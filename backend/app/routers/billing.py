"""
app/routers/billing.py
-----------------------
Billing & Subscription endpoints.

MVP: manual plan activation via admin endpoint.
Payment provider integration (Kaspi/Stripe) comes later.
"""

import hashlib
import hmac
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..dependencies.plan_guards import PLAN_QUOTAS, _is_premium
from ..models import SubscriptionTier, UsageCounter, User
from .auth import get_current_admin, get_current_user

router = APIRouter(prefix="/billing", tags=["billing"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class BillingStatusResponse(BaseModel):
    plan: str  # "FREE" | "PREMIUM"
    is_premium: bool
    expires_at: str | None = None
    provider: str | None = None
    chat_model: str
    limits: dict  # {resource: limit}
    usage: dict  # {resource: used_today}
    price_kzt: int = 2000


class CheckoutResponse(BaseModel):
    message: str
    payment_url: str | None = None


class SetPlanRequest(BaseModel):
    user_email: str
    plan: str  # "FREE" or "PREMIUM"
    days: int = 30  # Duration in days


class SetPlanResponse(BaseModel):
    email: str
    plan: str
    expires_at: str | None = None
    message: str


# ---------------------------------------------------------------------------
# Pure helpers (used by admin_set_plan; v3.79 regression target)
# ---------------------------------------------------------------------------


def compute_extended_premium_expiry(
    *,
    current_expiry: datetime | None,
    days: int,
    now: datetime,
) -> datetime:
    """
    Standard subscription billing semantic: ``max(now, current_expiry) + days``.

    v3.79 (2026-05-03) regression target. Pre-v3.79 the admin set-plan
    endpoint unconditionally wrote ``now + days``. Granting +30 days to
    a user who already had 25 days remaining silently truncated them to
    30 — the 25 unused days were lost. This helper preserves remaining
    time the way Kaspi/Stripe renewals do: the new term is appended to
    the existing one.

    Edge cases handled:
    - ``current_expiry is None`` (FREE user being upgraded): collapses
      to ``now + days``.
    - ``current_expiry`` already in the past (PREMIUM lapsed): collapses
      to ``now + days``.
    - ``current_expiry`` is naive (pre-v3.x rows wrote naive datetimes):
      treated as UTC.
    - ``days < 0``: returned as-is (admin tools occasionally use this
      to *trim* a grant — caller decides intent). The non-negative
      assumption belongs at the request schema, not here.

    Args are keyword-only so callers can't accidentally swap them.
    """
    anchor: datetime
    if current_expiry is None:
        anchor = now
    else:
        if current_expiry.tzinfo is None:
            current_expiry = current_expiry.replace(tzinfo=UTC)
        anchor = current_expiry if current_expiry > now else now
    return anchor + timedelta(days=days)


# ---------------------------------------------------------------------------
# GET /api/billing/status  —  current plan, limits, usage
# ---------------------------------------------------------------------------


@router.get("/status", response_model=BillingStatusResponse)
async def billing_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return current plan info, daily limits, and today's usage."""
    premium = _is_premium(current_user)
    tier = SubscriptionTier.PREMIUM if premium else SubscriptionTier.FREE
    limits = PLAN_QUOTAS.get(tier, PLAN_QUOTAS[SubscriptionTier.FREE])
    chat_model = (
        (settings.OPENAI_PREMIUM_MODEL or settings.OPENAI_MODEL or "gpt-4o-mini")
        if premium
        else (settings.OPENAI_MODEL or "gpt-4o-mini")
    )

    # Get today's usage
    today = date.today()
    result = await db.execute(
        select(UsageCounter).where(
            UsageCounter.user_id == current_user.id,
            UsageCounter.date == today,
        )
    )
    counter = result.scalar_one_or_none()

    usage = {
        "chat_messages": counter.chat_messages if counter else 0,
        "exam_runs": counter.exam_runs if counter else 0,
        "mistake_analyses": counter.mistake_analyses if counter else 0,
        "practice_questions": counter.practice_questions if counter else 0,
    }

    return BillingStatusResponse(
        plan=tier.value,
        is_premium=premium,
        expires_at=current_user.plan_expires_at.isoformat()
        if current_user.plan_expires_at
        else None,
        provider=current_user.billing_provider,
        chat_model=chat_model,
        limits=limits,
        usage=usage,
    )


# ---------------------------------------------------------------------------
# POST /api/billing/checkout  —  stub for future payment provider
# ---------------------------------------------------------------------------


@router.post("/checkout", response_model=CheckoutResponse)
async def billing_checkout(
    current_user: User = Depends(get_current_user),
):
    """
    Stub endpoint — will redirect to Kaspi / Stripe when integrated.
    For now returns a message explaining how to activate.
    """
    if _is_premium(current_user):
        return CheckoutResponse(
            message="Вы уже подключены к PREMIUM. Подписка активна.",
        )

    return CheckoutResponse(
        message="Онлайн-оплата скоро будет доступна. "
        "Для активации PREMIUM обратитесь к администратору.",
        payment_url=None,
    )


# ---------------------------------------------------------------------------
# POST /api/billing/webhook  —  payment provider callbacks (HMAC-gated)
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def billing_webhook(request: Request):
    """
    Payment provider POSTs here to confirm payments.

    v3.6 (2026-04-29) — audit finding #7. Previously this was an
    open endpoint that returned `{"status": "ok"}` for ANY payload,
    no auth, no signature check. The next person to wire a real
    provider would have inherited an open handler. We now require
    an HMAC-SHA256 signature in the `X-Signature` header (hex-
    encoded, computed over the raw body with `BILLING_WEBHOOK_SECRET`).

    If `BILLING_WEBHOOK_SECRET` is unset (i.e. no provider wired up
    yet), the endpoint returns 503 — refusing to process is the
    safe default for a payments path. The previous "always 200 OK"
    behavior is exactly the kind of thing that gets shipped and
    forgotten.

    Body parsing is intentionally NOT done here — the provider
    integration that lands later owns the schema. This handler's
    only job is auth + replay-resistance.
    """
    secret = settings.BILLING_WEBHOOK_SECRET.get_secret_value()
    if not secret:
        # No payment provider wired up yet. 503 instead of 200 so a
        # provider misconfigured to point at this endpoint can't
        # silently mark payments as accepted.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing webhook not configured",
        )

    raw_body = await request.body()
    provided = request.headers.get("X-Signature", "")
    if not provided:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Signature header",
        )

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(provided.lower(), expected.lower()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )

    # Signature is good. Real provider integration goes here. For now
    # we acknowledge so the provider doesn't retry, and log so ops
    # can see traffic.
    import logging

    logging.getLogger(__name__).info("Billing webhook accepted (%d bytes)", len(raw_body))
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /api/admin/set-plan  —  manual activation (admin-only)
# ---------------------------------------------------------------------------

