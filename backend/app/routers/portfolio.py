"""
Portfolio Router - Student Profile & Apply-Ready System

Handles portfolio CRUD, completeness scoring, and progressive profiling.
"""

import logging
import os
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

# v3.49 (2026-05-02): replaced 1x silent print() in the embedding
# generator with logger.exception. Embedding failures previously
# went to stdout and the function returned [] — silent degradation.
logger = logging.getLogger(__name__)

from ..database import get_db
from ..models import OnboardingStep, Portfolio, StudentProfile, User, Visibility
from ..services.telemetry import TelemetryService
from .auth import get_current_user

router = APIRouter(prefix="/api/portfolio", tags=["Portfolio"])

# OpenAI client for embedding generation
openai_api_key = os.getenv("OPENAI_API_KEY")
openai_client = AsyncOpenAI(api_key=openai_api_key) if openai_api_key else None


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================


class ProjectInput(BaseModel):
    title: str = Field(..., min_length=2, max_length=100)
    description: str = Field(..., max_length=500)
    url: str | None = None
    skills: list[str] = []


class AchievementInput(BaseModel):
    title: str = Field(..., min_length=2, max_length=100)
    date: str | None = None
    description: str | None = None


class PortfolioUpdate(BaseModel):
    headline: str | None = Field(None, max_length=200)
    summary: str | None = Field(None, max_length=2000)
    skills: list[str] | None = None
    interests: list[str] | None = None
    intents: list[str] | None = None  # ['internship', 'project', 'cofounder', 'mentor']
    availability_hours_per_week: int | None = Field(None, ge=0, le=80)
    available_start_date: datetime | None = None
    preferred_locations: list[str] | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    resume_url: str | None = None
    projects: list[ProjectInput] | None = None
    achievements: list[AchievementInput] | None = None
    visibility: Visibility | None = None


class PortfolioResponse(BaseModel):
    id: int
    user_id: int
    onboarding_step: str
    headline: str | None
    summary: str | None
    skills: list[str]
    interests: list[str]
    intents: list[str]
    availability_hours_per_week: int | None
    available_start_date: datetime | None
    preferred_locations: list[str]
    linkedin_url: str | None
    github_url: str | None
    portfolio_url: str | None
    resume_url: str | None
    projects: list[dict]
    achievements: list[dict]
    visibility: str
    completeness_score: int
    has_skills: bool
    has_bio: bool
    has_avatar: bool
    has_linkedin: bool
    has_github: bool
    has_project: bool
    has_resume: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CompletenessBreakdown(BaseModel):
    score: int
    max_score: int
    items: list[dict]  # [{"name": "Skills", "complete": true, "weight": 25, "earned": 25}]
    next_step: str | None  # "Add 3 skills to earn 25 points"


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


async def generate_portfolio_embedding(portfolio: Portfolio) -> list[float]:
    """Generate embedding for portfolio using OpenAI."""
    if not openai_client:
        return []

    # Build text representation
    parts = []

    if portfolio.headline:
        parts.append(portfolio.headline)

    if portfolio.summary:
        parts.append(portfolio.summary)

    if portfolio.skills:
        parts.append(f"Skills: {', '.join(portfolio.skills)}")

    if portfolio.interests:
        parts.append(f"Interests: {', '.join(portfolio.interests)}")

    if portfolio.intents:
        parts.append(f"Looking for: {', '.join(portfolio.intents)}")

    if portfolio.projects:
        for project in portfolio.projects:
            parts.append(f"Project: {project.get('title', '')}")
            if project.get("description"):
                parts.append(project["description"])

    if not parts:
        return []

    text = " ".join(parts)

    try:
        response = await openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return response.data[0].embedding
    except Exception:
        logger.exception("portfolio: failed to generate embedding; returning empty vector")
        return []


