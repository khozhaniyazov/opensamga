import logging
from typing import Any

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from app.models import (
    ChatMessage as ChatMessageModel,
)
from app.models import (
    ChatThread,
    FailedQuery,
    FailedQueryStatus,
    User,
)
from app.utils.sanitization import sanitize_text

logger = logging.getLogger(__name__)


async def save_chat_messages(
    current_user: User | None,
    user_message: str | None,
    assistant_message: str,
    db: AsyncSession,
    assistant_metadata: dict[str, Any] | None = None,
    thread_id: int | None = None,
):
    """Helper function to save chat messages to database.

    Phase A (session 20c): optionally persist ``assistant_metadata`` (e.g.
    ``{"book_id": 21, "page_number": 142, "rag_query_log_id": 9123}``) on the
    assistant row via ``ChatMessage.message_metadata`` (JSON column that
    existed but had zero writers pre-Phase-A). Reopened threads can then
    restore their citation chips and feedback targets without re-parsing the
    prose marker.

    Session 22 (BUG-S22-sidebar): optional ``thread_id`` scopes the rows to
    a ChatThread (left-rail sidebar). None = legacy "Main chat" bucket.
    When a non-NULL thread_id is set we also bump its ``updated_at`` so the
    sidebar's "most-recent" sort is correct.
    """
    if not current_user:
        return

    try:
        # Save user's message (only if provided and not empty)
        if user_message and user_message.strip():
            # Sanitize user input before storage
            sanitized_content = sanitize_text(user_message)
            user_msg = ChatMessageModel(
                user_id=current_user.id,
                role="user",
                content=sanitized_content,
                thread_id=thread_id,
            )
            db.add(user_msg)

        # Always save assistant's response. Phase A: attach metadata when
        # the caller knows the book_id/page_number or rag_query_log.id that
        # served this turn so the client can reload it.
        assistant_kwargs = {
            "user_id": current_user.id,
            "role": "assistant",
            "content": assistant_message,
            "thread_id": thread_id,
        }
        if assistant_metadata:
            # Strip None-valued entries so we don't store noise.
            clean_meta = {k: v for k, v in assistant_metadata.items() if v is not None}
            if clean_meta:
                assistant_kwargs["message_metadata"] = clean_meta
        assistant_msg = ChatMessageModel(**assistant_kwargs)
        db.add(assistant_msg)

        # Bump thread's updated_at so the sidebar shows most-recent first.
        if thread_id is not None:
            await db.execute(
                update(ChatThread)
                .where(
                    ChatThread.id == thread_id,
                    ChatThread.user_id == current_user.id,
                )
                .values(updated_at=func.now())
            )

        await db.commit()
    except Exception:
        logger.exception("Failed to save chat messages")
        try:
            await db.rollback()
        except Exception:
            logger.debug("db.rollback() failed in save_chat_messages", exc_info=True)


async def capture_failed_query(
    user_query: str,
    ai_response: str,
    current_user: User | None,
    tool_calls: list[dict] | None = None,
    db: AsyncSession = None,
):
    """
    Capture a failed query for later analysis.
    This runs in the background and doesn't block the response.
    """
    if not db:
        return

    try:
        failed_query = FailedQuery(
            user_id=current_user.id if current_user else None,
            user_query=user_query,
            ai_response=ai_response,
            status=FailedQueryStatus.PENDING,
            tool_calls_attempted=tool_calls or [],
        )
        db.add(failed_query)
        await db.commit()
    except Exception:
        logger.exception("Failed to capture failed query")
        try:
            await db.rollback()
        except Exception:
            logger.debug("db.rollback() failed in capture_failed_query", exc_info=True)


def detect_failure(ai_response: str) -> bool:
    """
    Detect if the AI response indicates a failure to find information.
    Returns True if failure phrases are detected.
    """
    if not ai_response:
        return False
