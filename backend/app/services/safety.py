"""
app/services/safety.py
----------------------
Handles AI Moderation, Anti-Cheating, and User Safety.
Uses OpenAI's Moderation API to detect toxicity.
Tracks 'Honor Score' to gamify good behavior.
"""

import logging
import os
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ModerationLog, User
from ..utils.http_client_registry import register_http_client
from .openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

# v3.49 (2026-05-02): replaced 2x print() with module logger.
# Service is content-moderation hot path; stdout was the wrong
# place for both the missing-API-key warning and the API-error
# fall-open path.
logger = logging.getLogger(__name__)

# Initialize Async OpenAI Client
# v3.4 (2026-04-29): register so lifespan shutdown can aclose(). Audit #5.
http_client = register_http_client(httpx.AsyncClient())
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"), http_client=http_client)


async def moderate_content(text: str, user_id: int, db: AsyncSession) -> tuple[bool, list[str]]:
    """
    Check if content is toxic using OpenAI Moderation API.
    Returns: (is_safe: bool, categories_flagged: list)
    """
    if not client.api_key:
        logger.warning("safety.moderate_content: OPENAI_API_KEY missing; skipping moderation")
        return True, []

    try:
        # ASYNC Call to prevent blocking the server
        response = await client.moderations.create(input=text)
        result = response.results[0]

        is_safe = not result.flagged
        # Extract flagged categories (filtering for True values)
        categories_flagged = [
            category for category, flagged in result.categories.model_dump().items() if flagged
        ]

        # Log the moderation check
        log = ModerationLog(
            user_id=user_id,
            action_type="TEXT_MODERATION",
            content=text[:500],  # Truncate for storage
            verdict="TOXIC" if not is_safe else "SAFE",
        )
        db.add(log)
        await db.commit()

        if not is_safe:
            # Penalize the user immediately
            reason = f"Toxic content: {', '.join(categories_flagged)}"
            await flag_user(user_id, reason, db)

        return is_safe, categories_flagged

    except Exception:
        # Fail open - allow content if API fails to prevent service disruption.
        # The exception details belong in the logger, not in the user-visible
        # response (which is "is_safe=True").
        logger.exception("safety.moderate_content: Moderation API error; failing open")
        return True, []


async def flag_user(user_id: int, reason: str, db: AsyncSession) -> int:
    """
    Deduct honor score and shadow-ban if necessary.
    Returns the new honor score.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user:
        return 0

    # Deduct 10 honor points (Floor at 0)
    old_score = user.honor_score
    user.honor_score = max(0, user.honor_score - 10)

    # Add flag to moderation history (JSON blob)
    # Ensure we handle the case where moderation_flags is None
    flags = list(user.moderation_flags) if user.moderation_flags else []

    flags.append(
        {
            "reason": reason,
            "timestamp": datetime.now(UTC).isoformat(),
            "honor_before": old_score,
            "honor_after": user.honor_score,
        }
    )
    # Reassign to trigger SQLAlchemy change tracking for JSON fields
    user.moderation_flags = flags

    # Shadow-ban if honor score drops below 50
    if user.honor_score < 50:
        user.is_shadow_banned = True

    await db.commit()
    await db.refresh(user)

    return user.honor_score


async def restore_honor(user_id: int, points: int, db: AsyncSession) -> int:
    """
    Reward positive behavior with honor points.
    Removes shadow-ban if threshold is met.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user:
        return 0

    # Add points (Cap at 100)
    user.honor_score = min(100, user.honor_score + points)

    # Remove shadow-ban if honor restored above 60
    if user.honor_score >= 60:
        user.is_shadow_banned = False

    await db.commit()
    return user.honor_score


async def detect_cheating(
    user_id: int, quiz_duration_seconds: int, num_questions: int, db: AsyncSession
) -> tuple[bool, str]:
    """
    Detect impossibly fast quiz completion (cheating heuristic).
    Returns: (is_suspicious: bool, reason: str)
    """
    # Minimum realistic time: 3 seconds per question (very fast reading)
    min_realistic_time = num_questions * 3

    if quiz_duration_seconds < min_realistic_time:
        reason = f"Answered {num_questions} questions in {quiz_duration_seconds}s (Human limit: {min_realistic_time}s)"

        # Log suspicious activity
        log = ModerationLog(
            user_id=user_id, action_type="CHEATING_DETECTION", content=reason, verdict="SUSPICIOUS"
        )
        db.add(log)

        # Flag user (Severe penalty)
        await flag_user(user_id, f"Suspected cheating: {reason}", db)

        return True, reason

    return False, ""


async def can_user_post(user_id: int, db: AsyncSession) -> bool:
    """
    Check if user is allowed to post (not shadow-banned).
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user:
        return False

    return not user.is_shadow_banned