def calculate_onboarding_step(
    portfolio: Portfolio, profile: StudentProfile | None
) -> OnboardingStep:
    """Determine current onboarding step based on portfolio completeness."""

    # Check profile basics
    has_basic = profile and profile.bio and profile.avatar_url
    has_academic = profile and profile.chosen_subjects and len(profile.chosen_subjects) > 0

    # Check portfolio fields
    has_skills = portfolio.has_skills and len(portfolio.skills or []) >= 3
    has_portfolio_content = portfolio.has_linkedin or portfolio.has_github or portfolio.has_project

    # Determine step
    if portfolio.completeness_score >= 80:
        return OnboardingStep.APPLY_READY
    elif has_portfolio_content:
        return OnboardingStep.PROFILE_PORTFOLIO
    elif has_skills:
        return OnboardingStep.PROFILE_SKILLS
    elif has_academic:
        return OnboardingStep.PROFILE_ACADEMIC
    elif has_basic:
        return OnboardingStep.PROFILE_BASIC
    else:
        return OnboardingStep.REGISTERED


def get_completeness_breakdown(portfolio: Portfolio) -> CompletenessBreakdown:
    """Get detailed breakdown of portfolio completeness."""
    items = [
        {
            "name": "Bio/Summary",
            "complete": portfolio.has_bio,
            "weight": 10,
            "earned": 10 if portfolio.has_bio else 0,
            "hint": "Add a summary about yourself",
        },
        {
            "name": "Profile Photo",
            "complete": portfolio.has_avatar,
            "weight": 5,
            "earned": 5 if portfolio.has_avatar else 0,
            "hint": "Upload a professional photo",
        },
        {
            "name": "Skills (3+)",
            "complete": portfolio.has_skills and len(portfolio.skills or []) >= 3,
            "weight": 25,
            "earned": 25 if (portfolio.has_skills and len(portfolio.skills or []) >= 3) else 0,
            "hint": "Add at least 3 relevant skills",
        },
        {
            "name": "LinkedIn",
            "complete": portfolio.has_linkedin,
            "weight": 15,
            "earned": 15 if portfolio.has_linkedin else 0,
            "hint": "Connect your LinkedIn profile",
        },
        {
            "name": "GitHub",
            "complete": portfolio.has_github,
            "weight": 10,
            "earned": 10 if portfolio.has_github else 0,
            "hint": "Connect your GitHub profile",
        },
        {
            "name": "Project (1+)",
            "complete": portfolio.has_project and len(portfolio.projects or []) >= 1,
            "weight": 20,
            "earned": 20 if (portfolio.has_project and len(portfolio.projects or []) >= 1) else 0,
            "hint": "Add at least one project you've worked on",
        },
        {
            "name": "Resume",
            "complete": portfolio.has_resume,
            "weight": 15,
            "earned": 15 if portfolio.has_resume else 0,
            "hint": "Upload your resume",
        },
    ]

    score = sum(item["earned"] for item in items)
    max_score = sum(item["weight"] for item in items)

    # Find next step
    incomplete = [item for item in items if not item["complete"]]
    incomplete.sort(key=lambda x: x["weight"], reverse=True)
    next_step = incomplete[0]["hint"] if incomplete else None

    return CompletenessBreakdown(
        score=score,
        max_score=max_score,
        items=items,
        next_step=next_step,
    )


# =============================================================================
# PORTFOLIO ENDPOINTS
# =============================================================================


