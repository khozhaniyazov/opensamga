"""
Dev Console Router - Localhost-Only Data Manipulation

SECURITY: All endpoints check that request comes from localhost.
This router is for development/testing purposes only.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    ActivityLog,
    ActivityType,
    GamificationProfile,
    LeagueTier,
    MistakeReview,
    StudentProfile,
    User,
    Visibility,
)
from .auth import get_current_user

router = APIRouter(prefix="/dev", tags=["dev-console"])


# =============================================================================
# SECURITY: LOCALHOST CHECK
# =============================================================================


def require_localhost(request: Request):
    """Only allow requests from localhost."""
    client_host = request.client.host if request.client else None
    allowed_hosts = ["127.0.0.1", "localhost", "::1"]

    # Also check for forwarded header in case of proxy
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_host = forwarded.split(",")[0].strip()

    if client_host not in allowed_hosts:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dev console is only available on localhost",
        )


# =============================================================================
# SCHEMAS
# =============================================================================


class SetXPRequest(BaseModel):
    xp: int


class SetStreakRequest(BaseModel):
    streak: int


class SetLeagueRequest(BaseModel):
    league: str  # BRONZE, SILVER, GOLD, DIAMOND, ELITE


class CreateActivityRequest(BaseModel):
    subject: str
    score: int
    max_score: int = 100
    activity_type: str = "TEST_COMPLETED"


class CreateMistakeRequest(BaseModel):
    question_text: str
    user_answer: str
    correct_answer: str
    topic_tag: str | None = None
    subject: str | None = None


class SetSubjectScoreRequest(BaseModel):
    subject: str
    score: int


class UserDataResponse(BaseModel):
    user_id: int
    email: str
    name: str | None
    total_xp: int
    league_tier: str
    current_streak: int
    target_university_id: int | None
    chosen_subjects: list[str] | None
    activity_count: int
    mistake_count: int


# =============================================================================
# GAMIFICATION ENDPOINTS
# =============================================================================


@router.post("/gamification/set-xp")
async def set_xp(
    request: Request,
    data: SetXPRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set user's XP directly."""
    require_localhost(request)

    result = await db.execute(
        select(GamificationProfile).where(GamificationProfile.user_id == current_user.id).limit(1)
    )
    profile = result.scalars().first()

    if not profile:
        raise HTTPException(status_code=404, detail="Gamification profile not found")

    profile.total_xp = max(0, data.xp)
    await db.commit()

    return {"success": True, "new_xp": profile.total_xp}


