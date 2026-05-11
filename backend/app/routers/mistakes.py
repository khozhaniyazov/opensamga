"""
app/routers/mistakes.py
-----------------------
Smart Mistake Killer API Router

Handles mistake analysis requests:
- Analyzes student mistakes
- Generates AI diagnosis
- Creates remedial practice questions
- Batch creation for exam mistakes (Gap Closer System)
"""

import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies.plan_guards import require_premium
from ..models import MistakeReview, User
from ..services.gap_analyzer import get_recent_practice_summary
from ..services.mistake_service import process_mistake

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mistakes", tags=["mistakes"])

# --- PYDANTIC SCHEMAS ---


class MistakeRequest(BaseModel):
    """Request model for mistake analysis."""

    question_data: dict  # The full question object
    user_answer: str
    correct_answer: str


class MistakeResponse(BaseModel):
    """Response model for mistake analysis."""

    id: int
    user_id: int
    ai_diagnosis: str
    library_citation: dict | None
    remedial_questions: list
    is_resolved: bool
    created_at: str
    # New Gap Closer fields
    topic_tag: str | None = None
    question_type: str | None = None
    points_lost: int = 1

    model_config = ConfigDict(from_attributes=True)


class ExamMistake(BaseModel):
    """A single mistake from an exam."""

    question_id: int | str
    question_text: str
    options: dict[str, str]  # {"A": "...", "B": "..."}
    user_answer: list[str]  # What user selected
    correct_answer: list[str]  # What was correct
    subject: str | None = None
    topic_tag: str | None = None


class BatchMistakeRequest(BaseModel):
    """Request model for batch creating exam mistakes."""

    mistakes: list[ExamMistake]


class BatchMistakeResponse(BaseModel):
    """Response for batch mistake creation."""

    created_count: int
    skipped_count: int
    mistake_ids: list[int]


def _has_meaningful_exam_answer(answer: list[str]) -> bool:
    return any(str(item or "").strip() for item in answer or [])


# --- Trend / Recommendation / List response models ---


class MistakeTrendPoint(BaseModel):
    """A single data point in the daily mistake trend."""

    date: str  # YYYY-MM-DD
    total: int  # total mistakes on this date
    resolved: int  # resolved mistakes on this date
    unresolved: int  # unresolved mistakes on this date


class MistakeTrendsResponse(BaseModel):
    """Aggregate trend data for charting mistake resolution over time."""

    daily_trends: list[MistakeTrendPoint]
    total_mistakes: int
    total_resolved: int
    total_unresolved: int
    resolution_rate: float  # 0.0 to 1.0


class StudyRecommendation(BaseModel):
    """A single personalized study recommendation based on mistake patterns."""

    topic: str  # topic_tag value
    subject: str | None = None  # extracted from question snapshot
    mistake_count: int  # how many mistakes in this topic
    unresolved_count: int  # how many still unresolved
    priority: str  # "high", "medium", "low"
    recommendation: str  # e.g., "Focus on Algebra — 8 unresolved mistakes"
    last_mistake_date: str | None = None


class PracticeSnapshot(BaseModel):
    session_id: int | None
    subject: str | None
    score: int | None
    max_score: int | None
    updated_at: str | None


class PracticeTrendItem(BaseModel):
    subject: str
    sessions: int
    answered: int
    correct: int
    points_lost: int
    accuracy_rate: float
    latest_updated_at: str | None


class PracticeTrendSummary(BaseModel):
    latest_practice: PracticeSnapshot | None = None
    trends: list[PracticeTrendItem] = Field(default_factory=list)


class RecommendationsResponse(BaseModel):
    """Response containing prioritized study recommendations."""

    recommendations: list[StudyRecommendation]
    total_weak_areas: int
    practice_summary: PracticeTrendSummary | None = None


class MistakeListItem(BaseModel):
    """A single mistake in the paginated list."""

    id: int
    question_text: str  # from original_question_snapshot
    subject: str | None = None
    topic_tag: str | None = None
    question_type: str | None = None
    user_answer: str
    correct_answer: str
    is_resolved: bool
    points_lost: int
    created_at: str
    ai_diagnosis: str | None = None

    model_config = ConfigDict(from_attributes=True)


class MistakeListResponse(BaseModel):
    """Paginated mistake list with filter metadata."""

    mistakes: list[MistakeListItem]
    total: int
    page: int
    page_size: int
    subjects: list[str]  # Available subject values for filter UI
    topics: list[str]  # Available topic_tag values for filter UI


# --- ENDPOINTS ---


