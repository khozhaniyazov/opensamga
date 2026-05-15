"""
Admin Router - Marketplace Moderation & Analytics

Provides endpoints for:
- Opportunity moderation (approve, reject, flag)
- Poster verification
- Platform analytics dashboard
- User management
"""

import logging
import os
from datetime import UTC, datetime, timedelta
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..database import get_db
from ..models import (
    AcceptanceScore,
    ExamQuestion,
    Opportunity,
    OpportunityApplication,
    OpportunityStatus,
    Portfolio,
    Report,
    ReportStatus,
    TelemetryEvent,
    UniversityDetail,
    User,
    Verification,
    VerificationType,
)
from .auth import get_current_admin as _canonical_get_current_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["Admin"])


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================


class PlatformStats(BaseModel):
    """Overall platform statistics."""

    total_users: int
    active_users_7d: int
    total_opportunities: int
    active_opportunities: int
    total_applications: int
    applications_7d: int
    total_portfolios: int
    portfolios_complete: int  # 80%+ completeness
    avg_completeness: float

    # Liquidity metrics
    applications_per_opportunity: float
    opportunities_with_applications: int
    ghosting_rate: float  # % applications never reviewed


class OpportunityForReview(BaseModel):
    """Opportunity data for admin review."""

    id: int
    title: str
    description: str
    opportunity_type: str
    status: str
    poster_id: int
    poster_name: str | None
    poster_email: str | None
    is_verified: bool
    view_count: int
    application_count: int
    created_at: datetime
    published_at: datetime | None
    flags: list[str]

    model_config = ConfigDict(from_attributes=True)


