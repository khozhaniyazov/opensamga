from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HistoricalGrantThreshold, UniversityData


def _normalize_quota_type(quota_type: str | None) -> str:
    value = (quota_type or "GENERAL").upper()
    return value if value in {"GENERAL", "RURAL", "ORPHAN"} else "GENERAL"


def _threshold_column_for_quota(quota_type: str | None):
    normalized = _normalize_quota_type(quota_type)
    if normalized == "RURAL":
        return UniversityData.grant_threshold_rural
    if normalized == "ORPHAN":
        return None
    return UniversityData.grant_threshold_general


def _threshold_value_for_quota(uni: UniversityData, quota_type: str | None):
    normalized = _normalize_quota_type(quota_type)
    if normalized == "RURAL":
        return uni.grant_threshold_rural
    if normalized == "ORPHAN":
        return None
    return uni.grant_threshold_general


# v3.8 (2026-04-30) — DB audit P0.
#
# `university_data.min_score_paid` was created with `default=50`
# (see models.py:394). 921 out of 1,915 rows (48%) carry the literal
# value 50 — that's the schema sentinel, not a real
# minimum-score-for-paid-admission. Surfacing it through the API as
# `50` makes the eligibility math wrong (every score >= 50 looks
# "eligible for paid"), and tells students that a 50-out-of-140
# UNT score is enough for paid admission anywhere — a meaningfully
# wrong answer.
#
# Until the real per-major minimums are backfilled, mask the
# sentinel at the API layer: `50` => `None`. This is a *conservative*
# loss — if a real major really does require a 50, the API will
# under-report it, but no student is misinformed in the wrong
# direction. Real values cluster around 65-90.
_PAID_SCORE_SENTINEL = 50


def _unmask_paid_score(value: int | None) -> int | None:
    """Return `None` when the column carries the schema default.

    Audit note: this is a serializer-only mask. The DB rows are NOT
    rewritten — that's a backfill project blocked on a real source
    document. When the backfill lands, change the default to `None`
    and remove this helper.
    """
    if value is None or value == _PAID_SCORE_SENTINEL:
        return None
    return value


async def search_universities_by_name(db: AsyncSession, query: str, limit: int = 10) -> list[dict]:
    """
    Fuzzy search universities by name.
    Handles partial matches like "кбту", "казну", "satbayev"
    """
    stmt = (
        select(UniversityData)
        .where(
            or_(
                UniversityData.uni_name.ilike(f"%{query}%"),
                UniversityData.major_name.ilike(f"%{query}%"),
            )
        )
        .limit(limit)
    )

    result = await db.execute(stmt)
    universities = result.scalars().all()

    # Get years for each university/major
    results = []
    for uni in universities:
        # Get the latest year for this university/major
        year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
            HistoricalGrantThreshold.uni_name.ilike(f"%{uni.uni_name}%"),
            HistoricalGrantThreshold.major_code == uni.major_code,
        )
        year_result = await db.execute(year_query)
        latest_year = year_result.scalar()

        results.append(
            {
                "id": uni.id,
                "uni_name": uni.uni_name,
                "major_name": uni.major_name,
                "major_code": uni.major_code,
                "city": getattr(uni, "city", None),  # Handle missing city attribute
                "grant_threshold_general": uni.grant_threshold_general,
                "grant_threshold_rural": uni.grant_threshold_rural,
                "min_score_paid": _unmask_paid_score(uni.min_score_paid),
                "data_year": latest_year,  # CRITICAL: Include year
            }
        )

    return results


async def get_all_universities_by_city(db: AsyncSession, city: str) -> list[dict]:
    """Get all universities in a specific city."""
    stmt = (
        select(UniversityData)
        .where(UniversityData.city.ilike(f"%{city}%"))
        .order_by(UniversityData.grant_threshold_general.desc())
    )

    result = await db.execute(stmt)
    return [
        {
            "id": uni.id,
            "uni_name": uni.uni_name,
            "major_name": uni.major_name,
            "grant_threshold_general": uni.grant_threshold_general,
        }
        for uni in result.scalars().all()
    ]


