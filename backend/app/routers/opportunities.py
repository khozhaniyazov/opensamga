"""
Opportunities Router - Two-Sided Marketplace Core

Handles CRUD for opportunities and the matching/feed system.
"""

import logging
import os
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.services.openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

# v3.49 (2026-05-02): replaced 1x silent print() in the embedding
# generator with logger.exception. Same fix as portfolio.py.
logger = logging.getLogger(__name__)

from ..database import get_db
from ..models import (
    VALID_APPLICATION_TRANSITIONS,
    ApplicationStatus,
    Opportunity,
    OpportunityApplication,
    OpportunityStatus,
    OpportunityType,
    Portfolio,
    User,
)
from ..services.telemetry import TelemetryService
from .auth import get_current_user, get_current_user_optional

router = APIRouter(prefix="/api/opportunities", tags=["Opportunities"])

# OpenAI client for embedding generation
openai_api_key = os.getenv("OPENAI_API_KEY")
openai_client = AsyncOpenAI(api_key=openai_api_key) if openai_api_key else None


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================


class ScreeningQuestion(BaseModel):
    question: str
    required: bool = True


class OpportunityCreate(BaseModel):
    title: str = Field(..., min_length=5, max_length=200)
    description: str = Field(..., min_length=50, max_length=5000)
    opportunity_type: OpportunityType
    required_skills: list[str] = []
    preferred_major_codes: list[str] = []
    min_grade: int | None = None
    location: str = "remote"
    is_remote: bool = True
    commitment_hours_per_week: int | None = None
    duration_weeks: int | None = None
    start_date: datetime | None = None
    is_paid: bool = False
    compensation_description: str | None = None
    screening_questions: list[ScreeningQuestion] = []


class OpportunityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    required_skills: list[str] | None = None
    preferred_major_codes: list[str] | None = None
    location: str | None = None
    is_remote: bool | None = None
    commitment_hours_per_week: int | None = None
    duration_weeks: int | None = None
    start_date: datetime | None = None
    is_paid: bool | None = None
    compensation_description: str | None = None
    screening_questions: list[ScreeningQuestion] | None = None


class OpportunityResponse(BaseModel):
    id: int
    title: str
    description: str
    opportunity_type: str
    required_skills: list[str]
    preferred_major_codes: list[str]
    location: str
    is_remote: bool
    commitment_hours_per_week: int | None
    duration_weeks: int | None
    start_date: datetime | None
    is_paid: bool
    compensation_description: str | None
    screening_questions: list[dict]
    status: str
    is_verified: bool
    is_featured: bool
    view_count: int
    application_count: int
    poster_id: int
    created_at: datetime
    published_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ApplicationCreate(BaseModel):
    cover_note: str | None = None
    screening_answers: list[dict] = []  # [{"question_id": 0, "answer": "..."}]
    attachment_urls: list[str] = []


class ApplicationResponse(BaseModel):
    id: int
    opportunity_id: int
    applicant_id: int
    status: str
    cover_note: str | None
    screening_answers: list[dict]
    created_at: datetime
    submitted_at: datetime | None
    viewed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class MatchedOpportunity(BaseModel):
    opportunity: OpportunityResponse
    similarity_score: float
    match_reasons: list[str]  # ["Matches your skills: Python, React", "Remote opportunity"]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


async def generate_embedding(text: str) -> list[float]:
    """Generate embedding for text using OpenAI."""
    if not openai_client:
        return []

    try:
        response = await openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return response.data[0].embedding
    except Exception:
        logger.exception("opportunities: failed to generate embedding; returning empty vector")
        return []


def build_opportunity_text(opp: Opportunity) -> str:
    """Build text representation of opportunity for embedding."""
    parts = [
        opp.title,
        opp.description,
        f"Type: {opp.opportunity_type.value}",
        f"Skills: {', '.join(opp.required_skills or [])}",
        f"Location: {opp.location}",
    ]
    return " ".join(parts)


# =============================================================================
# OPPORTUNITY CRUD ENDPOINTS
# =============================================================================


