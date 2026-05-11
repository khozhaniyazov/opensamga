import logging
import os

import httpx
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.services.openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

from ..config import settings
from ..database import get_db
from ..dependencies.plan_guards import PLAN_QUOTAS, _get_or_create_counter, _is_premium
from ..models import ChatThread, SubscriptionTier, User
from ..routers.auth import ALGORITHM, SECRET_KEY
from ..routers.chat import build_user_context_prompt, save_chat_messages, strip_reasoning_blocks
from ..services.chat.prompts import build_chat_system_prompt
from ..utils.onboarding import is_onboarding_completed

router = APIRouter(tags=["chat_websocket"])
logger = logging.getLogger(__name__)


import re as _re

_FAKE_CITATION_PATTERNS = [
    # "📚 Источник: Физика, 9 класс, стр 141." — whole line.
    _re.compile(r"(?mi)^\s*📚[^\n]*(?:Источник|Дереккөз)[^\n]*\n?"),
    # Bolded variants: "📚 *Источник: …*"
    _re.compile(r"(?mi)📚\s*\*(?:Источник|Дереккөз)[^\n*]*\*\s*\n?"),
    # Inline "(Не найдено в библиотеке)" residues.
    _re.compile(
        r"\s*\(\s*(?:Не\s+найдено\s+в\s+библиотеке|Кітапханада\s+табылмады)[^)]*\)",
        _re.IGNORECASE,
    ),
]


def _strip_fabricated_citations(text: str) -> str:
    """Scrub hallucinated citation markers from a WS-path answer.

    The WS path does not invoke the retrieval layer, so any
    ``📚 Источник: …`` line the model produces is fabricated. Remove
    them so we never stream a fake citation to the user. The REST path
    remains untouched — it has its own verified citation injection in
    ``app.routers.chat._with_hint``.
    """
    if not text:
        return text
    cleaned = text
    for pat in _FAKE_CITATION_PATTERNS:
        cleaned = pat.sub("", cleaned)
    # Collapse whitespace left behind by the removal.
    cleaned = _re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


DEFAULT_CHAT_MODEL = settings.OPENAI_MODEL or "gpt-4o-mini"
PREMIUM_CHAT_MODEL = settings.OPENAI_PREMIUM_MODEL or DEFAULT_CHAT_MODEL

openai_api_key = settings.OPENAI_API_KEY.get_secret_value() or os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    logger.warning("OPENAI_API_KEY not set for WebSocket chat")

# v3.4 (2026-04-29): register so lifespan shutdown can aclose(). Audit #5.
from ..utils.http_client_registry import register_http_client  # noqa: E402

http_client = register_http_client(httpx.AsyncClient(timeout=60.0))
client = AsyncOpenAI(api_key=openai_api_key, http_client=http_client) if openai_api_key else None


