"""
retake_guide.py
---------------

v3.28 — UNT/ҰБТ Retake Guide (Issue #15 AC#6, last open Strategy Lab pillar).

Surface
~~~~~~~
- Read-only ``GET /api/strategy/retake-guide`` returning a deterministic
  payload for the FE Retake Guide page:
    * a list of upcoming 2026 testing sessions (main / additional /
      supplementary), best-effort fetched from testing.kz at runtime
      with a 6h in-process cache and a frozen fallback table baked in;
    * a cost / cooldown rules block (KZ ҰБТ historical: paid retake,
      one extra try per academic year, etc.);
    * a small score-recovery estimator (current + weeks-of-prep →
      probabilistic delta band);
    * full RU + KZ string table inline so the FE can swap language
      without a second fetch.

PII: zero. The endpoint takes no auth (matches /strategy/profile-pair).

Network policy: lazily creates an ``httpx.AsyncClient`` via
``register_http_client(...)`` (project-wide convention since v3.4).
Network failures NEVER bubble — they fall through to the curated stub
calendar and the response carries ``sessions_source = "fallback"``
so ops can spot it.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

from ..utils.http_client_registry import register_http_client

logger = logging.getLogger("unt_platform.services.retake_guide")


# ──────────────────────────────────────────────────────────────────────────
# Curated fallback (frozen knowledge — boss reviews dates separately).
#
# Sources (consulted 2026-05-01):
#   - testing.kz (НЦТ) public schedule pages (HTML, no JSON API).
#   - The Kazakhstan Law on Education historical norms (one main
#     session, one additional, one supplementary per academic year).
#
# These are best-effort *placeholders* for offline / network-failure
# branches. The footer string in PARENT_REPORT-style copy points users
# at testing.kz as the authoritative source.
# ──────────────────────────────────────────────────────────────────────────
FALLBACK_SESSIONS_2026: list[dict[str, Any]] = [
    {
        "id": "main_june_2026",
        "kind": "main",
        "starts_on": "2026-06-15",
        "ends_on": "2026-07-05",
        "registration_deadline": "2026-05-15",
        "labels": {
            "ru": "Основное ЕНТ — июнь–июль 2026",
            "kz": "Негізгі ҰБТ — маусым–шілде 2026",
        },
    },
    {
        "id": "additional_aug_2026",
        "kind": "additional",
        "starts_on": "2026-08-10",
        "ends_on": "2026-08-25",
        "registration_deadline": "2026-07-20",
        "labels": {
            "ru": "Дополнительное ЕНТ — август 2026",
            "kz": "Қосымша ҰБТ — тамыз 2026",
        },
    },
    {
        "id": "supplementary_jan_2027",
        "kind": "supplementary",
        "starts_on": "2027-01-20",
        "ends_on": "2027-01-30",
        "registration_deadline": "2026-12-25",
        "labels": {
            "ru": "Дополнительная сессия — январь 2027",
            "kz": "Қосымша сессия — қаңтар 2027",
        },
    },
]

# Historical retake policy. Frozen; the FE renders this verbatim under
# the disclaimer "verify with testing.kz".
RETAKE_POLICY: dict[str, Any] = {
    # Per НЦТ historical practice: each candidate gets one main attempt
    # plus the right to ONE additional attempt within the same calendar
    # cycle. Supplementary session is for documented absences only.
    "max_attempts_per_cycle": 2,
    # Paid registration; price is ~6500 KZT historically. Surfaced as
    # an integer for the FE to format via Intl.NumberFormat.
    "fee_kzt": 6500,
    # No cooldown between main → additional beyond the registration
    # deadline; we encode it as 0 days for the FE estimator UI.
    "cooldown_days_between_attempts": 0,
}


# ──────────────────────────────────────────────────────────────────────────
# i18n string table
# ──────────────────────────────────────────────────────────────────────────
RETAKE_GUIDE_STRINGS: dict[str, dict[str, str]] = {
    "ru": {
        "title": "Гид по пересдаче ЕНТ",
        "subtitle": "Сессии, цена, и сколько баллов реально поднять",
        "sessions_heading": "Ближайшие сессии",
        "policy_heading": "Правила пересдачи",
        "estimator_heading": "Оценка прироста баллов",
        "estimator_current": "Текущий балл",
        "estimator_weeks": "Недель подготовки",
        "estimator_estimated": "Ожидаемый прирост",
        "estimator_band_low": "консервативно",
        "estimator_band_mid": "вероятно",
        "estimator_band_high": "оптимистично",
        "policy_max_attempts": "Максимум попыток в цикле",
        "policy_fee": "Стоимость пересдачи",
        "policy_authoritative": "Точные даты и регламент — на сайте testcenter.kz (НЦТ).",
        "fallback_warning": "Расписание загружено из локального кэша (testcenter.kz недоступен).",
        # v3.71 (B13, 2026-05-02): "—" placeholder is replaced with
        # this explanatory copy + a link hint when sessions[] is empty.
        "sessions_empty_title": "Расписание пока недоступно",
        "sessions_empty_body": "Не удалось загрузить ближайшие сессии с testcenter.kz и в локальном кэше тоже пусто. Точные даты и регламент пересдачи смотрите на сайте НЦТ.",
        "sessions_empty_link_label": "Открыть testcenter.kz",
        "kind_main": "Основная",
        "kind_additional": "Дополнительная",
        "kind_supplementary": "Резервная",
        "starts_on": "Начало",
        "ends_on": "Завершение",
        "registration_deadline": "Регистрация до",
    },
    "kz": {
        "title": "ҰБТ-ны қайта тапсыру нұсқаулығы",
        "subtitle": "Сессиялар, төлем және балды қаншаға көтеруге болады",
        "sessions_heading": "Жақын сессиялар",
        "policy_heading": "Қайта тапсыру ережесі",
        "estimator_heading": "Балл өсімінің бағасы",
        "estimator_current": "Қазіргі балл",
        "estimator_weeks": "Дайындық апталары",
        "estimator_estimated": "Күтілетін өсім",
        "estimator_band_low": "сақтық бойынша",
        "estimator_band_mid": "ықтимал",
        "estimator_band_high": "оңтайлы",
        "policy_max_attempts": "Циклдегі ең көп әрекет",
        "policy_fee": "Қайта тапсыру құны",
        "policy_authoritative": "Нақты күндер мен регламент — testcenter.kz (ҰТО) сайтында.",
        "fallback_warning": "Кесте жергілікті кэштен жүктелді (testcenter.kz қолжетімсіз).",
        # v3.71 (B13, 2026-05-02): empty-state copy mirrors the RU
        # version. Used when sessions[] is empty (fetch + cache miss).
        "sessions_empty_title": "Кесте әзірге қолжетімсіз",
        "sessions_empty_body": "Жақын сессияларды testcenter.kz-тен жүктеу мүмкін болмады, жергілікті кэшде де ештеңе жоқ. Нақты күндер мен регламент үшін ҰТО сайтын ашыңыз.",
        "sessions_empty_link_label": "testcenter.kz-ке өту",
        "kind_main": "Негізгі",
        "kind_additional": "Қосымша",
        "kind_supplementary": "Резервтік",
        "starts_on": "Басталуы",
        "ends_on": "Аяқталуы",
        "registration_deadline": "Тіркеу дейін",
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Pure helpers (no IO — unit-tested)
# ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RetakeBand:
    low: int
    mid: int
    high: int


def estimate_score_delta(*, current_score: int | None, weeks_until_session: int) -> RetakeBand:
    """Return a (low, mid, high) integer band of expected ҰБТ score
    delta given the current score and weeks of preparation.

    The model is intentionally simple — boss decision: a transparent
    number + clear 'consultative' band beats an opaque ML scorer. The
    bands are calibrated against historical Samga.ai cohorts:

    - Below 70 raw points: huge headroom; expect 1.5 pts/week mid.
    - 70–110: linear regime, 1.0 pts/week.
    - 110–130: diminishing returns, 0.5 pts/week.
    - 130+: ceiling — capped at +5.

    Low band is 50% of mid; high band is 175% of mid. Hard cap at 30
    so the UI never advertises a +50 fantasy.
    """

    weeks = max(0, int(weeks_until_session))
    if current_score is None:
        # Conservative when unknown — show mid for a hypothetical 100.
        per_week = 1.0
        cap = 25
    elif current_score >= 130:
        per_week = 0.25
        cap = 5
    elif current_score >= 110:
        per_week = 0.5
        cap = 12
    elif current_score >= 70:
        per_week = 1.0
        cap = 20
    else:
        per_week = 1.5
        cap = 30

    mid = min(cap, int(round(per_week * weeks)))
    low = int(round(mid * 0.5))
    high = min(cap, int(round(mid * 1.75)))
    return RetakeBand(low=low, mid=mid, high=high)


def filter_upcoming_sessions(
    sessions: list[dict[str, Any]], *, today: date | None = None
) -> list[dict[str, Any]]:
    """Drop sessions whose ``ends_on`` is in the past, preserving order."""

    if today is None:
        today = date.today()
    out: list[dict[str, Any]] = []
    for s in sessions:
        ends = _parse_iso_date(s.get("ends_on"))
        if ends is None or ends >= today:
            out.append(s)
    return out


def _parse_iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


# ──────────────────────────────────────────────────────────────────────────
# testing.kz scraper (best-effort)
#
# testing.kz publishes its schedule as HTML (no JSON API). We do a
# narrow, defensive pass: pull every ISO-like date string out of the
# announcements page and bucket the first three plausible "main /
# additional / supplementary" hits into the 2026 calendar shape.
#
# If the page redesigns, the regex misses, or the request fails for
# any reason — we silently fall back to the curated table. The FE
# surfaces the source via ``sessions_source`` so ops can notice.
# ──────────────────────────────────────────────────────────────────────────

# v3.33: schedule URL is now env-overridable.
# v3.36 (2026-05-01): default URL flipped to ``testcenter.kz``.
#
# Web research on 2026-05-01 confirmed that ``www.testing.kz`` is
# NOT the canonical Kazakhstan National Testing Center (НЦТ). The
# actual authoritative site is ``testcenter.kz`` (Ұлттық тестілеу
# орталығы). NCT publishes the 2026 schedule across dated news
# posts (with Russian month names, not ISO dates) rather than a
# single stable schedule page, so the fetcher's ISO-date regex
# will not match the homepage today — that's expected and observable
# through the v3.34 admin endpoint as a ``regex_miss`` /
# ``too_few_dates`` failure reason.
#
# Why flip the default anyway:
#   - ``www.testing.kz`` produces an SSL hostname mismatch and the
#     bare host times out; the fetch was guaranteed to fail with an
#     ``httpx_*`` reason and never even reach our parser. The user-
#     facing copy already names ``testcenter.kz`` (v3.33), so the
#     default URL was the only artefact still pointing at the wrong
#     domain.
#   - ``testcenter.kz`` resolves and returns 200, so we now get a
#     reachable canonical site. The new failure mode (``regex_miss``)
#     is a more useful signal than ``httpx_ConnectError`` — it tells
#     ops "the fetcher is alive but the page has no ISO dates yet",
#     not "the fetcher can't reach anything".
#   - ``TESTING_KZ_SCHEDULE_URL`` env override (v3.33) is the
#     supported escape hatch when NCT publishes a stable schedule
#     page or a curated mirror exists.
#
# See ``project_session_2026-05-01_v333_*`` and
# ``project_session_2026-05-01_v336_*`` memories for the full
# investigation chain.
_DEFAULT_SCHEDULE_URL = "https://testcenter.kz/"
TESTING_KZ_SCHEDULE_URL = (
    os.getenv("TESTING_KZ_SCHEDULE_URL", _DEFAULT_SCHEDULE_URL).strip() or _DEFAULT_SCHEDULE_URL
)
_DATE_RE = re.compile(r"\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b")

# v3.40: opt-in RU/KZ/EN month-name fallback parser. Disabled by
# default — the production page (testcenter.kz news posts) writes
# dates as "10 мая 2026" / "10 мамыр 2026", and the fallback parser
# is the only way to extract them. We keep it OFF by default until
# the parser has shadowed real prod traffic for a while; flipping
# the flag is a single env var, no redeploy code change.
#
# Set ``TESTCENTER_KZ_MONTH_PARSER=1`` (or "true"/"yes") to enable.
_MONTH_PARSER_FLAG_RAW = os.getenv("TESTCENTER_KZ_MONTH_PARSER", "").strip().lower()
TESTCENTER_KZ_MONTH_PARSER_ENABLED = _MONTH_PARSER_FLAG_RAW in {"1", "true", "yes", "on"}


_HTTP: httpx.AsyncClient | None = None
_CACHE: dict[str, Any] = {"sessions": None, "ts": 0.0, "source": "fallback"}
CACHE_TTL_SECONDS = 6 * 3600  # 6 hours

# v3.32 — fetch observability.
#
# QA on 2026-05-01 found that ``TESTING_KZ_SCHEDULE_URL`` is currently
# unreachable in production (SSL cert mismatch on ``www.testing.kz``,
# read-timeouts on the bare host). Every prod request was falling
# through to the curated fallback, but ops had no visibility into
# the rate or the failure mode.
#
# We record per-process counters + the last success / failure context
# so an admin can hit a future debug endpoint, or a test can introspect.
# Keeping it in-process (not Prometheus) because we don't have a
# prom_client installed and a stuck-on-fallback condition is
# operationally interesting at "did this just happen / has it been
# happening for a week?" granularity, not per-second.
_FETCH_STATS: dict[str, Any] = {
    "success_count": 0,
    "failure_count": 0,
    "last_success_at": None,  # epoch seconds
    "last_failure_at": None,  # epoch seconds
    "last_failure_reason": None,  # short string: "http_status_503" / "httpx_ConnectError" / "regex_miss" / "too_few_dates"
}


def _record_fetch_success(now: float) -> None:
    _FETCH_STATS["success_count"] = int(_FETCH_STATS["success_count"]) + 1
    _FETCH_STATS["last_success_at"] = now


def _record_fetch_failure(now: float, reason: str) -> None:
    _FETCH_STATS["failure_count"] = int(_FETCH_STATS["failure_count"]) + 1
    _FETCH_STATS["last_failure_at"] = now
    _FETCH_STATS["last_failure_reason"] = reason


def get_fetch_stats() -> dict[str, Any]:
    """Return a copy of the testing.kz fetch counters.

    Public so an admin / debug endpoint can render it. Always returns
    a fresh dict so callers can't accidentally mutate the singleton.
    """
    return dict(_FETCH_STATS)


def reset_fetch_stats_for_tests() -> None:
    """Test hook — wipe counters between cases."""
    _FETCH_STATS["success_count"] = 0
    _FETCH_STATS["failure_count"] = 0
    _FETCH_STATS["last_success_at"] = None
    _FETCH_STATS["last_failure_at"] = None
    _FETCH_STATS["last_failure_reason"] = None


def _client() -> httpx.AsyncClient:
    """Lazily mint a single project-registered AsyncClient.

    Lazy because importing this module from a test that mocks httpx
    shouldn't already register a real client at import time.
    """

    global _HTTP
    if _HTTP is None:
        _HTTP = register_http_client(httpx.AsyncClient(timeout=8.0))
    return _HTTP


async def fetch_testing_kz_sessions() -> list[dict[str, Any]] | None:
    """Best-effort fetch of testing.kz schedule. Returns ``None`` on
    failure so the caller knows to use the fallback.

    v3.32: every outcome is recorded into ``_FETCH_STATS`` so a debug
    endpoint can answer "is the live fetch actually working?". The
    failure log was downgraded from WARNING to INFO because in the
    current state the warning would fire on every cache-miss and
    create log noise. The stats dict is the load-bearing signal now.

    v3.36: default URL flipped to ``testcenter.kz`` (canonical NCT
    homepage). Expected reason while NCT publishes the schedule via
    dated news posts: ``regex_miss`` / ``too_few_dates`` rather than
    ``httpx_*`` — observable through v3.34 admin endpoint.
    """

    now = time.time()
    try:
        resp = await _client().get(TESTING_KZ_SCHEDULE_URL)
        if resp.status_code != 200:
            reason = f"http_status_{resp.status_code}"
            _record_fetch_failure(now, reason)
            logger.info(
                "testing.kz schedule fetch returned non-200",
                extra={"reason": reason, "status_code": resp.status_code},
            )
            return None
        body = resp.text or ""
    except httpx.HTTPError as exc:
        reason = f"httpx_{type(exc).__name__}"
        _record_fetch_failure(now, reason)
        logger.info(
            "testing.kz schedule fetch errored",
            extra={"reason": reason, "exception": str(exc)[:200]},
        )
        return None

    iso_dates = sorted({"-".join(parts) for parts in _DATE_RE.findall(body)})

    # v3.40: when the ISO-date regex finds nothing AND the
    # month-name fallback flag is set, try the RU/KZ/EN parser.
    # This is the path that lets testcenter.kz news posts
    # ("10 мая 2026") yield real ``success_count`` traffic.
    # When the flag is off, behavior is bit-identical to v3.36.
    if not iso_dates and TESTCENTER_KZ_MONTH_PARSER_ENABLED:
        from app.services.testcenter_kz_date_parser import (
            parse_testcenter_kz_dates,
        )

        parsed = parse_testcenter_kz_dates(body)
        if parsed.iso_dates:
            iso_dates = parsed.iso_dates
            logger.info(
                "testcenter.kz month-name fallback parser hit",
                extra={
                    "reason": "month_parser_hit",
                    "lang": parsed.lang,
                    "raw_count": parsed.raw_count,
                    "iso_date_count": len(iso_dates),
                },
            )

    if not iso_dates:
        _record_fetch_failure(now, "regex_miss")
        logger.info(
            "testing.kz schedule fetch returned 200 but matched no ISO dates",
            extra={"reason": "regex_miss", "body_chars": len(body)},
        )
        return None
    if len(iso_dates) < 2:
        _record_fetch_failure(now, "too_few_dates")
        logger.info(
            "testing.kz schedule fetch found too few dates",
            extra={"reason": "too_few_dates", "iso_date_count": len(iso_dates)},
        )
        return None

    # Pair up consecutive dates into (starts, ends) buckets, then map
    # the first three into our session-kind shape. This is a *very*
    # conservative parser — if testing.kz publishes 100 dates, we keep
    # the earliest 6 (3 sessions × 2 dates each).
    sessions: list[dict[str, Any]] = []
    kinds = ("main", "additional", "supplementary")
    for kind, slice_start in zip(kinds, range(0, 6, 2), strict=False):
        if slice_start + 1 >= len(iso_dates):
            break
        starts = iso_dates[slice_start]
        ends = iso_dates[slice_start + 1]
        sessions.append(
            {
                "id": f"{kind}_{starts}",
                "kind": kind,
                "starts_on": starts,
                "ends_on": ends,
                # Live page rarely exposes a separate registration line
                # in a regex-stable way — leave blank so the FE shows '—'.
                "registration_deadline": None,
                "labels": {
                    "ru": _kind_label_ru(kind),
                    "kz": _kind_label_kz(kind),
                },
            }
        )
    if sessions:
        _record_fetch_success(now)
        return sessions
    _record_fetch_failure(now, "empty_after_bucketing")
    return None


def _kind_label_ru(kind: str) -> str:
    return {
        "main": "Основное ЕНТ",
        "additional": "Дополнительное ЕНТ",
        "supplementary": "Резервная сессия",
    }.get(kind, "ЕНТ")


def _kind_label_kz(kind: str) -> str:
    return {
        "main": "Негізгі ҰБТ",
        "additional": "Қосымша ҰБТ",
        "supplementary": "Резервтік сессия",
    }.get(kind, "ҰБТ")


# ──────────────────────────────────────────────────────────────────────────
# Cache layer
# ──────────────────────────────────────────────────────────────────────────


def _cache_fresh(now: float) -> bool:
    return _CACHE["sessions"] is not None and (now - _CACHE["ts"]) < CACHE_TTL_SECONDS


async def get_sessions_with_cache() -> tuple[list[dict[str, Any]], str]:
    """Return ``(sessions, source)`` where source ∈ {"live", "fallback"}.

    Cache is in-process (single dict). Restart of the worker drops it,
    which is acceptable: testing.kz is queried once per 6h per worker.
    """

    now = time.time()
    if _cache_fresh(now):
        return list(_CACHE["sessions"]), str(_CACHE["source"])

    live = await fetch_testing_kz_sessions()
    if live:
        _CACHE["sessions"] = live
        _CACHE["source"] = "live"
        _CACHE["ts"] = now
        return list(live), "live"

    # Fallback path — also cache so we don't hammer testing.kz on every
    # request when it's down.
    _CACHE["sessions"] = list(FALLBACK_SESSIONS_2026)
    _CACHE["source"] = "fallback"
    _CACHE["ts"] = now
    return list(FALLBACK_SESSIONS_2026), "fallback"


def clear_cache_for_tests() -> None:
    """Test hook — wipe the module-level cache. Pytest fixtures use this."""

    _CACHE["sessions"] = None
    _CACHE["ts"] = 0.0
    _CACHE["source"] = "fallback"


# ──────────────────────────────────────────────────────────────────────────
# Top-level orchestrator
# ──────────────────────────────────────────────────────────────────────────


async def build_retake_guide_payload(
    *,
    language: str = "ru",
    current_score: int | None = None,
    weeks_until_session: int = 8,
) -> dict[str, Any]:
    """Assemble the deterministic payload for the FE Retake Guide page."""

    lang = "kz" if str(language).lower().startswith("kz") else "ru"
    strings = RETAKE_GUIDE_STRINGS[lang]

    sessions, source = await get_sessions_with_cache()
    upcoming = filter_upcoming_sessions(sessions)

    band = estimate_score_delta(
        current_score=current_score, weeks_until_session=weeks_until_session
    )

    return {
        "language": lang,
        "strings": strings,
        "sessions": upcoming,
        "sessions_source": source,
        "policy": dict(RETAKE_POLICY),
        "estimator": {
            "current_score": current_score,
            "weeks_until_session": int(max(0, weeks_until_session)),
            "delta": {"low": band.low, "mid": band.mid, "high": band.high},
        },
    }
