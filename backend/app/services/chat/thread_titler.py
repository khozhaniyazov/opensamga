"""
app/services/chat/thread_titler.py
----------------------------------
Auto-rename chat threads after the first user/assistant turn lands.

Rationale (s26 phase 8 — closes E1/E2 from the QA report):
the FE already pre-seeds the thread title with the first ~60 chars of the
first prompt, but boss wants something nicer ("Шансы на грант КБТУ" instead
of "Какие у меня шансы на грант если я набрал…"). After the assistant turn
is committed we ask the LLM for a ≤6-word topic and overwrite the title —
but only when it's safe to do so:

  * thread has exactly 2 messages (one user + one assistant — i.e. this
    really was the first turn)
  * stored title is NULL **or** equals the first 60 chars of the user
    prompt (the FE auto-seed). Anything else is treated as a manual
    rename and we keep our hands off.

Returns the new title on success, ``None`` when we deliberately skipped
or the LLM call blew up. Callers can pass that title into a
``thread_renamed`` SSE event so the rail flips live.
"""

from __future__ import annotations

import logging
import os
import re

from openai import AsyncOpenAI
from sqlalchemy import func as sqlfunc
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import ChatMessage as ChatMessageModel
from app.models import ChatThread
from app.services.openai_failover import (
    AsyncOpenAIFailoverClient as AsyncOpenAIFailover,
)

logger = logging.getLogger(__name__)

# Same KZ-specific letters used in chunk_completer.detect_language but
# normalised — we lowercase before lookup.
_KZ_CHARS = set("әіңғүұқөһ")
# Cyrillic block (RU + shared with KZ).
_CYR_RE = re.compile(r"[а-яё]", re.IGNORECASE)


def detect_lang(text: str) -> str:
    """Return "kz", "ru", or "en". Heuristic, no external lib.

    * any KZ-specific lowercase letter present → "kz"
    * else any Cyrillic letter → "ru"
    * else → "en"
    """
    if not text:
        return "ru"
    lowered = text.lower()
    if any(ch in _KZ_CHARS for ch in lowered):
        return "kz"
    if _CYR_RE.search(lowered):
        return "ru"
    return "en"


_SYS_PROMPTS = {
    "ru": (
        "Ты помощник, который придумывает короткие заголовки для чата. "
        "Дай заголовок на русском: 2–6 слов, без кавычек, без точки в конце, "
        "без эмодзи. Заголовок описывает тему диалога с точки зрения пользователя. "
        "ВАЖНО: ответ — ТОЛЬКО сам заголовок, без префиксов «Заголовок:», "
        "без рассуждений, без тегов <think>. Только заголовок, ничего больше."
    ),
    "kz": (
        "Сен чат тақырыптарын қысқа атаумен белгілейтін көмекшісің. "
        "Қазақ тілінде 2–6 сөзден тұратын атау бер: тырнақшасыз, "
        "соңында нүкте қойма, эмодзи қоспа. Атау — қолданушы тұрғысынан тақырып. "
        "МАҢЫЗДЫ: жауап — ТЕК атау, «Атау:» сияқты префикстерсіз, "
        "ой жүгірту мәтінінсіз, <think> тегсіз. Тек атау, басқа ештеңе."
    ),
    "en": (
        "You are an assistant that writes short chat titles. "
        "Reply with 2–6 English words: no quotes, no trailing period, no emoji. "
        "The title is the user's topic, not the answer. "
        "IMPORTANT: respond with ONLY the title itself — no 'Title:' prefix, "
        "no reasoning, no <think> tags. Just the title, nothing else."
    ),
}


# Max characters of each side we feed the LLM. Keeps tokens cheap.
_MAX_USER_CHARS = 600
_MAX_ASSISTANT_CHARS = 400
# Hard cap on the returned title (mirrors backend column policy: 120).
_TITLE_HARD_CAP = 80


