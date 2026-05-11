"""v3.36 — default schedule URL flipped to testcenter.kz (no DB, no network).

Closes #44 AC6.

Up to v3.35 the in-code default for ``TESTING_KZ_SCHEDULE_URL`` was
``https://www.testing.kz/ent/schedule``. That host fails SSL hostname
verification and the bare host times out, so the fetcher was
guaranteed to fail with an ``httpx_*`` reason and never reach the
parser. The user-facing copy already named ``testcenter.kz`` (v3.33),
so the URL was the only artefact still pointing at the wrong domain.

v3.36 flips the in-code default to ``https://testcenter.kz/`` — the
canonical Kazakhstan National Testing Center (НЦТ — Ұлттық тестілеу
орталығы) homepage. NCT does not yet publish a stable ISO-date
schedule page (the 2026 schedule lives in dated news posts with
Russian month names), so the parser will fail with ``regex_miss`` /
``too_few_dates`` rather than ``httpx_ConnectError`` — observable
through the v3.34 admin endpoint as a more actionable signal. Ops
can override via ``TESTING_KZ_SCHEDULE_URL`` (v3.33) when a stable
schedule URL or curated mirror exists.

These tests pin the new default at the module level and through the
admin endpoint, so a future regression that flips back to testing.kz
trips loudly.
"""

from __future__ import annotations

import importlib
import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _reload_retake_guide():
    import app.services.retake_guide as rg

    return importlib.reload(rg)


def test_default_url_points_at_testcenter_kz():
    """Module-level default after v3.36 is the canonical NCT host."""
    env = {k: v for k, v in os.environ.items() if k != "TESTING_KZ_SCHEDULE_URL"}
    with patch.dict(os.environ, env, clear=True):
        rg = _reload_retake_guide()
        assert rg._DEFAULT_SCHEDULE_URL == "https://testcenter.kz/"
        assert rg.TESTING_KZ_SCHEDULE_URL == "https://testcenter.kz/"
    _reload_retake_guide()


def test_default_url_does_not_reference_testing_kz_anymore():
    """The legacy testing.kz default must not survive in
    ``_DEFAULT_SCHEDULE_URL`` — v3.33 + v3.36 together purge the
    domain from the production code path."""
    env = {k: v for k, v in os.environ.items() if k != "TESTING_KZ_SCHEDULE_URL"}
    with patch.dict(os.environ, env, clear=True):
        rg = _reload_retake_guide()
        assert "testing.kz" not in rg._DEFAULT_SCHEDULE_URL
        assert "testing.kz" not in rg.TESTING_KZ_SCHEDULE_URL
    _reload_retake_guide()


def test_default_url_uses_https_scheme():
    """No accidental http:// — NCT serves https only and our httpx
    client doesn't follow http→https redirects by default."""
    env = {k: v for k, v in os.environ.items() if k != "TESTING_KZ_SCHEDULE_URL"}
    with patch.dict(os.environ, env, clear=True):
        rg = _reload_retake_guide()
        assert rg._DEFAULT_SCHEDULE_URL.startswith("https://")
    _reload_retake_guide()


def test_env_override_still_wins_over_v336_default():
    """Regression pin: v3.36 must not have accidentally hardcoded
    the new default in a way that bypasses ``TESTING_KZ_SCHEDULE_URL``."""
    override = "https://example.test/curated-mirror"
    with patch.dict(os.environ, {"TESTING_KZ_SCHEDULE_URL": override}):
        rg = _reload_retake_guide()
        assert rg.TESTING_KZ_SCHEDULE_URL == override
    _reload_retake_guide()


# --- admin endpoint reflects the new default --------------------------------


def _admin_user():
    """Stand-in admin principal — matches the v3.34 test contract."""
    from unittest.mock import MagicMock

    user = MagicMock()
    user.email = "admin@samga.test"
    user.is_admin = True
    return user


def test_admin_fetch_stats_endpoint_reports_v336_default(monkeypatch):
    """v3.34 endpoint returns the live module value — proves the
    flip is observable through the API. Mirrors the
    ``test_v334_admin_retake_guide_fetch_stats.py`` TestClient
    pattern (no context-manager ``with`` block — that hangs on
    Python 3.14 + anyio 4 due to the lifespan thread join)."""
    monkeypatch.delenv("TESTING_KZ_SCHEDULE_URL", raising=False)
    _reload_retake_guide()

    from app.main import app
    from app.routers.auth import get_current_admin

    app.dependency_overrides[get_current_admin] = lambda: _admin_user()
    try:
        client = TestClient(app)
        resp = client.get("/api/admin/retake-guide/fetch-stats")
        assert resp.status_code == 200
        body = resp.json()
        assert body["schedule_url"] == "https://testcenter.kz/"
    finally:
        app.dependency_overrides.clear()
        _reload_retake_guide()
