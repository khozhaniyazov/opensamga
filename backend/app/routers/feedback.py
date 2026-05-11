"""
Feedback router - session 15 (2026-04-21).

Thumbs-up / thumbs-down signal for assistant chat messages. Each row
carries:
  * message_id   - client-side unique id for the assistant reply
  * rating       - -1 (down), 0 (cleared), +1 (up)
  * comment      - optional free-text reason (truncated to 2000 chars)
  * rag_query_log_id - nullable FK, linking this feedback back to the
                       RAG call that served the answer. Set by the
                       caller if known.

Idempotent on (message_id, user_id): last-write-wins via UPSERT-like
UPDATE, or INSERT when none exists. We avoid a DB unique index so the
migration stays simple and so anonymous feedback (user_id NULL) can
coexist.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, conint
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from .auth import get_current_user_optional

router = APIRouter(prefix="/feedback", tags=["feedback"])


class ChatFeedbackIn(BaseModel):
    message_id: str = Field(..., min_length=1, max_length=128)
    rating: conint(ge=-1, le=1)  # type: ignore[valid-type]
    comment: str | None = Field(None, max_length=2000)
    rag_query_log_id: int | None = None


class ChatFeedbackOut(BaseModel):
    id: int
    message_id: str
    rating: int
    updated: bool


@router.post("/chat", response_model=ChatFeedbackOut)
async def submit_chat_feedback(
    payload: ChatFeedbackIn,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> ChatFeedbackOut:
    user_id = current_user.id if current_user else None

    existing = (
        await db.execute(
            text(
                "SELECT id FROM chat_feedback "
                "WHERE message_id = :mid AND COALESCE(user_id, -1) = COALESCE(:uid, -1) "
                "LIMIT 1"
            ),
            {"mid": payload.message_id, "uid": user_id},
        )
    ).scalar()

    if existing:
        await db.execute(
            text(
                "UPDATE chat_feedback SET rating = :rating, comment = :comment, "
                "rag_query_log_id = :rql WHERE id = :id"
            ),
            {
                "rating": payload.rating,
                "comment": payload.comment,
                "rql": payload.rag_query_log_id,
                "id": existing,
            },
        )
        await db.commit()
        return ChatFeedbackOut(
            id=int(existing),
            message_id=payload.message_id,
            rating=payload.rating,
            updated=True,
        )

    row = (
        await db.execute(
            text(
                "INSERT INTO chat_feedback "
                "(user_id, message_id, rating, comment, rag_query_log_id) "
                "VALUES (:uid, :mid, :rating, :comment, :rql) "
                "RETURNING id"
            ),
            {
                "uid": user_id,
                "mid": payload.message_id,
                "rating": payload.rating,
                "comment": payload.comment,
                "rql": payload.rag_query_log_id,
            },
        )
    ).scalar()
    await db.commit()

    if not row:
        raise HTTPException(status_code=500, detail="Failed to record feedback")

    return ChatFeedbackOut(
        id=int(row),
        message_id=payload.message_id,
        rating=payload.rating,
        updated=False,
    )


@router.get("/chat/{message_id}", response_model=ChatFeedbackOut | None)
async def get_chat_feedback(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> ChatFeedbackOut | None:
    user_id = current_user.id if current_user else None
    row = (
        await db.execute(
            text(
                "SELECT id, message_id, rating FROM chat_feedback "
                "WHERE message_id = :mid AND COALESCE(user_id, -1) = COALESCE(:uid, -1) "
                "ORDER BY id DESC LIMIT 1"
            ),
            {"mid": message_id, "uid": user_id},
        )
    ).first()
    if not row:
        return None
    return ChatFeedbackOut(
        id=int(row[0]),
        message_id=row[1],
        rating=int(row[2]),
        updated=False,
    )
