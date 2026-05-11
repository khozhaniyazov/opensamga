"""
profile_pair_simulator.py
-------------------------

v3.25 — Profile subject pair simulator (Issue #15 AC#4).

Given a profile-subject pair (e.g. ("Mathematics", "Physics")), assemble a
read-only snapshot:

- The pair's curated career direction copy (RU + KZ).
- Reachable major groups whose ``unt_subjects`` contains BOTH subjects.
- Aggregate grant pressure across the matched majors (median, max threshold,
  total grants awarded, university-row count).
- Heuristic risk flags ("narrow_major_range", "high_competition",
  "low_grant_count").

Design notes
~~~~~~~~~~~~

- ``MajorGroup.unt_subjects`` is a CSV-as-string column. The pre-existing
  chat tool ``get_majors_by_subjects`` matches via ``ILIKE %subject%`` and is
  buggy: ``ILIKE %Mathematics%`` matches ``"Mathematical Literacy"`` too.
  This service splits the CSV explicitly and exact-matches canonical names,
  so ``"Mathematics"`` does not collide with ``"Mathematical Literacy"``.
- All helpers are pure (no DB, no I/O) so they are unit-testable without a
  fixture. The async ``build_profile_pair_simulator_response`` orchestrator
  is the only DB-touching surface.
- No new persisted state, no migrations, no LLM calls. Career copy is a
  curator-authored constant in this module.

Author: solo session 2026-05-01.
"""

from __future__ import annotations

import os
import time as _time
from collections.abc import Iterable
from dataclasses import dataclass
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants.subjects import (
    PROFILE_SUBJECT_COMBINATIONS,
    is_valid_profile_subject_pair,
    normalize_subject_name,
)
from ..models import HistoricalGrantThreshold, MajorGroup, UniversityData

# ──────────────────────────────────────────────────────────────────────────
# Risk thresholds
#
# These are deliberately coarse — the underlying data does not support
# anything precise. The intent is to flag "this pair has very few majors"
# (narrow range), "the median entry bar is high" (high competition), or
# "few grants are awarded across the pair's majors" (low grant supply).
# ──────────────────────────────────────────────────────────────────────────
RISK_NARROW_MAJOR_RANGE_MAX = 3
RISK_HIGH_COMPETITION_MIN_THRESHOLD = 120
RISK_LOW_GRANT_COUNT_MAX = 50


@dataclass(frozen=True)
class PairCareerCopy:
    """Curated bilingual career-direction copy for a single subject pair."""

    title_ru: str
    title_kz: str
    majors_ru: str
    majors_kz: str
    pressure_ru: str
    pressure_kz: str
    next_ru: str
    next_kz: str

    def to_dict(self) -> dict[str, dict[str, str]]:
        return {
            "ru": {
                "title": self.title_ru,
                "majors": self.majors_ru,
                "pressure": self.pressure_ru,
                "next": self.next_ru,
            },
            "kz": {
                "title": self.title_kz,
                "majors": self.majors_kz,
                "pressure": self.pressure_kz,
                "next": self.next_kz,
            },
        }


