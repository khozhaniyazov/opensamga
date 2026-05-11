"""Grounded MCQ synthesizer: expand thin mock_questions buckets using qwen-max
grounded on embedded textbook chunks.

Design notes (session 23-C+):
  * Source column value:  'synthesized_v1'
  * Anchor selection:     textbook_chunks 200..800 chars, chunk_embedding
                          NOT NULL, joined to textbooks.subject == target
                          subject. Language inferred from the chunk body
                          via Cyrillic-ratio + target-language heuristic
                          (textbooks.file_name hints are noisy).
  * One qwen-max chat call per anchor. Strict JSON output via
    response_format=json_object. One retry on bad JSON.
  * Dup guard: reject if content_hash collides with an existing row,
    or if correct_letter isn't in options, or if language-script check
    fails.
  * Every kept question is dumped to
      backend/scripts/synth_dump/{subject}_{lang}_{YYYYMMDD_HHMMSS}.jsonl
    so we keep a full audit trail alongside the DB insert.
  * Deliberately does NOT auto-dedupe against the existing bank -- run
    dedup_mock_questions.py dry-run afterwards and have boss approve.

ASCII-only stdout (Windows cmd.exe mojibake rule, QWEN.md).
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

import asyncpg  # noqa: E402

from app.services.qwen_dashscope import (  # noqa: E402
    dashscope_client,
    embed_texts,
)

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/unt_platform",
)
DUMP_DIR = REPO / "backend" / "scripts" / "synth_dump"
DUMP_DIR.mkdir(parents=True, exist_ok=True)

_WS_RE = re.compile(r"\s+")
_CYR_RE = re.compile(r"[\u0400-\u04FF]")
_LAT_RE = re.compile(r"[A-Za-z]")
# Kazakh-only letters: ў, ә, ғ, қ, ң, ө, ұ, ү, һ, і (lower+upper)
_KZ_SPECIFIC_RE = re.compile(
    r"[\u04D9\u0493\u049B\u04A3\u04E9\u04B1\u04AF\u04BB\u0456"
    r"\u04D8\u0492\u049A\u04A2\u04E8\u04B0\u04AE\u04BA\u0406]"
)


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip()).lower()


def _hash(question: str, options: dict[str, str]) -> str:
    keys = sorted(options)
    opts_joined = "|".join(f"{k}:{_norm(options[k])}" for k in keys)
    h = hashlib.sha256()
    h.update(_norm(question).encode("utf-8"))
    h.update(b"||")
    h.update(opts_joined.encode("utf-8"))
    return h.hexdigest()[:40]


def _cyr_ratio(s: str) -> float:
    alpha = sum(1 for c in s if c.isalpha())
    if not alpha:
        return 0.0
    return len(_CYR_RE.findall(s)) / alpha


def _lat_ratio(s: str) -> float:
    alpha = sum(1 for c in s if c.isalpha())
    if not alpha:
        return 0.0
    return len(_LAT_RE.findall(s)) / alpha


def _has_kz_specific(s: str) -> bool:
    return bool(_KZ_SPECIFIC_RE.search(s or ""))


def infer_chunk_lang(content: str) -> str:
    """Classify chunk body as one of {en, kz, ru}."""
    if not content:
        return "??"
    if _lat_ratio(content) > 0.75:
        return "en"
    if _has_kz_specific(content):
        return "kz"
    if _cyr_ratio(content) > 0.55:
        return "ru"
    return "??"


def lang_ok_for_target(text: str, target: str) -> bool:
    """True if generated MCQ text is in the requested language."""
    t = target.lower()
    if t.startswith("en"):
        return _lat_ratio(text) > 0.80
    if t.startswith("kz"):
        # Kazakh generation must include at least one kz-specific letter.
        return _cyr_ratio(text) > 0.55 and _has_kz_specific(text)
    if t.startswith("ru"):
        return _cyr_ratio(text) > 0.60 and not _has_kz_specific(text)
    return True


def _difficulty_from_text(q: str, expl: str) -> str:
    n = len(q)
    if n > 180 or (expl and len(expl) > 120):
        return "HARD"
    if n >= 60:
        return "MEDIUM"
    return "EASY"


SELECT_ANCHORS_SQL = """
SELECT tc.id          AS chunk_id,
       tc.content     AS content,
       tc.page_number,
       t.id           AS textbook_id,
       t.title        AS book_title,
       t.subject      AS book_subject,
       t.grade        AS book_grade,
       t.file_name
  FROM textbook_chunks tc
  JOIN textbooks t ON t.id = tc.textbook_id
 WHERE LENGTH(tc.content) BETWEEN 200 AND 800
   AND tc.chunk_embedding IS NOT NULL
   AND LOWER(t.subject) = LOWER($1)
 ORDER BY RANDOM()
 LIMIT $2
