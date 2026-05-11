"""
app/dependencies/plan_guards.py
-------------------------------
Reusable FastAPI dependencies for subscription plan enforcement.

Usage:
    @router.post("/generate")
    async def generate(user=Depends(require_premium)):
        ...

    @router.post("/chat")
    async def chat(counter=Depends(require_quota("chat_messages", 20, 200))):
        ...
"""

from datetime import UTC, date, datetime

from fastapi import Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import SubscriptionTier, UsageCounter, User
from ..routers.auth import get_current_user

# ---------------------------------------------------------------------------
# v3.85 (2026-05-03): UTC-anchored "today" + atomic counter increment.
# ---------------------------------------------------------------------------


def _today_utc() -> date:
    """Return today's UTC calendar date.

    Pre-v3.85 the codebase used ``date.today()``, which returns the
    *server-local* calendar date. On a server in any non-UTC zone
    (e.g. the Kazakhstan deploy at UTC+5) this drifts the daily
    quota reset boundary off UTC midnight — two users in different
    zones could see "yesterday" / "today" disagree.

    v3.85 anchors all quota counters on UTC. If the server is
    already UTC (the typical case), ``_today_utc()`` and the old
    ``date.today()`` agree exactly; on non-UTC servers the reset
    boundary now matches what the FE shows in
    ``Asia/Almaty``-relative-to-UTC charts.
    """
    return datetime.now(UTC).date()


async def _atomic_charge_counter(*, user_id: int, resource: str, db: AsyncSession) -> int:
    """Atomically increment ``UsageCounter.<resource>`` for today's row.

    Used by the v3.84 ``_quota_charge`` family and by the
    ``require_quota`` dependency. The bump is issued as a single
    DB-side ``UPDATE ... SET col = col + 1 ... RETURNING col`` so
    two concurrent commits cannot both write ``previous + 1`` and
    undercount the bump (the canonical TOCTOU pattern fixed in
    v3.81 + v3.83).

    Returns the post-increment value of ``resource``. If today's
    row doesn't exist yet, this function INSERTs a fresh
    ``UsageCounter`` with ``<resource>=1`` and returns ``1``.

    Caller is responsible for committing the surrounding
    transaction. We deliberately don't commit here so the call
    site can compose the charge with adjacent writes
    (ActivityLog, Mistake creation, etc.) inside one transaction.

    Raises ``ValueError`` for unknown resources to fail fast on
    typos — UsageCounter only has four counter columns and adding
    new ones is an Alembic migration, not a runtime concern.
    """
    if resource not in {
        "chat_messages",
        "exam_runs",
        "mistake_analyses",
        "practice_questions",
    }:
        raise ValueError(f"unknown UsageCounter resource: {resource!r}")

    today = _today_utc()
    column = getattr(UsageCounter, resource)
    stmt = (
        update(UsageCounter)
        .where(UsageCounter.user_id == user_id, UsageCounter.date == today)
        .values({resource: column + 1})
        .returning(column)
    )
    result = await db.execute(stmt)
    new_value = result.scalar_one_or_none()
    if new_value is not None:
        return int(new_value)

    # No row for today yet — INSERT one with resource = 1. The
    # UNIQUE constraint on (user_id, date) makes this safe under
    # concurrency: if a sibling request inserts first, our INSERT
    # raises IntegrityError and we retry the UPDATE. We don't
    # actually catch the IntegrityError here because the call
    # sites all use _get_or_create_counter() before charging, so
    # a row almost always exists by the time we reach this branch.
    counter = UsageCounter(user_id=user_id, date=today)
    setattr(counter, resource, 1)
    db.add(counter)
    await db.flush()
    return 1


