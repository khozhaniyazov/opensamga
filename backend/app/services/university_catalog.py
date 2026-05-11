from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HistoricalGrantThreshold, UniversityData, UniversityDetail
from app.services.university_aliases import build_university_alias_map
from app.services.university_data_confidence import build_summary_confidence

TRANSLIT_MAP = str.maketrans(
    {
        "ә": "а",
        "қ": "к",
        "ғ": "г",
        "ң": "н",
        "ү": "у",
        "ұ": "у",
        "ө": "о",
        "і": "и",
        "һ": "х",
    }
)


def normalize_name(value: str | None) -> str:
    text = (value or "").lower().replace("ё", "е").translate(TRANSLIT_MAP)
    text = re.sub(r"\s*\([^)]*\)\s*", " ", text)
    text = text.replace("имени", "им")
    text = text.replace("им.", "им")
    text = text.replace("академика", "ак")
    text = re.sub(r"[^0-9a-zа-я\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


UNIVERSITY_ALIAS_MAP = build_university_alias_map(normalize_name)


RAW_PRESTIGE_OVERRIDES = {
    "Казахский национальный университет имени аль-Фараби": {
        "tier": "elite",
        "score": 98,
        "note": "QS и исследовательский статус",
    },
    "Евразийский национальный университет им. Л.Н. Гумилева": {
        "tier": "elite",
        "score": 94,
        "note": "сильная международная репутация и QS",
    },
    "Казахский национальный исследовательский технический университет имени К.И.Сатпаева": {
        "tier": "elite",
        "score": 90,
        "note": "национальный исследовательский техвуз",
    },
    "Казахский национальный педагогический университет имени Абая": {
        "tier": "elite",
        "score": 86,
        "note": "ведущий педвуз и QS",
    },
    "Казахстанско-Британский технический университет": {
        "tier": "elite",
        "score": 84,
        "note": "международный техбренд и QS Asia",
    },
    "Южно-Казахстанский университет имени М. Ауэзова": {
        "tier": "elite",
        "score": 82,
        "note": "QS Asia Top-150",
    },
    "Международный казахско-турецкий университет имени Х.А.Ясави": {
        "tier": "strong",
        "score": 74,
        "note": "международный статус и QS",
    },
    "Казахский агротехнический университет имени С.Сейфуллина": {
        "tier": "strong",
        "score": 72,
        "note": "рост в QS Asia и QS World",
    },
    "Карагандинский Университет имени академика Е.А.Букетова": {
        "tier": "strong",
        "score": 70,
        "note": "национальный статус с 2025 года",
    },
    "Каспийский университет технологии и инжиниринга имени Ш.Есенова": {
        "tier": "strong",
        "score": 68,
        "note": "участник QS World 2026",
    },
    "Университет имени Шакарима города Семей": {
        "tier": "strong",
        "score": 66,
        "note": "участник QS World 2026",
    },
    "Северо-Казахстанский университет имени М.Козыбаева": {
        "tier": "strong",
        "score": 64,
        "note": "участник QS World 2026",
    },
}

PRESTIGE_OVERRIDES = {
    normalize_name(name): profile for name, profile in RAW_PRESTIGE_OVERRIDES.items()
}

SPECIAL_STATUS_MARKERS = ("национальный", "national")
RESEARCH_MARKERS = ("исследовательский", "research")


@dataclass
class UniversityCatalog:
    summaries: list[dict[str, Any]]
    summary_by_id: dict[int, dict[str, Any]]
    details_by_id: dict[int, UniversityDetail]
    rows_by_id: dict[int, list[UniversityData]]
    history_by_id: dict[int, list[HistoricalGrantThreshold]]


def dedupe_universities(universities: list[UniversityDetail]) -> list[UniversityDetail]:
    groups: dict[str, list[UniversityDetail]] = defaultdict(list)
    for item in universities:
        groups[normalize_name(item.full_name)].append(item)

    unique_unis: list[UniversityDetail] = []
    for group in groups.values():
        if len(group) == 1:
            unique_unis.append(group[0])
            continue

        with_code = [
            item for item in group if item.university_code and item.university_code.strip()
        ]
        pool = with_code or group
        unique_unis.append(min(pool, key=lambda item: len(item.full_name or "")))

    return unique_unis


def canonicalize_university_name(
    raw_name: str | None,
    canonical_by_normalized: dict[str, str],
) -> str | None:
    normalized = normalize_name(raw_name)
    if not normalized:
        return None

    if normalized in canonical_by_normalized:
        return canonical_by_normalized[normalized]

    alias_target = UNIVERSITY_ALIAS_MAP.get(normalized)
    if alias_target:
        return alias_target

    return None


def extract_city(contacts: Any) -> str | None:
    sources = contacts if isinstance(contacts, list) else [str(contacts or "")]
    for source in sources:
        text = str(source or "").strip()
        if not text:
            continue
        if "|" in text:
            parts = [part.strip() for part in text.split("|") if part.strip()]
            if len(parts) >= 2:
                candidate = sanitize_city(parts[1])
                if candidate:
                    return candidate
        else:
            candidate = sanitize_city(text)
            if candidate:
                return candidate
    return None


def sanitize_city(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None

    lowered = text.lower()
    if (
        "http" in lowered
        or "instagram" in lowered
        or "facebook" in lowered
        or "vk.com" in lowered
        or "код вуза" in lowered
        or "univision" in lowered
        or "@" in lowered
    ):
        return None

    if re.search(r"\+?\d{3,}", text):
        return None

    if any(
        marker in lowered
        for marker in ("улица", "ул.", "мкр", "микрорайон", "проспект", "пр.", "дом", "здан")
    ):
        return None

    if "," in text and any(char.isdigit() for char in text):
        return None

    if len(text) > 40:
        return None

    return text


# Authoritative overrides for universities whose contacts_raw does not contain
# a resolvable city and which have no UniversityData rows (fresh entries).
UNIVERSITY_CITY_OVERRIDES: dict[str, str] = {
    "De Montfort University Kazakhstan": "Алматы",
    "Актауский гуманитарно-технический университет": "Актау",
    "Казахский медицинский университет непрерывного образования": "Алматы",
    "Казахский национальный женский педагогический университет": "Алматы",
    "Казахский университет путей сообщений": "Алматы",
    "Международный университет Silkway": "Шымкент",
    "Региональный социально-инновационный университет": "Шымкент",
    "Таразский государственный педагогический университет": "Тараз",
    'Университет "Алматы"': "Алматы",
    'Университет "Астана"': "Астана",
    "Университет иностранных языков и деловой карьеры": "Алматы",
    "Центрально-Азиатский университет": "Алматы",
}


def choose_city(detail: UniversityDetail, rows: list[UniversityData]) -> str | None:
    counter: Counter[str] = Counter()
    contact_city = extract_city(detail.contacts_raw)
    if contact_city:
        counter[contact_city] += 4

    for row in rows:
        city = sanitize_city(row.city)
        if city:
            counter[city] += 1

    if counter:
        return counter.most_common(1)[0][0]

    # Fallback: authoritative override by full_name
    full_name = (detail.full_name or "").strip()
    if full_name in UNIVERSITY_CITY_OVERRIDES:
        return UNIVERSITY_CITY_OVERRIDES[full_name]
    return None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def build_prestige_profile(detail: UniversityDetail) -> dict[str, Any]:
    normalized = normalize_name(detail.full_name)
    override = PRESTIGE_OVERRIDES.get(normalized)
    if override:
        return {
            "prestige_tier": override["tier"],
            "prestige_score": override["score"],
            "prestige_note": override["note"],
        }

    score = 12
    signals: list[str] = []

    if any(marker in normalized for marker in SPECIAL_STATUS_MARKERS):
        score += 18
        signals.append("национальный статус")
    if any(marker in normalized for marker in RESEARCH_MARKERS):
        score += 14
        signals.append("исследовательский профиль")

    total_students = detail.total_students or 0
    if total_students >= 20000:
        score += 6
    elif total_students >= 10000:
        score += 4
    elif total_students >= 5000:
        score += 2

    if score >= 70:
        tier = "elite"
    elif score >= 48:
        tier = "strong"
    elif score >= 28:
        tier = "established"
    else:
        tier = "regional"

    note = ", ".join(signals) if signals else "региональная репутация"
    return {
        "prestige_tier": tier,
        "prestige_score": score,
        "prestige_note": note,
    }


def compute_popularity_score(
    detail: UniversityDetail,
    rows: list[UniversityData],
    prestige_score: int,
) -> tuple[int, int | None, int | None, int]:
    thresholds = sorted(
        {
            row.grant_threshold_general
            for row in rows
            if row.grant_threshold_general and row.grant_threshold_general > 0
        }
    )
    unique_major_count = len({row.major_code for row in rows if row.major_code})

    median_threshold = round(median(thresholds)) if thresholds else None
    max_threshold = max(thresholds) if thresholds else None

    threshold_component = 0.0
    if median_threshold is not None:
        threshold_component = clamp((median_threshold - 65) / 55, 0, 1) * 64

    top_major_component = 0.0
    if max_threshold is not None:
        top_major_component = clamp((max_threshold - 80) / 40, 0, 1) * 10

    breadth_component = min(unique_major_count, 24) / 24 * 12

    total_students = detail.total_students or 0
    if total_students > 0:
        size_component = clamp(math.log10(total_students + 1) / 4.5, 0, 1) * 12
    else:
        size_component = 0.0

    brand_component = min(prestige_score, 80) / 80 * 8

    score = round(
        threshold_component
        + top_major_component
        + breadth_component
        + size_component
        + brand_component
    )

    return score, median_threshold, max_threshold, unique_major_count


def raw_general_thresholds(rows: list[UniversityData]) -> list[int | None]:
    return [row.grant_threshold_general for row in rows]


def popularity_tier_for_rank(rank: int, total: int, score: int) -> str:
    if score <= 20:
        return "niche"

    if total <= 1:
        return "very_high"

    ratio = rank / max(total - 1, 1)
    if ratio <= 0.15:
        return "very_high"
    if ratio <= 0.4:
        return "high"
    if ratio <= 0.75:
        return "medium"
    return "niche"


async def load_university_catalog(db: AsyncSession) -> UniversityCatalog:
    details_result = await db.execute(select(UniversityDetail))
    all_details = details_result.scalars().all()
    unique_details = dedupe_universities(all_details)

    canonical_by_normalized = {
        normalize_name(detail.full_name): detail.full_name
        for detail in unique_details
        if normalize_name(detail.full_name)
    }

    university_rows_result = await db.execute(select(UniversityData))
    university_rows = university_rows_result.scalars().all()

    history_rows_result = await db.execute(select(HistoricalGrantThreshold))
    history_rows = history_rows_result.scalars().all()

    rows_by_name: dict[str, list[UniversityData]] = defaultdict(list)
    history_by_name: dict[str, list[HistoricalGrantThreshold]] = defaultdict(list)

    for row in university_rows:
        canonical = canonicalize_university_name(row.uni_name, canonical_by_normalized)
        if canonical:
            rows_by_name[canonical].append(row)

    for row in history_rows:
        canonical = canonicalize_university_name(row.uni_name, canonical_by_normalized)
        if canonical:
            history_by_name[canonical].append(row)

    summaries: list[dict[str, Any]] = []
    summary_by_id: dict[int, dict[str, Any]] = {}
    details_by_id: dict[int, UniversityDetail] = {}
    rows_by_id: dict[int, list[UniversityData]] = {}
    history_by_id: dict[int, list[HistoricalGrantThreshold]] = {}

    for detail in unique_details:
        rows = rows_by_name.get(detail.full_name, [])
        history = history_by_name.get(detail.full_name, [])
        prestige = build_prestige_profile(detail)
        popularity_score, median_threshold, max_threshold, majors_count = compute_popularity_score(
            detail,
            rows,
            prestige["prestige_score"],
        )

        summary = {
            "id": detail.id,
            "label": detail.full_name,
            "value": str(detail.id),
            "city": choose_city(detail, rows),
            "university_code": detail.university_code,
            "search_keywords": detail.search_keywords,
            "total_students": detail.total_students,
            "majors_count": majors_count,
            "median_grant_threshold": median_threshold,
            "max_grant_threshold": max_threshold,
            "data_confidence": build_summary_confidence(
                median_grant_threshold=median_threshold,
                max_grant_threshold=max_threshold,
                raw_general_thresholds=raw_general_thresholds(rows),
                source_url=detail.source_url,
            ),
            "popularity_score": popularity_score,
            "popularity_tier": "medium",
            **prestige,
        }

        summaries.append(summary)
        summary_by_id[detail.id] = summary
        details_by_id[detail.id] = detail
        rows_by_id[detail.id] = rows
        history_by_id[detail.id] = history

    ranked_summaries = sorted(
        summaries,
        key=lambda item: (
            item["popularity_score"],
            item["median_grant_threshold"] or 0,
            item["prestige_score"],
            item["total_students"] or 0,
        ),
        reverse=True,
    )
    total = len(ranked_summaries)
    for rank, entry in enumerate(ranked_summaries):
        entry["popularity_rank"] = rank + 1
        entry["popularity_tier"] = popularity_tier_for_rank(rank, total, entry["popularity_score"])

    summaries.sort(key=lambda item: item["label"].lower())

    return UniversityCatalog(
        summaries=summaries,
        summary_by_id=summary_by_id,
        details_by_id=details_by_id,
        rows_by_id=rows_by_id,
        history_by_id=history_by_id,
    )
