"""
v3.79 (2026-05-03) — admin set-plan extends, doesn't overwrite.

Regression target: pre-v3.79 the admin set-plan endpoint wrote
``plan_expires_at = now + days`` unconditionally. Granting +30
days to a user who already had 25 days remaining silently
truncated them to 30 (lost 25 unused days). v3.79 swaps the
expiry computation for ``max(now, current_expiry) + days``.

Two-lane contract pin (per
``feedback_two_lane_contract_pin.md``):
1. Pure helper ``compute_extended_premium_expiry`` — pin every
   edge case directly (no DB, no app boot).
2. End-to-end via TestClient + ``app.dependency_overrides`` —
   verify the route actually calls the helper and the persisted
   row reflects extension semantics.

The TestClient lane uses an in-memory mock User + a captured
commit so we don't need a real DB. The DB-level integration is
covered by the same pattern used for v3.34 and v3.36.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.routers.billing import compute_extended_premium_expiry

# ---------------------------------------------------------------------------
# Pure helper — every edge case
# ---------------------------------------------------------------------------


class TestComputeExtendedPremiumExpiry:
    def test_none_current_expiry_collapses_to_now_plus_days(self):
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        result = compute_extended_premium_expiry(
            current_expiry=None,
            days=30,
            now=now,
        )
        assert result == now + timedelta(days=30)

    def test_past_current_expiry_collapses_to_now_plus_days(self):
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        # 2 days lapsed PREMIUM
        past = now - timedelta(days=2)
        result = compute_extended_premium_expiry(
            current_expiry=past,
            days=30,
            now=now,
        )
        assert result == now + timedelta(days=30)

    def test_active_premium_extends_from_existing_expiry(self):
        # The bug: granting +30 days to a user with 25 days left
        # used to truncate them to 30. Now it must give them 55.
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        active = now + timedelta(days=25)
        result = compute_extended_premium_expiry(
            current_expiry=active,
            days=30,
            now=now,
        )
        # Anchor on the existing expiry, not on now.
        assert result == active + timedelta(days=30)
        # Equivalent to: 55 days from now.
        assert result == now + timedelta(days=55)

    def test_active_premium_with_naive_datetime_treats_as_utc(self):
        # Pre-v3.x rows may have written naive datetimes. Helper
        # must not raise on aware-vs-naive comparison.
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        # 10 days into the future, naive (no tzinfo).
        naive_future = (now + timedelta(days=10)).replace(tzinfo=None)
        result = compute_extended_premium_expiry(
            current_expiry=naive_future,
            days=7,
            now=now,
        )
        # Treated as UTC, so +10 days from now, then +7 = +17.
        assert result == now + timedelta(days=17)
        # Result is timezone-aware.
        assert result.tzinfo is not None

    def test_exactly_at_now_collapses_to_now_plus_days(self):
        # Boundary: current_expiry equal to now is "not greater
        # than" — anchor on now.
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        result = compute_extended_premium_expiry(
            current_expiry=now,
            days=30,
            now=now,
        )
        assert result == now + timedelta(days=30)

    def test_helper_does_not_mutate_input(self):
        # Defensive: make sure the helper doesn't reach back and
        # mutate `current_expiry` (the naive→aware path uses
        # `.replace()` which returns a new instance, but pin the
        # contract anyway).
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        naive = (now + timedelta(days=5)).replace(tzinfo=None)
        snapshot = naive
        compute_extended_premium_expiry(
            current_expiry=naive,
            days=30,
            now=now,
        )
        assert naive is snapshot
        assert naive.tzinfo is None

    def test_negative_days_passes_through(self):
        # Admin tools occasionally trim a grant. Helper doesn't
        # second-guess; non-negative assumption belongs in the
        # request schema (which the route doesn't enforce today,
        # so this is just a docstring claim pinned).
        now = datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC)
        active = now + timedelta(days=10)
        result = compute_extended_premium_expiry(
            current_expiry=active,
            days=-3,
            now=now,
        )
        assert result == active - timedelta(days=3)


# ---------------------------------------------------------------------------
# Route lane — TestClient + dependency override
# ---------------------------------------------------------------------------


def _make_admin_user():
    user = MagicMock()
    user.email = "admin@samga.test"
    user.is_admin = True
    return user


def _make_target_user(*, expires_at: datetime | None):
    """Mock target user with a controllable plan_expires_at."""
    from app.models import SubscriptionTier

    user = MagicMock()
    user.email = "kid@samga.test"
    user.subscription_tier = SubscriptionTier.FREE
    user.plan_expires_at = expires_at
    user.billing_provider = None
    user.provider_subscription_id = None
    return user


def _client_with_target(target_user):
    """Boot app, override admin gate, override db.execute to return target."""
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app
    from app.routers.auth import get_current_admin

    app.dependency_overrides[get_current_admin] = lambda: _make_admin_user()

    # Build a mock async session that returns target_user from
    # the User-by-email select.
    mock_session = MagicMock()
    scalar_result = MagicMock()
    scalar_result.scalar_one_or_none = MagicMock(return_value=target_user)
    mock_session.execute = AsyncMock(return_value=scalar_result)
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()

    async def _override_db():
        yield mock_session

    app.dependency_overrides[get_db] = _override_db

    return TestClient(app), mock_session


def _clear_overrides():
    from app.main import app

    app.dependency_overrides.clear()


def test_route_extends_when_target_has_remaining_premium():
    """
    The bug, end-to-end. 25 days remaining + grant 30 = 55 days
    from now (anchored on the existing expiry).
    """
    now = datetime.now(UTC)
    target = _make_target_user(expires_at=now + timedelta(days=25))
    client, _session = _client_with_target(target)
    try:
        resp = client.post(
            "/api/admin/set-plan",
            json={"user_email": target.email, "plan": "PREMIUM", "days": 30},
        )
        assert resp.status_code == 200, resp.text
        # The mock target was mutated by the route. Verify the new
        # expiry is in the [54.5, 55.5] day window from now (allow
        # for the small clock drift between datetime.now() calls).
        delta = target.plan_expires_at - now
        assert timedelta(days=54, hours=23) < delta < timedelta(days=55, hours=1), (
            f"expected ~55 days, got {delta}"
        )
        assert resp.json()["message"] == "PREMIUM extended by 30 days"
    finally:
        _clear_overrides()


def test_route_does_not_truncate_when_grant_is_smaller_than_remainder():
    """
    Tighter version of the regression: 25 days remaining + grant
    7 = 32 days from now. Pre-v3.79 this would have truncated the
    user to 7 days — destroying 18 days of credit.
    """
    now = datetime.now(UTC)
    target = _make_target_user(expires_at=now + timedelta(days=25))
    client, _session = _client_with_target(target)
    try:
        resp = client.post(
            "/api/admin/set-plan",
            json={"user_email": target.email, "plan": "PREMIUM", "days": 7},
        )
        assert resp.status_code == 200, resp.text
        delta = target.plan_expires_at - now
        assert timedelta(days=31, hours=23) < delta < timedelta(days=32, hours=1), (
            f"expected ~32 days, got {delta}; pre-v3.79 would have given ~7"
        )
    finally:
        _clear_overrides()


def test_route_collapses_to_now_plus_days_for_free_user():
    """FREE user (no current expiry) — collapses to now+days."""
    now = datetime.now(UTC)
    target = _make_target_user(expires_at=None)
    client, _session = _client_with_target(target)
    try:
        resp = client.post(
            "/api/admin/set-plan",
            json={"user_email": target.email, "plan": "PREMIUM", "days": 30},
        )
        assert resp.status_code == 200, resp.text
        delta = target.plan_expires_at - now
        assert timedelta(days=29, hours=23) < delta < timedelta(days=30, hours=1)
    finally:
        _clear_overrides()


def test_route_collapses_to_now_plus_days_for_lapsed_premium():
    """Lapsed PREMIUM — current_expiry in the past — collapses to now+days."""
    now = datetime.now(UTC)
    target = _make_target_user(expires_at=now - timedelta(days=2))
    client, _session = _client_with_target(target)
    try:
        resp = client.post(
            "/api/admin/set-plan",
            json={"user_email": target.email, "plan": "PREMIUM", "days": 30},
        )
        assert resp.status_code == 200, resp.text
        delta = target.plan_expires_at - now
        assert timedelta(days=29, hours=23) < delta < timedelta(days=30, hours=1)
    finally:
        _clear_overrides()


def test_route_returns_404_when_target_missing():
    """The 404 path is unaffected by v3.79 — pin it for safety."""
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app
    from app.routers.auth import get_current_admin

    app.dependency_overrides[get_current_admin] = lambda: _make_admin_user()

    mock_session = MagicMock()
    scalar_result = MagicMock()
    scalar_result.scalar_one_or_none = MagicMock(return_value=None)
    mock_session.execute = AsyncMock(return_value=scalar_result)
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()

    async def _override_db():
        yield mock_session

    app.dependency_overrides[get_db] = _override_db

    client = TestClient(app)
    try:
        resp = client.post(
            "/api/admin/set-plan",
            json={"user_email": "missing@samga.test", "plan": "PREMIUM", "days": 30},
        )
        assert resp.status_code == 404
    finally:
        _clear_overrides()


def test_route_message_field_says_extended_not_activated():
    """
    User-visible: the response message changed from
    "PREMIUM activated for N days" to "PREMIUM extended by N days"
    to communicate the new semantic. Pin the wording so the
    admin UI's expectation stays in sync.
    """
    target = _make_target_user(expires_at=None)
    client, _session = _client_with_target(target)
    try:
        resp = client.post(
            "/api/admin/set-plan",
            json={"user_email": target.email, "plan": "PREMIUM", "days": 14},
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "PREMIUM extended by 14 days"
    finally:
        _clear_overrides()