class ModerationAction(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    FLAG = "flag"
    UNFLAG = "unflag"
    FEATURE = "feature"
    UNFEATURE = "unfeature"
    CLOSE = "close"


class ModerationRequest(BaseModel):
    action: ModerationAction
    reason: str | None = None


class PosterForVerification(BaseModel):
    """Poster awaiting verification."""

    user_id: int
    name: str | None
    email: str | None
    opportunities_posted: int
    verifications: list[dict]
    created_at: datetime


class VerifyPosterRequest(BaseModel):
    verification_type: str
    is_approved: bool
    notes: str | None = None


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


# v3.3 (2026-04-29): the canonical admin gate now lives in
# routers/auth.py:get_current_admin. Previously this module had its
# own hardcoded email list, routers/billing.py had a SECOND copy of
# the same hardcoded list, and routers/auth.py had a THIRD source of
# truth (DB `is_admin` flag OR `RAG_ADMIN_EMAILS` env). A user with
# `is_admin=True` in the DB was silently denied by every endpoint in
# this file. We now delegate to the canonical helper and re-export
# `is_admin` as a convenience predicate for any code that wants to
# check "is this user an admin?" without raising.


def is_admin(user: User) -> bool:
    """Check if user has admin privileges (DB flag OR env allowlist)."""
    if not user:
        return False
    if bool(getattr(user, "is_admin", False)):
        return True
    email = (getattr(user, "email", "") or "").lower()
    if not email:
        return False
    raw = os.environ.get("RAG_ADMIN_EMAILS", "") or ""
    allow = {e.strip().lower() for e in raw.split(",") if e.strip()}
    return email in allow


async def require_admin(
    current_user: User = Depends(_canonical_get_current_admin),
) -> User:
    """Dependency to require admin access — delegates to auth.get_current_admin."""
    return current_user


# =============================================================================
# PLATFORM ANALYTICS
# =============================================================================


@router.get("/stats", response_model=PlatformStats)
async def get_platform_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get overall platform statistics."""
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)

    # User stats
    total_users = await db.scalar(select(func.count(User.id)))

    active_users_query = select(func.count(func.distinct(TelemetryEvent.user_id))).where(
        TelemetryEvent.timestamp >= week_ago
    )
    active_users_7d = await db.scalar(active_users_query) or 0

    # Opportunity stats
    total_opportunities = await db.scalar(select(func.count(Opportunity.id)))
    active_opportunities = await db.scalar(
        select(func.count(Opportunity.id)).where(Opportunity.status == OpportunityStatus.ACTIVE)
    )

    # Application stats
    total_applications = await db.scalar(select(func.count(OpportunityApplication.id)))
    applications_7d = (
        await db.scalar(
            select(func.count(OpportunityApplication.id)).where(
                OpportunityApplication.created_at >= week_ago
            )
        )
        or 0
    )

    # Portfolio stats
    total_portfolios = await db.scalar(select(func.count(Portfolio.id)))

    # Count portfolios with 80%+ completeness (needs subquery)
    portfolios_complete = 0  # Placeholder - actual calculation would need completeness_score column

    # Average completeness
    avg_completeness = 0.0  # Placeholder

    # Liquidity metrics
    opps_with_apps = (
        await db.scalar(select(func.count(func.distinct(OpportunityApplication.opportunity_id))))
        or 0
    )

    applications_per_opp = 0.0
    if active_opportunities and active_opportunities > 0:
        applications_per_opp = (total_applications or 0) / active_opportunities

    # Ghosting rate - applications never viewed
    never_viewed = (
        await db.scalar(
            select(func.count(OpportunityApplication.id)).where(
                OpportunityApplication.viewed_at.is_(None),
                OpportunityApplication.created_at < now - timedelta(days=3),
            )
        )
        or 0
    )

    ghosting_rate = 0.0
    if total_applications and total_applications > 0:
        ghosting_rate = never_viewed / total_applications

    return PlatformStats(
        total_users=total_users or 0,
        active_users_7d=active_users_7d,
        total_opportunities=total_opportunities or 0,
        active_opportunities=active_opportunities or 0,
        total_applications=total_applications or 0,
        applications_7d=applications_7d,
        total_portfolios=total_portfolios or 0,
        portfolios_complete=portfolios_complete,
        avg_completeness=avg_completeness,
        applications_per_opportunity=round(applications_per_opp, 2),
        opportunities_with_applications=opps_with_apps,
        ghosting_rate=round(ghosting_rate, 3),
    )


@router.get("/stats/funnel")
async def get_funnel_stats(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get conversion funnel statistics."""
    since = datetime.now(UTC) - timedelta(days=days)

    # Define funnel stages
    stages = [
        ("signup", "user.registered"),
        ("portfolio_started", "portfolio.created"),
        ("portfolio_complete", "portfolio.completeness_changed"),
        ("opportunity_viewed", "opportunity.viewed"),
        ("application_submitted", "application.submitted"),
        ("interview_scheduled", "application.interview_scheduled"),
        ("offer_received", "application.offered"),
        ("offer_accepted", "application.accepted"),
    ]

    funnel_data = []
    for stage_name, event_type in stages:
        count = (
            await db.scalar(
                select(func.count(func.distinct(TelemetryEvent.user_id))).where(
                    TelemetryEvent.event_type == event_type,
                    TelemetryEvent.timestamp >= since,
                )
            )
            or 0
        )
        funnel_data.append(
            {
                "stage": stage_name,
                "event_type": event_type,
                "unique_users": count,
            }
        )

    return {
        "period_days": days,
        "funnel": funnel_data,
    }


# =============================================================================
# OPPORTUNITY MODERATION
# =============================================================================


@router.get("/opportunities/pending", response_model=list[OpportunityForReview])
async def get_pending_opportunities(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get opportunities pending review."""
    query = (
        select(Opportunity)
        .options(joinedload(Opportunity.poster))
        .where(
            or_(
                Opportunity.status == OpportunityStatus.PENDING_REVIEW,
                Opportunity.is_verified == False,
            )
        )
        .order_by(Opportunity.created_at.desc())
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    opportunities = result.scalars().unique().all()

    return [
        OpportunityForReview(
            id=opp.id,
            title=opp.title,
            description=opp.description,
            opportunity_type=opp.opportunity_type.value,
            status=opp.status.value,
            poster_id=opp.poster_id,
            poster_name=opp.poster.name if opp.poster else None,
            poster_email=opp.poster.email if opp.poster else None,
            is_verified=opp.is_verified,
            view_count=opp.view_count,
            application_count=opp.application_count,
            created_at=opp.created_at,
            published_at=opp.published_at,
            flags=[],  # TODO: Add flags from moderation_flags
        )
        for opp in opportunities
    ]


@router.get("/opportunities/flagged", response_model=list[OpportunityForReview])
async def get_flagged_opportunities(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get flagged opportunities requiring attention."""
    query = (
        select(Opportunity)
        .options(joinedload(Opportunity.poster))
        .where(Opportunity.status == OpportunityStatus.FLAGGED)
        .order_by(Opportunity.created_at.desc())
    )

    result = await db.execute(query)
    opportunities = result.scalars().unique().all()

    return [
        OpportunityForReview(
            id=opp.id,
            title=opp.title,
            description=opp.description,
            opportunity_type=opp.opportunity_type.value,
            status=opp.status.value,
            poster_id=opp.poster_id,
            poster_name=opp.poster.name if opp.poster else None,
            poster_email=opp.poster.email if opp.poster else None,
            is_verified=opp.is_verified,
            view_count=opp.view_count,
            application_count=opp.application_count,
            created_at=opp.created_at,
            published_at=opp.published_at,
            flags=[],
        )
        for opp in opportunities
    ]


@router.post("/opportunities/{opportunity_id}/moderate")
async def moderate_opportunity(
    opportunity_id: int,
    request: ModerationRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Apply moderation action to an opportunity."""
    query = select(Opportunity).where(Opportunity.id == opportunity_id)
    result = await db.execute(query)
    opportunity = result.scalar_one_or_none()

    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    action = request.action

    if action == ModerationAction.APPROVE:
        opportunity.status = OpportunityStatus.ACTIVE
        opportunity.is_verified = True
        opportunity.published_at = datetime.now(UTC)
        opportunity.expires_at = datetime.now(UTC) + timedelta(days=30)

    elif action == ModerationAction.REJECT:
        opportunity.status = OpportunityStatus.CLOSED
        # TODO: Send notification to poster with reason

    elif action == ModerationAction.FLAG:
        opportunity.status = OpportunityStatus.FLAGGED
        # TODO: Add flag reason to moderation_flags

    elif action == ModerationAction.UNFLAG:
        opportunity.status = OpportunityStatus.ACTIVE

    elif action == ModerationAction.FEATURE:
        opportunity.is_featured = True

    elif action == ModerationAction.UNFEATURE:
        opportunity.is_featured = False

    elif action == ModerationAction.CLOSE:
        opportunity.status = OpportunityStatus.CLOSED

    await db.commit()

    return {
        "message": f"Opportunity {action.value}d successfully",
        "opportunity_id": opportunity_id,
        "new_status": opportunity.status.value,
    }


# =============================================================================
# POSTER VERIFICATION
# =============================================================================


@router.get("/posters/unverified", response_model=list[PosterForVerification])
async def get_unverified_posters(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get posters who need verification."""
    # Find users who have posted opportunities but aren't verified
    query = text("""
        SELECT DISTINCT u.id, u.name, u.email, u.created_at,
            (SELECT COUNT(*) FROM opportunities WHERE poster_id = u.id) as opp_count
        FROM users u
        JOIN opportunities o ON o.poster_id = u.id
        WHERE u.id NOT IN (
            SELECT user_id FROM verifications WHERE is_verified = true
        )
        ORDER BY opp_count DESC
    """)

    result = await db.execute(query)
    rows = result.fetchall()

    posters = []
    for row in rows:
        # Get pending verifications
        ver_query = select(Verification).where(Verification.user_id == row.id)
        ver_result = await db.execute(ver_query)
        verifications = ver_result.scalars().all()

        posters.append(
            PosterForVerification(
                user_id=row.id,
                name=row.name,
                email=row.email,
                opportunities_posted=row.opp_count,
                verifications=[
                    {
                        "type": v.verification_type.value,
                        "is_verified": v.is_verified,
                        "created_at": v.created_at.isoformat(),
                    }
                    for v in verifications
                ],
                created_at=row.created_at,
            )
        )

    return posters


@router.post("/posters/{user_id}/verify")
async def verify_poster(
    user_id: int,
    request: VerifyPosterRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Verify a poster."""
    # Check if verification exists
    ver_type = VerificationType(request.verification_type)
    query = select(Verification).where(
        Verification.user_id == user_id,
        Verification.verification_type == ver_type,
    )
    result = await db.execute(query)
    verification = result.scalar_one_or_none()

    if verification:
        verification.is_verified = request.is_approved
        verification.verified_at = datetime.now(UTC) if request.is_approved else None
        verification.verified_by_id = admin.id
    else:
        verification = Verification(
            user_id=user_id,
            verification_type=ver_type,
            is_verified=request.is_approved,
            verified_at=datetime.now(UTC) if request.is_approved else None,
            verified_by_id=admin.id,
        )
        db.add(verification)

    await db.commit()

    # If approved, auto-verify all their pending opportunities
    if request.is_approved:
        await db.execute(
            text("""
                UPDATE opportunities
                SET is_verified = true, status = 'ACTIVE',
                    published_at = COALESCE(published_at, NOW())
                WHERE poster_id = :user_id AND status = 'PENDING_REVIEW'
            """),
            {"user_id": user_id},
        )
        await db.commit()

    return {
        "message": "Poster verification updated",
        "user_id": user_id,
        "verification_type": request.verification_type,
        "is_verified": request.is_approved,
    }


# =============================================================================
# REPORTS MANAGEMENT
# =============================================================================


@router.get("/reports/pending")
async def get_pending_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get pending reports for review."""
    query = (
        select(Report)
        .options(
            joinedload(Report.reporter),
            joinedload(Report.reported_user),
            joinedload(Report.reported_opportunity),
        )
        .where(Report.status == ReportStatus.PENDING)
        .order_by(Report.created_at.desc())
    )

    result = await db.execute(query)
    reports = result.scalars().unique().all()

    return [
        {
            "id": r.id,
            "report_type": r.report_type.value,
            "reason": r.reason,
            "description": r.description,
            "reporter_id": r.reporter_id,
            "reporter_email": r.reporter.email if r.reporter else None,
            "reported_user_id": r.reported_user_id,
            "reported_user_email": r.reported_user.email if r.reported_user else None,
            "reported_opportunity_id": r.reported_opportunity_id,
            "reported_opportunity_title": r.reported_opportunity.title
            if r.reported_opportunity
            else None,
            "created_at": r.created_at,
        }
        for r in reports
    ]


@router.post("/reports/{report_id}/resolve")
async def resolve_report(
    report_id: int,
    resolution: str,  # "dismiss", "warn", "ban"
    notes: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Resolve a report."""
    query = select(Report).where(Report.id == report_id)
    result = await db.execute(query)
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if resolution == "dismiss":
        report.status = ReportStatus.DISMISSED
    elif resolution in ("warn", "ban"):
        report.status = ReportStatus.ACTION_TAKEN

        # Apply action to reported user
        if report.reported_user_id:
            user_query = select(User).where(User.id == report.reported_user_id)
            user_result = await db.execute(user_query)
            reported_user = user_result.scalar_one_or_none()

            if reported_user:
                if resolution == "ban":
                    reported_user.is_shadow_banned = True
                # Add to moderation flags
                flags = reported_user.moderation_flags or []
                flags.append(
                    {
                        "type": resolution,
                        "report_id": report_id,
                        "at": datetime.now(UTC).isoformat(),
                        "by": admin.id,
                    }
                )
                reported_user.moderation_flags = flags

    report.resolved_at = datetime.now(UTC)
    report.resolved_by_id = admin.id
    report.resolution_notes = notes

    await db.commit()

    return {
        "message": "Report resolved",
        "report_id": report_id,
        "resolution": resolution,
    }


# =============================================================================
# LIBRARY MANAGEMENT
# =============================================================================

import re
from pathlib import Path

from fastapi import BackgroundTasks, File, Form, UploadFile

from ..constants.subjects import normalize_subject_name
from ..models import LibraryUploadJob, UploadJobStatus
from ..services.admin_upload_service import process_background_upload

# opensamga round-3 (2026-05-15) audit hardened the admin library upload:
#   * Hard size cap (200 MiB) so a compromised admin token cannot fill
#     disk with a single chunked POST.
#   * Magic-byte verification — file MUST start with `%PDF-` before we
#     persist a single byte beyond the first chunk. Defends against an
#     attacker who labels an arbitrary blob as `application/pdf`.
#   * Filename always sanitized — even when the user supplies a `title`
#     the regex did not cover the no-title branch, which let the raw
#     ``file.filename`` flow into the path join.
MAX_LIBRARY_PDF_BYTES = 200 * 1024 * 1024
_PDF_MAGIC = b"%PDF-"


def _sanitize_library_filename(raw: str) -> str:
    """Lowercased ASCII/Cyrillic-letter-only stem + `.pdf` extension."""
    stem = re.sub(r"[^a-zA-Z0-9_\-а-яА-ЯёЁІіҢңҒғҮүҰұҚқӨөҺһ]", "_", raw.strip())
    stem = re.sub(r"_+", "_", stem).strip("_").lower()
    if not stem:
        stem = "upload"
    return f"{stem}.pdf"


@router.post("/library/upload")
async def upload_library_book(
    background_tasks: BackgroundTasks,
    subject: str = Form(...),
    grade: int = Form(...),
    title: str = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Upload a scanned book and start the OCR/Ingestion pipeline."""
    # 1. Determine filename — always sanitized.
    raw_name = title.strip() if title and title.strip() else (file.filename or "upload")
    filename = _sanitize_library_filename(raw_name)

    # 2. Save file to disk with streaming size cap + magic-byte check.
    canonical_subject = normalize_subject_name(subject)
    backend_dir = Path(__file__).resolve().parent.parent.parent
    raw_library_dir = (
        backend_dir.parent / "dataset" / "raw_library" / canonical_subject / str(grade)
    )
    raw_library_dir.mkdir(parents=True, exist_ok=True)

    file_path = raw_library_dir / filename
    bytes_written = 0
    first_chunk = True
    try:
        with open(file_path, "wb") as buffer:
            while True:
                chunk = await file.read(256 * 1024)
                if not chunk:
                    break
                if first_chunk:
                    if not chunk.startswith(_PDF_MAGIC):
                        buffer.close()
                        file_path.unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=415,
                            detail="Uploaded file is not a PDF (missing %PDF- magic).",
                        )
                    first_chunk = False
                bytes_written += len(chunk)
                if bytes_written > MAX_LIBRARY_PDF_BYTES:
                    buffer.close()
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"PDF exceeds {MAX_LIBRARY_PDF_BYTES // (1024 * 1024)} MiB cap.",
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        file_path.unlink(missing_ok=True)
        logger.exception(
            "library upload save failed admin_id=%s path=%s",
            admin.id,
            file_path,
        )
        raise HTTPException(status_code=500, detail="Failed to save uploaded PDF.") from exc

    # 3. Track job in DB
    job = LibraryUploadJob(
        filename=filename, subject=subject, grade=grade, status=UploadJobStatus.PENDING
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # 3. Spawn background job
    background_tasks.add_task(process_background_upload, job.id, str(file_path))

    return {"message": "Upload started", "job_id": job.id, "filename": file.filename}


@router.get("/library/jobs")
async def get_library_jobs(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get recent library upload jobs status."""
    query = select(LibraryUploadJob).order_by(LibraryUploadJob.created_at.desc()).limit(limit)
    result = await db.execute(query)
    jobs = result.scalars().all()

    return [
        {
            "id": j.id,
            "filename": j.filename,
            "subject": j.subject,
            "grade": j.grade,
            "status": j.status.value,
            "logs": j.logs,
            "created_at": j.created_at,
            "completed_at": j.completed_at,
        }
        for j in jobs
    ]


@router.get("/library/textbooks")
async def get_library_textbooks(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get list of all successfully ingested textbooks from the vector DB."""
    from ..models import Textbook

    query = select(Textbook).order_by(Textbook.subject, Textbook.grade, Textbook.title)
    result = await db.execute(query)
    textbooks = result.scalars().all()

    return [
        {
            "id": t.id,
            "title": t.title,
            "subject": t.subject,
            "grade": t.grade,
            "file_name": t.file_name,
            "total_pages": t.total_pages,
            "total_chunks": t.total_chunks,
            "created_at": t.created_at,
            "updated_at": t.updated_at,
        }
        for t in textbooks
    ]


# =============================================================================
# BULK DATA IMPORT ENDPOINTS
# =============================================================================


@router.post("/import/universities")
async def import_universities(
    data: list[dict],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Bulk import universities from JSON array."""
    try:
        imported = 0
        skipped = 0
        errors = []

        for item in data:
            try:
                university_code = item.get("university_code")
                if not university_code:
                    errors.append(f"Missing university_code in item: {item}")
                    continue

                # Check if exists
                query = select(UniversityDetail).where(
                    UniversityDetail.university_code == university_code
                )
                result = await db.execute(query)
                existing = result.scalar_one_or_none()

                if existing:
                    # Update
                    existing.full_name = item.get("full_name", existing.full_name)
                    existing.website = item.get("website", existing.website)
                    existing.search_keywords = item.get("search_keywords", existing.search_keywords)
                    skipped += 1
                else:
                    # Insert
                    university = UniversityDetail(
                        full_name=item.get("full_name"),
                        university_code=university_code,
                        website=item.get("website"),
                        search_keywords=item.get("search_keywords"),
                    )
                    db.add(university)
                    imported += 1
            except Exception as e:
                errors.append(
                    f"Error processing {item.get('university_code', 'unknown')}: {str(e)}"
                )

        await db.commit()
        return {"imported": imported, "skipped": skipped, "errors": errors}
    except Exception as e:
        logger.exception("admin import universities failed")
        raise HTTPException(status_code=500, detail="Import failed") from e


@router.post("/import/acceptance-scores")
async def import_acceptance_scores(
    data: list[dict],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Bulk import acceptance scores from JSON array."""
    try:
        imported = 0
        skipped = 0
        errors = []

        for item in data:
            try:
                university_code = item.get("university_code")
                major_code = item.get("major_code")
                year = item.get("year")
                quota_type = item.get("quota_type")

                if not all([university_code, major_code, year, quota_type]):
                    errors.append(f"Missing required fields in item: {item}")
                    continue

                # Check if exists
                query = select(AcceptanceScore).where(
                    AcceptanceScore.university_code == university_code,
                    AcceptanceScore.major_code == major_code,
                    AcceptanceScore.year == year,
                    AcceptanceScore.quota_type == quota_type,
                )
                result = await db.execute(query)
                existing = result.scalar_one_or_none()

                if existing:
                    skipped += 1
                else:
                    score = AcceptanceScore(
                        university_code=university_code,
                        major_code=major_code,
                        year=year,
                        quota_type=quota_type,
                        min_score=item.get("min_score"),
                        grants_awarded=item.get("grants_awarded"),
                    )
                    db.add(score)
                    imported += 1
            except Exception as e:
                errors.append(f"Error processing score: {str(e)}")

        await db.commit()
        return {"imported": imported, "skipped": skipped, "errors": errors}
    except Exception as e:
        logger.exception("admin import acceptance scores failed")
        raise HTTPException(status_code=500, detail="Import failed") from e


@router.post("/import/questions")
async def import_questions(
    data: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Bulk import questions from JSON matching database/*.json format."""
    try:
        imported = 0
        skipped = 0
        errors = []

        subjects = data.get("subjects", [])

        for subject_data in subjects:
            subject_name = subject_data.get("subject_name_ru", "Unknown")
            questions = subject_data.get("questions", [])

            for q in questions:
                try:
                    source_id = q.get("question_id")
                    if not source_id:
                        errors.append("Missing question_id in question")
                        continue

                    # Check if exists
                    query = select(ExamQuestion).where(ExamQuestion.source_id == source_id)
                    result = await db.execute(query)
                    existing = result.scalar_one_or_none()

                    if existing:
                        skipped += 1
                    else:
                        question = ExamQuestion(
                            subject=subject_name,
                            source_id=source_id,
                            format=q.get("format", "single_choice"),
                            max_points=q.get("max_points", 1),
                            question_text_kz=q.get("question_text_kz", ""),
                            question_text_ru=q.get("question_text_ru", ""),
                            options_kz=q.get("options_kz", []),
                            options_ru=q.get("options_ru", []),
                            correct_answers_indices=q.get("correct_answers_indices", []),
                        )
                        db.add(question)
                        imported += 1
                except Exception as e:
                    errors.append(
                        f"Error processing question {q.get('question_id', 'unknown')}: {str(e)}"
                    )

        await db.commit()
        return {"imported": imported, "skipped": skipped, "errors": errors}
    except Exception as e:
        logger.exception("admin import questions failed")
        raise HTTPException(status_code=500, detail="Import failed") from e


# =============================================================================
# EXAM QUESTION MANAGEMENT
# =============================================================================


class ExamQuestionUpdate(BaseModel):
    """Schema for updating exam questions."""

    question_text_kz: str | None = None
    question_text_ru: str | None = None
    options_kz: list[str] | None = None
    options_ru: list[str] | None = None
    correct_answers_indices: list[int] | None = None


@router.get("/questions")
async def list_exam_questions(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    subject: str | None = Query(None),
    format: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List exam questions with pagination and optional filters."""
    query = select(ExamQuestion)

    # Apply filters
    if subject:
        query = query.where(ExamQuestion.subject == subject)
    if format:
        query = query.where(ExamQuestion.format == format)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply pagination
    offset = (page - 1) * limit
    query = query.order_by(ExamQuestion.id).offset(offset).limit(limit)

    result = await db.execute(query)
    questions = result.scalars().all()

    pages = (total + limit - 1) // limit if total > 0 else 1

    return {
        "items": [
            {
                "id": q.id,
                "subject": q.subject,
                "source_id": q.source_id,
                "format": q.format,
                "max_points": q.max_points,
                "question_text_kz": q.question_text_kz,
                "question_text_ru": q.question_text_ru,
                "options_kz": q.options_kz,
                "options_ru": q.options_ru,
                "correct_answers_indices": q.correct_answers_indices,
            }
            for q in questions
        ],
        "total": total,
        "page": page,
        "pages": pages,
    }


@router.get("/questions/{question_id}")
async def get_exam_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get a single exam question by ID."""
    query = select(ExamQuestion).where(ExamQuestion.id == question_id)
    result = await db.execute(query)
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    return {
        "id": question.id,
        "subject": question.subject,
        "source_id": question.source_id,
        "format": question.format,
        "max_points": question.max_points,
        "question_text_kz": question.question_text_kz,
        "question_text_ru": question.question_text_ru,
        "options_kz": question.options_kz,
        "options_ru": question.options_ru,
        "correct_answers_indices": question.correct_answers_indices,
    }


@router.patch("/questions/{question_id}")
async def update_exam_question(
    question_id: int,
    update_data: ExamQuestionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update an exam question."""
    query = select(ExamQuestion).where(ExamQuestion.id == question_id)
    result = await db.execute(query)
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    # Apply updates
    if update_data.question_text_kz is not None:
        question.question_text_kz = update_data.question_text_kz
    if update_data.question_text_ru is not None:
        question.question_text_ru = update_data.question_text_ru
    if update_data.options_kz is not None:
        question.options_kz = update_data.options_kz
    if update_data.options_ru is not None:
        question.options_ru = update_data.options_ru
    if update_data.correct_answers_indices is not None:
        # Validate indices
        max_idx_kz = len(question.options_kz) - 1 if question.options_kz else 0
        max_idx_ru = len(question.options_ru) - 1 if question.options_ru else 0
        max_idx = max(max_idx_kz, max_idx_ru)

        for idx in update_data.correct_answers_indices:
            if idx < 0 or idx > max_idx:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid answer index {idx}. Must be between 0 and {max_idx}",
                )

        question.correct_answers_indices = update_data.correct_answers_indices

    await db.commit()
    await db.refresh(question)

    return {
        "id": question.id,
        "subject": question.subject,
        "source_id": question.source_id,
        "format": question.format,
        "max_points": question.max_points,
        "question_text_kz": question.question_text_kz,
        "question_text_ru": question.question_text_ru,
        "options_kz": question.options_kz,
        "options_ru": question.options_ru,
        "correct_answers_indices": question.correct_answers_indices,
    }


@router.delete("/questions/{question_id}", status_code=204)
async def delete_exam_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete an exam question."""
    query = select(ExamQuestion).where(ExamQuestion.id == question_id)
    result = await db.execute(query)
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    await db.delete(question)
    await db.commit()

    return None


# =============================================================================
# UNIVERSITY CRUD
# =============================================================================

from math import ceil


@router.get("/universities")
async def list_universities(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List universities with pagination and search."""
    query = select(UniversityDetail)

    if search:
        search_filter = or_(
            UniversityDetail.full_name.ilike(f"%{search}%"),
            UniversityDetail.university_code.ilike(f"%{search}%"),
            UniversityDetail.search_keywords.ilike(f"%{search}%"),
        )
        query = query.where(search_filter)

    total = await db.scalar(select(func.count()).select_from(query.subquery()))

    query = query.offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": u.id,
                "full_name": u.full_name,
                "university_code": u.university_code,
                "website": u.website,
                "total_students": u.total_students,
                "grant_students": u.grant_students,
                "paid_students": u.paid_students,
                "military_chair": u.military_chair,
                "has_dorm": u.has_dorm,
                "contacts_raw": u.contacts_raw,
                "source_url": u.source_url,
                "search_keywords": u.search_keywords,
            }
            for u in items
        ],
        "total": total or 0,
        "page": page,
        "pages": ceil((total or 0) / limit),
    }


@router.get("/universities/{id}")
async def get_university(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get single university by ID."""
    result = await db.execute(select(UniversityDetail).where(UniversityDetail.id == id))
    university = result.scalar_one_or_none()

    if not university:
        raise HTTPException(status_code=404, detail="University not found")

    return {
        "id": university.id,
        "full_name": university.full_name,
        "university_code": university.university_code,
        "website": university.website,
        "total_students": university.total_students,
        "grant_students": university.grant_students,
        "paid_students": university.paid_students,
        "military_chair": university.military_chair,
        "has_dorm": university.has_dorm,
        "contacts_raw": university.contacts_raw,
        "source_url": university.source_url,
        "search_keywords": university.search_keywords,
    }


@router.patch("/universities/{id}")
async def update_university(
    id: int,
    updates: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update university fields."""
    result = await db.execute(select(UniversityDetail).where(UniversityDetail.id == id))
    university = result.scalar_one_or_none()

    if not university:
        raise HTTPException(status_code=404, detail="University not found")

    for key, value in updates.items():
        if hasattr(university, key):
            setattr(university, key, value)

    await db.commit()
    await db.refresh(university)

    return {
        "id": university.id,
        "full_name": university.full_name,
        "university_code": university.university_code,
        "website": university.website,
        "total_students": university.total_students,
        "grant_students": university.grant_students,
        "paid_students": university.paid_students,
        "military_chair": university.military_chair,
        "has_dorm": university.has_dorm,
        "contacts_raw": university.contacts_raw,
        "source_url": university.source_url,
        "search_keywords": university.search_keywords,
    }


@router.delete("/universities/{id}")
async def delete_university(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete university by ID."""
    result = await db.execute(select(UniversityDetail).where(UniversityDetail.id == id))
    university = result.scalar_one_or_none()

    if not university:
        raise HTTPException(status_code=404, detail="University not found")

    await db.delete(university)
    await db.commit()

    return {"status": "deleted"}


# =============================================================================
# ACCEPTANCE SCORE CRUD
# =============================================================================


@router.get("/acceptance-scores")
async def list_acceptance_scores(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    university_code: str = Query(""),
    major_code: str = Query(""),
    year: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List acceptance scores with pagination and filters."""
    query = select(AcceptanceScore)

    if university_code:
        query = query.where(AcceptanceScore.university_code == university_code)
    if major_code:
        query = query.where(AcceptanceScore.major_code == major_code)
    if year:
        query = query.where(AcceptanceScore.year == year)

    total = await db.scalar(select(func.count()).select_from(query.subquery()))

    query = query.offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": s.id,
                "university_code": s.university_code,
                "major_code": s.major_code,
                "year": s.year,
                "quota_type": s.quota_type,
                "min_score": s.min_score,
                "grants_awarded": s.grants_awarded,
                "created_at": s.created_at,
            }
            for s in items
        ],
        "total": total or 0,
        "page": page,
        "pages": ceil((total or 0) / limit),
    }


@router.get("/acceptance-scores/{id}")
async def get_acceptance_score(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get single acceptance score by ID."""
    result = await db.execute(select(AcceptanceScore).where(AcceptanceScore.id == id))
    score = result.scalar_one_or_none()

    if not score:
        raise HTTPException(status_code=404, detail="Acceptance score not found")

    return {
        "id": score.id,
        "university_code": score.university_code,
        "major_code": score.major_code,
        "year": score.year,
        "quota_type": score.quota_type,
        "min_score": score.min_score,
        "grants_awarded": score.grants_awarded,
        "created_at": score.created_at,
    }


@router.patch("/acceptance-scores/{id}")
async def update_acceptance_score(
    id: int,
    updates: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update acceptance score fields."""
    result = await db.execute(select(AcceptanceScore).where(AcceptanceScore.id == id))
    score = result.scalar_one_or_none()

    if not score:
        raise HTTPException(status_code=404, detail="Acceptance score not found")

    for key, value in updates.items():
        if hasattr(score, key):
            setattr(score, key, value)

    await db.commit()
    await db.refresh(score)

    return {
        "id": score.id,
        "university_code": score.university_code,
        "major_code": score.major_code,
        "year": score.year,
        "quota_type": score.quota_type,
        "min_score": score.min_score,
        "grants_awarded": score.grants_awarded,
        "created_at": score.created_at,
    }


@router.delete("/acceptance-scores/{id}")
async def delete_acceptance_score(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete acceptance score by ID."""
    result = await db.execute(select(AcceptanceScore).where(AcceptanceScore.id == id))
    score = result.scalar_one_or_none()

    if not score:
        raise HTTPException(status_code=404, detail="Acceptance score not found")

    await db.delete(score)
    await db.commit()

    return {"status": "deleted"}


# =============================================================================
# s25 chat A/B telemetry: legacy two-call vs streaming agent loop
# =============================================================================
#
# `chat_messages.message_metadata` carries `chat_path ∈ {legacy, agent}` for
# every assistant turn since 2026-04-26. This endpoint slices the JSONB
# column and returns simple counts so the dashboard can compare the two
# code paths side-by-side without us shipping a migration just for stats.


@router.get("/chat/path-breakdown")
async def chat_path_breakdown(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Compare legacy vs agent chat-path turns over the last N days.

    Returns:
        {
          "window_days": 7,
          "rows": [
            {"chat_path": "agent", "turns": 142,
             "with_citation": 81, "citation_pct": 57.0,
             "avg_tool_calls": 1.8, "avg_len_chars": 922},
            {"chat_path": "legacy", ...}
          ]
        }

    `with_citation` = turns whose metadata.book_id is non-null. That is
    our practical proxy for "the assistant grounded its answer in a
    library page" — a higher rate is better, all else equal.
    """
    rows_q = await db.execute(
        text(
            """
            SELECT
                COALESCE(message_metadata->>'chat_path', 'unknown') AS chat_path,
                COUNT(*) AS turns,
                COUNT(*) FILTER (
                    WHERE message_metadata->>'book_id' IS NOT NULL
                ) AS with_citation,
                AVG((message_metadata->>'tool_calls_count')::int) AS avg_tool_calls,
                AVG(LENGTH(content)) AS avg_len_chars
            FROM chat_messages
            WHERE role = 'assistant'
              AND created_at > now() - (:days || ' days')::interval
            GROUP BY 1
            ORDER BY turns DESC
            """
        ),
        {"days": str(days)},
    )
    out = []
    for r in rows_q.mappings().all():
        turns = int(r["turns"] or 0)
        with_cit = int(r["with_citation"] or 0)
        out.append(
            {
                "chat_path": r["chat_path"],
                "turns": turns,
                "with_citation": with_cit,
                "citation_pct": round(100.0 * with_cit / turns, 1) if turns else 0.0,
                "avg_tool_calls": (
                    round(float(r["avg_tool_calls"]), 2)
                    if r["avg_tool_calls"] is not None
                    else None
                ),
                "avg_len_chars": (int(r["avg_len_chars"]) if r["avg_len_chars"] is not None else 0),
            }
        )
    return {"window_days": days, "rows": out}


# =============================================================================
# v3.11 (I1+I2, 2026-04-30): trust-signal weekly roll-up
# =============================================================================
#
# I1 (per-message redaction count surfaced into metadata) is already
# satisfied at the persistence layer — `routers/chat.py` writes
# `unverified_score_claims_redacted`, `consulted_sources`,
# `failed_tool_calls`, and `is_general_knowledge` into
# `chat_messages.message_metadata` for every assistant turn since
# s28-s30. This endpoint slices those JSONB fields into ops-readable
# aggregates so the dashboard can answer "how many turns had a
# redaction, a failed tool call, fell back to general knowledge, or
# grounded in a library source?".
#
# All wire-shape + percentage math lives in
# `app.services.trust_signal_rollup` so it's vitest-pinnable
# without booting a DB.


@router.get("/chat/trust-signal-rollup")
async def chat_trust_signal_rollup(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Roll-up of trust-signal metadata over the last N days.

    Returns a payload like:
        {
          "window_days": 7,
          "rows": [
            {"bucket": "agent", "turns": 142,
             "redactions_total": 11, "turns_with_redaction": 8,
             "redaction_pct": 5.6, "turns_with_failed_tool": 3,
             "failed_tool_pct": 2.1, "turns_general_knowledge": 31,
             "general_knowledge_pct": 21.8, "turns_with_sources": 84,
             "sourced_pct": 59.2, "avg_redactions": 0.08},
            ...
          ],
          "totals": {...}
        }

    Buckets are `chat_path` (agent / legacy / unknown). Percentages
    are computed via `safe_pct` (zero-div safe, one decimal place)
    so the dashboard can render them straight without re-formatting.
    """
    from ..services.trust_signal_rollup import build_rollup_payload

    rows_q = await db.execute(
        text(
            """
            SELECT
                COALESCE(message_metadata->>'chat_path', 'unknown') AS bucket,
                COUNT(*) AS turns,
                COALESCE(SUM(
                    NULLIF(message_metadata->>'unverified_score_claims_redacted', '')::int
                ), 0) AS redactions_total,
                COUNT(*) FILTER (
                    WHERE NULLIF(
                        message_metadata->>'unverified_score_claims_redacted', ''
                    )::int > 0
                ) AS turns_with_redaction,
                COUNT(*) FILTER (
                    WHERE message_metadata->'failed_tool_calls' IS NOT NULL
                      AND jsonb_typeof(message_metadata::jsonb->'failed_tool_calls') = 'array'
                      AND jsonb_array_length(message_metadata::jsonb->'failed_tool_calls') > 0
                ) AS turns_with_failed_tool,
                COUNT(*) FILTER (
                    WHERE (message_metadata->>'is_general_knowledge')::bool IS TRUE
                ) AS turns_general_knowledge,
                COUNT(*) FILTER (
                    WHERE message_metadata->'consulted_sources' IS NOT NULL
                      AND jsonb_typeof(message_metadata::jsonb->'consulted_sources') = 'array'
                      AND jsonb_array_length(message_metadata::jsonb->'consulted_sources') > 0
                ) AS turns_with_sources,
                AVG(
                    NULLIF(message_metadata->>'unverified_score_claims_redacted', '')::int
                ) AS avg_redactions
            FROM chat_messages
            WHERE role = 'assistant'
              AND created_at > now() - (:days || ' days')::interval
            GROUP BY 1
            """
        ),
        {"days": str(days)},
    )
    rows = list(rows_q.mappings().all())
    return build_rollup_payload(window_days=days, rows=rows)


# =============================================================================
# RETAKE GUIDE — testing.kz fetch observability
# =============================================================================
#
# v3.34: surface the in-process ``_FETCH_STATS`` from
# ``app/services/retake_guide.py`` (introduced in v3.32) through the
# admin gate. Operators can now answer "is the live testing.kz fetch
# actually working?" without shelling into a worker. The signal is
# load-bearing because the URL has been unreachable in prod for
# weeks (see project_session_2026-05-01_v332/v333 memory) — this
# endpoint is the canonical way to confirm it.
#
# The endpoint is read-only and is gated by ``require_admin`` (the
# canonical gate from v3.3). It returns the dict shape exactly as
# ``get_fetch_stats()`` produces it so a future alert can consume it
# without translation.


@router.get("/retake-guide/fetch-stats")
async def admin_retake_guide_fetch_stats(_: User = Depends(require_admin)):
    """Return testing.kz fetch counters for the current worker.

    The dict shape is fixed by the service layer:

        {
          "success_count": int,
          "failure_count": int,
          "last_success_at": float | None,  # epoch seconds
          "last_failure_at": float | None,  # epoch seconds
          "last_failure_reason": str | None # e.g. "httpx_ConnectError"
        }

    These counters are per-process, so in a multi-worker deploy each
    worker reports its own slice. That's acceptable for a
    "is-anything-succeeding" signal — if every worker reports
    ``success_count == 0`` after hours of traffic, the live fetch
    is dead and ops should set ``TESTING_KZ_SCHEDULE_URL`` (v3.33)
    to a working mirror.
    """
    from ..services.retake_guide import TESTING_KZ_SCHEDULE_URL, get_fetch_stats

    stats = get_fetch_stats()
    return {
        "schedule_url": TESTING_KZ_SCHEDULE_URL,
        "stats": stats,
    }