async def get_universities_by_score_range(
    db: AsyncSession, score: int, quota_type: str = "GENERAL", margin: int = 10, limit: int = 20
) -> list[dict]:
    """
    Find universities within a score range.
    Critical for building a balanced application portfolio.

    Returns universities where:
    - SAFE: score > threshold + 5
    - TARGET: score within ±5 of threshold
    - REACH: score < threshold but within 10 points
    """
    quota_type = _normalize_quota_type(quota_type)
    threshold_col = _threshold_column_for_quota(quota_type)
    if threshold_col is None:
        return []

    # Get universities within score range
    stmt = (
        select(UniversityData)
        .where(
            and_(
                threshold_col.isnot(None),
                threshold_col <= score + margin,
                threshold_col >= score - margin,
            )
        )
        .order_by(threshold_col.desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    universities = result.scalars().all()

    # Categorize each university
    categorized = []
    for uni in universities:
        threshold = _threshold_value_for_quota(uni, quota_type)
        if threshold is None:
            continue
        buffer = score - threshold

        if buffer >= 5:
            category = "БЕЗОПАСНЫЙ"
        elif buffer >= -5:
            category = "ЦЕЛЕВОЙ"
        else:
            category = "МЕЧТА"

        # Get the latest year for this university/major from HistoricalGrantThreshold
        year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
            HistoricalGrantThreshold.uni_name.ilike(f"%{uni.uni_name}%"),
            HistoricalGrantThreshold.major_code == uni.major_code,
        )
        year_result = await db.execute(year_query)
        latest_year = year_result.scalar()

        # tuition_per_year==0 is a data-missing sentinel, not a real price.
        # Return None so the LLM renders it as "not available" instead of
        # "0 tenge".
        tuition = uni.tuition_per_year if (uni.tuition_per_year or 0) > 0 else None

        categorized.append(
            {
                "id": uni.id,
                "uni_name": uni.uni_name,
                "major_name": uni.major_name,
                "major_code": uni.major_code,
                "city": uni.city,
                "threshold": threshold,
                "buffer": buffer,
                "category": category,
                "tuition_per_year": tuition,
                "data_year": latest_year,  # CRITICAL: Include year
            }
        )

    return categorized


async def get_majors_by_field(
    db: AsyncSession, field: str, score: int = None, quota_type: str = "GENERAL"
) -> list[dict]:
    """
    Get all majors in a specific field (e.g., "Computer Science", "Engineering", "Medicine")
    Optionally filter by student's score.
    """
    stmt = select(UniversityData).where(UniversityData.major_name.ilike(f"%{field}%"))

    result = await db.execute(stmt)
    majors = result.scalars().all()

    output = []
    for major in majors:
        threshold = _threshold_value_for_quota(major, quota_type)

        # Get the latest year for this university/major
        year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
            HistoricalGrantThreshold.uni_name.ilike(f"%{major.uni_name}%"),
            HistoricalGrantThreshold.major_code == major.major_code,
        )
        year_result = await db.execute(year_query)
        latest_year = year_result.scalar()

        data = {
            "id": major.id,
            "uni_name": major.uni_name,
            "major_name": major.major_name,
            "major_code": major.major_code,
            "city": major.city,
            "threshold": threshold,
            "min_score_paid": _unmask_paid_score(major.min_score_paid),
            "data_year": latest_year,  # CRITICAL: Include year
        }

        # Add eligibility if score provided. We compute eligibility
        # against the unmasked value: if the column holds the
        # sentinel, we cannot judge eligibility at all (None) — telling
        # the user "yes, you qualify" off a default value is worse
        # than telling them we don't know.
        if score and threshold is not None:
            data["buffer"] = score - threshold
            unmasked_paid = _unmask_paid_score(major.min_score_paid)
            data["eligible"] = None if unmasked_paid is None else score >= unmasked_paid

        output.append(data)

    # Sort by threshold (easiest first)
    output.sort(key=lambda x: (x["threshold"] is None, x["threshold"] or 0))
    return output


async def get_statistics(db: AsyncSession) -> dict:
    """
    Get database statistics for debugging and monitoring.
    """
    # Count universities
    uni_count = await db.execute(select(func.count()).select_from(UniversityData))
    total_unis = uni_count.scalar()

    # Get threshold statistics
    avg_threshold = await db.execute(select(func.avg(UniversityData.grant_threshold_general)))

    max_threshold = await db.execute(select(func.max(UniversityData.grant_threshold_general)))

    min_threshold = await db.execute(select(func.min(UniversityData.grant_threshold_general)))

    return {
        "total_universities": total_unis,
        "avg_grant_threshold": round(avg_threshold.scalar() or 0, 2),
        "max_grant_threshold": max_threshold.scalar() or 0,
        "min_grant_threshold": min_threshold.scalar() or 0,
    }


async def compare_universities(
    db: AsyncSession, uni_ids: list[int], score: int, quota_type: str = "GENERAL"
) -> list[dict]:
    """
    Compare multiple universities side-by-side.
    Perfect for helping students make final decisions.
    """
    stmt = select(UniversityData).where(UniversityData.id.in_(uni_ids))
    result = await db.execute(stmt)
    universities = result.scalars().all()

    comparison = []
    for uni in universities:
        threshold = _threshold_value_for_quota(uni, quota_type)
        buffer = score - threshold if threshold is not None else None

        # Get the latest year for this university/major from HistoricalGrantThreshold
        year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
            HistoricalGrantThreshold.uni_name.ilike(f"%{uni.uni_name}%"),
            HistoricalGrantThreshold.major_code == uni.major_code,
        )
        year_result = await db.execute(year_query)
        latest_year = year_result.scalar()

        tuition = uni.tuition_per_year if (uni.tuition_per_year or 0) > 0 else None

        comparison.append(
            {
                "uni_name": uni.uni_name,
                "major_name": uni.major_name,
                "city": uni.city,
                "threshold": threshold,
                "buffer": buffer,
                "grant_probability": (90 if buffer >= 5 else (50 if buffer >= -3 else 10))
                if buffer is not None
                else None,
                "tuition_per_year": tuition,
                "min_score_paid": _unmask_paid_score(uni.min_score_paid),
                "data_year": latest_year,  # CRITICAL: Include year
            }
        )

    return comparison
