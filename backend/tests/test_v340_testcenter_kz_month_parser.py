"""v3.40 (2026-05-01) — pin the RU/KZ/EN month-name date parser
in ``backend/app/services/testcenter_kz_date_parser.py`` plus the
opt-in integration into ``retake_guide.fetch_testing_kz_sessions``.

The parser is pure (no DB, no httpx, no time). Tests cover every
language table, every defensive branch, and the fetcher's flag-off
default behavior.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services import retake_guide
from app.services.testcenter_kz_date_parser import (
    ParsedDates,
    parse_testcenter_kz_dates,
    supported_months,
)

# ---------- ParsedDates shape ----------------------------------------


def test_empty_body_returns_empty_parseddates() -> None:
    out = parse_testcenter_kz_dates("")
    assert out == ParsedDates(iso_dates=[], lang=None, raw_count=0)


def test_none_safe_for_garbage_input() -> None:
    # Non-string inputs are tolerated and return the empty shape.
    out = parse_testcenter_kz_dates(None)  # type: ignore[arg-type]
    assert out.iso_dates == []
    assert out.lang is None


def test_no_match_keeps_lang_none() -> None:
    out = parse_testcenter_kz_dates("Just a paragraph with no dates at all.")
    assert out.iso_dates == []
    assert out.lang is None
    assert out.raw_count == 0


# ---------- RU month-name parsing ------------------------------------


def test_ru_genitive_form_with_year() -> None:
    body = "Основной этап ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года."
    out = parse_testcenter_kz_dates(body)
    assert "2026-05-10" in out.iso_dates
    assert "2026-07-10" in out.iso_dates
    assert out.lang == "ru"
    assert out.raw_count >= 2


def test_ru_drops_dates_without_year_token_nearby() -> None:
    body = "10 мая будет важная дата."  # no year anywhere
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []
    assert out.lang is None


def test_ru_drops_dates_with_year_outside_lookahead() -> None:
    # Year is far past the 80-char lookahead window — should drop.
    far = " " * 200 + "2026"
    body = f"10 мая{far}"
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


def test_ru_year_must_be_in_valid_range() -> None:
    # 2019 is below _VALID_YEAR_MIN (2024) — must drop.
    body = "10 мая 2019 года была годовщина."
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


# ---------- KZ month-name parsing ------------------------------------


def test_kz_locative_form() -> None:
    body = "ҰБТ-2026 негізгі кезеңі 10 мамырдан 10 шілдеге дейін 2026 жылы өткізіледі."
    out = parse_testcenter_kz_dates(body)
    assert "2026-05-10" in out.iso_dates
    assert "2026-07-10" in out.iso_dates
    assert out.lang == "kz"


def test_kz_bare_nominative() -> None:
    body = "Хабарландыру: 5 наурыз 2026 жылы тіркеу басталады."
    out = parse_testcenter_kz_dates(body)
    assert "2026-03-05" in out.iso_dates
    assert out.lang == "kz"


# ---------- EN month-name parsing ------------------------------------


def test_en_full_month_day_first() -> None:
    # Parser is day-first by design (matches RU/KZ). Multilingual
    # NCT mirrors that write "10 May 2026" parse cleanly.
    body = "ENT-2026 main stage runs from 10 May to 10 July 2026."
    out = parse_testcenter_kz_dates(body)
    assert "2026-05-10" in out.iso_dates
    assert "2026-07-10" in out.iso_dates
    assert out.lang == "en"


def test_en_short_month_form() -> None:
    body = "Important: 15 Apr 2026 deadline."
    out = parse_testcenter_kz_dates(body)
    assert "2026-04-15" in out.iso_dates


# ---------- defensive branches ---------------------------------------


def test_invalid_calendar_dates_are_dropped() -> None:
    # Feb 30 / Apr 31 / month=13-equivalent garbage all drop.
    body = "30 февраля 2026 и 31 апреля 2026 будут красочными."
    out = parse_testcenter_kz_dates(body)
    # Both day numbers parsed but datetime.date() rejects them.
    assert out.iso_dates == []
    # raw_count still reflects the matches that happened pre-validation.
    assert out.raw_count >= 2


def test_dedup_and_sort() -> None:
    body = "10 мая 2026, повторяю 10 мая 2026 и затем 5 апреля 2026."
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == ["2026-04-05", "2026-05-10"]
    assert out.lang == "ru"


def test_dominant_language_picks_ru_on_tie_with_en() -> None:
    # 1 RU date + 1 EN date — tie. RU > EN tiebreak.
    # Note: the year tokens are placed AFTER each day-month pair so
    # the v3.40 day-first scan picks them up but the v3.44 year-first
    # scan does not (no year leads either match), keeping the
    # tiebreak the only differentiator.
    # The 60-char filler exceeds the v3.44 year-first 40-char gap
    # window so neither year-first scan double-fires on the second
    # "10 May" via the leading "2026". Tiebreak is therefore the
    # only differentiator.
    body = "10 мая 2026 -- " + "x" * 60 + " unrelated -- 10 May 2026"
    out = parse_testcenter_kz_dates(body)
    # The same iso date, deduped to one
    assert out.iso_dates == ["2026-05-10"]
    # raw_count counts both spans; lang prefers RU on tie
    assert out.lang == "ru"
    assert out.raw_count == 2


def test_partial_month_word_does_not_match() -> None:
    # "май" appears inside "майонез" — must not match.
    body = "10 майонез 2026 не дата."
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


# ---------- supported_months introspection ---------------------------


def test_supported_months_ru() -> None:
    months = supported_months("ru")
    assert "мая" in months
    assert "января" in months
    assert "сентября" in months


def test_supported_months_kz() -> None:
    months = supported_months("kz")
    assert "мамыр" in months
    assert "шілде" in months


def test_supported_months_unknown_returns_empty() -> None:
    assert supported_months("fr") == []


# ---------- fetcher integration: flag OFF (default) ------------------


@pytest.mark.asyncio
async def test_fetcher_with_flag_off_does_not_use_month_parser(monkeypatch) -> None:
    """When the flag is off (default), the fetcher behavior is
    bit-identical to v3.36. A body with only RU month dates and no
    ISO dates yields ``regex_miss``, not a successful parse."""
    monkeypatch.setattr(retake_guide, "TESTCENTER_KZ_MONTH_PARSER_ENABLED", False)
    retake_guide.reset_fetch_stats_for_tests()

    body = "Основной этап ЕНТ-2026 пройдёт 10 мая 2026 и 10 июля 2026."
    fake_resp = type("R", (), {"status_code": 200, "text": body})()
    with patch.object(retake_guide, "_client") as mock_client:
        mock_client.return_value.get = AsyncMock(return_value=fake_resp)
        result = await retake_guide.fetch_testing_kz_sessions()

    assert result is None
    stats = retake_guide.get_fetch_stats()
    assert stats["last_failure_reason"] == "regex_miss"


@pytest.mark.asyncio
async def test_fetcher_with_flag_on_consumes_month_parser(monkeypatch) -> None:
    """When the flag is on, a body that has no ISO dates but does
    have RU month-name dates produces sessions instead of
    ``regex_miss``."""
    monkeypatch.setattr(retake_guide, "TESTCENTER_KZ_MONTH_PARSER_ENABLED", True)
    retake_guide.reset_fetch_stats_for_tests()

    body = (
        "Основной этап ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года. "
        "Дополнительный этап — 15 августа 2026 — 20 августа 2026."
    )
    fake_resp = type("R", (), {"status_code": 200, "text": body})()
    with patch.object(retake_guide, "_client") as mock_client:
        mock_client.return_value.get = AsyncMock(return_value=fake_resp)
        result = await retake_guide.fetch_testing_kz_sessions()

    assert result is not None
    assert len(result) >= 1
    stats = retake_guide.get_fetch_stats()
    assert stats["success_count"] == 1
    # First session should start at the earliest date.
    assert result[0]["starts_on"] == "2026-05-10"


@pytest.mark.asyncio
async def test_fetcher_flag_on_still_falls_through_when_no_dates(monkeypatch) -> None:
    """Flag on + body with no parseable dates → still ``regex_miss``."""
    monkeypatch.setattr(retake_guide, "TESTCENTER_KZ_MONTH_PARSER_ENABLED", True)
    retake_guide.reset_fetch_stats_for_tests()

    body = "Welcome to our site. We have some news."
    fake_resp = type("R", (), {"status_code": 200, "text": body})()
    with patch.object(retake_guide, "_client") as mock_client:
        mock_client.return_value.get = AsyncMock(return_value=fake_resp)
        result = await retake_guide.fetch_testing_kz_sessions()

    assert result is None
    assert retake_guide.get_fetch_stats()["last_failure_reason"] == "regex_miss"


# ---------- env-var coercion -----------------------------------------


def test_env_flag_truthy_values(monkeypatch) -> None:
    """The flag accepts the standard true-ish env values; everything
    else (empty / "no" / "0") leaves it off."""
    import importlib

    cases = [
        ("1", True),
        ("true", True),
        ("TRUE", True),
        ("yes", True),
        ("on", True),
        ("0", False),
        ("no", False),
        ("", False),
        ("  ", False),
    ]
    for value, expected in cases:
        monkeypatch.setenv("TESTCENTER_KZ_MONTH_PARSER", value)
        # Re-import to re-evaluate module-level constant.
        importlib.reload(retake_guide)
        assert retake_guide.TESTCENTER_KZ_MONTH_PARSER_ENABLED is expected, f"value={value!r}"
    # Reset to default for the rest of the suite.
    monkeypatch.delenv("TESTCENTER_KZ_MONTH_PARSER", raising=False)
    importlib.reload(retake_guide)