@router.post("/gamification/set-streak")
async def set_streak(
    request: Request,
    data: SetStreakRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set user's streak directly."""
    require_localhost(request)

    result = await db.execute(
        select(GamificationProfile).where(GamificationProfile.user_id == current_user.id).limit(1)
    )
    profile = result.scalars().first()

    if not profile:
        raise HTTPException(status_code=404, detail="Gamification profile not found")

    profile.current_streak = max(0, data.streak)
    await db.commit()

    return {"success": True, "new_streak": profile.current_streak}


@router.post("/gamification/set-league")
async def set_league(
    request: Request,
    data: SetLeagueRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set user's league tier directly."""
    require_localhost(request)

    # Validate league tier
    try:
        league = LeagueTier(data.league.upper())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid league. Must be one of: {[t.value for t in LeagueTier]}",
        ) from None

    result = await db.execute(
        select(GamificationProfile).where(GamificationProfile.user_id == current_user.id).limit(1)
    )
    profile = result.scalars().first()

    if not profile:
        raise HTTPException(status_code=404, detail="Gamification profile not found")

    profile.league_tier = league
    await db.commit()

    return {"success": True, "new_league": profile.league_tier.value}


# =============================================================================
# ACTIVITY ENDPOINTS
# =============================================================================


@router.post("/activities/create")
async def create_activity(
    request: Request,
    data: CreateActivityRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a fake activity log for testing."""
    require_localhost(request)

    # Import normalization function
    from ..constants.subjects import normalize_subject_name

    # Normalize subject name to canonical English
    canonical_subject = normalize_subject_name(data.subject)

    # Map string to ActivityType
    try:
        activity_type = ActivityType(data.activity_type)
    except ValueError:
        activity_type = ActivityType.TEST_COMPLETED

    activity = ActivityLog(
        user_id=current_user.id,
        activity_type=activity_type,
        metadata_blob={
            "subject": canonical_subject,  # Store canonical English name
            "score": data.score,
            "max_score": data.max_score,
            "source": "dev_console",
        },
        visibility=Visibility.PUBLIC,
        created_at=datetime.now(UTC),
    )

    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    return {"success": True, "activity_id": activity.id, "canonical_subject": canonical_subject}


@router.delete("/activities/clear")
async def clear_activities(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear all activity logs for current user."""
    require_localhost(request)

    result = await db.execute(delete(ActivityLog).where(ActivityLog.user_id == current_user.id))
    await db.commit()

    return {"success": True, "deleted_count": result.rowcount}


# =============================================================================
# MISTAKES ENDPOINTS
# =============================================================================


@router.post("/mistakes/create")
async def create_mistake(
    request: Request,
    data: CreateMistakeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a fake mistake for testing."""
    require_localhost(request)

    mistake = MistakeReview(
        user_id=current_user.id,
        original_question_snapshot={
            "text": data.question_text,
            "subject": data.subject or "Test Subject",
            "source": "dev_console",
        },
        user_answer=data.user_answer,
        correct_answer=data.correct_answer,
        ai_diagnosis="[Dev Console] Test mistake created for development",
        is_resolved=False,
        topic_tag=data.topic_tag or data.subject or "Test Topic",
        question_type="practice",
        points_lost=1,
        created_at=datetime.now(UTC),
    )

    db.add(mistake)
    await db.commit()
    await db.refresh(mistake)

    return {"success": True, "mistake_id": mistake.id}


@router.delete("/mistakes/clear")
async def clear_mistakes(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear all mistakes for current user."""
    require_localhost(request)

    result = await db.execute(delete(MistakeReview).where(MistakeReview.user_id == current_user.id))
    await db.commit()

    return {"success": True, "deleted_count": result.rowcount}


# =============================================================================
# USER DATA OVERVIEW
# =============================================================================


@router.get("/user-data", response_model=UserDataResponse)
async def get_user_data(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all user data for dev console overview."""
    require_localhost(request)

    # Get gamification profile
    gam_result = await db.execute(
        select(GamificationProfile).where(GamificationProfile.user_id == current_user.id).limit(1)
    )
    gam_profile = gam_result.scalars().first()

    # Get student profile
    stud_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user.id).limit(1)
    )
    stud_profile = stud_result.scalars().first()

    # Count activities
    from sqlalchemy import func

    act_count = await db.execute(select(func.count()).where(ActivityLog.user_id == current_user.id))
    activity_count = act_count.scalar() or 0

    # Count mistakes
    mis_count = await db.execute(
        select(func.count()).where(MistakeReview.user_id == current_user.id)
    )
    mistake_count = mis_count.scalar() or 0

    return UserDataResponse(
        user_id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        total_xp=gam_profile.total_xp if gam_profile else 0,
        league_tier=gam_profile.league_tier.value if gam_profile else "BRONZE",
        current_streak=gam_profile.current_streak if gam_profile else 0,
        target_university_id=stud_profile.target_university_id if stud_profile else None,
        chosen_subjects=stud_profile.chosen_subjects if stud_profile else None,
        activity_count=activity_count,
        mistake_count=mistake_count,
    )


@router.get("/scoring-breakdown")
async def get_scoring_breakdown(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed scoring breakdown to debug score calculation.
    Shows which activities are being counted and how they convert to UNT scores.
    """
    require_localhost(request)

    from ..utils.unt_scoring import convert_to_unt_score, get_unt_max_points

    # Get student profile
    stud_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user.id).limit(1)
    )
    stud_profile = stud_result.scalars().first()

    # Get all TEST_COMPLETED activities
    activities_result = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.user_id == current_user.id,
            ActivityLog.activity_type == ActivityType.TEST_COMPLETED,
        )
        .order_by(ActivityLog.created_at.desc())
    )
    activities = activities_result.scalars().all()

    # Define mandatory subjects
    mandatory_subjects = ["History of Kazakhstan", "Mathematical Literacy", "Reading Literacy"]

    # Get profile subjects
    profile_subjects = []
    if stud_profile and stud_profile.chosen_subjects:
        profile_subjects = list(stud_profile.chosen_subjects)[:2]

    valid_subjects = mandatory_subjects + profile_subjects

    # Build detailed breakdown
    all_activities = []
    subject_scores = {}

    for activity in activities:
        if not activity.metadata_blob or not isinstance(activity.metadata_blob, dict):
            continue

        subject = activity.metadata_blob.get("subject")
        score = activity.metadata_blob.get("score")
        max_score = activity.metadata_blob.get("max_score")

        if not subject or score is None:
            continue

        # Calculate UNT score
        unt_max = get_unt_max_points(subject)
        unt_score = convert_to_unt_score(score, max_score, subject) if max_score else 0
        percentage = (score / max_score * 100) if max_score else 0

        # Check if in valid subjects
        is_mandatory = any(ms.lower() in subject.lower() for ms in mandatory_subjects)
        is_profile = subject in profile_subjects
        is_counted = is_mandatory or is_profile

        activity_detail = {
            "subject": subject,
            "raw_score": score,
            "max_score": max_score,
            "percentage": round(percentage, 1),
            "unt_max_possible": unt_max,
            "unt_score": round(unt_score, 2),
            "is_counted": is_counted,
            "reason": "Valid UNT subject" if is_counted else "Not in your 5 UNT subjects",
            "created_at": activity.created_at.isoformat(),
        }

        all_activities.append(activity_detail)

        # Track only the latest score per subject if it's valid
        if is_counted and subject not in subject_scores:
            subject_scores[subject] = unt_score

    # Calculate total
    total_unt_score = sum(subject_scores.values())

    return {
        "profile_subjects": profile_subjects,
        "valid_unt_subjects": valid_subjects,
        "total_activities": len(activities),
        "total_unt_score": round(total_unt_score, 2),
        "subject_scores": {k: round(v, 2) for k, v in subject_scores.items()},
        "all_activities": all_activities,
        "diagnosis": {
            "expected_max_score": 140,
            "current_score": round(total_unt_score, 2),
            "missing_subjects": [s for s in valid_subjects if s not in subject_scores],
            "extra_activities": len([a for a in all_activities if not a["is_counted"]]),
        },
    }