@router.post("", response_model=OpportunityResponse)
async def create_opportunity(
    data: OpportunityCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new opportunity (starts as DRAFT)."""

    # Create opportunity
    opportunity = Opportunity(
        poster_id=current_user.id,
        title=data.title,
        description=data.description,
        opportunity_type=data.opportunity_type,
        required_skills=data.required_skills,
        preferred_major_codes=data.preferred_major_codes,
        min_grade=data.min_grade,
        location=data.location,
        is_remote=data.is_remote,
        commitment_hours_per_week=data.commitment_hours_per_week,
        duration_weeks=data.duration_weeks,
        start_date=data.start_date,
        is_paid=data.is_paid,
        compensation_description=data.compensation_description,
        screening_questions=[q.model_dump() for q in data.screening_questions],
        status=OpportunityStatus.DRAFT,
    )

    db.add(opportunity)
    await db.commit()
    await db.refresh(opportunity)

    # Generate embedding in background
    embedding_text = build_opportunity_text(opportunity)
    embedding = await generate_embedding(embedding_text)
    if embedding:
        opportunity.opportunity_embedding = embedding
        await db.commit()

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "opportunity.created",
        user_id=current_user.id,
        properties={"opportunity_id": opportunity.id, "type": data.opportunity_type.value},
        request=request,
    )

    return opportunity


@router.get("/{opportunity_id}", response_model=OpportunityResponse)
async def get_opportunity(
    opportunity_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Get opportunity details."""
    query = select(Opportunity).where(Opportunity.id == opportunity_id)
    result = await db.execute(query)
    opportunity = result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    # Only allow viewing active opportunities (unless owner)
    if opportunity.status != OpportunityStatus.ACTIVE:
        if not current_user or current_user.id != opportunity.poster_id:
            raise HTTPException(status_code=404, detail="Opportunity not found")

    # v3.87 (2026-05-04): the view_count bump used to be
    # ``opportunity.view_count += 1`` which translates to
    # SELECT-then-UPDATE — under concurrent GETs two requests
    # could each read N and both write N+1, undercounting by one.
    # Switch to an atomic UPDATE so the DB serializes the bump.
    # Pattern matches v3.81 (loot-box claim) / v3.83 (apply count) /
    # v3.85 (UsageCounter) atomic-bump shape.
    await db.execute(
        update(Opportunity)
        .where(Opportunity.id == opportunity_id)
        .values(view_count=Opportunity.view_count + 1)
    )
    await db.commit()

    # Track view event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "opportunity.viewed",
        user_id=current_user.id if current_user else None,
        properties={"opportunity_id": opportunity_id},
        request=request,
    )

    return opportunity


@router.put("/{opportunity_id}", response_model=OpportunityResponse)
async def update_opportunity(
    opportunity_id: int,
    data: OpportunityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update opportunity (owner only)."""
    query = select(Opportunity).where(Opportunity.id == opportunity_id)
    result = await db.execute(query)
    opportunity = result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    if opportunity.poster_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "screening_questions" and value:
            value = [q if isinstance(q, dict) else q.model_dump() for q in value]
        setattr(opportunity, field, value)

    opportunity.updated_at = datetime.now(UTC)

    # Regenerate embedding if content changed
    if data.title or data.description or data.required_skills:
        embedding_text = build_opportunity_text(opportunity)
        embedding = await generate_embedding(embedding_text)
        if embedding:
            opportunity.opportunity_embedding = embedding

    await db.commit()
    await db.refresh(opportunity)

    return opportunity


@router.post("/{opportunity_id}/publish", response_model=OpportunityResponse)
async def publish_opportunity(
    opportunity_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Publish a draft opportunity (makes it active)."""
    query = select(Opportunity).where(Opportunity.id == opportunity_id)
    result = await db.execute(query)
    opportunity = result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    if opportunity.poster_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if opportunity.status != OpportunityStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Can only publish draft opportunities")

    # Set to pending review for first-time posters (trust/safety)
    # For now, auto-approve
    opportunity.status = OpportunityStatus.ACTIVE
    opportunity.published_at = datetime.now(UTC)
    opportunity.expires_at = datetime.now(UTC) + timedelta(days=30)

    await db.commit()
    await db.refresh(opportunity)

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "opportunity.published",
        user_id=current_user.id,
        properties={"opportunity_id": opportunity_id},
        request=request,
    )

    return opportunity


