import json
import logging
import re

from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import (
    HistoricalGrantThreshold,
    MajorGroup,
    UniversityData,
    UniversityDetail,
)
from app.services.ai_orchestrator import consult_library
from app.services.grant_logic import calculate_grant_probability_sync
from app.services.major_resolver import resolve_major_codes
from app.services.profile_pair_simulator import (
    canonical_pair_key,
    major_matches_pair,
)

logger = logging.getLogger(__name__)


def _expand_university_search_terms(uni_name_input: str) -> list[str]:
    raw_value = str(uni_name_input or "").strip()
    if not raw_value:
        return []

    uni_aliases = {
        "сду": ["демирел", "sdu", "demirel", "сулейман"],
        "кбту": ["kbtu", "казахстанско-британск", "kazakh-british"],
        "назарбаев": ["nu", "nazarbayev"],
        "aitu": ["astana it", "астана ит", "аиту"],
        "казну": ["казахский национальный", "аль-фараби", "al-farabi"],
        "политех": [
            "сатпаев",
            "satbayev",
            "казахский национальный исследовательский технический",
        ],
        "ену": ["гумилев", "гумилёв", "евразийский национальный", "enu"],
        "нархоз": ["narxoz", "университет нархоз"],
    }

    search_terms = [raw_value]
    uni_name_lower = raw_value.lower()

    for abbr, aliases in uni_aliases.items():
        if abbr in uni_name_lower or uni_name_lower in abbr:
            search_terms.extend(aliases)
        for alias in aliases:
            if alias in uni_name_lower or uni_name_lower in alias:
                search_terms.extend([abbr] + aliases)

    if "демирел" in uni_name_lower or "демиреля" in uni_name_lower:
        search_terms.extend(["демирел", "sdu", "demirel", "сулейман", "сду"])

    seen = set()
    unique_terms = []
    for term in search_terms:
        normalized = term.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_terms.append(term)
    return unique_terms


def _normalize_university_match_text(value: str) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", " ", str(value or "").lower()).strip()


def _score_university_candidate(
    candidate_name: str,
    raw_value: str,
    search_terms: list[str],
) -> tuple[int, int]:
    candidate = _normalize_university_match_text(candidate_name)
    raw = _normalize_university_match_text(raw_value)
    score = 0

    if raw:
        if candidate == raw:
            score += 1000
        elif raw in candidate:
            score += 700 + len(raw)
        elif candidate in raw:
            score += 400 + len(candidate)
        score += len(set(raw.split()) & set(candidate.split())) * 10

    for term in search_terms:
        normalized_term = _normalize_university_match_text(term)
        if not normalized_term:
            continue
        if candidate == normalized_term:
            score = max(score, 900 + len(normalized_term))
        elif normalized_term in candidate:
            score = max(score, 500 + len(normalized_term))

    return score, -len(candidate)


def _pick_best_university_candidate(candidates: list, raw_value: str, search_terms: list[str]):
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda item: _score_university_candidate(
            getattr(item, "uni_name", ""),
            raw_value,
            search_terms,
        ),
    )


