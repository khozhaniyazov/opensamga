"""v3.28 Retake Guide contract tests (no real network, no DB)."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import retake_guide


@pytest.fixture(autouse=True)
def _reset_module_cache():
    retake_guide.clear_cache_for_tests()
    yield
    retake_guide.clear_cache_for_tests()


# --- estimate_score_delta --------------------------------------------------


def test_estimator_zero_weeks_yields_zero_band():
    band = retake_guide.estimate_score_delta(current_score=80, weeks_until_session=0)
    assert band.low == 0 and band.mid == 0 and band.high == 0


def test_estimator_low_score_high_headroom():
    band = retake_guide.estimate_score_delta(current_score=50, weeks_until_session=10)
    # 1.5/wk * 10 = 15 mid, 7 low (rounded), 26 high (capped at 30)
    assert band.mid == 15
    assert band.low == 8  # round(7.5) = 8 in Python's banker's rounding? actually 8
    assert band.high == 26


def test_estimator_ceiling_band_caps():
    band = retake_guide.estimate_score_delta(current_score=135, weeks_until_session=40)
    # Ceiling regime: per_week 0.25, cap 5 → mid clamped to 5
    assert band.mid == 5
    assert band.high <= 5


def test_estimator_unknown_score_uses_default_curve():
    band = retake_guide.estimate_score_delta(current_score=None, weeks_until_session=4)
    assert band.mid > 0
    assert band.low <= band.mid <= band.high


def test_estimator_negative_weeks_clamped_to_zero():
    band = retake_guide.estimate_score_delta(current_score=80, weeks_until_session=-3)
    assert band == retake_guide.RetakeBand(low=0, mid=0, high=0)


# --- filter_upcoming_sessions ----------------------------------------------


def test_filter_drops_past_and_keeps_future():
    today = date(2026, 7, 1)
    sessions = [
        {"id": "a", "ends_on": "2026-06-01"},
        {"id": "b", "ends_on": "2026-07-15"},
        {"id": "c", "ends_on": "2027-01-30"},
    ]
    out = retake_guide.filter_upcoming_sessions(sessions, today=today)
    assert [s["id"] for s in out] == ["b", "c"]


def test_filter_keeps_session_with_unparseable_ends_on():
    """Defensive: garbage from a regex parse shouldn't drop the row."""
    today = date(2026, 7, 1)
    sessions = [{"id": "a", "ends_on": "not-a-date"}]
    out = retake_guide.filter_upcoming_sessions(sessions, today=today)
    assert [s["id"] for s in out] == ["a"]


# --- string tables ----------------------------------------------------------


def test_string_tables_have_required_keys():
    required = {
        "title",
        "subtitle",
        "sessions_heading",
        "policy_heading",
        "estimator_heading",
        "fallback_warning",
        "kind_main",
        "kind_additional",
        "kind_supplementary",
        "policy_authoritative",
    }
    for lang in ("ru", "kz"):
        assert required.issubset(retake_guide.RETAKE_GUIDE_STRINGS[lang])


# --- testing.kz fetcher (mocked httpx) -------------------------------------


def _mock_response(status_code: int = 200, body: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = body
    return resp


@pytest.mark.asyncio
async def test_fetcher_parses_iso_dates_into_session_buckets():
    body = """<html>
    Main: 2026-06-15 to 2026-07-05
    Additional: 2026-08-10 to 2026-08-25
    Supplementary: 2027-01-20 to 2027-01-30
    </html>"""
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(200, body))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is not None
    assert [s["kind"] for s in out] == ["main", "additional", "supplementary"]
    assert out[0]["starts_on"] == "2026-06-15"
    assert out[0]["ends_on"] == "2026-07-05"
    # i18n labels are populated for both languages.
    assert out[0]["labels"]["ru"] and out[0]["labels"]["kz"]


@pytest.mark.asyncio
async def test_fetcher_returns_none_on_non_200():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(503, ""))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None


@pytest.mark.asyncio
async def test_fetcher_returns_none_on_httpx_error():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None


@pytest.mark.asyncio
async def test_fetcher_returns_none_when_body_has_too_few_dates():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_mock_response(200, "no dates here"))
    with patch.object(retake_guide, "_client", return_value=fake_client):
        out = await retake_guide.fetch_testing_kz_sessions()
    assert out is None


# --- cache layer ------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_falls_back_when_live_fails():
    with patch.object(retake_guide, "fetch_testing_kz_sessions", AsyncMock(return_value=None)):
        sessions, source = await retake_guide.get_sessions_with_cache()
    assert source == "fallback"
    assert sessions == retake_guide.FALLBACK_SESSIONS_2026


@pytest.mark.asyncio
async def test_cache_serves_live_on_success():
    fake_live = [
        {
            "id": "main_2026-06-15",
            "kind": "main",
            "starts_on": "2026-06-15",
            "ends_on": "2026-07-05",
            "registration_deadline": None,
            "labels": {"ru": "x", "kz": "x"},
        }
    ]
    with patch.object(retake_guide, "fetch_testing_kz_sessions", AsyncMock(return_value=fake_live)):
        sessions, source = await retake_guide.get_sessions_with_cache()
    assert source == "live"
    assert sessions == fake_live


@pytest.mark.asyncio
async def test_cache_does_not_refetch_within_ttl():
    """Two consecutive calls must share the cached value."""
    mock_fetch = AsyncMock(return_value=None)
    with patch.object(retake_guide, "fetch_testing_kz_sessions", mock_fetch):
        await retake_guide.get_sessions_with_cache()
        await retake_guide.get_sessions_with_cache()
    assert mock_fetch.call_count == 1


# --- top-level orchestrator -------------------------------------------------


@pytest.mark.asyncio
async def test_payload_shape_with_fallback():
    with patch.object(retake_guide, "fetch_testing_kz_sessions", AsyncMock(return_value=None)):
        out = await retake_guide.build_retake_guide_payload(
            language="kz", current_score=95, weeks_until_session=6
        )
    assert out["language"] == "kz"
    assert out["sessions_source"] == "fallback"
    assert out["estimator"]["current_score"] == 95
    assert out["estimator"]["weeks_until_session"] == 6
    assert out["policy"]["max_attempts_per_cycle"] == 2
    # Sanity: at least one session and the strings table is for KZ.
    assert any("kz" in s["labels"] for s in out["sessions"])
    assert "ҰБТ" in out["strings"]["title"]


@pytest.mark.asyncio
async def test_payload_unknown_language_defaults_to_russian():
    with patch.object(retake_guide, "fetch_testing_kz_sessions", AsyncMock(return_value=None)):
        out = await retake_guide.build_retake_guide_payload(language="en")
    assert out["language"] == "ru"