# ──────────────────────────────────────────────────────────────────────────
# Curated career copy
#
# Keys are sorted tuples of canonical English subject names to match the
# ``canonical_pair_key`` output. Covers all 12 entries from
# PROFILE_SUBJECT_COMBINATIONS so the BE never falls back to a generic
# string for a valid pair.
# ──────────────────────────────────────────────────────────────────────────
PAIR_CAREER_COPY: dict[tuple[str, str], PairCareerCopy] = {
    ("Informatics", "Mathematics"): PairCareerCopy(
        title_ru="Математика + Информатика",
        title_kz="Математика + Информатика",
        majors_ru="IT, Computer Science, аналитика, инженерные программы",
        majors_kz="IT, Computer Science, аналитика, инженерлік бағыттар",
        pressure_ru="Высокая конкуренция на сильные IT-направления.",
        pressure_kz="Күшті IT бағыттарында бәсеке жоғары.",
        next_ru="Проверить математику, алгоритмы и лимиты по грантам.",
        next_kz="Математика, алгоритм және грант шектерін тексеру.",
    ),
    ("Biology", "Chemistry"): PairCareerCopy(
        title_ru="Биология + Химия",
        title_kz="Биология + Химия",
        majors_ru="Медицина, биология, фармация, health science",
        majors_kz="Медицина, биология, фармация, health science",
        pressure_ru="Порог часто высокий, платное обучение может быть дорогим.",
        pressure_kz="Шек жиі жоғары, ақылы оқу қымбат болуы мүмкін.",
        next_ru="Сравнить грант-риск и бюджет до выбора города.",
        next_kz="Қала таңдауға дейін грант тәуекелі мен бюджетті салыстыру.",
    ),
    ("Mathematics", "Physics"): PairCareerCopy(
        title_ru="Физика + Математика",
        title_kz="Физика + Математика",
        majors_ru="Инженерия, энергетика, архитектура, прикладная математика",
        majors_kz="Инженерия, энергетика, архитектура, қолданбалы математика",
        pressure_ru="Сильный вариант, если база по формулам стабильная.",
        pressure_kz="Формула базасы тұрақты болса, мықты бағыт.",
        next_ru="Закрыть пробелы по механике, электричеству и функциям.",
        next_kz="Механика, электр және функциялар бойынша олқылықты жабу.",
    ),
    ("Geography", "Mathematics"): PairCareerCopy(
        title_ru="География + Математика",
        title_kz="География + Математика",
        majors_ru="Экономика, логистика, география, менеджмент",
        majors_kz="Экономика, логистика, география, менеджмент",
        pressure_ru="Направления широкие, но качество вузов сильно различается.",
        pressure_kz="Бағыт кең, бірақ ЖОО сапасы қатты өзгереді.",
        next_ru="Смотреть не только грант, но и город, практику и трудоустройство.",
        next_kz="Грантпен бірге қала, практика және жұмысқа шығуды қарау.",
    ),
    ("Fundamentals of Law", "World History"): PairCareerCopy(
        title_ru="Всемирная история + Право",
        title_kz="Дүниежүзі тарихы + Құқық",
        majors_ru="Право, госуправление, международные отношения",
        majors_kz="Құқық, мемлекеттік басқару, халықаралық қатынастар",
        pressure_ru="Важно заранее оценить конкурс и реальные карьерные маршруты.",
        pressure_kz="Конкурс пен нақты карьера жолдарын ерте бағалау керек.",
        next_ru="Сравнить проходные данные и альтернативные гуманитарные траектории.",
        next_kz="Өту деректерін және гуманитарлық балама жолдарды салыстыру.",
    ),
    ("Kazakh Language", "Kazakh Literature"): PairCareerCopy(
        title_ru="Казахский язык + Казахская литература",
        title_kz="Қазақ тілі + Қазақ әдебиеті",
        majors_ru="Филология, журналистика, преподавание, перевод",
        majors_kz="Филология, журналистика, оқытушылық, аударма",
        pressure_ru="Карьерный диапазон узкий — рассмотреть смежные гуманитарные треки.",
        pressure_kz="Мансап ауқымы тар — жақын гуманитарлық бағыттарды қарау.",
        next_ru="Проверить вакансии в журналистике/образовании и реальные средние зарплаты.",
        next_kz="Журналистика/білім беру бойынша бос орынды және орташа жалақыны тексеру.",
    ),
    ("Russian Language", "Russian Literature"): PairCareerCopy(
        title_ru="Русский язык + Русская литература",
        title_kz="Орыс тілі + Орыс әдебиеті",
        majors_ru="Филология, журналистика, преподавание, перевод",
        majors_kz="Филология, журналистика, оқытушылық, аударма",
        pressure_ru="Карьерный диапазон узкий — рассмотреть смежные гуманитарные треки.",
        pressure_kz="Мансап ауқымы тар — жақын гуманитарлық бағыттарды қарау.",
        next_ru="Проверить вакансии в журналистике/образовании и реальные средние зарплаты.",
        next_kz="Журналистика/білім беру бойынша бос орынды және орташа жалақыны тексеру.",
    ),
    ("Foreign Language", "World History"): PairCareerCopy(
        title_ru="Иностранный язык + Всемирная история",
        title_kz="Шетел тілі + Дүниежүзі тарихы",
        majors_ru="Международные отношения, регионоведение, перевод, дипломатия",
        majors_kz="Халықаралық қатынастар, аймақтану, аударма, дипломатия",
        pressure_ru="Сильные программы концентрируются в крупных городах — конкурс высокий.",
        pressure_kz="Күшті бағдарламалар ірі қалаларда — бәсеке жоғары.",
        next_ru="Сравнить языковой балл и проходные баллы по конкретным программам.",
        next_kz="Тіл балы мен нақты бағдарламалардың өту балын салыстыру.",
    ),
    ("Biology", "Geography"): PairCareerCopy(
        title_ru="Биология + География",
        title_kz="Биология + География",
        majors_ru="Экология, агрономия, туризм, geography science",
        majors_kz="Экология, агрономия, туризм, geography science",
        pressure_ru="Сегмент нишевый — внимательно смотреть на трудоустройство и регион.",
        pressure_kz="Сала тар — жұмысқа шығу мен өңірге мұқият қарау.",
        next_ru="Уточнить, какие университеты реально дают практику и стажировки.",
        next_kz="Қай ЖОО шынайы практика мен тағылымдама беретінін нақтылау.",
    ),
    ("Geography", "World History"): PairCareerCopy(
        title_ru="География + Всемирная история",
        title_kz="География + Дүниежүзі тарихы",
        majors_ru="Регионоведение, туризм, государственное управление, образование",
        majors_kz="Аймақтану, туризм, мемлекеттік басқару, білім беру",
        pressure_ru="Конкурс умеренный, но карьерные пути зависят от города и языка.",
        pressure_kz="Бәсеке орташа, бірақ мансап жолы қала мен тілге байланысты.",
        next_ru="Сопоставить программы по регионам и языку обучения.",
        next_kz="Өңір мен оқыту тіліне қарай бағдарламаларды салыстыру.",
    ),
    ("Foreign Language", "Geography"): PairCareerCopy(
        title_ru="Иностранный язык + География",
        title_kz="Шетел тілі + География",
        majors_ru="Туризм, международная логистика, регионоведение, education",
        majors_kz="Туризм, халықаралық логистика, аймақтану, білім беру",
        pressure_ru="Узкий, но рабочий профиль — карьера зависит от языкового уровня.",
        pressure_kz="Тар, бірақ жұмыс істейтін бағыт — мансап тіл деңгейіне байланысты.",
        next_ru="Поднять языковой уровень и сравнить вузы с международными программами.",
        next_kz="Тіл деңгейін көтеру және халықаралық бағдарламасы бар ЖОО салыстыру.",
    ),
    ("Chemistry", "Physics"): PairCareerCopy(
        title_ru="Химия + Физика",
        title_kz="Химия + Физика",
        majors_ru="Химия, материалы, нефтегаз, инженерия, прикладные науки",
        majors_kz="Химия, материалдар, мұнай-газ, инженерия, қолданбалы ғылым",
        pressure_ru="Технологические направления требуют сильной базы по обоим предметам.",
        pressure_kz="Технологиялық бағыттар екі пәннен де берік база талап етеді.",
        next_ru="Подтвердить лабораторную базу и оборудование выбранных вузов.",
        next_kz="Таңдалған ЖОО зертханалық базасы мен жабдықтарын растау.",
    ),
}