@router.get("/me", response_model=PortfolioResponse)
async def get_my_portfolio(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's portfolio (creates if doesn't exist)."""
    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        # Create new portfolio with proper error handling for race conditions
        try:
            portfolio = Portfolio(user_id=current_user.id)
            db.add(portfolio)
            await db.commit()
            await db.refresh(portfolio)
        except Exception as exc:
            # Handle race condition - portfolio was created by another request
            await db.rollback()
            # Re-fetch the portfolio
            result = await db.execute(query)
            portfolio = result.scalar_one_or_none()
            if not portfolio:
                raise HTTPException(
                    status_code=500, detail="Failed to create/fetch portfolio"
                ) from exc

    return portfolio


@router.put("/me", response_model=PortfolioResponse)
async def update_my_portfolio(
    data: PortfolioUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update current user's portfolio."""
    # Get or create portfolio
    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        portfolio = Portfolio(user_id=current_user.id)
        db.add(portfolio)

    # Track old completeness for event
    old_score = portfolio.completeness_score

    # Update fields
    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if field == "projects" and value is not None:
            value = [p.model_dump() if hasattr(p, "model_dump") else p for p in value]
            portfolio.has_project = len(value) > 0
        elif field == "achievements" and value is not None:
            value = [a.model_dump() if hasattr(a, "model_dump") else a for a in value]
        elif field == "skills" and value is not None:
            portfolio.has_skills = len(value) >= 3
        elif field == "linkedin_url" and value:
            portfolio.has_linkedin = True
        elif field == "github_url" and value:
            portfolio.has_github = True
        elif field == "resume_url" and value:
            portfolio.has_resume = True
        elif field == "summary" and value:
            portfolio.has_bio = True

        setattr(portfolio, field, value)

    portfolio.updated_at = datetime.now(UTC)

    # Get student profile for onboarding step calculation
    profile_query = select(StudentProfile).where(StudentProfile.user_id == current_user.id)
    profile_result = await db.execute(profile_query)
    profile = profile_result.scalar_one_or_none()

    # Update onboarding step
    portfolio.onboarding_step = calculate_onboarding_step(portfolio, profile)

    # Check if apply-ready
    if portfolio.completeness_score >= 80 and not portfolio.onboarding_completed_at:
        portfolio.onboarding_completed_at = datetime.now(UTC)

    # Generate embedding
    embedding = await generate_portfolio_embedding(portfolio)
    if embedding:
        portfolio.portfolio_embedding = embedding
        portfolio.last_embedding_update = datetime.now(UTC)

    await db.commit()
    await db.refresh(portfolio)

    # Track events
    telemetry = TelemetryService(db)

    new_score = portfolio.completeness_score
    if new_score != old_score:
        await telemetry.track(
            "portfolio.completeness_changed",
            user_id=current_user.id,
            properties={
                "old_score": old_score,
                "new_score": new_score,
                "change": new_score - old_score,
            },
            request=request,
        )

    await telemetry.track(
        "portfolio.updated",
        user_id=current_user.id,
        properties={
            "fields_updated": list(update_data.keys()),
            "completeness_score": new_score,
        },
        request=request,
    )

    return portfolio


@router.get("/me/completeness", response_model=CompletenessBreakdown)
async def get_completeness_breakdown_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get detailed completeness breakdown with hints."""
    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        try:
            portfolio = Portfolio(user_id=current_user.id)
            db.add(portfolio)
            await db.commit()
            await db.refresh(portfolio)
        except Exception as exc:
            await db.rollback()
            result = await db.execute(query)
            portfolio = result.scalar_one_or_none()
            if not portfolio:
                raise HTTPException(
                    status_code=500, detail="Failed to create/fetch portfolio"
                ) from exc

    return get_completeness_breakdown(portfolio)


@router.post("/me/skills")
async def add_skills(
    skills: list[str],
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add skills to portfolio (append, don't replace)."""
    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        portfolio = Portfolio(user_id=current_user.id, skills=[])
        db.add(portfolio)

    # Append unique skills
    existing = set(s.lower() for s in (portfolio.skills or []))
    new_skills = [s for s in skills if s.lower() not in existing]

    portfolio.skills = (portfolio.skills or []) + new_skills
    portfolio.has_skills = len(portfolio.skills) >= 3
    portfolio.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(portfolio)

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "portfolio.skills_added",
        user_id=current_user.id,
        properties={
            "skills_added": new_skills,
            "total_skills": len(portfolio.skills),
        },
        request=request,
    )

    return {
        "message": f"Added {len(new_skills)} skills",
        "skills": portfolio.skills,
        "completeness_score": portfolio.completeness_score,
    }