@router.post("/{opportunity_id}/close")
async def close_opportunity(
    opportunity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close an opportunity (stops accepting applications)."""
    query = select(Opportunity).where(Opportunity.id == opportunity_id)
    result = await db.execute(query)
    opportunity = result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    if opportunity.poster_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    opportunity.status = OpportunityStatus.CLOSED
    await db.commit()

    return {"message": "Opportunity closed", "id": opportunity_id}


# =============================================================================
# OPPORTUNITY LISTING & SEARCH
# =============================================================================


@router.get("", response_model=list[OpportunityResponse])
async def list_opportunities(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    opportunity_type: OpportunityType | None = None,
    location: str | None = None,
    is_remote: bool | None = None,
    skills: str | None = None,  # Comma-separated
    is_featured: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List active opportunities with filters."""
    query = (
        select(Opportunity)
        .where(Opportunity.status == OpportunityStatus.ACTIVE)
        .order_by(Opportunity.is_featured.desc(), Opportunity.published_at.desc())
    )

    if opportunity_type:
        query = query.where(Opportunity.opportunity_type == opportunity_type)

    if location:
        query = query.where(Opportunity.location.ilike(f"%{location}%"))

    if is_remote is not None:
        query = query.where(Opportunity.is_remote == is_remote)

    if skills:
        skill_list = [s.strip().lower() for s in skills.split(",")]
        # Match opportunities that have any of the specified skills
        query = query.where(
            func.lower(func.array_to_string(Opportunity.required_skills, ",")).op("~")(
                "|".join(skill_list)
            )
        )

    if is_featured:
        query = query.where(Opportunity.is_featured == True)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)

    return result.scalars().all()


# =============================================================================
# MATCHED FEED (Semantic Matching with pgvector)
# =============================================================================