@router.post("/analyze", response_model=MistakeResponse, status_code=status.HTTP_201_CREATED)
async def analyze_mistake(
    request: MistakeRequest,
    current_user: User = Depends(require_premium),
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze a student mistake and generate remedial questions.

    This endpoint:
    1. Searches the library for relevant textbook content
    2. Uses AI to diagnose the mistake
    3. Generates 3 remedial practice questions
    4. Saves the analysis to the database

    Args:
        request: MistakeRequest with question_data, user_answer, and correct_answer
        current_user: Authenticated user (from JWT token)
        db: Database session

    Returns:
        MistakeResponse with diagnosis, remedial questions, and citation
    """
    try:
        # Call the mistake service
        mistake_review = await process_mistake(
            db=db,
            user_id=current_user.id,
            question_data=request.question_data,
            user_answer=request.user_answer,
            correct_answer=request.correct_answer,
        )

        # Convert to response model
        return MistakeResponse(
            id=mistake_review.id,
            user_id=mistake_review.user_id,
            ai_diagnosis=mistake_review.ai_diagnosis,
            library_citation=mistake_review.library_citation,
            remedial_questions=mistake_review.remedial_questions or [],
            is_resolved=mistake_review.is_resolved,
            created_at=mistake_review.created_at.isoformat() if mistake_review.created_at else "",
            topic_tag=mistake_review.topic_tag,
            question_type=mistake_review.question_type,
            points_lost=mistake_review.points_lost or 1,
        )

    except Exception as e:
        logger.exception("mistake analysis failed user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to analyze mistake",
        ) from e


@router.post(
    "/batch-create", response_model=BatchMistakeResponse, status_code=status.HTTP_201_CREATED
)
async def batch_create_mistakes(
    request: BatchMistakeRequest,
    current_user: User = Depends(require_premium),
    db: AsyncSession = Depends(get_db),
):
    """
    Batch create mistakes from exam results (Gap Closer System).

    Called by frontend after exam submission for each wrong answer.
    Uses lightweight processing (no AI diagnosis) for performance.
    AI diagnosis can be triggered later on-demand.

    Args:
        request: BatchMistakeRequest with list of exam mistakes

    Returns:
        BatchMistakeResponse with count of created mistakes
    """
    created_count = 0
    skipped_count = 0
    mistake_ids = []

    for exam_mistake in request.mistakes:
        try:
            if not _has_meaningful_exam_answer(exam_mistake.user_answer):
                skipped_count += 1
                continue

            # Build question snapshot
            question_data = {
                "id": exam_mistake.question_id,
                "text": exam_mistake.question_text,
                "question": exam_mistake.question_text,
                "options": exam_mistake.options,
                "subject": exam_mistake.subject,
            }

            # Create lightweight MistakeReview (no AI diagnosis yet)
            mistake_review = MistakeReview(
                user_id=current_user.id,
                original_question_snapshot=question_data,
                user_answer=",".join(exam_mistake.user_answer),
                correct_answer=",".join(exam_mistake.correct_answer),
                ai_diagnosis="Pending analysis",  # Will be filled on-demand
                library_citation=None,
                remedial_questions=None,
                is_resolved=False,
                # Gap Closer System fields
                topic_tag=exam_mistake.topic_tag or exam_mistake.subject,
                textbook_chunk_id=None,  # Exams don't have anchor chunks
                question_type="exam",
                points_lost=1,
                correct_answers_count=0,
            )

            db.add(mistake_review)
            await db.flush()  # Get the ID
            mistake_ids.append(mistake_review.id)
            created_count += 1

        except Exception:
            # Per-mistake failure — keep batch alive (cron-loop pattern):
            # success path is silent here, failure attaches stack so
            # operators can distinguish DB-side errors from data bugs.
            logger.exception("Failed to create exam mistake")
            skipped_count += 1

    await db.commit()

    return BatchMistakeResponse(
        created_count=created_count, skipped_count=skipped_count, mistake_ids=mistake_ids
    )


@router.get("/unresolved", response_model=list[MistakeResponse])
async def get_unresolved_mistakes(
    current_user: User = Depends(require_premium), db: AsyncSession = Depends(get_db)
):
    """
    Get all unresolved mistakes for the current user (Gap Closer System).

    Used by the Gap Analyzer to cluster mistakes by topic.
    """
    result = await db.execute(
        select(MistakeReview)
        .where(MistakeReview.user_id == current_user.id)
        .where(MistakeReview.is_resolved == False)
        .order_by(MistakeReview.created_at.desc())
    )
    mistakes = result.scalars().all()

    return [
        MistakeResponse(
            id=m.id,
            user_id=m.user_id,
            ai_diagnosis=m.ai_diagnosis,
            library_citation=m.library_citation,
            remedial_questions=m.remedial_questions or [],
            is_resolved=m.is_resolved,
            created_at=m.created_at.isoformat() if m.created_at else "",
            topic_tag=m.topic_tag,
            question_type=m.question_type,
            points_lost=m.points_lost or 1,
        )
        for m in mistakes
    ]


@router.get("/trends", response_model=MistakeTrendsResponse)
async def get_mistake_trends(
    current_user: User = Depends(require_premium),
    db: AsyncSession = Depends(get_db),
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
):
    """
    Get daily mistake trend data for charting.

    Returns aggregated counts of total, resolved, and unresolved mistakes
    per day over the specified lookback period, plus overall summary stats.

    Args:
        days: Number of days to look back (default 30, max 365)

    Returns:
        MistakeTrendsResponse with daily_trends list and summary totals
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)

    result = await db.execute(
        select(MistakeReview)
        .where(MistakeReview.user_id == current_user.id)
        .where(MistakeReview.created_at >= cutoff)
        .order_by(MistakeReview.created_at.asc())
    )
    mistakes = result.scalars().all()

    # Group by date in Python (simpler and reliable across async drivers)
    daily_map = defaultdict(lambda: {"total": 0, "resolved": 0, "unresolved": 0})

    total_resolved = 0
    total_unresolved = 0

    for m in mistakes:
        date_key = m.created_at.strftime("%Y-%m-%d") if m.created_at else "unknown"
        daily_map[date_key]["total"] += 1
        if m.is_resolved:
            daily_map[date_key]["resolved"] += 1
            total_resolved += 1
        else:
            daily_map[date_key]["unresolved"] += 1
            total_unresolved += 1

    # Build sorted daily trends
    daily_trends = [
        MistakeTrendPoint(
            date=date_key,
            total=counts["total"],
            resolved=counts["resolved"],
            unresolved=counts["unresolved"],
        )
        for date_key, counts in sorted(daily_map.items())
    ]

    total_mistakes = total_resolved + total_unresolved
    resolution_rate = (total_resolved / total_mistakes) if total_mistakes > 0 else 0.0

    return MistakeTrendsResponse(
        daily_trends=daily_trends,
        total_mistakes=total_mistakes,
        total_resolved=total_resolved,
        total_unresolved=total_unresolved,
        resolution_rate=round(resolution_rate, 4),
    )


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_study_recommendations(
    current_user: User = Depends(require_premium), db: AsyncSession = Depends(get_db)
):
    """
    Generate personalized study recommendations based on mistake patterns.

    Analyzes all of the current user's mistakes, groups by topic_tag,
    and returns prioritized recommendations sorted by unresolved count.

    Priority levels:
    - "high": 5+ unresolved mistakes
    - "medium": 2-4 unresolved mistakes
    - "low": 1 unresolved mistake

    Returns:
        RecommendationsResponse with top 10 recommendations and weak area count
    """
    result = await db.execute(
        select(MistakeReview)
        .where(MistakeReview.user_id == current_user.id)
        .order_by(MistakeReview.created_at.desc())
    )
    mistakes = result.scalars().all()

    # Group by topic_tag
    topic_groups = defaultdict(list)
    for m in mistakes:
        tag = m.topic_tag or "Uncategorized"
        topic_groups[tag].append(m)

    recommendations = []
    for topic, group in topic_groups.items():
        total_count = len(group)
        unresolved_count = sum(1 for m in group if not m.is_resolved)

        # Skip topics with no unresolved mistakes
        if unresolved_count == 0:
            continue

        # Extract subject from first mistake's question snapshot
        subject = "Unknown"
        first_snapshot = group[0].original_question_snapshot
        if isinstance(first_snapshot, dict):
            subject = first_snapshot.get("subject", "Unknown") or "Unknown"

        # Most recent mistake date
        last_date = group[0].created_at
        last_mistake_date = last_date.strftime("%Y-%m-%d") if last_date else None

        # Assign priority
        if unresolved_count >= 5:
            priority = "high"
        elif unresolved_count >= 2:
            priority = "medium"
        else:
            priority = "low"

        recommendation_text = f"Focus on {topic} \u2014 {unresolved_count} unresolved mistake{'s' if unresolved_count != 1 else ''} in {subject}"

        recommendations.append(
            StudyRecommendation(
                topic=topic,
                subject=subject,
                mistake_count=total_count,
                unresolved_count=unresolved_count,
                priority=priority,
                recommendation=recommendation_text,
                last_mistake_date=last_mistake_date,
            )
        )

    # Sort by unresolved_count descending (worst areas first)
    recommendations.sort(key=lambda r: r.unresolved_count, reverse=True)

    # Return top 10
    top_recommendations = recommendations[:10]
    practice_summary = await get_recent_practice_summary(current_user.id, db)

    return RecommendationsResponse(
        recommendations=top_recommendations,
        total_weak_areas=len(recommendations),
        practice_summary=PracticeTrendSummary(**practice_summary),
    )