"""


INSERT_SQL = """
INSERT INTO mock_questions
    (subject, grade, language, source, source_url, content_hash,
     topic_tag, question_text, options, correct_answer, difficulty)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9::json, $10, $11)
ON CONFLICT (content_hash) DO NOTHING
RETURNING id
"""


EMBED_UPDATE_SQL = """
UPDATE mock_questions SET question_embedding = $1::vector
 WHERE id = $2
"""


SYS_PROMPT_RU = """Ты — эксперт по казахстанскому ЕНТ нового формата (после 2023).
Тебе дают УЗКИЙ фрагмент учебника как единственный источник правды.

Составь ОДИН новый тестовый вопрос с выбором ответа строго по фрагменту.

Жёсткие требования:
1. Вопрос должен быть ФАКТИЧЕСКИ выводим из фрагмента. Если вывести нельзя — верни {"skip":true,"reason":"..."}.
2. 4 варианта (A–D), ровно ОДИН правильный; 3 дистрактора правдоподобны, но фальшивы по фрагменту.
3. Вопрос и все варианты — на русском языке (без смеси с казахским/английским).
4. Не упоминай страницу, параграф, учебник, фразы «в тексте сказано».
5. Не используй буквы-плейсхолдеры («верно всё», «ни один»).

Верни СТРОГИЙ JSON:
{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A|B|C|D","explanation":"кратко почему правильный","topic":"подтема"}"""

SYS_PROMPT_KZ = """Сен — жаңа форматтағы қазақстандық ҰБТ (2023+) маманысың.
Саған оқулықтың ТАР үзіндісі жалғыз ақиқат көзі ретінде беріледі.

Осы үзінді бойынша бір тест сұрағын құрастыр.

Қатаң талаптар:
1. Сұрақ тек осы үзіндіден шығарылуы тиіс. Шығара алмасаң — {"skip":true,"reason":"..."} қайтар.
2. 4 нұсқа (A–D), тек бір дұрысы; 3 қате нұсқа сенімді көрінуі керек.
3. Сұрақ пен барлық нұсқалар ҚАЗАҚ тілінде болсын (орыс/ағылшынмен араластырма).
4. Бет, параграф, оқулық туралы айтпа, «мәтінде жазылған» деме.
5. «Барлығы дұрыс», «ешқайсысы» тәрізді толтырғыш-жауаптарды қолданба.

ТЕК таза JSON қайтар:
{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A|B|C|D","explanation":"неге дұрыс екенін қысқаша","topic":"ішкі тақырып"}"""

SYS_PROMPT_EN = """You are an expert on the new-format (post-2023) Kazakhstani UNT exam.
You are given a NARROW textbook passage as the ONLY source of truth.

Compose ONE new multiple-choice question strictly grounded in the passage.

Hard requirements:
1. The question must be factually derivable from the passage. If it cannot be, return {"skip":true,"reason":"..."}.
2. Exactly 4 options (A-D), exactly ONE correct; the 3 distractors must be plausible but false per the passage.
3. The question and all options must be in ENGLISH (no mixing with Russian/Kazakh).
4. Do not mention page numbers, paragraphs, the textbook, or phrases like "according to the text".
5. Do not use placeholder answers ("all of the above", "none of the above").

Return STRICT JSON:
{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A|B|C|D","explanation":"short reason why correct","topic":"subtopic"}"""


def build_user_prompt(passage: str, subject: str, language: str) -> str:
    if language.startswith("ru"):
        return (
            f"Предмет: {subject}\n"
            f'Фрагмент учебника:\n"""\n{passage.strip()}\n"""\n'
            "Составь один новый вопрос."
        )
    if language.startswith("en"):
        return (
            f"Subject: {subject}\n"
            f'Textbook passage:\n"""\n{passage.strip()}\n"""\n'
            "Compose one new question."
        )
    return (
        f'Пән: {subject}\nОқулық үзіндісі:\n"""\n{passage.strip()}\n"""\nБір жаңа сұрақ құрастыр.'
    )


def _call_qwen(
    subject: str, language: str, passage: str, model: str, timeout: int = 60
) -> dict[str, Any] | None:
    client = dashscope_client()
    if language.startswith("ru"):
        sys_prompt = SYS_PROMPT_RU
    elif language.startswith("en"):
        sys_prompt = SYS_PROMPT_EN
    else:
        sys_prompt = SYS_PROMPT_KZ
    user = build_user_prompt(subject=subject, passage=passage, language=language)
    for attempt in (1, 2):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user},
                ],
                temperature=0.7,
                max_tokens=900,
                response_format={"type": "json_object"},
                timeout=timeout,
            )
            raw = (resp.choices[0].message.content or "").strip()
        except Exception as e:
            print(f"    [qwen] attempt {attempt} ERR: {type(e).__name__}: {e}")
            if attempt == 2:
                return None
            time.sleep(1.5)
            continue
        try:
            return json.loads(raw)
        except Exception:
            # Some models emit fenced code: try to pull the JSON out.
            m = re.search(r"\{[\s\S]*\}", raw)
            if m:
                try:
                    return json.loads(m.group(0))
                except Exception:
                    pass
            print(f"    [qwen] attempt {attempt} bad JSON: {raw[:120]}...")
            if attempt == 2:
                return None
            time.sleep(1.0)
    return None