# ---------------------------------------------------------------------------
# Quota limits per plan
# ---------------------------------------------------------------------------
PLAN_QUOTAS = {
    SubscriptionTier.FREE: {
        "chat_messages": 20,
        "exam_runs": 0,
        "mistake_analyses": 0,
        "practice_questions": 0,
    },
    SubscriptionTier.PREMIUM: {
        "chat_messages": 200,
        "exam_runs": 10,
        "mistake_analyses": 20,
        "practice_questions": 50,
    },
    # Legacy PRO = same as PREMIUM
    SubscriptionTier.PRO: {
        "chat_messages": 200,
        "exam_runs": 10,
        "mistake_analyses": 20,
        "practice_questions": 50,
    },
}


def _is_premium(user: User) -> bool:
    """Check if user has an active premium subscription."""
    if user.subscription_tier not in (SubscriptionTier.PREMIUM, SubscriptionTier.PRO):
        return False
    # If there is an expiry date, check it
    if user.plan_expires_at and user.plan_expires_at < datetime.now(UTC):
        return False
    return True


# ---------------------------------------------------------------------------
# Dependency: require_premium
# ---------------------------------------------------------------------------
async def require_premium(
    current_user: User = Depends(get_current_user),
):
    """
    Raise 403 if user is not on an active PREMIUM plan.
    Use as a dependency on endpoints that are premium-only.
    """
    if not _is_premium(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="premium_required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Helper: get or create today's usage counter
# ---------------------------------------------------------------------------
async def _get_or_create_counter(user_id: int, db: AsyncSession) -> UsageCounter:
    """Get today's usage counter for the user, or create a fresh one.

    v3.85 (2026-05-03): "today" is now UTC, not server-local. See
    :func:`_today_utc` for rationale.
    """
    today = _today_utc()
    result = await db.execute(
        select(UsageCounter).where(
            UsageCounter.user_id == user_id,
            UsageCounter.date == today,
        )
    )
    counter = result.scalar_one_or_none()

    if counter is None:
        counter = UsageCounter(user_id=user_id, date=today)
        db.add(counter)
        await db.flush()

    return counter


# ---------------------------------------------------------------------------
# Dependency factory: require_quota
# ---------------------------------------------------------------------------
def require_quota(resource: str):
    """
    Factory that returns a FastAPI dependency enforcing daily quotas.

    The dependency:
    1. Looks up the user's plan
    2. Gets today's counter
    3. Checks if the quota for `resource` is exceeded
    4. Increments the counter
    5. Returns (user, counter) tuple

    Usage:
        @router.post("/chat")
        async def chat(
            quota_info=Depends(require_quota("chat_messages")),
        ):
            user, counter = quota_info
    """

    async def _check(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        counter = await _get_or_create_counter(current_user.id, db)

        tier = current_user.subscription_tier
        # Expired premium → treat as FREE
        if tier in (SubscriptionTier.PREMIUM, SubscriptionTier.PRO):
            if current_user.plan_expires_at and current_user.plan_expires_at < datetime.now(UTC):
                tier = SubscriptionTier.FREE

        limits = PLAN_QUOTAS.get(tier, PLAN_QUOTAS[SubscriptionTier.FREE])
        limit = limits.get(resource, 0)
        current_usage = getattr(counter, resource, 0)

        if limit == 0:
            # Feature disabled for this plan
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="premium_required",
            )

        if current_usage >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "quota_exceeded",
                    "resource": resource,
                    "limit": limit,
                    "used": current_usage,
                    "plan": tier.value,
                },
            )

        # v3.85 (2026-05-03): atomic UPDATE so two concurrent
        # requests can't both read N and both write N+1. The
        # ORM-level `setattr(counter, resource, current_usage + 1)`
        # this replaces was a textbook TOCTOU. Pattern matches
        # v3.81 (loot-box) / v3.83 (opportunity application_count).
        new_value = await _atomic_charge_counter(user_id=current_user.id, resource=resource, db=db)
        # Keep the in-memory ORM row consistent so the caller and
        # any subsequent reads on the same Session see the new
        # value without a refresh round-trip.
        setattr(counter, resource, new_value)

        return current_user, counter

    return _check