# ──────────────────────────────────────────────────────────────────────────
# Pure helpers
# ──────────────────────────────────────────────────────────────────────────


def canonical_pair_key(s1: str, s2: str) -> tuple[str, str]:
    """Return the canonical (sorted, normalized) tuple key for a pair.

    Uses ``normalize_subject_name`` so any RU/KZ/alias input lands on the
    canonical English key used by ``PROFILE_SUBJECT_COMBINATIONS`` and
    ``PAIR_CAREER_COPY``.
    """

    a = normalize_subject_name(s1)
    b = normalize_subject_name(s2)
    return tuple(sorted([a, b]))  # type: ignore[return-value]


def pair_career_copy(pair_key: tuple[str, str]) -> PairCareerCopy | None:
    """Look up curated career copy for a canonical pair key.

    Returns ``None`` when the pair is not in ``PAIR_CAREER_COPY``.  Callers
    are expected to gate on ``is_valid_profile_subject_pair`` first; this is
    only a copy lookup.
    """

    return PAIR_CAREER_COPY.get(pair_key)


def split_unt_subjects(csv_value: str | None) -> list[str]:
    """Split a ``MajorGroup.unt_subjects`` CSV string into normalized names.

    Empty/blank entries are dropped. Each entry is normalized via
    ``normalize_subject_name`` so downstream comparisons can use exact
    equality.
    """

    if not csv_value:
        return []
    parts: list[str] = []
    for raw in csv_value.split(","):
        cleaned = raw.strip()
        if not cleaned:
            continue
        parts.append(normalize_subject_name(cleaned))
    return parts