VERIFIER_SYS = """Ты — строгий факт-чекер для ЕНТ.
Тебе даёт ТОЛЬКО ОДИН фрагмент учебника + сгенерированный вопрос и
предлагаемый правильный ответ. Твоя задача — сказать, следует ли этот
ответ ОДНОЗНАЧНО и НАПРЯМУЮ из фрагмента (без внешних знаний).

Критерии отказа (verdict=NO):
- требуется знание вне фрагмента;
- фрагмент говорит о другом;
- в фрагменте несколько трактовок, ответ только одна из них;
- дистракторы тоже корректны по фрагменту;
- цифры/названия/формулы в ответе не дословно из фрагмента.

Верни СТРОГИЙ JSON:
{"verdict":"YES|NO","confidence":0.0-1.0,"reason":"одно короткое предложение"}"""

VERIFIER_SYS_EN = """You are a strict fact-checker for the UNT exam.
You are given ONE textbook passage plus a generated question and
its proposed correct answer. Decide whether that answer follows
UNAMBIGUOUSLY and DIRECTLY from the passage (no outside knowledge).

Reject (verdict=NO) if:
- the answer requires knowledge outside the passage;
- the passage is about something else;
- the passage supports multiple interpretations and the answer is only one of them;
- distractors are also correct per the passage;
- numbers / names / formulas in the answer are not verbatim in the passage.

Return STRICT JSON:
{"verdict":"YES|NO","confidence":0.0-1.0,"reason":"one short sentence"}"""