@router.get("/list", response_model=MistakeListResponse)
async def list_mistakes(
    current_user: User = Depends(require_premium),
    db: AsyncSession = Depends(get_db),
    subject: str | None = Query(None, description="Filter by subject"),
    topic: str | None = Query(None, description="Filter by topic_tag"),
    resolved: bool | None = Query(None, description="Filter by resolved status"),
    question_type: str | None = Query(None, description="Filter by question type"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
):
    """
    List mistakes with filtering and pagination.

    Supports filtering by subject, topic_tag, resolved status, and question_type.
    Returns paginated results plus available filter values for the UI.

    Args:
        subject: Filter by subject (from question snapshot)
        topic: Filter by topic_tag
        resolved: Filter by is_resolved (true/false)
        question_type: Filter by question_type (exam, practice, chat)
        page: Page number (1-indexed)
        page_size: Items per page (1-100, default 20)

    Returns:
        MistakeListResponse with paginated mistakes and filter metadata
    """
    # Build base query
    query = select(MistakeReview).where(MistakeReview.user_id == current_user.id)

    # Apply database-level filters
    if topic:
        query = query.where(MistakeReview.topic_tag == topic)
    if resolved is not None:
        query = query.where(MistakeReview.is_resolved == resolved)
    if question_type:
        query = query.where(MistakeReview.question_type == question_type)

    # Subject is stored in JSON (original_question_snapshot.subject),
    # so we use PostgreSQL JSON operator for filtering when possible,
    # falling back to topic_tag as proxy if JSON query is not feasible.
    if subject:
        # Use PostgreSQL JSON extraction: original_question_snapshot->>'subject'
        query = query.where(MistakeReview.original_question_snapshot["subject"].astext == subject)

    # Order by most recent first
    query = query.order_by(MistakeReview.created_at.desc())

    # Count total matching records (before pagination)
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    paginated_query = query.offset(offset).limit(page_size)

    result = await db.execute(paginated_query)
    mistakes_rows = result.scalars().all()

    # Build response items
    mistake_items = []
    for m in mistakes_rows:
        # Extract question_text and subject from snapshot
        snapshot = m.original_question_snapshot or {}
        q_text = ""
        q_subject = None
        if isinstance(snapshot, dict):
            q_text = (
                snapshot.get("question")
                or snapshot.get("text")
                or snapshot.get("question_text", "")
            )
            q_subject = snapshot.get("subject")

        mistake_items.append(
            MistakeListItem(
                id=m.id,
                question_text=q_text,
                subject=q_subject,
                topic_tag=m.topic_tag,
                question_type=m.question_type,
                user_answer=m.user_answer,
                correct_answer=m.correct_answer,
                is_resolved=m.is_resolved,
                points_lost=m.points_lost or 1,
                created_at=m.created_at.isoformat() if m.created_at else "",
                ai_diagnosis=m.ai_diagnosis,
            )
        )

    # Get available filter values for UI dropdowns
    # Distinct topic_tags
    topics_result = await db.execute(
        select(MistakeReview.topic_tag)
        .where(MistakeReview.user_id == current_user.id)
        .where(MistakeReview.topic_tag.isnot(None))
        .distinct()
    )
    available_topics = sorted([row[0] for row in topics_result.all() if row[0]])

    # Distinct subjects from question snapshots
    # Fetch all snapshots and extract unique subjects (lightweight for moderate data)
    all_snapshots_result = await db.execute(
        select(MistakeReview.original_question_snapshot)
        .where(MistakeReview.user_id == current_user.id)
        .where(MistakeReview.original_question_snapshot.isnot(None))
    )
    subject_set = set()
    for row in all_snapshots_result.all():
        snapshot = row[0]
        if isinstance(snapshot, dict):
            s = snapshot.get("subject")
            if s:
                subject_set.add(s)
    available_subjects = sorted(subject_set)

    return MistakeListResponse(
        mistakes=mistake_items,
        total=total,
        page=page,
        page_size=page_size,
        subjects=available_subjects,
        topics=available_topics,
    )
