"""
Analytics Engine - Trend Analysis and Forecasting for Grant Thresholds

Handles sparse data gracefully:
- n=1: Insufficient data (NEW_MAJOR)
- n=2: Simple percentage change (LOW_CONFIDENCE)
- n>=3: Full CAGR and volatility calculations
"""

import math
import statistics

from sqlalchemy import and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..models import HistoricalGrantThreshold


async def fetch_historical_data(
    db: AsyncSession, uni_name: str, major_code: str, quota_type: str = "GENERAL"
) -> list[dict]:
    """
    Fetch historical grant threshold data for a university + major combination.
    Returns list of {year, score} sorted by year ascending.
    """
    query = (
        select(HistoricalGrantThreshold)
        .where(
            and_(
                HistoricalGrantThreshold.uni_name == uni_name,
                HistoricalGrantThreshold.major_code == major_code,
                HistoricalGrantThreshold.quota_type == quota_type,
            )
        )
        .order_by(HistoricalGrantThreshold.data_year.asc())
    )

    result = await db.execute(query)
    records = result.scalars().all()

    return [
        {
            "year": record.data_year,
            "score": record.min_score,
            "grants_count": record.grants_awarded_count,
        }
        for record in records
    ]


def calculate_cagr(start_value: float, end_value: float, periods: int) -> float:
    """
    Calculate Compound Annual Growth Rate (CAGR).

    CAGR = ((End Value / Start Value) ^ (1 / periods)) - 1

    Returns percentage (e.g., 5.2 for 5.2% growth).
    """
    if start_value <= 0 or periods <= 0:
        return 0.0

    if end_value <= 0:
        # Handle negative or zero end values
        return -100.0  # Indicates complete drop

    ratio = end_value / start_value
    if ratio <= 0:
        return -100.0

    cagr = (math.pow(ratio, 1.0 / periods) - 1) * 100
    return cagr


def calculate_volatility(scores: list[float]) -> tuple[float, str]:
    """
    Calculate volatility (standard deviation) of scores.

    Returns: (volatility_value, confidence_level)
    - confidence_level: "HIGH", "LOW_CONFIDENCE", or "UNKNOWN"
    """
    if len(scores) < 2:
        return (0.0, "UNKNOWN")

    if len(scores) == 2:
        return (abs(scores[1] - scores[0]), "LOW_CONFIDENCE")

    # n >= 3: Full standard deviation
    try:
        std_dev = statistics.stdev(scores)
        return (std_dev, "HIGH")
    except statistics.StatisticsError:
        return (0.0, "UNKNOWN")


def calculate_trend_metrics(data_points: list[dict]) -> dict:
    """
    Calculate trend metrics from historical data.

    Args:
        data_points: List of {year, score} dictionaries, sorted by year ascending

    Returns:
        {
            "data_points_count": int,
            "cagr": float | None,
            "growth_rate": float | None,  # Simple percentage change for n=2
            "verdict": "RISING" | "FALLING" | "STABLE" | "NEW_MAJOR",
            "volatility": float,
            "volatility_confidence": "HIGH" | "LOW_CONFIDENCE" | "UNKNOWN",
            "history": List[{year, score}]
        }
    """
    n = len(data_points)

    if n == 0:
        return {
            "data_points_count": 0,
            "cagr": None,
            "growth_rate": None,
            "verdict": "NEW_MAJOR",
            "volatility": 0.0,
            "volatility_confidence": "UNKNOWN",
            "history": [],
        }

    # Extract scores and years
    scores = [dp["score"] for dp in data_points]
    years = [dp["year"] for dp in data_points]

    # n=1: Insufficient data
    if n == 1:
        return {
            "data_points_count": 1,
            "cagr": 0.0,
            "growth_rate": None,
            "verdict": "NEW_MAJOR",
            "volatility": 0.0,
            "volatility_confidence": "UNKNOWN",
            "history": data_points,
        }

    # n=2: Simple percentage change
    if n == 2:
        start_score = scores[0]
        end_score = scores[1]

        if start_score == 0:
            growth_rate = 0.0
        else:
            growth_rate = ((end_score - start_score) / start_score) * 100

        verdict = "RISING" if growth_rate > 0 else "FALLING" if growth_rate < 0 else "STABLE"

        volatility, vol_confidence = calculate_volatility(scores)

        return {
            "data_points_count": 2,
            "cagr": None,  # Cannot calculate CAGR with only 2 points
            "growth_rate": growth_rate,
            "verdict": verdict,
            "volatility": volatility,
            "volatility_confidence": "LOW_CONFIDENCE",
            "history": data_points,
        }

    # n>=3: Full analysis
    start_score = scores[0]
    end_score = scores[-1]
    periods = years[-1] - years[0]

    if periods <= 0:
        periods = 1  # Safety: avoid division by zero

    cagr = calculate_cagr(start_score, end_score, periods)
    volatility, vol_confidence = calculate_volatility(scores)

    # Determine verdict
    if abs(cagr) < 1.0:  # Less than 1% change
        verdict = "STABLE"
    elif cagr > 0:
        verdict = "RISING"
    else:
        verdict = "FALLING"

    return {
        "data_points_count": n,
        "cagr": cagr,
        "growth_rate": None,  # Use CAGR for n>=3
        "verdict": verdict,
        "volatility": volatility,
        "volatility_confidence": vol_confidence,
        "history": data_points,
    }