@router.post("/me/project")
async def add_project(
    project: ProjectInput,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a project to portfolio."""
    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        portfolio = Portfolio(user_id=current_user.id, projects=[])
        db.add(portfolio)

    # Add project
    projects = portfolio.projects or []
    projects.append(project.model_dump())

    portfolio.projects = projects
    portfolio.has_project = True
    portfolio.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(portfolio)

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "portfolio.project_added",
        user_id=current_user.id,
        properties={
            "project_title": project.title,
            "total_projects": len(portfolio.projects),
        },
        request=request,
    )

    return {
        "message": "Project added",
        "projects": portfolio.projects,
        "completeness_score": portfolio.completeness_score,
    }


@router.post("/me/connect/linkedin")
async def connect_linkedin(
    linkedin_url: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Connect LinkedIn profile."""
    # Validate LinkedIn URL
    if not linkedin_url.startswith("https://www.linkedin.com/") and not linkedin_url.startswith(
        "https://linkedin.com/"
    ):
        raise HTTPException(status_code=400, detail="Invalid LinkedIn URL")

    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        portfolio = Portfolio(user_id=current_user.id)
        db.add(portfolio)

    portfolio.linkedin_url = linkedin_url
    portfolio.has_linkedin = True
    portfolio.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(portfolio)

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "portfolio.linkedin_connected",
        user_id=current_user.id,
        properties={"linkedin_url": linkedin_url},
        request=request,
    )

    return {
        "message": "LinkedIn connected",
        "completeness_score": portfolio.completeness_score,
    }


@router.post("/me/connect/github")
async def connect_github(
    github_url: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Connect GitHub profile."""
    # Validate GitHub URL
    if not github_url.startswith("https://github.com/"):
        raise HTTPException(status_code=400, detail="Invalid GitHub URL")

    query = select(Portfolio).where(Portfolio.user_id == current_user.id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        portfolio = Portfolio(user_id=current_user.id)
        db.add(portfolio)

    portfolio.github_url = github_url
    portfolio.has_github = True
    portfolio.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(portfolio)

    # Track event
    telemetry = TelemetryService(db)
    await telemetry.track(
        "portfolio.github_connected",
        user_id=current_user.id,
        properties={"github_url": github_url},
        request=request,
    )

    return {
        "message": "GitHub connected",
        "completeness_score": portfolio.completeness_score,
    }


# =============================================================================
# PUBLIC PORTFOLIO VIEW
# =============================================================================


@router.get("/user/{user_id}")
async def get_user_portfolio(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user),
):
    """Get another user's portfolio (respects visibility settings)."""
    query = select(Portfolio).where(Portfolio.user_id == user_id)
    result = await db.execute(query)
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Check visibility
    if portfolio.visibility == Visibility.PRIVATE:
        if not current_user or current_user.id != user_id:
            raise HTTPException(status_code=404, detail="Portfolio not found")

    # v3.3 (2026-04-29): FRIENDS_ONLY previously fell through to the
    # public branch — i.e. acted exactly like PUBLIC. Until the social
    # graph (friend/follow edges) lands, the only safe interpretation
    # is "viewable by the owner only", which is the same posture as
    # PRIVATE. When friends are wired up, replace this with a join on
    # the friendships table. Tracking ticket: portfolio FRIENDS_ONLY
    # leak (audit finding #11, v3.3).
    if portfolio.visibility == Visibility.FRIENDS_ONLY:
        if not current_user or current_user.id != user_id:
            raise HTTPException(status_code=404, detail="Portfolio not found")

    # Return public view (exclude sensitive fields)
    return {
        "user_id": portfolio.user_id,
        "headline": portfolio.headline,
        "summary": portfolio.summary,
        "skills": portfolio.skills,
        "interests": portfolio.interests,
        "intents": portfolio.intents,
        "linkedin_url": portfolio.linkedin_url,
        "github_url": portfolio.github_url,
        "portfolio_url": portfolio.portfolio_url,
        "projects": portfolio.projects,
        "achievements": portfolio.achievements,
        "completeness_score": portfolio.completeness_score,
    }
