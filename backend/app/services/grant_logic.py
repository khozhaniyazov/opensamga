from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HistoricalGrantThreshold, UniversityData


def _normalize_quota_type(quota_type: str | None) -> str:
    value = (quota_type or "GENERAL").upper()
    return value if value in {"GENERAL", "RURAL", "ORPHAN"} else "GENERAL"


def _threshold_for_quota(
    quota_type: str | None,
    grant_threshold_general: int | None,
    grant_threshold_rural: int | None,
) -> int | None:
    normalized = _normalize_quota_type(quota_type)
    if normalized == "RURAL":
        return grant_threshold_rural
    if normalized == "ORPHAN":
        return None
    return grant_threshold_general


def calculate_grant_probability_sync(
    score: int,
    quota_type: str,
    grant_threshold_general: int | None,
    grant_threshold_rural: int | None,
):
    """
    Рассчитывает вероятность получения гранта на основе балла и типа квоты (синхронная версия).
    """
    threshold = _threshold_for_quota(quota_type, grant_threshold_general, grant_threshold_rural)
    if threshold is None:
        return {
            "статус": "нет данных",
            "вероятность": "нет данных",
            "сообщение": "Для этой квоты нет агрегированного порога в справочнике.",
        }

    # Эвристическая логика
    diff = score - threshold

    if diff >= 5:
        return {
            "статус": "безопасный",
            "вероятность": "высокая (>90%)",
            "сообщение": f"Ваш балл ({score}) значительно выше порога ({threshold}). 🟢",
        }
    elif -3 <= diff < 5:
        return {
            "статус": "рискованный",
            "вероятность": "средняя (50-70%)",
            "сообщение": f"Ваш балл ({score}) близок к порогу ({threshold}). Высокая конкуренция. 🟡",
        }
    else:
        return {
            "статус": "опасный",
            "вероятность": "низкая (<30%)",
            "сообщение": f"Ваш балл ({score}) значительно ниже порога ({threshold}). Рассмотрите другие варианты. 🔴",
        }


async def calculate_grant_probability(
    db: AsyncSession, score: int, quota_type: str, major_id: int
) -> dict:
    """
    Асинхронная версия: рассчитывает вероятность получения гранта для конкретного major_id.
    """
    # Fetch university/major data
    stmt = select(UniversityData).where(UniversityData.id == major_id)
    result = await db.execute(stmt)
    uni = result.scalars().first()

    if not uni:
        return {
            "статус": "неизвестно",
            "вероятность": "нет данных",
            "сообщение": "Университет или специальность не найдены.",
        }

    # Get thresholds
    grant_threshold_general = uni.grant_threshold_general
    grant_threshold_rural = uni.grant_threshold_rural

    # Get the latest year for this university/major
    year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
        HistoricalGrantThreshold.uni_name.ilike(f"%{uni.uni_name}%"),
        HistoricalGrantThreshold.major_code == uni.major_code,
    )
    year_result = await db.execute(year_query)
    latest_year = year_result.scalar()

    # Calculate probability using sync function
    result = calculate_grant_probability_sync(
        score, quota_type, grant_threshold_general, grant_threshold_rural
    )
    result["data_year"] = latest_year
    result["uni_name"] = uni.uni_name
    result["major_name"] = uni.major_name
    result["major_code"] = uni.major_code
    result["threshold"] = _threshold_for_quota(
        quota_type,
        grant_threshold_general,
        grant_threshold_rural,
    )

    return result


async def find_safe_alternatives(
    db: AsyncSession, score: int, quota_type: str, exclude_major_id: int = 0, limit: int = 3
) -> list[dict]:
    """
    Find universities where the student has a high probability of receiving a grant (SAFE options).
    Returns universities where score >= threshold + 5.
    """

    # Determine which threshold column to use
    quota_type = _normalize_quota_type(quota_type)
    if quota_type == "ORPHAN":
        return []

    threshold_col = (
        UniversityData.grant_threshold_rural
        if quota_type == "RURAL"
        else UniversityData.grant_threshold_general
    )

    # Build query for SAFE options (score >= threshold + 5)
    conditions = [
        threshold_col.isnot(None),
        threshold_col <= score - 5,  # Student score is at least 5 points above threshold
    ]

    # Exclude specific major if provided
    if exclude_major_id and exclude_major_id > 0:
        conditions.append(UniversityData.id != exclude_major_id)

    stmt = (
        select(UniversityData)
        .where(and_(*conditions))
        .order_by(threshold_col.asc())
        .limit(limit * 2)
    )  # Get more to filter by buffer

    result = await db.execute(stmt)
    universities = result.scalars().all()

    # Filter and categorize
    safe_options = []
    for uni in universities:
        threshold = _threshold_for_quota(
            quota_type,
            uni.grant_threshold_general,
            uni.grant_threshold_rural,
        )
        if threshold is None:
            continue
        buffer = score - threshold

        # Only include SAFE options (buffer >= 5)
        if buffer >= 5:
            # Get the latest year for this university/major
            year_query = select(func.max(HistoricalGrantThreshold.data_year)).where(
                HistoricalGrantThreshold.uni_name.ilike(f"%{uni.uni_name}%"),
                HistoricalGrantThreshold.major_code == uni.major_code,
            )
            year_result = await db.execute(year_query)
            latest_year = year_result.scalar()

            safe_options.append(
                {
                    "id": uni.id,
                    "uni_name": uni.uni_name,
                    "major_name": uni.major_name,
                    "major_code": uni.major_code,
                    "city": uni.city,
                    "threshold": threshold,
                    "buffer": buffer,
                    "grant_probability": min(
                        95, 90 + (buffer - 5) * 2
                    ),  # Scale probability based on buffer
                    "data_year": latest_year,
                }
            )

            if len(safe_options) >= limit:
                break

    return safe_options