@router.get("/feed/matched", response_model=list[MatchedOpportunity])
async def get_matched_feed(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get personalized opportunity feed based on portfolio embedding.
    Uses pgvector cosine similarity for semantic matching.
    """
    # Get user's portfolio
    portfolio_query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    portfolio_result = await db.execute(portfolio_query)
    portfolio = portfolio_result.scalar_one_or_none()

    if not portfolio or not portfolio.portfolio_embedding:
        # Fallback to featured/recent opportunities
        query = (
            select(Opportunity)
            .where(Opportunity.status == OpportunityStatus.ACTIVE)
            .order_by(Opportunity.is_featured.desc(), Opportunity.published_at.desc())
            .limit(limit)
        )

        result = await db.execute(query)
        opportunities = result.scalars().all()

        return [
            MatchedOpportunity(
                opportunity=OpportunityResponse.model_validate(opp),
                similarity_score=0.0,
                match_reasons=["New opportunity"],
            )
            for opp in opportunities
        ]

    # Use pgvector for semantic matching
    embedding = portfolio.portfolio_embedding

    # Raw SQL for pgvector cosine similarity
    query = text("""
        SELECT
            o.*,
            1 - (o.opportunity_embedding <=> :embedding) as similarity_score
        FROM opportunities o
        WHERE o.status = 'ACTIVE'
            AND o.opportunity_embedding IS NOT NULL
        ORDER BY o.opportunity_embedding <=> :embedding
        LIMIT :limit
    """)

    result = await db.execute(query, {"embedding": str(embedding), "limit": limit})
    rows = result.fetchall()

    matched_opportunities = []
    for row in rows:
        # Build match reasons
        reasons = []

        # Check skill overlap
        if portfolio.skills and row.required_skills:
            overlap = set(s.lower() for s in portfolio.skills) & set(
                s.lower() for s in row.required_skills
            )
            if overlap:
                reasons.append(f"Matches your skills: {', '.join(list(overlap)[:3])}")

        # Check location preference
        if row.is_remote and "remote" in (portfolio.preferred_locations or []):
            reasons.append("Remote opportunity")

        # Check intent match
        if portfolio.intents:
            intent_type_map = {
                "internship": ["INTERNSHIP"],
                "project": ["PROJECT", "HACKATHON"],
                "cofounder": ["COFOUNDER"],
                "mentor": ["MENTORSHIP"],
            }
            for intent in portfolio.intents:
                if row.opportunity_type in intent_type_map.get(intent.lower(), []):
                    reasons.append(f"Matches your intent: {intent}")
                    break

        if not reasons:
            reasons.append("Recommended for you")

        matched_opportunities.append(
            MatchedOpportunity(
                opportunity=OpportunityResponse(
                    id=row.id,
                    title=row.title,
                    description=row.description,
                    opportunity_type=row.opportunity_type,
                    required_skills=row.required_skills or [],
                    preferred_major_codes=row.preferred_major_codes or [],
                    location=row.location,
                    is_remote=row.is_remote,
                    commitment_hours_per_week=row.commitment_hours_per_week,
                    duration_weeks=row.duration_weeks,
                    start_date=row.start_date,
                    is_paid=row.is_paid,
                    compensation_description=row.compensation_description,
                    screening_questions=row.screening_questions or [],
                    status=row.status,
                    is_verified=row.is_verified,
                    is_featured=row.is_featured,
                    view_count=row.view_count,
                    application_count=row.application_count,
                    poster_id=row.poster_id,
                    created_at=row.created_at,
                    published_at=row.published_at,
                ),
                similarity_score=row.similarity_score,
                match_reasons=reasons,
            )
        )

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "match.suggested",
        user_id=current_user.id,
        properties={
            "count": len(matched_opportunities),
            "has_portfolio_embedding": True,
        },
        request=request,
    )

    return matched_opportunities


# =============================================================================
# APPLICATIONS
# =============================================================================


@router.post("/{opportunity_id}/apply", response_model=ApplicationResponse)
async def apply_to_opportunity(
    opportunity_id: int,
    data: ApplicationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Apply to an opportunity."""
    # Check opportunity exists and is active
    opp_query = select(Opportunity).where(Opportunity.id == opportunity_id)
    opp_result = await db.execute(opp_query)
    opportunity = opp_result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    if opportunity.status != OpportunityStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Opportunity is not accepting applications")

    if opportunity.poster_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot apply to your own opportunity")

    # Cheap pre-check for the existing-application case so the
    # common path returns a clean 400 without going through an
    # IntegrityError round-trip. The DB-level UNIQUE constraint
    # `uq_opportunity_applicant` on (opportunity_id, applicant_id)
    # is the authoritative guard — see the IntegrityError handler
    # below for the race-loser branch.
    existing_query = select(OpportunityApplication).where(
        OpportunityApplication.opportunity_id == opportunity_id,
        OpportunityApplication.applicant_id == current_user.id,
    )
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already applied to this opportunity")

    # Create application
    application = OpportunityApplication(
        opportunity_id=opportunity_id,
        applicant_id=current_user.id,
        status=ApplicationStatus.SUBMITTED,
        cover_note=data.cover_note,
        screening_answers=data.screening_answers,
        attachment_urls=data.attachment_urls,
        submitted_at=datetime.now(UTC),
        status_history=[
            {
                "status": "SUBMITTED",
                "at": datetime.now(UTC).isoformat(),
                "by": "applicant",
            }
        ],
    )

    db.add(application)

    # v3.83 (2026-05-03): the application_count bump used to be
    # ``opportunity.application_count += 1`` which translates to
    # SELECT-then-UPDATE — under concurrent applies two requests
    # could each read N and both write N+1, undercounting by one.
    # Switch to an atomic UPDATE so the DB serializes the bump.
    # Pattern matches the v3.81 loot-box atomic-claim shape.
    await db.execute(
        update(Opportunity)
        .where(Opportunity.id == opportunity_id)
        .values(application_count=Opportunity.application_count + 1)
    )

    # v3.83: race-loser branch. Two concurrent applies from the
    # same user can both pass the pre-check above; the second
    # commit will trip the UNIQUE constraint on
    # (opportunity_id, applicant_id). Pre-v3.83 this surfaced as
    # an unhandled IntegrityError → 500 with a SQLAlchemy stack
    # trace in the response. Post-v3.83 it surfaces as the same
    # localized 400 the pre-check returns.
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Already applied to this opportunity") from None
    await db.refresh(application)

    # Track events
    telemetry = TelemetryService(db)
    await telemetry.track(
        "application.submitted",
        user_id=current_user.id,
        properties={
            "opportunity_id": opportunity_id,
            "application_id": application.id,
            "has_cover_note": bool(data.cover_note),
        },
        request=request,
    )

    return application


@router.get("/my/applications", response_model=list[ApplicationResponse])
async def get_my_applications(
    status: ApplicationStatus | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's applications."""
    query = (
        select(OpportunityApplication)
        .where(OpportunityApplication.applicant_id == current_user.id)
        .order_by(OpportunityApplication.created_at.desc())
    )

    if status:
        query = query.where(OpportunityApplication.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{opportunity_id}/applications", response_model=list[ApplicationResponse])
async def get_opportunity_applications(
    opportunity_id: int,
    status: ApplicationStatus | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get applications for an opportunity (poster only)."""
    # Verify ownership
    opp_query = select(Opportunity).where(Opportunity.id == opportunity_id)
    opp_result = await db.execute(opp_query)
    opportunity = opp_result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    if opportunity.poster_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    query = (
        select(OpportunityApplication)
        .where(OpportunityApplication.opportunity_id == opportunity_id)
        .order_by(OpportunityApplication.created_at.desc())
    )

    if status:
        query = query.where(OpportunityApplication.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.put("/applications/{application_id}/status")
async def update_application_status(
    application_id: int,
    new_status: ApplicationStatus,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update application status (with state machine validation).
    Poster can: VIEWED, SHORTLISTED, INTERVIEW_SCHEDULED, OFFERED, DECLINED_BY_POSTER
    Applicant can: WITHDRAWN, ACCEPTED, DECLINED_BY_STUDENT
    """
    query = (
        select(OpportunityApplication)
        .options(joinedload(OpportunityApplication.opportunity))
        .where(OpportunityApplication.id == application_id)
    )

    result = await db.execute(query)
    application = result.scalar_one_or_none()

    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Determine who is making the update
    is_poster = application.opportunity.poster_id == current_user.id
    is_applicant = application.applicant_id == current_user.id

    if not (is_poster or is_applicant):
        raise HTTPException(status_code=403, detail="Not authorized")

    # Validate state transition
    valid_transitions = VALID_APPLICATION_TRANSITIONS.get(application.status, [])
    if new_status not in valid_transitions:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from {application.status.value} to {new_status.value}",
        )

    # Validate who can make this transition
    poster_only_statuses = {
        ApplicationStatus.VIEWED,
        ApplicationStatus.SHORTLISTED,
        ApplicationStatus.INTERVIEW_SCHEDULED,
        ApplicationStatus.OFFERED,
        ApplicationStatus.DECLINED_BY_POSTER,
    }
    applicant_only_statuses = {
        ApplicationStatus.WITHDRAWN,
        ApplicationStatus.ACCEPTED,
        ApplicationStatus.DECLINED_BY_STUDENT,
    }

    if new_status in poster_only_statuses and not is_poster:
        raise HTTPException(status_code=403, detail="Only the poster can set this status")

    if new_status in applicant_only_statuses and not is_applicant:
        raise HTTPException(status_code=403, detail="Only the applicant can set this status")

    # Update status
    old_status = application.status
    application.status = new_status
    application.status_changed_at = datetime.now(UTC)

    # Update status history
    history = application.status_history or []
    history.append(
        {
            "status": new_status.value,
            "at": datetime.now(UTC).isoformat(),
            "by": "poster" if is_poster else "applicant",
        }
    )
    application.status_history = history

    # Update viewed_at if first view
    if new_status == ApplicationStatus.VIEWED and not application.viewed_at:
        application.viewed_at = datetime.now(UTC)

    await db.commit()

    # Track event
    telemetry = TelemetryService(db)
    event_type = f"application.{new_status.value.lower()}"
    if new_status == ApplicationStatus.VIEWED:
        event_type = "application.viewed_by_poster"

    await telemetry.track(
        event_type,
        user_id=current_user.id,
        properties={
            "application_id": application_id,
            "opportunity_id": application.opportunity_id,
            "old_status": old_status.value,
            "new_status": new_status.value,
        },
        request=request,
    )

    return {
        "message": "Status updated",
        "application_id": application_id,
        "old_status": old_status.value,
        "new_status": new_status.value,
    }


# =============================================================================
# POSTER'S OPPORTUNITIES
# =============================================================================


@router.get("/my/posted", response_model=list[OpportunityResponse])
async def get_my_posted_opportunities(
    status: OpportunityStatus | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get opportunities posted by current user."""
    query = (
        select(Opportunity)
        .where(Opportunity.poster_id == current_user.id)
        .order_by(Opportunity.created_at.desc())
    )

    if status:
        query = query.where(Opportunity.status == status)

    result = await db.execute(query)
    return result.scalars().all()