def major_matches_pair(
    csv_value: str | None,
    pair_key: tuple[str, str],
) -> bool:
    """Return True iff the major's CSV unt_subjects contains BOTH pair entries.

    Uses exact-match against the normalized split list to avoid the
    ``Mathematics`` ↔ ``Mathematical Literacy`` substring collision that
    plagues the chat-tool ILIKE pattern.
    """

    if len(pair_key) != 2:
        return False
    subjects = set(split_unt_subjects(csv_value))
    return pair_key[0] in subjects and pair_key[1] in subjects


def classify_pair_risks(
    *,
    major_count: int,
    median_threshold: int | None,
    total_grants_awarded: int,
) -> dict[str, Any]:
    """Compute risk flags + severity from aggregate stats.

    Pure & deterministic. Severity is the worst of the triggered flags.
    """

    flags: list[str] = []
    if major_count <= RISK_NARROW_MAJOR_RANGE_MAX:
        flags.append("narrow_major_range")
    if median_threshold is not None and median_threshold >= RISK_HIGH_COMPETITION_MIN_THRESHOLD:
        flags.append("high_competition")
    if total_grants_awarded <= RISK_LOW_GRANT_COUNT_MAX:
        flags.append("low_grant_count")

    if not flags:
        severity = "low"
    elif len(flags) >= 2:
        severity = "high"
    else:
        severity = "medium"

    return {"flags": flags, "severity": severity}


def aggregate_thresholds(
    *,
    grant_thresholds: Iterable[int | None],
) -> dict[str, int | None]:
    """Aggregate a stream of (possibly missing) grant thresholds.

    Returns ``{median, max}`` across non-null entries.  ``median`` is the
    integer median (rounded down for even-length samples to match Python's
    ``statistics.median`` behavior on ints — we coerce to int for the API).
    """

    cleaned = [int(v) for v in grant_thresholds if v is not None]
    if not cleaned:
        return {"median": None, "max": None}
    return {"median": int(median(cleaned)), "max": max(cleaned)}


# ──────────────────────────────────────────────────────────────────────────
# Async orchestrator (DB-touching — not unit-tested as a unit;
# integration-tested elsewhere in line with v3.21/v3.23 convention).
# ──────────────────────────────────────────────────────────────────────────


# ---------------------------------------------------------------------------
# v4.10 (2026-05-05) — process-local memo cache for the simulator payload.
#
# The simulator response is an aggregation over MajorGroup x UniversityData
# x HistoricalGrantThreshold keyed only by (subject1, subject2). The
# underlying tables are slow-moving — universities + thresholds are imported
# once per admission cycle (annual) and we don't read user-specific data
# here. Caching the payload per canonical_pair_key gives O(1) repeat hits
# (the simulator route currently runs 200-400ms cold).
#
# Strict opt-in: the cache is disabled unless ``STRATEGY_PAIR_MEMO_TTL_SECONDS``
# is set to a positive integer. With the env unset (the default), behaviour
# is bit-identical to v4.9 — every request goes through the full DB path.
# This keeps the v4.10 change additive: ops can flip the cache on per-env
# (e.g. ``STRATEGY_PAIR_MEMO_TTL_SECONDS=3600`` in prod) without touching
# code or redeploying for a rollback.
#
# Future work (NOT in v4.10): tie cache invalidation to the admission-cycle
# import lifecycle event. That couples to the ingest pipeline; the TTL
# approach is a deliberate first step.
# ---------------------------------------------------------------------------

_SIMULATOR_MEMO: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def _memo_ttl_seconds() -> int:
    """Read the cache TTL from the environment.

    Returns 0 (cache disabled) for any of: env unset, empty string,
    non-integer value, or negative integer. Read on every request so
    the cache can be flipped on/off without restarting the worker —
    cheap because os.getenv is a dict lookup.
    """
    raw = os.getenv("STRATEGY_PAIR_MEMO_TTL_SECONDS")
    if not raw:
        return 0  # disabled by default
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def _reset_simulator_memo() -> None:
    """Test-only helper: clear the process-local memo.

    Exposed to keep tests deterministic without reaching into a private
    module attribute. Production callers should never need this.
    """
    _SIMULATOR_MEMO.clear()