def _verify_grounded(
    subject: str,
    passage: str,
    q: dict[str, Any],
    model: str,
    timeout: int = 45,
    language: str = "ru",
) -> tuple[bool, str, float]:
    """Second pass: ask model to confirm the correct answer follows from the
    passage. Returns (is_grounded, reason, confidence)."""
    client = dashscope_client()
    opts_str = "\n".join(f"  {k}) {v}" for k, v in q["options"].items())
    if language.startswith("en"):
        sys_prompt = VERIFIER_SYS_EN
        user = (
            f"Subject: {subject}\n"
            f'Passage:\n"""\n{passage.strip()}\n"""\n\n'
            f"Question: {q['question']}\n"
            f"Options:\n{opts_str}\n"
            f"Proposed correct answer: {q['correct']}) "
            f"{q['options'][q['correct']]}\n\n"
            "Does this answer follow UNAMBIGUOUSLY from the passage?"
        )
    else:
        sys_prompt = VERIFIER_SYS
        user = (
            f"Предмет: {subject}\n"
            f'Фрагмент:\n"""\n{passage.strip()}\n"""\n\n'
            f"Вопрос: {q['question']}\n"
            f"Варианты:\n{opts_str}\n"
            f"Предложенный правильный ответ: {q['correct']}) "
            f"{q['options'][q['correct']]}\n\n"
            "Следует ли этот ответ ОДНОЗНАЧНО из фрагмента?"
        )
    for attempt in (1, 2):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user},
                ],
                temperature=0.0,
                max_tokens=200,
                response_format={"type": "json_object"},
                timeout=timeout,
            )
            raw = (resp.choices[0].message.content or "").strip()
            obj = json.loads(raw)
            v = (obj.get("verdict") or "").upper()
            c = float(obj.get("confidence") or 0.0)
            r = (obj.get("reason") or "")[:80]
            if v == "YES" and c >= 0.70:
                return True, r, c
            return False, f"{v}:{r}", c
        except Exception as e:
            if attempt == 2:
                return False, f"verify_err:{type(e).__name__}", 0.0
            time.sleep(1.0)
    return False, "verify_unknown", 0.0


def validate(obj: dict[str, Any], language: str) -> tuple[bool, str]:
    if not isinstance(obj, dict):
        return False, "not_dict"
    if obj.get("skip") is True:
        return False, f"model_skipped:{obj.get('reason', '')[:40]}"
    q = obj.get("question") or ""
    opts = obj.get("options") or {}
    correct = (obj.get("correct") or "").strip().upper()
    if not isinstance(q, str) or len(q.strip()) < 20:
        return False, "q_too_short"
    if not isinstance(opts, dict) or len(opts) < 4:
        return False, "opts_lt4"
    norm_opts = {k.strip().upper(): str(v).strip() for k, v in opts.items() if str(v).strip()}
    if len(norm_opts) < 4:
        return False, "opts_empty"
    if correct not in norm_opts:
        return False, f"correct_not_in_opts:{correct}"
    # Language script check
    combined = q + " " + " ".join(norm_opts.values())
    if not lang_ok_for_target(combined, language):
        return False, "lang_mismatch"
    # No duplicate option values
    if len({_norm(v) for v in norm_opts.values()}) < len(norm_opts):
        return False, "dup_option_values"
    # Placeholder bans
    banned = ("все перечисленные", "ни один", "не знаю", "бәрі дұрыс", "ешқайсысы")
    lower = (q + " " + " ".join(norm_opts.values())).lower()
    if any(b in lower for b in banned):
        return False, "banned_phrase"
    obj["question"] = q.strip()
    obj["options"] = norm_opts
    obj["correct"] = correct
    return True, "ok"


async def collect_anchors(
    conn: asyncpg.Connection, subject: str, language: str, n_candidates: int
) -> list[asyncpg.Record]:
    """Fetch candidate anchors whose inferred language matches target."""
    # Over-fetch, filter by language in Python because the DB rows have no
    # pre-computed language column.
    over = max(n_candidates * 8, 80)
    rows = await conn.fetch(SELECT_ANCHORS_SQL, subject, over)
    kept = []
    for r in rows:
        if infer_chunk_lang(r["content"]) == language:
            kept.append(r)
            if len(kept) >= n_candidates:
                break
    return kept


