"""v3.44 (2026-05-02) — pin the year-first parser branch and the
news-card noise filter added on top of v3.40.

The v3.41 shadow run against a captured testcenter.kz homepage
showed that:
  (a) the homepage repeats every news post inside
      ``<span class="news-card__meta">29 апреля, 2026</span>``
      wrappers, and those post-date timestamps dominated the
      report (9 of 12 context windows), drowning real schedule
      mentions; and
  (b) the real schedule sentences are written year-first
      ("2026 жылы 8-25 шілде", "2026 жылы 14-17 мамырда"),
      which the v3.40 day-first regex never sees because the
      year token sits BEFORE the day-month pair.

These tests pin both fixes and the regression cases that drove the
design choices.
"""

from __future__ import annotations

import pytest

from app.services.testcenter_kz_date_parser import (
    _strip_known_noise,
    parse_testcenter_kz_dates,
)

# ---------- noise filter ---------------------------------------------


def test_strip_known_noise_removes_news_card_meta() -> None:
    body = '<span class="news-card__meta">29 апреля, 2026</span>after'
    cleaned = _strip_known_noise(body)
    assert "29 апреля" not in cleaned
    assert "after" in cleaned


def test_strip_known_noise_keeps_unrelated_spans() -> None:
    body = '<span class="news-card__title">Real title 2026</span>'
    cleaned = _strip_known_noise(body)
    # Title spans are NOT in the noise allowlist.
    assert cleaned == body


def test_strip_known_noise_handles_nested_attrs() -> None:
    body = '<span data-test="x" class="foo news-card__meta bar" data-id="9">29 апреля, 2026</span>'
    cleaned = _strip_known_noise(body)
    assert "29 апреля" not in cleaned


def test_strip_known_noise_handles_div_wrapper() -> None:
    body = '<div class="post-meta">12 июля 2026</div>'
    cleaned = _strip_known_noise(body)
    assert "июля" not in cleaned


def test_parse_drops_news_card_meta_post_dates() -> None:
    """End-to-end: a body that has only a news-card meta date must
    parse as zero dates after the v3.44 noise filter strips it."""
    body = (
        "<article>"
        '<a href="/news/x">Some title</a>'
        '<span class="news-card__meta">29 апреля, 2026</span>'
        "</article>"
    )
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


# ---------- year-first form ------------------------------------------


def test_year_first_kz_with_zhyly_particle() -> None:
    body = "2026 жылы 25 шілде өткізіледі."
    out = parse_testcenter_kz_dates(body)
    assert "2026-07-25" in out.iso_dates
    assert out.lang == "kz"


def test_year_first_kz_range_emits_both_endpoints() -> None:
    # "8-25 шілде" → both 2026-07-08 AND 2026-07-25
    body = "2026 жылы 8-25 шілде өткізіледі."
    out = parse_testcenter_kz_dates(body)
    assert "2026-07-08" in out.iso_dates
    assert "2026-07-25" in out.iso_dates
    assert out.lang == "kz"


def test_year_first_ru_with_year_word() -> None:
    # Year-first scan picks up the first day-month after the year
    # (within the 40-char gap). The second day-month "10 июля" is
    # too far from the leading "2026" for the year-first scan, and
    # has no trailing year within the day-first lookahead either —
    # so it's correctly omitted. Year-first finds the FIRST near
    # date.
    body = "В 2026 году с 10 мая проходит ЕНТ."
    out = parse_testcenter_kz_dates(body)
    assert "2026-05-10" in out.iso_dates
    assert out.lang == "ru"


def test_year_first_with_excessive_gap_does_not_fire() -> None:
    # 200-char filler between year and day-month — well past the
    # 40-char gap. Year-first scan must drop. Day-first scan finds
    # no trailing year either, so total = zero.
    filler = "x" * 200
    body = f"2026 {filler} 10 мая"
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


def test_year_first_invalid_calendar_drops() -> None:
    # 2026 ... 30 февраля — Feb 30 is not a real date.
    body = "2026 жылы 30 ақпан"
    out = parse_testcenter_kz_dates(body)
    # Only February has 28 days in 2026, so 30 ақпан drops.
    assert "2026-02-30" not in out.iso_dates
    # Year-first should also not be confused into emitting any other date.
    assert all(not d.startswith("2026-02-3") for d in out.iso_dates)


def test_year_first_year_out_of_range_drops() -> None:
    body = "2019 жылы 10 шілде өткізілді."
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


def test_year_first_range_with_same_day_does_not_double_emit() -> None:
    # "5-5 шілде" is degenerate; the dedup in day_end != day branch
    # plus set-based ISO-date dedup should leave one entry.
    body = "2026 жылы 5-5 шілде өткізіледі."
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == ["2026-07-05"]


# ---------- combined behavior on a representative homepage ----------


def test_combined_homepage_shape_yields_real_schedule_dates() -> None:
    """A small synthetic body shaped like the real testcenter.kz
    homepage: news-card meta wrappers (noise) + a real schedule
    excerpt (year-first KZ). Noise must be stripped; real dates
    must survive."""
    body = (
        '<article class="news-card">'
        '<a href="/news/x">title</a>'
        '<span class="news-card__meta">29 апреля, 2026</span>'
        "</article>"
        '<article class="news-card">'
        '<div class="news-card__excerpt">'
        "2026 жылы 8-25 шілде өткізіледі."
        "</div>"
        '<span class="news-card__meta">14 апреля, 2026</span>'
        "</article>"
    )
    out = parse_testcenter_kz_dates(body)
    # Two real schedule dates from the year-first scan.
    assert "2026-07-08" in out.iso_dates
    assert "2026-07-25" in out.iso_dates
    # No April 14 / 29 leakage (both were inside news-card__meta).
    assert "2026-04-14" not in out.iso_dates
    assert "2026-04-29" not in out.iso_dates
    assert out.lang == "kz"


# ---------- backward-compat: v3.40 surface unchanged ----------------


def test_v340_day_first_ru_still_works() -> None:
    body = "Основной этап ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года."
    out = parse_testcenter_kz_dates(body)
    assert "2026-05-10" in out.iso_dates
    assert "2026-07-10" in out.iso_dates


def test_v340_invalid_calendar_dates_still_drop() -> None:
    body = "30 февраля 2026 и 31 апреля 2026 будут красочными."
    out = parse_testcenter_kz_dates(body)
    assert out.iso_dates == []


@pytest.mark.parametrize(
    "body,expected",
    [
        ("", []),
        ("Just a paragraph.", []),
        ("2026 жылы 5 қаңтарда басталады.", ["2026-01-05"]),
    ],
)
def test_year_first_param_smoke(body: str, expected: list[str]) -> None:
    out = parse_testcenter_kz_dates(body)
    for d in expected:
        assert d in out.iso_dates