def predict_2026_score(data_points: list[dict]) -> dict | None:
    """
    Predict 2026 score using Linear Regression.

    Only works if n >= 3.

    Returns:
        {
            "score": int,  # Predicted score (capped at 140)
            "confidence": "HIGH" | "LOW"
        }
        or None if insufficient data
    """
    n = len(data_points)

    if n < 3:
        return None

    # Extract years and scores
    years = [dp["year"] for dp in data_points]
    scores = [dp["score"] for dp in data_points]

    # Linear Regression: y = mx + b
    # Where x = year, y = score

    n_points = len(years)
    sum_x = sum(years)
    sum_y = sum(scores)
    sum_xy = sum(x * y for x, y in zip(years, scores, strict=False))
    sum_x_squared = sum(x * x for x in years)

    # Calculate slope (m) and intercept (b)
    denominator = n_points * sum_x_squared - sum_x * sum_x

    if abs(denominator) < 1e-10:  # Avoid division by zero
        return None

    slope = (n_points * sum_xy - sum_x * sum_y) / denominator
    intercept = (sum_y - slope * sum_x) / n_points

    # Predict 2026
    predicted_score = slope * 2026 + intercept

    # Safety cap: UNT max score is 140
    predicted_score = min(140, max(0, int(round(predicted_score))))

    # Confidence based on data points and volatility
    volatility, _ = calculate_volatility(scores)
    if n >= 4 and volatility < 5.0:  # Low volatility, more data points
        confidence = "HIGH"
    else:
        confidence = "LOW"

    return {"score": predicted_score, "confidence": confidence}


async def get_analytics_report(
    db: AsyncSession, uni_name: str, major_code: str, quota_type: str = "GENERAL"
) -> dict:
    """
    Generate complete analytics report for a university + major combination.

    Returns:
        {
            "data_points_count": int,
            "history": List[{year, score}],
            "trend": {
                "cagr": float | None,
                "growth_rate": float | None,
                "verdict": str,
                "volatility": float,
                "volatility_confidence": str
            },
            "forecast": {
                "score": int,
                "confidence": str
            } | None
        }
    """
    # Fetch historical data
    data_points = await fetch_historical_data(db, uni_name, major_code, quota_type)

    if not data_points:
        return {
            "data_points_count": 0,
            "history": [],
            "trend": {
                "cagr": None,
                "growth_rate": None,
                "verdict": "NEW_MAJOR",
                "volatility": 0.0,
                "volatility_confidence": "UNKNOWN",
            },
            "forecast": None,
        }

    # Calculate trend metrics
    trend_metrics = calculate_trend_metrics(data_points)

    # Predict 2026 (only if n >= 3)
    forecast = predict_2026_score(data_points) if len(data_points) >= 3 else None

    return {
        "data_points_count": trend_metrics["data_points_count"],
        "history": trend_metrics["history"],
        "trend": {
            "cagr": trend_metrics["cagr"],
            "growth_rate": trend_metrics["growth_rate"],
            "verdict": trend_metrics["verdict"],
            "volatility": trend_metrics["volatility"],
            "volatility_confidence": trend_metrics["volatility_confidence"],
        },
        "forecast": forecast,
    }