admin_router = APIRouter(prefix="/admin", tags=["admin"])


@admin_router.post("/set-plan", response_model=SetPlanResponse)
async def admin_set_plan(
    request: SetPlanRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually set a user's subscription plan.
    Admin-only: gated by the canonical `get_current_admin` dependency
    (DB `is_admin` flag OR `RAG_ADMIN_EMAILS` env allowlist). Previously
    this used a hardcoded 2-email set that ignored the DB flag entirely.
    """

    # Find target user
    result = await db.execute(select(User).where(User.email == request.user_email))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email '{request.user_email}' not found",
        )

    # Apply plan
    plan_upper = request.plan.upper()
    if plan_upper == "PREMIUM":
        target_user.subscription_tier = SubscriptionTier.PREMIUM
        target_user.plan_expires_at = compute_extended_premium_expiry(
            current_expiry=target_user.plan_expires_at,
            days=request.days,
            now=datetime.now(UTC),
        )
        target_user.billing_provider = "manual"
        msg = f"PREMIUM extended by {request.days} days"
    elif plan_upper == "FREE":
        target_user.subscription_tier = SubscriptionTier.FREE
        target_user.plan_expires_at = None
        target_user.billing_provider = None
        target_user.provider_subscription_id = None
        msg = "Downgraded to FREE"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid plan '{request.plan}'. Use 'FREE' or 'PREMIUM'.",
        )

    await db.commit()
    await db.refresh(target_user)

    return SetPlanResponse(
        email=target_user.email,
        plan=target_user.subscription_tier.value,
        expires_at=target_user.plan_expires_at.isoformat() if target_user.plan_expires_at else None,
        message=msg,
    )
