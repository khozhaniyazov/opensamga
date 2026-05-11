"""v4.8 — Contract tests for ``GET /health/detail``.

Promotes ``spike/health-detail-endpoint`` (8b75091). The endpoint
aggregates instance state for the ops dashboard:

  * service / version / build_sha
  * uptime_seconds (monotonic)
  * timestamp (UTC)
  * checks: per-component {ok, latency_ms, detail}

It is **not** a deploy probe — orchestrator probes still use
/health/live and /health/ready. The contract pinned here:

  * 200 OK on database success — even if individual checks degrade.
  * Returns the documented JSON envelope, not a different one.
  * Database check returns ok=True on a working SELECT 1.
  * Database check returns ok=False with detail=type(exc).__name__
    when the underlying execute throws — never propagates.
  * uptime_seconds is monotonic-positive and timestamp parses as ISO 8601.
  * Version string is kept in sync with FastAPI(version=...) — drift
    catches accidentally bumping main.py without health.py.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


def _override_db_with(execute_side_effect):
    """Install a get_db override whose .execute() runs the supplied callable.

    Returns the AsyncMock so callers can assert on call count if needed.
    """
    db_mock = AsyncMock()
    db_mock.execute = AsyncMock(side_effect=execute_side_effect)

    async def override_get_db():
        yield db_mock

    app.dependency_overrides[get_db] = override_get_db
    return db_mock


def test_health_detail_envelope_ok() -> None:
    """Happy path: 200 OK + documented envelope keys + DB check ok=True."""
    _override_db_with(lambda *_a, **_k: None)
    try:
        client = TestClient(app)
        response = client.get("/health/detail")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()

    # Top-level envelope.
    assert set(body.keys()) >= {
        "service",
        "version",
        "build_sha",
        "uptime_seconds",
        "timestamp",
        "checks",
    }
    assert body["service"] == "samga.ai-api"
    assert isinstance(body["version"], str) and body["version"]
    # build_sha is best-effort: str-or-None depending on .git presence.
    assert body["build_sha"] is None or isinstance(body["build_sha"], str)
    assert isinstance(body["uptime_seconds"], (int, float))
    assert body["uptime_seconds"] >= 0
    # ISO 8601 with TZ.
    parsed = datetime.fromisoformat(body["timestamp"])
    assert parsed.tzinfo is not None

    # Database component check.
    assert "database" in body["checks"]
    db_check = body["checks"]["database"]
    assert db_check["ok"] is True
    assert db_check["detail"] == "connected"
    assert isinstance(db_check["latency_ms"], (int, float))


def test_health_detail_envelope_db_degraded_does_not_throw() -> None:
    """DB throwing must mark the component degraded, not 500 the response."""

    def boom(*_a, **_k):
        raise RuntimeError("simulated db crash")

    _override_db_with(boom)
    try:
        client = TestClient(app)
        response = client.get("/health/detail")
    finally:
        app.dependency_overrides.clear()

    # /health/detail is operator-facing — it MUST stay 200 even when a
    # component is degraded. Orchestrator probes use /health/ready.
    assert response.status_code == 200
    body = response.json()

    db_check = body["checks"]["database"]
    assert db_check["ok"] is False
    # The catch arm reports exception class name, not str(exc) — that
    # avoids leaking SQL fragments / driver internals in the response body.
    assert db_check["detail"] == "RuntimeError"


def test_health_detail_version_matches_main_app_version() -> None:
    """``version`` in /health/detail tracks ``FastAPI(version=...)``.

    The endpoint's docstring promises the version "matches FastAPI app
    version". This pin makes the promise enforceable — any future bump
    to ``main.py`` must update health.py in the same change.
    """
    _override_db_with(lambda *_a, **_k: None)
    try:
        client = TestClient(app)
        response = client.get("/health/detail")
    finally:
        app.dependency_overrides.clear()

    body = response.json()
    assert body["version"] == app.version, (
        f"/health/detail version={body['version']!r} drifted from "
        f"FastAPI(version={app.version!r}) — keep them in sync."
    )
