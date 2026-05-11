"""v3.32 — Retake Guide testing.kz fetch observability (no DB, no network).

QA on 2026-05-01 surfaced that ``TESTING_KZ_SCHEDULE_URL`` is
unreachable in production (cert mismatch on www, read-timeouts on the
bare host), so every cache-miss falls through to the curated table.
The previous code logged a WARNING on each failure (log noise) without
exposing structured counters anyone could read.

v3.32 adds:

- ``_FETCH_STATS`` module-level dict tracking success / failure
  counts + last success / failure timestamps + a short failure reason.
- ``get_fetch_stats()`` public helper returning a copy.
- ``reset_fetch_stats_for_tests()`` test hook.
- WARNING → INFO log tone. The stats dict is the load-bearing signal.

These tests pin the contract so a future endpoint or alert (e.g.
"if last_success_at is None and failure_count > 100, page someone")
has a stable shape to consume.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import retake_guide


@pytest.fixture(autouse=True)
def _reset_module_state():
    retake_guide.clear_cache_for_tests()
    retake_guide.reset_fetch_stats_for_tests()
    yield
    retake_guide.clear_cache_for_tests()
    retake_guide.reset_fetch_stats_for_tests()


def _mock_response(status_code: int = 200, body: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = body
    return resp


def test_fresh_stats_have_zero_counters_and_no_timestamps():
    stats = retake_guide.get_fetch_stats()
    assert stats["success_count"] == 0
    assert stats["failure_count"] == 0
    assert stats["last_success_at"] is None
    assert stats["last_failure_at"] is None
    assert stats["last_failure_reason"] is None


def test_get_fetch_stats_returns_a_copy():
    """Mutating the returned dict must not corrupt module state."""
    stats = retake_guide.get_fetch_stats()
    stats["success_count"] = 999
    fresh = retake_guide.get_fetch_stats()
    assert fresh["success_count"] == 0


@pytest.mark.asyncio
async def test_successful_fetch_increments_success_counter():
    body = "<p>2026-06-15 to 2026-07-05</p><p>2026-08-10 to 2026-08-25</p>"
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(200, body))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is not None
    stats = retake_guide.get_fetch_stats()
    assert stats["success_count"] == 1
    assert stats["failure_count"] == 0
    assert stats["last_success_at"] is not None
    assert stats["last_failure_reason"] is None


@pytest.mark.asyncio
async def test_non_200_status_records_http_status_reason():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(503, ""))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None
    stats = retake_guide.get_fetch_stats()
    assert stats["failure_count"] == 1
    assert stats["last_failure_reason"] == "http_status_503"
    assert stats["last_success_at"] is None


@pytest.mark.asyncio
async def test_httpx_error_records_exception_class_name():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None
    stats = retake_guide.get_fetch_stats()
    assert stats["failure_count"] == 1
    # Reason carries the exception class name so an alert can
    # discriminate ConnectError vs ReadTimeout vs SSLError.
    assert stats["last_failure_reason"] == "httpx_ConnectError"


@pytest.mark.asyncio
async def test_regex_miss_records_regex_miss_reason():
    """Body with no ISO-shaped dates = regex_miss (the v3.28 pivot
    case where testing.kz redesigns and the parser silently dies)."""
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(200, "no dates here at all"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None
    stats = retake_guide.get_fetch_stats()
    assert stats["last_failure_reason"] == "regex_miss"


@pytest.mark.asyncio
async def test_too_few_dates_records_too_few_dates_reason():
    """Body with a single ISO date = not enough to bucket into
    (starts, ends) pairs."""
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(200, "<p>only 2026-06-15 here</p>"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None
    stats = retake_guide.get_fetch_stats()
    assert stats["last_failure_reason"] == "too_few_dates"


@pytest.mark.asyncio
async def test_failures_accumulate_across_calls():
    """Two consecutive failures must increment failure_count to 2."""
    fake_client = MagicMock()
    fake_client.get = AsyncMock(side_effect=httpx.ReadTimeout("slow"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        await retake_guide.fetch_testing_kz_sessions()
        await retake_guide.fetch_testing_kz_sessions()
    stats = retake_guide.get_fetch_stats()
    assert stats["failure_count"] == 2
    assert stats["success_count"] == 0
    assert stats["last_failure_reason"] == "httpx_ReadTimeout"


@pytest.mark.asyncio
async def test_success_after_failure_updates_both_timestamps():
    """A failure followed by a success leaves both ``last_*_at`` set."""
    fail_client = MagicMock()
    fail_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    success_body = "<p>2026-06-15 / 2026-07-05</p><p>2026-08-10 / 2026-08-25</p>"
    success_client = MagicMock()
    success_client.get = AsyncMock(return_value=_mock_response(200, success_body))

    with patch.object(retake_guide, "_client", return_value=fail_client):
        await retake_guide.fetch_testing_kz_sessions()
    with patch.object(retake_guide, "_client", return_value=success_client):
        await retake_guide.fetch_testing_kz_sessions()

    stats = retake_guide.get_fetch_stats()
    assert stats["success_count"] == 1
    assert stats["failure_count"] == 1
    assert stats["last_success_at"] is not None
    assert stats["last_failure_at"] is not None
    # Failure happened first; success_at must be ≥ failure_at.
    assert stats["last_success_at"] >= stats["last_failure_at"]