_THINK_RE = re.compile(r"<think>.*?(?:</think>|$)", re.IGNORECASE | re.DOTALL)
# Common preambles models emit before the actual title.
_PREAMBLE_RE = re.compile(
    r"^(?:title|заголовок|атау|topic|тема|chat title|"
    r"here(?:'s| is)(?: a)? (?:short )?title|"
    r"the (?:short )?title (?:is|would be))[\s::\-—]+",
    re.IGNORECASE,
)


def _clean_title(raw: str) -> str:
    """Strip quotes/brackets/trailing punctuation the model loves to add.

    Also defends against reasoning-style outputs: <think>…</think> blocks
    (some Qwen/Reasoning-class models leak these), and labelled preambles
    like "Title: …" / "Заголовок: …".
    """
    t = (raw or "").strip()
    # 1) Strip <think>…</think> reasoning blocks (closed AND open-ended).
    t = _THINK_RE.sub("", t).strip()
    # If the model only emitted a reasoning tag and nothing past it, bail.
    if not t:
        return ""
    # 2) If multiple lines, take the last non-empty one — title usually
    #    comes after any preamble/reasoning the model dumped.
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    if len(lines) > 1:
        t = lines[-1]
    # 3) Strip "Title: " / "Заголовок: " labels.
    t = _PREAMBLE_RE.sub("", t).strip()
    # 4) Drop wrapping quotes (« » " " ' ' " ").
    t = re.sub(r'^[\s"\'«»“”„‚‹›`]+', "", t)
    t = re.sub(r'[\s"\'«»“”„‚‹›`]+$', "", t)
    # 5) Drop trailing terminal punctuation.
    t = re.sub(r"[\s.!?…]+$", "", t)
    # 6) Collapse internal whitespace.
    t = re.sub(r"\s+", " ", t)
    return t[:_TITLE_HARD_CAP]


async def _summarize_title(
    user_msg: str,
    assistant_msg: str,
    lang: str,
) -> str | None:
    """One-shot LLM call. Returns cleaned title or None on failure."""
    sys_prompt = _SYS_PROMPTS.get(lang, _SYS_PROMPTS["ru"])
    u = (user_msg or "").strip()[:_MAX_USER_CHARS]
    a = (assistant_msg or "").strip()[:_MAX_ASSISTANT_CHARS]
    if not u:
        return None

    user_block = (
        f"Сообщение пользователя:\n{u}\n\nОтвет ассистента:\n{a}\n\nЗаголовок:"
        if lang == "ru"
        else (
            f"Қолданушы хабарламасы:\n{u}\n\nАссистент жауабы:\n{a}\n\nАтау:"
            if lang == "kz"
            else f"User message:\n{u}\n\nAssistant reply:\n{a}\n\nTitle:"
        )
    )

    # Title summarization is a stateless, cheap, low-stakes call. Use
    # DashScope (qwen-plus) directly so we don't tie up the failover
    # rotation that the main agent loop depends on, and so we get a
    # plain instruction-tuned model that doesn't burn tokens inside
    # <think> blocks like the failover candidates do.
    ds_key = os.getenv("DASHSCOPE_API_KEY") or settings.DASHSCOPE_API_KEY.get_secret_value()
    ds_base = (
        os.getenv("DASHSCOPE_BASE_URL")
        or settings.DASHSCOPE_BASE_URL
        or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )

    use_failover = False
    if ds_key:
        api_key = ds_key
        base_url: str | None = ds_base
        model = "qwen-plus"
    else:
        api_key = os.getenv("OPENAI_API_KEY") or settings.OPENAI_API_KEY.get_secret_value() or ""
        base_url = None
        model = (
            os.getenv("OPENAI_PREMIUM_MODEL")
            or os.getenv("OPENAI_MODEL")
            or settings.OPENAI_PREMIUM_MODEL
            or settings.OPENAI_MODEL
            or "gpt-4o-mini"
        )
        use_failover = True

    if not api_key:
        logger.warning("thread_titler: no API key available, skipping rename")
        return None

    try:
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        if use_failover:
            client = AsyncOpenAIFailover(**client_kwargs)
        else:
            client = AsyncOpenAI(**client_kwargs)
        # NB: max_tokens stays moderate. For DashScope qwen-plus this is
        # plenty; if we ever fall back to the failover rotation a
        # reasoning-class model may still burn most of these tokens
        # inside <think>…</think>, which _clean_title strips.
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_block},
            ],
            temperature=0.2,
            max_tokens=64,
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception as exc:
        logger.warning("thread_titler: LLM call failed: %s", exc)
        return None

    cleaned = _clean_title(raw)
    if not cleaned:
        logger.debug(
            "thread_titler: cleaned title empty after sanitization (raw len=%d)",
            len(raw),
        )
        return None
    # If the model ignored the word limit and produced a sentence, take
    # the first clause (split on common punctuation) and clip to ~6 words.
    if len(cleaned.split()) > 6:
        first_clause = re.split(r"[.!?:;\n—–]", cleaned, maxsplit=1)[0].strip()
        words = first_clause.split()
        if len(words) >= 2:
            cleaned = " ".join(words[:6])
        else:
            cleaned = " ".join(cleaned.split()[:6])
    word_count = len(cleaned.split())
    if word_count < 2:
        logger.info("thread_titler: model returned %d words, skipping", word_count)
        return None
    return cleaned


