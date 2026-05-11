"""
app/routers/strategy.py
-----------------------
University Strategist API Router

Handles roadmap generation requests:
- Generates personalized study roadmaps
- Calculates score gaps
- Identifies weak subjects
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..services.profile_pair_simulator import (
    build_profile_pair_simulator_response,
)
from ..services.retake_guide import build_retake_guide_payload
from ..services.strategy_service import generate_strategy
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/strategy", tags=["strategy"])


# Pydantic model for probability response
class ProbabilityResponse(BaseModel):
    probability: int | None  # null if no data or missing target
    gap: int
    target_score: int
    current_score: int


@router.get("/roadmap", response_model=dict, status_code=status.HTTP_200_OK)
async def get_roadmap(
    language: str = Query(
        "ru", description="Language preference: 'ru' for Russian, 'kz' for Kazakh"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a personalized roadmap to reach the target university's grant score.

    This endpoint:
    1. Fetches the user's target university and grant threshold
    2. Calculates current score from test completion activities
    3. Identifies the gap and weakest subject
    4. Generates a 3-step AI-powered roadmap

    Args:
        language: Language preference ('ru' for Russian, 'kz' for Kazakh). Defaults to 'ru'.
        current_user: Authenticated user (from JWT token)
        db: Database session

    Returns:
        Dict with:
        - status: "On Track" | "At Risk" | "Needs Improvement" | "no_data"
        - target_university: University name
        - target_score: Grant threshold score
        - current_score: Current total score
        - gap: Score gap (positive = need improvement)
        - weakest_subject: Subject with lowest average
        - weakest_percentage: Average percentage for weakest subject
        - subject_breakdown: Dict of subject scores
        - roadmap: List of 3 weekly steps with topics, focus, and activities
    """
    try:
        # Normalize language parameter (only accept 'ru' or 'kz')
        normalized_language = "kz" if language.lower() == "kz" else "ru"

        # Call the strategy service
        strategy = await generate_strategy(
            db=db, user_id=current_user.id, language=normalized_language
        )

        return strategy

    except Exception as e:
        logger.exception(
            "strategy roadmap failed user_id=%s lang=%s",
            current_user.id,
            normalized_language,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate roadmap",
        ) from e


@router.get("/probability", response_model=ProbabilityResponse, status_code=status.HTTP_200_OK)
async def get_grant_probability(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Calculate grant probability based on the user's current score and target university.

    This endpoint:
    1. Calls generate_strategy to get accurate score calculation (with Pentagon Rule)
    2. Extracts gap and status from the strategy result
    3. Calculates probability percentage based on the gap

    Returns:
        Dict with:
        - probability: Percentage (0-100) or null if no data/missing target
        - gap: Score gap (positive = need improvement, negative = surplus)
        - target_score: Grant threshold score
        - current_score: Current total score (calculated from 5 UNT subjects)
    """
    try:
        # Call the strategy service to get accurate score calculation
        strategy = await generate_strategy(
            db=db,
            user_id=current_user.id,
            language="ru",  # Default language for probability calculation
        )

        # Extract data from strategy result
        status_value = strategy.get("status")
        gap = strategy.get("gap", 0)
        target_score = strategy.get("target_score", 0)
        current_score = strategy.get("current_score", 0)

        # If status is "no_data" or target is missing, return null probability
        if status_value == "no_data" or not target_score or target_score == 0:
            return ProbabilityResponse(
                probability=None, gap=gap, target_score=target_score, current_score=current_score
            )

        # Calculate probability based on gap using linear interpolation
        # Note: gap = current_score - target_score (from strategy service)
        # If gap is positive, student has surplus (exceeds target)
        # If gap is negative, student needs to improve
        diff = gap

        # Smoother probability curve using linear interpolation
        if diff >= 20:
            # Large surplus - near guaranteed
            probability = 99
        elif diff >= 0:
            # At or above target (gap 0-19): interpolate 70-99%
            probability = 70 + int((diff / 20) * 29)
        elif diff >= -10:
            # Small gap (1-10 points needed): interpolate 40-69%
            probability = 40 + int(((diff + 10) / 10) * 30)
        elif diff >= -30:
            # Medium gap (11-30 points needed): interpolate 10-39%
            probability = 10 + int(((diff + 30) / 20) * 30)
        else:
            # Large gap (30+ points needed)
            probability = max(5, 10 + int((diff + 30) / 5))

        return ProbabilityResponse(
            probability=probability, gap=gap, target_score=target_score, current_score=current_score
        )

    except Exception as e:
        logger.exception(
            "strategy grant probability failed user_id=%s",
            current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate grant probability",
        ) from e


# v3.25 (2026-05-01): Profile subject pair simulator (Issue #15 AC#4).
# Read-only — no auth required. Returns reachable major groups, aggregated
# grant pressure, curated career copy, and heuristic risk flags for a
# given pair. Pair must be one of the 12 PROFILE_SUBJECT_COMBINATIONS.
class _PairMajorEntry(BaseModel):
    code: str | None
    name: str | None
    university_count: int
    median_grant_threshold: int | None
    max_grant_threshold: int | None
    total_grants_awarded: int
    deep_link: str | None


class _PairSummary(BaseModel):
    major_count: int
    median_grant_threshold: int | None
    max_grant_threshold: int | None
    total_grants_awarded: int


class _PairRisks(BaseModel):
    flags: list[str]
    severity: str


class ProfilePairSimulatorResponse(BaseModel):
    pair: list[str]
    career_copy: dict | None
    majors: list[_PairMajorEntry]
    summary: _PairSummary
    risks: _PairRisks


@router.get(
    "/profile-pair",
    response_model=ProfilePairSimulatorResponse,
    status_code=status.HTTP_200_OK,
)
async def get_profile_pair_simulator(
    subject1: str = Query(..., description="First subject (canonical English, RU, or KZ name)."),
    subject2: str = Query(..., description="Second subject (canonical English, RU, or KZ name)."),
    db: AsyncSession = Depends(get_db),
):
    """Return the profile-subject pair simulator snapshot.

    Validates the pair against PROFILE_SUBJECT_COMBINATIONS (in any
    language alias). On invalid pair returns HTTP 400.
    """

    try:
        return await build_profile_pair_simulator_response(
            db=db, subject1=subject1, subject2=subject2
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to build profile-pair simulator: {exc}",
        ) from exc


# ──────────────────────────────────────────────────────────────────────────
# v3.28 — Retake Guide (Issue #15 AC#6)
#
# Read-only, no-auth — same posture as /strategy/profile-pair.
# Returns the deterministic retake-guide payload (sessions + cost
# rules + score-recovery estimator). The service module owns the
# testing.kz fetch + 6h cache + curated fallback.
# ──────────────────────────────────────────────────────────────────────────


@router.get("/retake-guide", status_code=status.HTTP_200_OK)
async def get_retake_guide(
    language: str = Query("ru", description="Language: ru or kz"),
    current_score: int | None = Query(
        None, description="Latest UNT score (0–140); used for the estimator band."
    ),
    weeks_until_session: int = Query(
        8, ge=0, le=52, description="Weeks of preparation before the chosen session."
    ),
):
    """Return the v3.28 Retake Guide payload."""

    try:
        return await build_retake_guide_payload(
            language=language,
            current_score=current_score,
            weeks_until_session=weeks_until_session,
        )
    except Exception as exc:  # pragma: no cover — defensive
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to build retake guide: {exc}",
        ) from exc