async def execute_tool(
    function_name: str,
    function_args: dict,
    db: AsyncSession,
    language: str = "ru",
    preferred_grade: int = None,
    user_id: int = None,
):
    tool_response_content = ""
    try:
        if function_name == "get_university_data":
            uni_name_input = function_args.get("uni_name", "")
            major_input = function_args.get("major_code", "")

            search_terms = _expand_university_search_terms(uni_name_input)

            # Search with OR conditions for all terms
            conditions = [UniversityData.uni_name.ilike(f"%{term}%") for term in search_terms]
            query = select(UniversityData).where(or_(*conditions))

            # Handle major search by name or code
            if major_input:
                resolved_major_codes = await resolve_major_codes(db, major_input)
                major_conditions = [
                    UniversityData.major_code.ilike(f"%{major_input}%"),
                    UniversityData.major_name.ilike(f"%{major_input}%"),
                ]
                if resolved_major_codes:
                    major_conditions.extend(
                        UniversityData.major_code == code for code in resolved_major_codes
                    )
                if (
                    any(
                        hint in major_input.casefold()
                        for hint in ["айти", "информац", "информат", "computer science"]
                    )
                    or "it" in major_input.casefold()
                ):
                    major_conditions.append(
                        UniversityData.major_name.ilike("%информацион%технолог%")
                    )
                    major_conditions.append(UniversityData.major_name.ilike("%информат%"))
                query = query.where(or_(*major_conditions))

            result = await db.execute(query)
            unis = result.scalars().all()
            if unis:
                # Get the latest year for each university/major from HistoricalGrantThreshold
                uni_data_list = []
                for u in unis:
                    # Try to get the latest year for this university/major
                    year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
                        HistoricalGrantThreshold.uni_name.ilike(f"%{u.uni_name}%"),
                        HistoricalGrantThreshold.major_code == u.major_code,
                    )
                    year_result = await db.execute(year_query)
                    latest_year = year_result.scalar()

                    uni_data_list.append(
                        {
                            "uni_name": u.uni_name,
                            "major": u.major_name,
                            "code": u.major_code,
                            "general_threshold": u.grant_threshold_general,
                            "rural_threshold": u.grant_threshold_rural,
                            "data_year": latest_year,  # CRITICAL: Include year
                        }
                    )
                tool_response_content = json.dumps(uni_data_list, ensure_ascii=False)
            else:
                # Fallback: search in UniversityDetail for basic info
                detail_conditions = [
                    UniversityDetail.full_name.ilike(f"%{term}%") for term in search_terms
                ]
                detail_query = select(UniversityDetail).where(or_(*detail_conditions)).limit(5)
                detail_result = await db.execute(detail_query)
                detail_unis = detail_result.scalars().all()

                if detail_unis:
                    tool_response_content = json.dumps(
                        [
                            {
                                "uni_name": u.full_name,
                                "website": u.website,
                                "has_dorm": u.has_dorm,
                                "has_military_chair": u.military_chair,
                                "note": "Найдена базовая информация. Для проходных баллов используй get_historical_data или get_detailed_grant_scores.",
                            }
                            for u in detail_unis
                        ],
                        ensure_ascii=False,
                    )
                else:
                    tool_response_content = "Данные не найдены."

        elif function_name == "check_grant_chance":
            uni_name = function_args.get("uni_name", "")
            major_code = function_args.get("major_code")
            score = function_args.get("score")
            quota_type = function_args.get("quota_type", "GENERAL")

            if not uni_name or score is None:
                tool_response_content = "Недостаточно данных для расчёта."
            else:
                search_terms = _expand_university_search_terms(uni_name)
                query = select(UniversityData).where(
                    or_(*[UniversityData.uni_name.ilike(f"%{term}%") for term in search_terms])
                )
                resolved_major_codes = (
                    await resolve_major_codes(db, major_code) if major_code else []
                )
                if major_code:
                    major_conditions = [
                        UniversityData.major_code.ilike(f"%{major_code}%"),
                        UniversityData.major_name.ilike(f"%{major_code}%"),
                    ]
                    if resolved_major_codes:
                        major_conditions.extend(
                            UniversityData.major_code == code for code in resolved_major_codes
                        )
                    query = query.where(or_(*major_conditions))

                result = await db.execute(query)
                scalars = result.scalars()
                candidates = scalars.all()
                uni = _pick_best_university_candidate(
                    candidates if isinstance(candidates, list) else [],
                    uni_name,
                    search_terms,
                )
                if uni is None:
                    uni = scalars.first()

                if uni:
                    # Get the latest year for this university/major
                    year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
                        HistoricalGrantThreshold.uni_name.ilike(f"%{uni.uni_name}%"),
                        HistoricalGrantThreshold.major_code
                        == (
                            (resolved_major_codes[0] if resolved_major_codes else None)
                            or major_code
                            or uni.major_code
                        ),
                    )
                    year_result = await db.execute(year_query)
                    latest_year = year_result.scalar()

                    prob = calculate_grant_probability_sync(
                        score,
                        quota_type,
                        uni.grant_threshold_general,
                        uni.grant_threshold_rural,
                    )
                    prob["data_year"] = latest_year  # CRITICAL: Include year
                    tool_response_content = json.dumps(prob, ensure_ascii=False)
                else:
                    tool_response_content = "Университет или специальность не найдены."

        elif function_name == "get_historical_data":
            uni_name_input = function_args.get("uni_name", "")
            major_input = function_args.get("major_code", "")
            requested_year = function_args.get("year")  # Get requested year if specified

            search_terms = _expand_university_search_terms(uni_name_input) if uni_name_input else []

            # Smart major code resolution
            resolved_major_codes = await resolve_major_codes(db, major_input) if major_input else []

            # Determine year priority: if user specified year, use it; otherwise 2025->2024->2023->2022
            if requested_year and requested_year in [2022, 2023, 2024, 2025]:
                year_priority = [requested_year]
            else:
                year_priority = [2025, 2024, 2023, 2022]

            # First try to get data for requested year (or 2025 if not specified)
            query_2025 = select(HistoricalGrantThreshold).where(
                HistoricalGrantThreshold.data_year == year_priority[0]
            )
            if search_terms and uni_name_input != "GROUP_BASELINE":
                uni_conditions = [
                    HistoricalGrantThreshold.uni_name.ilike(f"%{term}%") for term in search_terms
                ]
                query_2025 = query_2025.where(or_(*uni_conditions))
            if resolved_major_codes:
                major_conditions = [
                    HistoricalGrantThreshold.major_code == code for code in resolved_major_codes
                ]
                query_2025 = query_2025.where(or_(*major_conditions))

            result_2025 = await db.execute(query_2025)
            data_2025 = result_2025.scalars().all()
            data_2024 = []
            data_2023 = []
            data_2022 = []

            # If no data found for first priority year, try other years in priority order
            if not data_2025 and len(year_priority) > 1:
                for year in year_priority[1:]:
                    query_year = select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.data_year == year
                    )
                    if search_terms and uni_name_input != "GROUP_BASELINE":
                        uni_conditions = [
                            HistoricalGrantThreshold.uni_name.ilike(f"%{term}%")
                            for term in search_terms
                        ]
                        query_year = query_year.where(or_(*uni_conditions))
                    if resolved_major_codes:
                        major_conditions = [
                            HistoricalGrantThreshold.major_code == code
                            for code in resolved_major_codes
                        ]
                        query_year = query_year.where(or_(*major_conditions))

                    result_year = await db.execute(query_year)
                    year_data = result_year.scalars().all()

                    if year == 2024:
                        data_2024 = year_data
                    elif year == 2023:
                        data_2023 = year_data
                    elif year == 2022:
                        data_2022 = year_data

                    if year_data:
                        break

                # If still no data, try GROUP_BASELINE (group-level thresholds)
                if (
                    not data_2025
                    and not data_2024
                    and not data_2023
                    and not data_2022
                    and resolved_major_codes
                ):
                    for baseline_year in year_priority:
                        query_baseline = select(HistoricalGrantThreshold).where(
                            HistoricalGrantThreshold.data_year == baseline_year,
                            HistoricalGrantThreshold.uni_name == "GROUP_BASELINE",
                        )
                        baseline_conditions = [
                            HistoricalGrantThreshold.major_code == code
                            for code in resolved_major_codes
                        ]
                        query_baseline = query_baseline.where(or_(*baseline_conditions))
                        result_baseline = await db.execute(query_baseline)
                        baseline_data = result_baseline.scalars().all()
                        if baseline_data:
                            data_2025 = baseline_data  # Use the first available baseline
                            break

            # Combine results, prioritizing requested year or newest data
            all_data = list(data_2025) if data_2025 else []
            if not all_data:
                all_data = list(data_2024) if data_2024 else []
            if not all_data:
                all_data = list(data_2023) if data_2023 else []
            if not all_data:
                all_data = list(data_2022) if data_2022 else []

            if all_data:
                tool_response_content = json.dumps(
                    [
                        {
                            "uni_name": d.uni_name,
                            "major_code": d.major_code,
                            "year": d.data_year,
                            "quota": d.quota_type,
                            "min_score": d.min_score,
                            "is_baseline": d.uni_name == "GROUP_BASELINE",
                        }
                        for d in all_data
                    ],
                    ensure_ascii=False,
                )
            else:
                tool_response_content = "Исторические данные не найдены."

        elif function_name == "get_major_requirements":
            major_code = function_args.get("major_code", "")
            if not major_code:
                tool_response_content = "Код или название специальности не указаны."
            else:
                resolved_codes = await resolve_major_codes(db, major_code)
                conditions = [MajorGroup.group_code.ilike(f"%{major_code}%")]
                if resolved_codes:
                    conditions.extend(MajorGroup.group_code == code for code in resolved_codes)
                query = select(MajorGroup).where(or_(*conditions))
                result = await db.execute(query)
                group = result.scalars().first()
                if group:
                    tool_response_content = f"Специальность {group.group_name} ({group.group_code}). Предметы: {group.unt_subjects}"
                else:
                    tool_response_content = "Информация о специальности не найдена."

        elif function_name == "recommend_universities":
            score = function_args.get("score")
            if score is None:
                tool_response_content = "Балл не указан."
            else:
                quota = function_args.get("quota_type", "GENERAL")
                column = (
                    UniversityData.grant_threshold_general
                    if quota == "GENERAL"
                    else UniversityData.grant_threshold_rural
                )
                query = (
                    select(UniversityData).where(column <= score).order_by(column.desc()).limit(5)
                )

                if "major_code" in function_args and function_args["major_code"]:
                    major_input = function_args["major_code"]
                    resolved_major_codes = await resolve_major_codes(db, major_input)
                    major_conditions = [
                        UniversityData.major_code.ilike(f"%{major_input}%"),
                        UniversityData.major_name.ilike(f"%{major_input}%"),
                    ]
                    if resolved_major_codes:
                        major_conditions.extend(
                            UniversityData.major_code == code for code in resolved_major_codes
                        )
                    query = query.where(or_(*major_conditions))

                result = await db.execute(query)
                unis = result.scalars().all()
                if unis:
                    # Get the latest year for each university/major
                    uni_list = []
                    for u in unis:
                        # Try to get the latest year for this university/major
                        year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
                            HistoricalGrantThreshold.uni_name.ilike(f"%{u.uni_name}%"),
                            HistoricalGrantThreshold.major_code == u.major_code,
                        )
                        year_result = await db.execute(year_query)
                        latest_year = year_result.scalar()

                        uni_list.append(
                            {
                                "uni_name": u.uni_name,
                                "major": u.major_name,
                                "threshold": u.grant_threshold_general
                                if quota == "GENERAL"
                                else u.grant_threshold_rural,
                                "data_year": latest_year,  # CRITICAL: Include year
                            }
                        )
                    tool_response_content = json.dumps(uni_list, ensure_ascii=False)
                else:
                    tool_response_content = "Подходящие университеты не найдены."

        elif function_name == "get_majors_by_subjects":
            s1 = function_args.get("subject1", "")
            s2 = function_args.get("subject2", "")
            if not s1 or not s2:
                tool_response_content = "Указаны не все предметы."
            else:
                # v3.26 (2026-05-01): Use the v3.25 CSV-split exact-match
                # helpers instead of ILIKE %subject% — the latter
                # substring-collides "Mathematics" with "Mathematical
                # Literacy". We pull all MajorGroup rows and filter in
                # Python via major_matches_pair, mirroring the
                # /strategy/profile-pair endpoint behavior.
                pair_key = canonical_pair_key(s1, s2)
                result = await db.execute(select(MajorGroup))
                groups = [
                    g
                    for g in result.scalars().all()
                    if major_matches_pair(g.unt_subjects, pair_key)
                ]
                if groups:
                    tool_response_content = json.dumps(
                        [
                            {
                                "code": g.group_code,
                                "name": g.group_name,
                                "subjects": g.unt_subjects,
                            }
                            for g in groups
                        ],
                        ensure_ascii=False,
                    )
                else:
                    tool_response_content = "Специальности по данным предметам не найдены."

        elif function_name == "compare_universities":
            uni_names = function_args.get("uni_names", [])
            if not uni_names:
                tool_response_content = "Список университетов пуст."
            else:
                comparisons = []
                for name in uni_names:
                    query = select(UniversityDetail).where(
                        UniversityDetail.full_name.ilike(f"%{name}%")
                    )
                    result = await db.execute(query)
                    detail = result.scalars().first()
                    if detail:
                        comparisons.append(
                            {
                                "name": detail.full_name,
                                "students": detail.total_students,
                                "dorm": "Да" if detail.has_dorm == "True" else "Нет",
                                "military": "Да" if detail.military_chair == "True" else "Нет",
                                "website": detail.website,
                            }
                        )

                if comparisons:
                    tool_response_content = json.dumps(
                        {"comparison": comparisons}, ensure_ascii=False
                    )
                else:
                    tool_response_content = "Информация для сравнения не найдена."

        elif function_name == "find_universities_by_region_and_features":
            region = function_args.get("region", "")
            has_dorm = function_args.get("has_dorm")
            has_military_chair = function_args.get("has_military_chair")

            if not region:
                tool_response_content = "Укажите регион или город."
            else:
                # Search universities by region/city name
                query = select(UniversityDetail).where(
                    or_(
                        UniversityDetail.full_name.ilike(f"%{region}%"),
                        UniversityDetail.search_keywords.ilike(f"%{region}%")
                        if UniversityDetail.search_keywords
                        else False,
                    )
                )

                # Filter by features if specified
                if has_dorm is True:
                    query = query.where(UniversityDetail.has_dorm == "True")
                elif has_dorm is False:
                    query = query.where(UniversityDetail.has_dorm != "True")

                if has_military_chair is True:
                    query = query.where(UniversityDetail.military_chair == "True")
                elif has_military_chair is False:
                    query = query.where(UniversityDetail.military_chair != "True")

                result = await db.execute(query)
                unis = result.scalars().all()

                if unis:
                    results = []
                    for uni in unis:
                        results.append(
                            {
                                "name": uni.full_name,
                                "city": region,
                                "has_dorm": "Да" if uni.has_dorm == "True" else "Нет",
                                "has_military_chair": "Да"
                                if uni.military_chair == "True"
                                else "Нет",
                                "total_students": uni.total_students,
                                "website": uni.website,
                            }
                        )
                    tool_response_content = json.dumps(
                        {
                            "region": region,
                            "universities": results,
                            "count": len(results),
                        },
                        ensure_ascii=False,
                    )
                else:
                    tool_response_content = f"Университеты в регионе '{region}' с указанными характеристиками не найдены."

        elif function_name == "get_detailed_grant_scores":
            # Get detailed 2023 and 2022 scores per university per major
            major_code = function_args.get("major_code", "")
            major_name = function_args.get("major_name", "")
            uni_name_filter = function_args.get("uni_name", "")
            student_score = function_args.get("score")

            # Resolve major code from name if needed (including slang)
            resolved_codes = await resolve_major_codes(
                db,
                [major_code, major_name],
            )

            # Resolve university aliases for filtering
            uni_search_terms = []
            if uni_name_filter:
                uni_search_terms.append(uni_name_filter)
                # Add aliases
                uni_aliases_map = {
                    "политех": [
                        "сатпаев",
                        "satbayev",
                        "казахский национальный исследовательский технический",
                    ],
                    "сду": ["демирел", "sdu", "demirel", "сулейман"],
                    "кбту": ["kbtu", "казахстанско-британск", "британск"],
                    "ену": ["гумилев", "гумилёв", "евразийский национальный", "enu"],
                    "нархоз": ["narxoz", "университет нархоз"],
                }
                for alias, expansions in uni_aliases_map.items():
                    if alias in uni_name_filter.lower():
                        uni_search_terms.extend(expansions)

            if not resolved_codes:
                tool_response_content = "Укажите код или название специальности."
            else:
                # Query detailed scores from HistoricalGrantThreshold (prioritize 2024, then 2023, then 2022)
                detailed_data = []

                # First try 2024 (most recent)
                query_2024 = select(HistoricalGrantThreshold).where(
                    HistoricalGrantThreshold.data_year == 2024,
                    HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                    or_(*[HistoricalGrantThreshold.major_code == code for code in resolved_codes]),
                )

                if uni_search_terms:
                    uni_conditions = [
                        HistoricalGrantThreshold.uni_name.ilike(f"%{term}%")
                        for term in uni_search_terms
                    ]
                    query_2024 = query_2024.where(or_(*uni_conditions))

                query_2024 = query_2024.order_by(HistoricalGrantThreshold.min_score.asc())
                result_2024 = await db.execute(query_2024)
                detailed_data = result_2024.scalars().all()

                # If no 2024 data, try 2023
                if not detailed_data:
                    query_2023 = select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.data_year == 2023,
                        HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                        or_(
                            *[
                                HistoricalGrantThreshold.major_code == code
                                for code in resolved_codes
                            ]
                        ),
                    )

                    if uni_search_terms:
                        uni_conditions = [
                            HistoricalGrantThreshold.uni_name.ilike(f"%{term}%")
                            for term in uni_search_terms
                        ]
                        query_2023 = query_2023.where(or_(*uni_conditions))

                    query_2023 = query_2023.order_by(HistoricalGrantThreshold.min_score.asc())
                    result_2023 = await db.execute(query_2023)
                    detailed_data = result_2023.scalars().all()

                # If still no data, try 2022
                if not detailed_data:
                    query_2022 = select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.data_year == 2022,
                        HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                        or_(
                            *[
                                HistoricalGrantThreshold.major_code == code
                                for code in resolved_codes
                            ]
                        ),
                    )

                    if uni_search_terms:
                        uni_conditions = [
                            HistoricalGrantThreshold.uni_name.ilike(f"%{term}%")
                            for term in uni_search_terms
                        ]
                        query_2022 = query_2022.where(or_(*uni_conditions))

                    query_2022 = query_2022.order_by(HistoricalGrantThreshold.min_score.asc())
                    result_2022 = await db.execute(query_2022)
                    detailed_data = result_2022.scalars().all()

                if detailed_data:
                    # Group by university and add chance calculation
                    results = []
                    for d in detailed_data:
                        entry = {
                            "uni_name": d.uni_name,
                            "major_code": d.major_code,
                            "year": d.data_year,
                            "quota": d.quota_type,
                            "min_score": d.min_score,
                        }
                        # Calculate chance if student score provided
                        if student_score and d.quota_type == "GENERAL":
                            diff = student_score - d.min_score
                            if diff >= 10:
                                entry["chance"] = "🟢 БЕЗОПАСНЫЙ (≥90%)"
                                entry["category"] = "SAFE"
                            elif diff >= 0:
                                entry["chance"] = "🟡 ЦЕЛЕВОЙ (50-90%)"
                                entry["category"] = "TARGET"
                            elif diff >= -10:
                                entry["chance"] = "🟠 МЕЧТА (10-50%)"
                                entry["category"] = "REACH"
                            else:
                                entry["chance"] = "🔴 ОЧЕНЬ РИСКОВАННО (<10%)"
                                entry["category"] = "UNLIKELY"
                        results.append(entry)

                    tool_response_content = json.dumps(
                        {
                            "detailed_scores": results,
                            "total_universities": len(set(d["uni_name"] for d in results)),
                            "major_codes": resolved_codes,
                        },
                        ensure_ascii=False,
                    )
                else:
                    tool_response_content = "Детальные данные по этой специальности не найдены."

        elif function_name == "find_universities_by_score":
            # Find universities categorized by chance (SAFE/TARGET/REACH)
            student_score = function_args.get("score")
            major_code = function_args.get("major_code", "")
            major_name = function_args.get("major_name", "")
            quota_type = function_args.get("quota_type", "GENERAL")

            if not student_score:
                tool_response_content = "Укажите ваш балл ЕНТ/ҰБТ."
            else:
                # Resolve major codes
                resolved_codes = await resolve_major_codes(
                    db,
                    [major_code, major_name],
                )

                # Query detailed data (prioritize 2025, then 2024, then 2023, then 2022)
                all_data = []

                # First, try 2025 data (most recent)
                query_2025 = select(HistoricalGrantThreshold).where(
                    HistoricalGrantThreshold.data_year == 2025,
                    HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                    HistoricalGrantThreshold.quota_type == quota_type,
                )

                if resolved_codes:
                    query_2025 = query_2025.where(
                        or_(
                            *[
                                HistoricalGrantThreshold.major_code == code
                                for code in resolved_codes
                            ]
                        )
                    )

                result_2025 = await db.execute(query_2025)
                all_data = list(result_2025.scalars().all())

                # If no 2025 data or insufficient, try 2024
                if not all_data or len(all_data) < 5:
                    query_2024 = select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.data_year == 2024,
                        HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                        HistoricalGrantThreshold.quota_type == quota_type,
                    )

                    if resolved_codes:
                        query_2024 = query_2024.where(
                            or_(
                                *[
                                    HistoricalGrantThreshold.major_code == code
                                    for code in resolved_codes
                                ]
                            )
                        )

                    result_2024 = await db.execute(query_2024)
                    all_data = list(result_2024.scalars().all())

                # If no 2024 data or insufficient, try 2023
                if not all_data or len(all_data) < 5:
                    query_2023 = select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.data_year == 2023,
                        HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                        HistoricalGrantThreshold.quota_type == quota_type,
                    )

                    if resolved_codes:
                        query_2023 = query_2023.where(
                            or_(
                                *[
                                    HistoricalGrantThreshold.major_code == code
                                    for code in resolved_codes
                                ]
                            )
                        )

                    result_2023 = await db.execute(query_2023)
                    all_data = list(result_2023.scalars().all())

                # If still insufficient, try 2022
                if not all_data or len(all_data) < 5:
                    query_2022 = select(HistoricalGrantThreshold).where(
                        HistoricalGrantThreshold.data_year == 2022,
                        HistoricalGrantThreshold.uni_name != "GROUP_BASELINE",
                        HistoricalGrantThreshold.quota_type == quota_type,
                    )

                    if resolved_codes:
                        query_2022 = query_2022.where(
                            or_(
                                *[
                                    HistoricalGrantThreshold.major_code == code
                                    for code in resolved_codes
                                ]
                            )
                        )

                    result_2022 = await db.execute(query_2022)
                    all_data.extend(result_2022.scalars().all())

                # Categorize universities
                safe = []  # score >= min_score + 10
                target = []  # min_score <= score < min_score + 10
                reach = []  # min_score - 10 <= score < min_score

                # Filter out records with None min_score before processing
                valid_data = [d for d in all_data if d.min_score is not None]

                if not valid_data:
                    tool_response_content = json.dumps(
                        {
                            "error": "Не найдено данных с указанными параметрами.",
                            "student_score": student_score,
                            "quota_type": quota_type,
                        },
                        ensure_ascii=False,
                    )
                else:
                    for d in valid_data:
                        diff = student_score - d.min_score
                        entry = {
                            "uni_name": d.uni_name,
                            "major_code": d.major_code,
                            "min_score": d.min_score,
                            "your_margin": diff,
                            "data_year": d.data_year,  # CRITICAL: Include year
                        }

                        if diff >= 10:
                            safe.append(entry)
                        elif diff >= 0:
                            target.append(entry)
                        elif diff >= -10:
                            reach.append(entry)

                    # Sort each category
                    safe.sort(key=lambda x: x["min_score"], reverse=True)
                    target.sort(key=lambda x: x["your_margin"], reverse=True)
                    reach.sort(key=lambda x: x["your_margin"], reverse=True)

                    tool_response_content = json.dumps(
                        {
                            "student_score": student_score,
                            "quota_type": quota_type,
                            "safe_universities": safe[:10],  # Top 10 safe
                            "target_universities": target[:10],  # Top 10 target
                            "reach_universities": reach[:10],  # Top 10 reach
                            "recommendation": "Рекомендуем: 2 БЕЗОПАСНЫХ + 1 ЦЕЛЕВОЙ + 1 МЕЧТА",
                        },
                        ensure_ascii=False,
                    )

        elif function_name == "consult_library":
            # RAG tool: Search textbooks for academic content
            query = function_args.get("query", "")
            subject = function_args.get("subject")

            if not query:
                tool_response_content = json.dumps(
                    {"error": "Query is required", "citations": []}, ensure_ascii=False
                )
            else:
                try:
                    # Call consult_library from ai_orchestrator
                    # Pass language for query optimization
                    explicit_tool_grade = function_args.get("grade")
                    tool_grade = explicit_tool_grade or preferred_grade
                    library_results = await consult_library(
                        db=db,
                        query=query,
                        subject=subject,
                        language=language,
                        grade=explicit_tool_grade,
                        preferred_grade=tool_grade,
                        user_id=user_id,
                    )

                    # Format results for GPT-4
                    if library_results:
                        citations = []
                        # Session 16 (2026-04-21): carry the
                        # rag_query_log_id so the chat layer can echo
                        # it on the assistant message envelope, and
                        # the FE feedback widget can post it back.
                        rag_query_log_id = None
                        for result in library_results:
                            if rag_query_log_id is None:
                                rqli = result.get("rag_query_log_id")
                                if rqli is not None:
                                    rag_query_log_id = int(rqli)
                            citations.append(
                                {
                                    # Phase A (s20c): thread book_id through
                                    # so the FE citation chip can deep-link
                                    # without client-side fuzzy matching.
                                    "book_id": result.get("book_id"),
                                    "book_title": result.get("book_title", ""),
                                    "subject": result.get("subject", ""),
                                    "grade": result.get("grade", ""),
                                    "page_number": result.get("page_number", ""),
                                    "content": result.get("content", "")[
                                        :500
                                    ],  # Limit content length
                                    "citation": result.get("citation", ""),
                                    "similarity_score": result.get("similarity_score", 0),
                                    # s32 (A5, 2026-04-27): textbook freshness
                                    # ISO timestamp. None for legacy snapshots
                                    # whose row pre-dates the alembic that
                                    # added textbooks.updated_at.
                                    "updated_at": result.get("updated_at"),
                                }
                            )

                        tool_response_content = json.dumps(
                            {
                                "query": query,
                                "citations": citations,
                                "count": len(citations),
                                "rag_query_log_id": rag_query_log_id,
                            },
                            ensure_ascii=False,
                        )
                    else:
                        tool_response_content = json.dumps(
                            {
                                "query": query,
                                "citations": [],
                                "count": 0,
                                "message": "No relevant results found in textbooks",
                            },
                            ensure_ascii=False,
                        )

                except Exception as e:
                    logger.exception("Error in consult_library tool call")
                    tool_response_content = json.dumps(
                        {"error": str(e), "citations": []}, ensure_ascii=False
                    )

        else:
            tool_response_content = f"Неизвестная функция: {function_name}"

    except Exception as e:
        # v3.52: was `import traceback; traceback.format_exc()` whose return
        # value was discarded — pure dead code on the error path. Replaced
        # with logger.exception() so the stack actually lands in the log
        # feed. ``str(e)`` is kept in the user-visible string because the
        # model surfaces it back to the user (same convention as the
        # consult_library branch above).
        logger.exception("Tool dispatch error for %s", function_name)
        tool_response_content = f"Ошибка при выполнении функции {function_name}: {str(e)}"
    return tool_response_content