async def get_user_from_token(token: str, db: AsyncSession) -> User | None:
    """Authenticate a user from a JWT token for WebSocket sessions."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        if email is None:
            return None
        # v3.3: refresh tokens must NOT grant WS access. Mirrors the
        # gate in routers/auth.py:get_current_user. See CHANGELOG.
        if payload.get("type") == "refresh":
            return None

        query = (
            select(User)
            .options(
                selectinload(User.profile),
                selectinload(User.gamification_profile),
            )
            .where(User.email == email)
        )
        result = await db.execute(query)
        return result.scalars().first()
    except JWTError:
        return None
    except Exception:
        logger.exception("Error in WebSocket authentication")
        return None


@router.websocket("/ws/chat")
async def chat_websocket(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket endpoint for streaming AI chat responses.

    Client -> Server:
        {"type": "message", "content": "...", "language": "ru"}

    Server -> Client:
        {"type": "chunk", "content": "..."}
        {"type": "done"}
        {"type": "error", "message": "..."}
    """
    user = await get_user_from_token(token, db)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not is_onboarding_completed(user.profile):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if client is None:
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    await websocket.accept()
    logger.info("WebSocket connection accepted for user %s", user.email)

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") != "message":
                continue

            user_message = (data.get("content") or "").strip()
            language = data.get("language", "ru")
            # Session 22c (2026-04-22, BUG B3): the WS path previously had
            # NO thread support, so every message was persisted with
            # ``thread_id = NULL`` — invisible in the sidebar. Accept
            # an optional ``thread_id`` in the payload, validate it is
            # owned by the authenticated user, and forward it to
            # ``save_chat_messages``. Invalid/missing stays NULL so
            # legacy clients keep working.
            requested_thread_id = data.get("thread_id")
            effective_thread_id: int | None = None
            if requested_thread_id:
                try:
                    tid = int(requested_thread_id)
                    thread_row = await db.execute(
                        select(ChatThread).where(
                            ChatThread.id == tid,
                            ChatThread.user_id == user.id,
                        )
                    )
                    if thread_row.scalar_one_or_none() is not None:
                        effective_thread_id = tid
                except (ValueError, TypeError):
                    effective_thread_id = None
            if not user_message:
                continue

            logger.info("Processing WebSocket message from %s", user.email)

            try:
                user_context = await build_user_context_prompt(user, db, language)
            except Exception:
                logger.exception("Error building user context")
                user_context = None

            is_premium = _is_premium(user)
            plan = SubscriptionTier.PREMIUM if is_premium else SubscriptionTier.FREE
            model_name = PREMIUM_CHAT_MODEL if is_premium else DEFAULT_CHAT_MODEL

            try:
                system_content = build_chat_system_prompt(
                    language,
                    user_context=user_context,
                    model_name=model_name,
                    is_premium=is_premium,
                )
            except Exception:
                logger.exception("Error getting system prompt")
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "Ошибка при подготовке системы.",
                    }
                )
                await websocket.send_json({"type": "done"})
                continue

            # Session 22 (2026-04-22): the WS path has NO function-calling
            # wired in, so `consult_library` is not actually callable here.
            # The default system prompt still instructs the model to
            # "first call consult_library" for academic questions, so the
            # model compensates by FABRICATING a plausible citation like
            # "📚 Источник: Физика 9, Законы Ньютона" — which is worse
            # than saying nothing, because it looks authoritative.
            # Append an override that (a) forbids invented citations on
            # this channel and (b) suggests the user switch to the slower
            # REST path if they need a real textbook citation.
            no_tools_override_ru = (
                "ВНИМАНИЕ: в этом режиме у тебя НЕТ доступа к инструменту "
                "consult_library и ты НЕ можешь посмотреть учебники. "
                "Поэтому:\n"
                "• НИКОГДА не добавляй строку '📚 Источник: …' или любой "
                "другой маркер цитаты с номером страницы/класса/книги — "
                "ты их сейчас не знаешь и выдумывать нельзя.\n"
                "• Не пиши '(Не найдено в библиотеке)' — это тоже маркер "
                "инструмента, которого здесь нет.\n"
                "• Отвечай по своим знаниям, кратко и точно, без "
                "ссылок на конкретные учебники."
            )
            no_tools_override_kz = (
                "НАЗАР АУДАР: бұл режимде сенде consult_library құралына "
                "қолжеткізу ЖОҚ және оқулықтарды қарай алмайсың. Сондықтан:\n"
                "• '📚 Дереккөз: …' жолын немесе бет/сынып/кітап нөмірі "
                "бар кез келген цитата маркерін ЕШҚАШАН қоспа — сен оны "
                "қазір білмейсің, ойлап табуға болмайды.\n"
                "• '(Кітапханада табылмады)' деп те жазба — бұл да "
                "мұнда жоқ құралдың маркері.\n"
                "• Өз біліміңмен қысқа әрі дәл жауап бер, нақты "
                "оқулыққа сілтеме жасама."
            )
            system_content = (
                system_content
                + "\n\n"
                + (no_tools_override_kz if language == "kz" else no_tools_override_ru)
            )

            system_prompt = {"role": "system", "content": system_content}

            messages = [
                system_prompt,
                {"role": "user", "content": user_message},
            ]

            counter = await _get_or_create_counter(user.id, db)
            limits = PLAN_QUOTAS.get(plan, PLAN_QUOTAS[SubscriptionTier.FREE])
            limit = limits.get("chat_messages", 20)

            if counter.chat_messages >= limit:
                error_message = (
                    "Лимит сообщений исчерпан. Пожалуйста, подключите Premium."
                    if not is_premium
                    else "Дневной лимит Premium исчерпан."
                )
                await websocket.send_json({"type": "error", "message": error_message})
                await websocket.send_json({"type": "done"})
                continue

            # v3.3 (2026-04-29): charge the quota AFTER successful
            # generation. Previously we incremented `counter.chat_messages`
            # and committed before calling the model — every timeout,
            # content-filter trip, or OpenAI 5xx burned a daily message
            # for the user. We still want a "best-effort" guard against
            # double-spend on a flaky stream, so we pre-reserve in-memory
            # by tracking the increment locally and flushing only after
            # the model returns. If anything raises before the commit,
            # the increment never reaches the DB.
            full_response = ""
            try:
                logger.info("Calling chat model %s for user %s", model_name, user.email)
                response = await client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    stream=False,
                )
                # Charge the quota now that we have a response in hand.
                # v3.85 (2026-05-03): atomic UPDATE so two concurrent
                # WS turns from the same session can't both read N
                # and both write N+1 (the canonical TOCTOU pattern
                # fixed in v3.81 / v3.83).
                from ..dependencies.plan_guards import _atomic_charge_counter

                new_value = await _atomic_charge_counter(
                    user_id=counter.user_id, resource="chat_messages", db=db
                )
                counter.chat_messages = new_value
                await db.commit()

                full_response = strip_reasoning_blocks(response.choices[0].message.content or "")
                # Session 22 (2026-04-22): belt-and-suspenders — even
                # with the no-tools override, some models still emit a
                # fake "📚 Источник: …" line because it was in their
                # fine-tune data. Strip any such line out of the
                # assistant response before streaming. This protects
                # the WS path from producing misleading citations;
                # the REST path goes through the real retrieval layer
                # and re-injects a verified citation separately.
                full_response = _strip_fabricated_citations(full_response)
                if full_response:
                    for char in full_response:
                        await websocket.send_json({"type": "chunk", "content": char})
                else:
                    await websocket.send_json(
                        {
                            "type": "chunk",
                            "content": "Извините, не удалось получить ответ.",
                        }
                    )

                await websocket.send_json({"type": "done"})

                if full_response:
                    try:
                        await save_chat_messages(
                            user,
                            user_message,
                            full_response,
                            db,
                            thread_id=effective_thread_id,
                        )
                    except Exception:
                        logger.exception("Error saving chat history")
            except Exception:
                logger.exception("Error during streaming response")
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Извините, произошла ошибка при генерации ответа.",
                        }
                    )
                    await websocket.send_json({"type": "done"})
                except Exception:
                    logger.exception("Failed to notify client about WebSocket error")
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for user %s", user.email)
    except Exception:
        logger.exception("WebSocket error for user %s", user.email)
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Произошла ошибка соединения.",
                }
            )
        except Exception:
            logger.exception("Failed to send WebSocket connection error")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("WebSocket closed for user %s", user.email)
