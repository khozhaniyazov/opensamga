"""v3.40 (2026-05-01) — RU/KZ/EN month-name date parser for
``testcenter.kz`` news posts.

## Why this module exists

The retake-guide fetcher (``app/services/retake_guide.py``) tries to
extract ENT sitting dates from an upstream page so the
``/dashboard/retake-guide`` UI can show real dates instead of the
hand-curated ``FALLBACK_SESSIONS_2026``. Until v3.36 the upstream
URL was the dead ``www.testing.kz`` host (cert mismatch). v3.36
flipped the default to ``testcenter.kz`` (the canonical NCT
homepage), but testcenter.kz **does not publish a stable ISO-date
schedule page**. The dates are scattered across dated news posts
written in Russian or Kazakh::

    "ҰБТ-2026 негізгі кезеңі 10 мамырдан 10 шілдеге дейін өткізіледі."
    "Основной этап ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026."
    "The main stage of ENT-2026 will be held from 10 May to 10 July."

The existing ISO-date regex finds nothing on these pages, so the
v3.32 ``_FETCH_STATS`` records ``regex_miss`` on every cache-miss.
That's already a useful signal — but to flip ``success_count`` we
need a parser that handles the actual content.

## What this module does (and doesn't do)

- **Pure functions.** No httpx, no time, no logger, no DB. Takes a
  string body in, returns a structured ``ParsedDates`` shape out.
- **RU + KZ + EN month tables** with case-insensitive matching and
  Cyrillic word-boundary handling (the standard ``\b`` doesn't
  honor Cyrillic ranges in Python's ``re``, so we use explicit
  non-letter look-arounds).
- **Year-aware**: expects an explicit 4-digit year token nearby
  (within ~50 chars after the day-month) so we don't accidentally
  emit dates from "10 мая" without a year context. This is the
  defensive bias — better to emit fewer real dates than to confuse
  May 2025 archives with May 2026 sittings.
- **Returns ``ParsedDates``**: ``iso_dates`` sorted-unique list of
  ``YYYY-MM-DD`` strings + ``lang`` (the dominant language detected,
  one of ``"ru"``/``"kz"``/``"en"``/``None``) + ``raw_count`` (total
  spans matched before dedup, useful for debug). The fetcher
  consumes ``iso_dates`` only.
- **Defensive sorting**: only well-formed dates (real calendar
  dates) survive. We use ``datetime.date(...)`` to validate, so
  Feb 30 / Apr 31 / month=13 are silently dropped.

## What this module does NOT do

- Does not bucket dates into "main" / "additional" / "supplementary"
  sessions. That's the fetcher's responsibility (it already does
  exactly this for ISO dates and the bucketing rule is unchanged).
- Does not fetch HTTP. Pure parsing only.
- Does not handle ranges like "с 10 мая по 10 июля" specially —
  it matches both endpoints as separate dates and lets the
  fetcher's existing pair-up-consecutive logic handle them.
- Does not handle relative dates ("через неделю" / "следующий
  понедельник"). Out of scope.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

# ---------- month tables --------------------------------------------

# All keys are lowercase. The parser lowercases the body before
# matching. Each table maps a recognized month token to its
# 1-indexed month number.

# RU forms include nominative + genitive (the form that appears
# in "10 мая 2026" — "of May") so we cover both bare ("январь")
# and dated ("января") spellings.
_RU_MONTHS: dict[str, int] = {
    "январь": 1,
    "января": 1,
    "февраль": 2,
    "февраля": 2,
    "март": 3,
    "марта": 3,
    "апрель": 4,
    "апреля": 4,
    "май": 5,
    "мая": 5,
    "июнь": 6,
    "июня": 6,
    "июль": 7,
    "июля": 7,
    "август": 8,
    "августа": 8,
    "сентябрь": 9,
    "сентября": 9,
    "октябрь": 10,
    "октября": 10,
    "ноябрь": 11,
    "ноября": 11,
    "декабрь": 12,
    "декабря": 12,
}

# KZ forms include locative case ("мамырда" — "in May", from "мамыр")
# because that's how dates are written in news copy. We include the
# bare nominative form too. Note KZ uses the same Cyrillic alphabet
# as Russian for these month names, plus the special characters
# ҰБТ pages favor (ә, ғ, қ, ң, ө, ұ, ү, h, і).
_KZ_MONTHS: dict[str, int] = {
    "қаңтар": 1,
    "қаңтарда": 1,
    "ақпан": 2,
    "ақпанда": 2,
    "наурыз": 3,
    "наурызда": 3,
    "сәуір": 4,
    "сәуірде": 4,
    "мамыр": 5,
    "мамырда": 5,
    "мамырдан": 5,
    "маусым": 6,
    "маусымда": 6,
    "шілде": 7,
    "шілдеде": 7,
    "шілдеге": 7,
    "тамыз": 8,
    "тамызда": 8,
    "қыркүйек": 9,
    "қыркүйекте": 9,
    "қазан": 10,
    "қазанда": 10,
    "қараша": 11,
    "қарашада": 11,
    "желтоқсан": 12,
    "желтоқсанда": 12,
}

_EN_MONTHS: dict[str, int] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sept": 9,
    "sep": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


# Year window: ENT 2026 schedule should mention 2026 (or maybe 2027
# for January supplementary). We accept a generous 2024..2030 range
# so historical news posts and forward-looking schedule announcements
# both parse, and the fetcher's existing "keep earliest 6 dates"
# logic is what prevents stale data from poisoning the response.
_VALID_YEAR_MIN = 2024
_VALID_YEAR_MAX = 2030

# Maximum char distance between a "<day> <month>" token and the
# year that follows. Russian/Kazakh news headlines occasionally
# write "10 мамырдан 10 шілдеге дейін 2026 жылы" putting the year
# at the end of the clause; 80 chars covers this.
_YEAR_LOOKAHEAD = 80


# Pre-compile a per-language regex per month-table at import time.
# Pattern shape: ``(?P<day>\d{1,2})[\s\u00a0]+(?P<mon>...)`` where
# the alternation is the longest-first list of month tokens. We
# require non-letter look-around so partial matches inside a longer
# word don't fire.
def _compile_month_regex(table: dict[str, int]) -> re.Pattern[str]:
    # Sort longest-first so "сентября" wins before "сент".
    tokens = sorted(table.keys(), key=len, reverse=True)
    alternation = "|".join(re.escape(t) for t in tokens)
    # Use non-letter look-around (Unicode-aware via re.UNICODE).
    # ``[^\w]`` matches any non-word char; we anchor with start-of-string
    # / non-word before the day digit, and non-word after the month token.
    pattern = (
        r"(?P<day>\d{1,2})[\s\u00a0]+"
        rf"(?P<mon>{alternation})"
        r"(?=[^\wа-яёА-ЯЁәіңғүұқөhӘІҢҒҮҰҚӨH]|$)"
    )
    return re.compile(pattern, flags=re.IGNORECASE | re.UNICODE)


_RU_RE = _compile_month_regex(_RU_MONTHS)
_KZ_RE = _compile_month_regex(_KZ_MONTHS)
_EN_RE = _compile_month_regex(_EN_MONTHS)


# Year regex: explicit 4-digit year in our valid range.
_YEAR_RE = re.compile(r"\b(20[2-3]\d)\b")


# v3.44: year-first form. KZ news copy is overwhelmingly written as
# ``2026 жылы 8-25 шілде`` (year + KZ "жылы" particle + day-range +
# month) — none of which the v3.40 day-first scan picks up because
# the year token sits BEFORE the day-month pair, not after.
#
# The ``[^\d]{0,40}?`` gap is bounded + non-greedy + digit-free so a
# single match can't span across two unrelated dates ("2026 ... 5 ...
# 25 май 2026" stays as two separate matches, not one giant one).
#
# We also accept an optional ``-<day_end>`` to capture range endpoints
# like "8-25 шілде" → emit both 2026-07-08 AND 2026-07-25 as sitting
# dates. The fetcher's existing bucketing logic decides which slot
# they fill.
def _compile_year_first_regex(table: dict[str, int]) -> re.Pattern[str]:
    tokens = sorted(table.keys(), key=len, reverse=True)
    alternation = "|".join(re.escape(t) for t in tokens)
    pattern = (
        r"(?P<year>20[2-3]\d)\b[^\d]{0,40}?"
        r"(?P<day>\d{1,2})(?:\s*-\s*(?P<day_end>\d{1,2}))?[\s\u00a0]+"
        rf"(?P<mon>{alternation})"
        r"(?=[^\wа-яёА-ЯЁәіңғүұқөhӘІҢҒҮҰҚӨH]|$)"
    )
    return re.compile(pattern, flags=re.IGNORECASE | re.UNICODE)


_RU_YEAR_FIRST_RE = _compile_year_first_regex(_RU_MONTHS)
_KZ_YEAR_FIRST_RE = _compile_year_first_regex(_KZ_MONTHS)
_EN_YEAR_FIRST_RE = _compile_year_first_regex(_EN_MONTHS)


# v3.44: news-card / list-page noise filter. Captured testcenter.kz
# bodies show that the homepage repeats every news post with a
# ``<span class="news-card__meta">29 апреля, 2026</span>`` wrapper
# carrying the POST DATE (which is irrelevant — sitting dates live
# in the post body / title / excerpt). When the parser runs against
# the raw homepage, those nine post-date spans dominate the report
# and drown out the real schedule mentions.
#
# We strip a small allowlist of known-noise wrappers BEFORE parsing.
# The list is conservative on purpose — over-stripping would silently
# delete real schedule mentions, which is worse than the noise.
_NOISE_TAG_NAMES = ("span", "div", "time")
_NOISE_CLASS_NAMES = (
    "news-card__meta",
    "news-card__date",
    "post-meta",
    "post__date",
    "article-meta",
)


def _build_noise_re() -> re.Pattern[str]:
    tags = "|".join(_NOISE_TAG_NAMES)
    classes = "|".join(re.escape(c) for c in _NOISE_CLASS_NAMES)
    # Match opening tag with any attributes including the noise class,
    # any inner content (lazy), then the closing tag.
    return re.compile(
        rf'<(?P<tag>{tags})\b[^>]*\bclass="[^"]*\b(?:{classes})\b[^"]*"[^>]*>'
        r"[\s\S]*?</(?P=tag)>",
        re.IGNORECASE,
    )


_NOISE_RE = _build_noise_re()


def _strip_known_noise(body: str) -> str:
    """Remove the small allowlist of known-noise wrappers (post-date
    timestamps on news-card list pages). Conservative by design.

    Pure function. Returns a new string with the noise spans replaced
    by a single space (so adjacent text doesn't accidentally fuse and
    create false matches).
    """
    return _NOISE_RE.sub(" ", body)


# ---------- public types --------------------------------------------


@dataclass(frozen=True)
class ParsedDates:
    """Output shape. ``iso_dates`` is sorted-unique YYYY-MM-DD
    strings. ``lang`` is the dominant language (None when no spans
    matched). ``raw_count`` is the total spans matched before dedup,
    useful for the v3.32 ``_FETCH_STATS`` ``last_failure_reason``
    when zero dates survive validation."""

    iso_dates: list[str]
    lang: str | None
    raw_count: int


# ---------- core parsing --------------------------------------------


def _scan_with_table(
    body_lower: str, regex: re.Pattern[str], table: dict[str, int]
) -> list[tuple[int, int, int]]:
    """Return a list of ``(year, month, day)`` tuples for every
    valid match in ``body_lower``. Months are looked up in
    ``table`` (already lowercased keys). Year is the first valid
    year token within ``_YEAR_LOOKAHEAD`` chars after the
    day-month pair; if none, the match is dropped."""

    out: list[tuple[int, int, int]] = []
    for m in regex.finditer(body_lower):
        try:
            day = int(m.group("day"))
        except ValueError:
            continue
        if not (1 <= day <= 31):
            continue
        month = table.get(m.group("mon").lower())
        if month is None:
            continue
        # Look for an explicit year token within the lookahead window.
        tail = body_lower[m.end() : m.end() + _YEAR_LOOKAHEAD]
        ymatch = _YEAR_RE.search(tail)
        if ymatch is None:
            continue
        year = int(ymatch.group(1))
        if not (_VALID_YEAR_MIN <= year <= _VALID_YEAR_MAX):
            continue
        out.append((year, month, day))
    return out


def _scan_with_year_first_table(
    body_lower: str, regex: re.Pattern[str], table: dict[str, int]
) -> list[tuple[int, int, int]]:
    """Year-first variant of ``_scan_with_table``. Year is captured
    by the regex itself (no lookahead window). Optional ``day_end``
    capture emits both endpoints of a "8-25 шілде" range as
    separate ``(year, month, day)`` tuples — the fetcher's
    bucketing logic treats range endpoints as independent sitting
    dates."""

    out: list[tuple[int, int, int]] = []
    for m in regex.finditer(body_lower):
        try:
            year = int(m.group("year"))
            day = int(m.group("day"))
        except (ValueError, TypeError):
            continue
        if not (_VALID_YEAR_MIN <= year <= _VALID_YEAR_MAX):
            continue
        if not (1 <= day <= 31):
            continue
        month = table.get(m.group("mon").lower())
        if month is None:
            continue
        out.append((year, month, day))
        # Range form: "8-25 шілде" → also emit day_end.
        day_end_raw = m.group("day_end")
        if day_end_raw:
            try:
                day_end = int(day_end_raw)
            except ValueError:
                continue
            if 1 <= day_end <= 31 and day_end != day:
                out.append((year, month, day_end))
    return out


def parse_testcenter_kz_dates(body: str) -> ParsedDates:
    """Parse RU/KZ/EN month-name dates out of a testcenter.kz-style
    HTML/text body.

    Pure function. No I/O. Returns a structured ``ParsedDates`` even
    when nothing is found (``iso_dates=[]``, ``lang=None``,
    ``raw_count=0``).

    v3.44: pre-strips known-noise wrappers (news-card post-date
    timestamps), and runs a year-first scan in addition to the
    v3.40 day-first scan. Both passes feed into the same calendar-
    validation gate.
    """
    if not body or not isinstance(body, str):
        return ParsedDates(iso_dates=[], lang=None, raw_count=0)

    # v3.44: strip news-card post-date wrappers BEFORE lowercasing
    # so the regex sees the original casing of the class names.
    cleaned = _strip_known_noise(body)

    # Lowercase once for case-insensitive month matching.
    body_lower = cleaned.lower()

    ru_matches = _scan_with_table(body_lower, _RU_RE, _RU_MONTHS)
    kz_matches = _scan_with_table(body_lower, _KZ_RE, _KZ_MONTHS)
    en_matches = _scan_with_table(body_lower, _EN_RE, _EN_MONTHS)

    # v3.44: year-first pass, additive.
    ru_matches += _scan_with_year_first_table(body_lower, _RU_YEAR_FIRST_RE, _RU_MONTHS)
    kz_matches += _scan_with_year_first_table(body_lower, _KZ_YEAR_FIRST_RE, _KZ_MONTHS)
    en_matches += _scan_with_year_first_table(body_lower, _EN_YEAR_FIRST_RE, _EN_MONTHS)

    # Dominant-language pick: largest count wins. Ties broken by
    # RU > KZ > EN (NCT publishes RU and KZ; EN is rare and usually
    # mirrored from the RU page).
    counts = {"ru": len(ru_matches), "kz": len(kz_matches), "en": len(en_matches)}
    raw_count = sum(counts.values())
    if raw_count == 0:
        return ParsedDates(iso_dates=[], lang=None, raw_count=0)
    lang_order = ["ru", "kz", "en"]
    lang = max(lang_order, key=lambda k: counts[k])

    # Validate every (y, m, d) by constructing a real ``date``.
    # Garbage like Feb 30 / Apr 31 silently drops.
    iso_set: set[str] = set()
    for y, m, d in ru_matches + kz_matches + en_matches:
        try:
            iso_set.add(date(y, m, d).isoformat())
        except ValueError:
            continue
    iso_dates = sorted(iso_set)
    return ParsedDates(iso_dates=iso_dates, lang=lang, raw_count=raw_count)


# ---------- introspection -------------------------------------------


def supported_months(language: str) -> list[str]:
    """Return the sorted list of recognized month tokens for the
    given language. Useful for debug pages and tests; not used by
    the fetcher."""
    table = {
        "ru": _RU_MONTHS,
        "kz": _KZ_MONTHS,
        "en": _EN_MONTHS,
    }.get(language)
    if table is None:
        return []
    return sorted(table.keys())