def _seed_match(user_msg: str | None) -> str | None:
    """Reproduce the FE's auto-seed (`text.slice(0, 60).trim()`) so we can
    detect "this title was the FE auto-seed, safe to overwrite"."""
    if not user_msg:
        return None
    seed = user_msg[:60].strip()
    return seed or None


async def auto_rename_thread_if_first_turn(
    db: AsyncSession,
    thread_id: int,
    user_id: int,
    user_msg: str,
    assistant_msg: str,
) -> str | None:
    """Inline-after-save auto-rename.

    Returns the new title on success, ``None`` when we skipped (manual
    rename detected, not first turn, LLM unavailable, etc.). Never raises;
    persistence path treats failures as non-fatal.
    """
    if not thread_id or not user_id:
        return None

    try:
        # 1) Confirm exactly one user turn so far. >1 = mid-conversation; we
        #    don't rename later in the thread.
        user_count_q = select(sqlfunc.count(ChatMessageModel.id)).where(
            ChatMessageModel.thread_id == thread_id,
            ChatMessageModel.user_id == user_id,
            ChatMessageModel.role == "user",
        )
        user_count = (await db.execute(user_count_q)).scalar_one()
        if user_count != 1:
            return None

        # 2) Read current title so we can decide whether to overwrite.
        title_q = select(ChatThread.title).where(
            ChatThread.id == thread_id,
            ChatThread.user_id == user_id,
        )
        current_title = (await db.execute(title_q)).scalar_one_or_none()
        if current_title is None:
            current_title_norm = None
        else:
            current_title_norm = current_title.strip()

        seed = _seed_match(user_msg)
        # Only allowed to rename if title is NULL/empty OR equals the FE seed.
        # Anything else = manual rename, hands off.
        if current_title_norm and seed and current_title_norm != seed:
            return None
        if current_title_norm and not seed:
            # No user_msg available but title exists → can't tell, skip.
            return None
    except Exception as exc:
        logger.warning("thread_titler: preflight read failed: %s", exc)
        return None

    # 3) Generate the new title.
    lang = detect_lang(user_msg)
    new_title = await _summarize_title(user_msg, assistant_msg, lang)
    if not new_title:
        return None

    # 4) Conditional UPDATE: re-check the same guard at write time so we
    #    don't race a manual rename between preflight and commit.
    try:
        stmt = (
            update(ChatThread)
            .where(
                ChatThread.id == thread_id,
                ChatThread.user_id == user_id,
            )
            .values(title=new_title)
        )
        if seed:
            stmt = stmt.where((ChatThread.title.is_(None)) | (ChatThread.title == seed))
        else:
            stmt = stmt.where(ChatThread.title.is_(None))
        result = await db.execute(stmt)
        await db.commit()
        if (result.rowcount or 0) == 0:
            # Race lost (user renamed manually between preflight and write).
            return None
    except Exception as exc:
        logger.warning("thread_titler: UPDATE failed: %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass
        return None

    return new_title
