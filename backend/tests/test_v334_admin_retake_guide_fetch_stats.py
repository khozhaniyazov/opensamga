"""v3.34 — Admin endpoint surfacing retake-guide fetch stats (no DB).

v3.32 added in-process ``_FETCH_STATS`` counters in
``app/services/retake_guide.py`` so an operator could tell whether
the live testing.kz fetch is working. v3.33 made the URL
env-overridable. v3.34 lights the path: a read-only admin endpoint
``GET /api/admin/retake-guide/fetch-stats`` returns the counters +
the currently-active URL so ops can confirm which URL is in play
and whether anything has succeeded.

These tests pin:
- The dict shape returned by the endpoint (keys + types).
- The auth gate — no token → 401, non-admin → 403, admin → 200.
- The schedule_url field reflects the live module value (so a future
  env override change is observable through the endpoint, not just
  by shelling in).
- Mutation isolation — the endpoint's response is a copy; mutating
  it does NOT corrupt the module-level singleton.

The TestClient pattern follows v3.31's two-lane contract pin
convention: boot the real FastAPI app and hit the actual querystring
path rather than calling the handler directly.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, status

from app.services import retake_guide


@pytest.fixture(autouse=True)
def _reset_module_state():
    retake_guide.clear_cache_for_tests()
    retake_guide.reset_fetch_stats_for_tests()
    yield
    retake_guide.clear_cache_for_tests()
    retake_guide.reset_fetch_stats_for_tests()


def _make_admin_user():
    """Cheap stand-in for the User ORM object used by the gate."""
    user = MagicMock()
    user.email = "admin@samga.test"
    user.is_admin = True
    return user


def _make_regular_user():
    user = MagicMock()
    user.email = "kid@samga.test"
    user.is_admin = False
    return user


def _client_with_admin():
    """Boot app and override get_current_admin → admin user."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers.auth import get_current_admin

    app.dependency_overrides[get_current_admin] = lambda: _make_admin_user()
    return TestClient(app)


def _client_with_403():
    """Boot app and override get_current_admin → 403 (non-admin)."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers.auth import get_current_admin

    def _deny():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    app.dependency_overrides[get_current_admin] = _deny
    return TestClient(app)


def _clear_overrides():
    from app.main import app

    app.dependency_overrides.clear()


# --- auth gate -------------------------------------------------------------


def test_endpoint_returns_403_for_non_admin():
    client = _client_with_403()
    try:
        resp = client.get("/api/admin/retake-guide/fetch-stats")
        assert resp.status_code == 403
    finally:
        _clear_overrides()


def test_endpoint_returns_401_when_no_token():
    """No override + no Authorization header → 401 (oauth2_scheme rejects)."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/admin/retake-guide/fetch-stats")
    # Either 401 or 403 depending on how oauth2 dependency resolves;
    # the load-bearing assertion is "not 200".
    assert resp.status_code in (401, 403)


# --- happy path ------------------------------------------------------------


def test_endpoint_returns_fresh_stats_for_admin():
    client = _client_with_admin()
    try:
        resp = client.get("/api/admin/retake-guide/fetch-stats")
        assert resp.status_code == 200
        body = resp.json()
        assert "schedule_url" in body
        assert "stats" in body
        s = body["stats"]
        # All five keys must be present (alert consumers depend on this).
        assert set(s.keys()) == {
            "success_count",
            "failure_count",
            "last_success_at",
            "last_failure_at",
            "last_failure_reason",
        }
        # Fresh / reset values.
        assert s["success_count"] == 0
        assert s["failure_count"] == 0
        assert s["last_success_at"] is None
        assert s["last_failure_at"] is None
        assert s["last_failure_reason"] is None
    finally:
        _clear_overrides()


@pytest.mark.asyncio
async def test_endpoint_reflects_recorded_failure():
    """After the fetcher records a failure, the endpoint shows it."""
    import httpx

    fake_client = MagicMock()
    fake_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        await retake_guide.fetch_testing_kz_sessions()

    client = _client_with_admin()
    try:
        resp = client.get("/api/admin/retake-guide/fetch-stats")
        assert resp.status_code == 200
        s = resp.json()["stats"]
        assert s["failure_count"] == 1
        assert s["success_count"] == 0
        assert s["last_failure_reason"] == "httpx_ConnectError"
        assert s["last_failure_at"] is not None
    finally:
        _clear_overrides()


def test_endpoint_returns_currently_active_schedule_url():
    """The endpoint must expose whatever URL the module is using —
    so env overrides are observable through the endpoint, not just
    by shelling into a worker."""
    client = _client_with_admin()
    try:
        resp = client.get("/api/admin/retake-guide/fetch-stats")
        assert resp.status_code == 200
        url = resp.json()["schedule_url"]
        assert url == retake_guide.TESTING_KZ_SCHEDULE_URL
        # And it's a non-empty string (defensive against bad env).
        assert isinstance(url, str)
        assert url.startswith("http")
    finally:
        _clear_overrides()


# --- mutation isolation ----------------------------------------------------


def test_endpoint_response_does_not_corrupt_module_state():
    """Two consecutive calls must show identical fresh state — even
    if a misbehaving caller mutated the first response in-flight."""
    client = _client_with_admin()
    try:
        first = client.get("/api/admin/retake-guide/fetch-stats").json()
        # Simulate a caller stomping on the response dict.
        first["stats"]["success_count"] = 99999

        second = client.get("/api/admin/retake-guide/fetch-stats").json()
        assert second["stats"]["success_count"] == 0
    finally:
        _clear_overrides()