async def _embed_only_new(conn: asyncpg.Connection, max_rows: int) -> int:
    rows = await conn.fetch(
        """
        SELECT id, question_text FROM mock_questions
         WHERE source = 'synthesized_v1'
           AND question_embedding IS NULL
         ORDER BY id LIMIT $1
    """,
        max_rows,
    )
    if not rows:
        return 0
    pairs = [(r["id"], r["question_text"]) for r in rows]
    n = 0
    MAX_CHARS = 2000
    for i in range(0, len(pairs), 10):
        batch = pairs[i : i + 10]
        texts = [(p[1] or "")[:MAX_CHARS] or "(empty)" for p in batch]
        try:
            vectors = await asyncio.to_thread(embed_texts, texts)
        except Exception as e:
            print(f"  embed ERR {i}:{i + 10}: {e!r}")
            continue
        for (row_id, _), vec in zip(batch, vectors, strict=False):
            lit = "[" + ",".join(f"{v:.6f}" for v in vec) + "]"
            await conn.execute(EMBED_UPDATE_SQL, lit, row_id)
            n += 1
    return n


async def run(
    subject: str,
    language: str,
    target_count: int,
    pilot_n: int | None,
    model: str,
    dry_run: bool,
    skip_embed: bool,
) -> None:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_subj = subject.replace(" ", "_").lower()
    dump_path = DUMP_DIR / f"{safe_subj}_{language}_{ts}.jsonl"

    conn = await asyncpg.connect(DSN)
    try:
        before_bucket = await conn.fetchval(
            "SELECT COUNT(*) FROM mock_questions WHERE subject=$1 AND language=$2",
            subject,
            language,
        )
        print(f"bucket before:  {subject} / {language} = {before_bucket}")
        if pilot_n is not None:
            to_generate = pilot_n
        else:
            to_generate = max(target_count - before_bucket, 0)
        if to_generate == 0:
            print("nothing to do")
            return
        print(f"to_generate:    {to_generate}")

        # Anchor pool: over-sample 3x so we have replacements after rejects.
        wanted = to_generate * 3
        anchors = await collect_anchors(conn, subject, language, wanted)
        print(f"anchors pool:   {len(anchors)} (requested {wanted})")
        if not anchors:
            print("  NO ANCHORS. This bucket is OCR-blocked for synthesis.")
            return

        stats = Counter()
        kept_rows: list[dict[str, Any]] = []
        dump_fp = dump_path.open("w", encoding="utf-8")
        used_content_hashes: set[str] = set()
        try:
            for r in anchors:
                if len(kept_rows) >= to_generate:
                    break
                passage = r["content"]
                obj = _call_qwen(subject, language, passage, model)
                if obj is None:
                    stats["qwen_fail"] += 1
                    continue
                ok, reason = validate(obj, language)
                if not ok:
                    stats[f"rej_{reason}"] += 1
                    continue
                opts = obj["options"]
                ch = _hash(obj["question"], opts)
                if ch in used_content_hashes:
                    stats["rej_dup_in_batch"] += 1
                    continue
                # DB-level dup check
                existing = await conn.fetchval(
                    "SELECT 1 FROM mock_questions WHERE content_hash=$1", ch
                )
                if existing:
                    stats["rej_dup_in_db"] += 1
                    continue
                # Second pass: grounding verifier
                grounded, vreason, vconf = _verify_grounded(
                    subject, passage, obj, model, language=language
                )
                if not grounded:
                    stats[f"rej_verifier_{vreason.split(':', 1)[0]}"] += 1
                    continue
                used_content_hashes.add(ch)
                topic = (obj.get("topic") or "general").strip() or "general"
                record = {
                    "subject": subject,
                    "grade": r["book_grade"],
                    "language": language,
                    "source": "synthesized_v1",
                    "source_url": None,
                    "content_hash": ch,
                    "topic_tag": f"{subject} > synthesized:{topic}"[:120],
                    "question_text": obj["question"],
                    "options_json": json.dumps(opts, ensure_ascii=False),
                    "correct_answer": obj["correct"],
                    "difficulty": _difficulty_from_text(
                        obj["question"], obj.get("explanation") or ""
                    ),
                    # Audit payload:
                    "_anchor_chunk_id": r["chunk_id"],
                    "_anchor_page": r["page_number"],
                    "_anchor_book": r["book_title"],
                    "_anchor_file": r["file_name"],
                    "_anchor_quote": passage[:240],
                    "_model": model,
                    "_explanation": obj.get("explanation", ""),
                    "_verifier_reason": vreason,
                    "_verifier_confidence": vconf,
                }
                kept_rows.append(record)
                dump_fp.write(json.dumps(record, ensure_ascii=False) + "\n")
                dump_fp.flush()
                stats["kept"] += 1
                if stats["kept"] % 5 == 0:
                    print(
                        f"  [{stats['kept']}/{to_generate}] q_ok "
                        f"(rejects so far: "
                        f"{sum(v for k, v in stats.items() if k.startswith('rej_'))})"
                    )
        finally:
            dump_fp.close()

        print(f"\ndump -> {dump_path}")
        print(f"stats: {dict(stats)}")
        print(f"kept:  {len(kept_rows)}")

        if dry_run:
            print("DRY RUN: not writing to DB")
            return
        if not kept_rows:
            print("nothing to insert")
            return

        print("\n-- inserting into mock_questions --")
        new_ids: list[int] = []
        for r in kept_rows:
            new_id = await conn.fetchval(
                INSERT_SQL,
                r["subject"],
                r["grade"],
                r["language"],
                r["source"],
                r["source_url"],
                r["content_hash"],
                r["topic_tag"],
                r["question_text"],
                r["options_json"],
                r["correct_answer"],
                r["difficulty"],
            )
            if new_id is not None:
                new_ids.append(new_id)
        print(f"new_inserts:    {len(new_ids)}")

        after_bucket = await conn.fetchval(
            "SELECT COUNT(*) FROM mock_questions WHERE subject=$1 AND language=$2",
            subject,
            language,
        )
        print(
            f"bucket after:   {subject} / {language} = {after_bucket}  "
            f"(+{after_bucket - before_bucket})"
        )

        if skip_embed:
            print("--skip-embed: not embedding")
        else:
            missing = await conn.fetchval(
                "SELECT COUNT(*) FROM mock_questions "
                "WHERE source='synthesized_v1' "
                "  AND question_embedding IS NULL"
            )
            print(f"to embed:       {missing}")
            n = await _embed_only_new(conn, missing)
            print(f"embedded:       {n}")

        total = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        embedded = await conn.fetchval(
            "SELECT COUNT(*) FROM mock_questions WHERE question_embedding IS NOT NULL"
        )
        print(f"\nmock_questions total: {total}  embedded: {embedded}")
    finally:
        await conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--subject", required=True, help='Canonical subject name, e.g. "Mathematical Literacy"'
    )
    ap.add_argument("--language", required=True, choices=["ru", "kz", "en"])
    ap.add_argument(
        "--target-count", type=int, default=500, help="Stop when bucket reaches this count"
    )
    ap.add_argument(
        "--pilot-n",
        type=int,
        default=None,
        help="If set, generate exactly N and stop (overrides --target-count)",
    )
    ap.add_argument("--model", default="qwen-max")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-embed", action="store_true")
    args = ap.parse_args()
    asyncio.run(
        run(
            args.subject,
            args.language,
            args.target_count,
            args.pilot_n,
            args.model,
            args.dry_run,
            args.skip_embed,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