async def build_profile_pair_simulator_response(
    *,
    db: AsyncSession,
    subject1: str,
    subject2: str,
) -> dict[str, Any]:
    """Build the full simulator payload for a profile-subject pair.

    Raises ``ValueError`` if the pair is not a valid UNT profile pair —
    routers should map that to HTTP 400.
    """

    if not is_valid_profile_subject_pair([subject1, subject2]):
        raise ValueError("invalid_profile_pair")

    # SPIKE: process-local memo lookup keyed on the canonical pair.
    ttl = _memo_ttl_seconds()
    cache_key = canonical_pair_key(subject1, subject2) if ttl else None
    if cache_key is not None:
        cached = _SIMULATOR_MEMO.get(cache_key)
        if cached is not None:
            cached_at, cached_payload = cached
            if _time.monotonic() - cached_at < ttl:
                return cached_payload

    pair_key = canonical_pair_key(subject1, subject2)
    copy = pair_career_copy(pair_key)

    # 1. Pull all major groups; CSV-split + exact-match in Python so we
    #    avoid the chat-tool ILIKE substring bug.
    rows = (await db.execute(select(MajorGroup))).scalars().all()
    matched: list[MajorGroup] = [
        row for row in rows if major_matches_pair(row.unt_subjects, pair_key)
    ]

    # 2. For each matched major_code, look up current-year UniversityData and
    #    historical thresholds, then aggregate.  We deliberately keep this
    #    simple — one query per major would be silly; one bulk query per
    #    table keyed on the major_code list.
    major_codes: list[str] = [row.group_code for row in matched if row.group_code]
    universities_per_major: dict[str, list[UniversityData]] = {}
    historical_per_major: dict[str, list[HistoricalGrantThreshold]] = {}
    if major_codes:
        uni_rows = (
            (
                await db.execute(
                    select(UniversityData).where(UniversityData.major_code.in_(major_codes))
                )
            )
            .scalars()
            .all()
        )
        for u in uni_rows:
            if u.major_code:
                universities_per_major.setdefault(u.major_code, []).append(u)

        hist_rows = (
            (
                await db.execute(
                    select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.major_code.in_(major_codes)
                    )
                )
            )
            .scalars()
            .all()
        )
        for h in hist_rows:
            if h.major_code:
                historical_per_major.setdefault(h.major_code, []).append(h)

    majors_payload: list[dict[str, Any]] = []
    all_thresholds: list[int] = []
    total_grants_awarded = 0
    for row in matched:
        code = row.group_code
        uni_rows_for_code = universities_per_major.get(code, [])
        hist_rows_for_code = historical_per_major.get(code, [])
        thresholds = [u.grant_threshold_general for u in uni_rows_for_code]
        agg = aggregate_thresholds(grant_thresholds=thresholds)
        grants_awarded_for_code = sum((h.grants_awarded_count or 0) for h in hist_rows_for_code)
        total_grants_awarded += grants_awarded_for_code
        if agg["median"] is not None:
            all_thresholds.append(agg["median"])
        majors_payload.append(
            {
                "code": code,
                "name": row.group_name,
                "university_count": len({u.uni_name for u in uni_rows_for_code if u.uni_name}),
                "median_grant_threshold": agg["median"],
                "max_grant_threshold": agg["max"],
                "total_grants_awarded": grants_awarded_for_code,
                "deep_link": (f"/dashboard/universities?major_code={code}" if code else None),
            }
        )
    majors_payload.sort(
        key=lambda m: (
            -(m["median_grant_threshold"] or 0),
            -(m["university_count"] or 0),
            (m["name"] or ""),
        )
    )

    overall = aggregate_thresholds(grant_thresholds=all_thresholds)
    risks = classify_pair_risks(
        major_count=len(matched),
        median_threshold=overall["median"],
        total_grants_awarded=total_grants_awarded,
    )

    payload = {
        "pair": list(pair_key),
        "career_copy": copy.to_dict() if copy else None,
        "majors": majors_payload,
        "summary": {
            "major_count": len(matched),
            "median_grant_threshold": overall["median"],
            "max_grant_threshold": overall["max"],
            "total_grants_awarded": total_grants_awarded,
        },
        "risks": risks,
    }

    # SPIKE: store in the memo if cache is enabled. The cache key is
    # already canonicalised via canonical_pair_key, so (Math, Phys)
    # and (Phys, Math) hit the same entry.
    if cache_key is not None:
        _SIMULATOR_MEMO[cache_key] = (_time.monotonic(), payload)

    return payload


def expected_pairs() -> list[tuple[str, str]]:
    """Re-export ``PROFILE_SUBJECT_COMBINATIONS`` as canonical sorted keys."""

    return sorted({canonical_pair_key(p[0], p[1]) for p in PROFILE_SUBJECT_COMBINATIONS})
