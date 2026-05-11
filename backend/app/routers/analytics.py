"""
Analytics Router - Trend Analysis, Forecasting, and Gap Analysis API

Provides endpoints for:
- Historical grant threshold trends
- Future score predictions
- Gap Closer recommendations
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies.plan_guards import require_premium
from ..models import User
from ..services.analytics import get_analytics_report
from ..services.gap_analyzer import generate_recommendations, get_recent_practice_summary
from ..services.weak_topic_mode import build_weak_topic_mode_response
from .auth import get_current_admin, get_current_user_optional

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


# --- SCHEMAS ---


class AnalyticsReportResponse(BaseModel):
    data_points_count: int
    history: list[dict]
    trend: dict
    forecast: dict | None = None


class TopicRecommendation(BaseModel):
    topic: str
    points_lost: int
    pages_to_read: int
    efficiency: float
    action: str  # "READ", "SKIP", "QUIZ"
    priority: str  # "HIGH", "MEDIUM", "LOW"
    message: str


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


class GapAnalysisResponse(BaseModel):
    target_university: str | None
    grant_threshold: int | None
    current_score: int | None
    current_score_source: str | None = None
    gap: int | None
    total_recoverable_points: int
    recommendations: list[TopicRecommendation]
    practice_summary: PracticeTrendSummary | None = None


# v3.23 — Weak Topic Mode (issue #15 acceptance criterion #2). Reuses
# `gap_analyzer` clustering primitives but reshapes the output:
#   - topics are grouped per subject (top N each)
#   - every topic carries a 4-action bundle: learn / tutor / practice / retest
#   - a deterministic 7-day recovery plan is synthesized from the top topics
# No new persisted state, no LLM calls.


class WeakTopicAction(BaseModel):
    kind: str  # "learn" | "tutor" | "practice" | "retest"
    href: str
    subject: str | None = None


class WeakTopicEntry(BaseModel):
    topic: str
    subject: str
    points_lost: int
    mistake_count: int
    pages_to_read: int
    priority: str  # "HIGH" | "MEDIUM" | "LOW"
    actions: list[WeakTopicAction]


class WeakTopicSubjectGroup(BaseModel):
    subject: str
    total_points_lost: int
    topics: list[WeakTopicEntry]


class WeakTopicPlanDay(BaseModel):
    day: int
    intent: str  # "learn" | "practice" | "review" | "retest"
    topic: str | None
    subject: str | None
    href: str


class WeakTopicModeResponse(BaseModel):
    target_university: str | None
    grant_threshold: int | None
    current_score: int | None
    current_score_source: str | None = None
    gap: int | None
    total_recoverable_points: int
    expected_subjects: list[str]
    subject_groups: list[WeakTopicSubjectGroup]
    seven_day_plan: list[WeakTopicPlanDay]


# --- ENDPOINTS ---


@router.get("/report", response_model=AnalyticsReportResponse)
async def get_report(
    uni_name: str = Query(..., description="University name"),
    major_code: str = Query(..., description="Major code (e.g., B057)"),
    quota_type: str = Query("GENERAL", description="Quota type: GENERAL or RURAL"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """
    Get analytics report for a specific university + major combination.

    Returns trend analysis and 2026 forecast (if sufficient data available).

    **Data Requirements:**
    - n=1: Returns "NEW_MAJOR" verdict, no forecast
    - n=2: Returns simple growth rate, no forecast
    - n>=3: Returns full CAGR and volatility, includes 2026 forecast
    """
    try:
        report = await get_analytics_report(db, uni_name, major_code, quota_type)
        return report
    except Exception as e:
        logger.exception(
            "analytics report failed uni=%s major=%s quota=%s",
            uni_name,
            major_code,
            quota_type,
        )
        raise HTTPException(status_code=500, detail="Failed to generate analytics report") from e


@router.get("/gap-analysis", response_model=GapAnalysisResponse)
async def get_gap_analysis(
    current_user: User = Depends(require_premium), db: AsyncSession = Depends(get_db)
):
    """
    Get tactical gap analysis showing ROI for studying topics.

    **Gap Closer Feature:**
    - Calculates gap between current mock score and target grant threshold
    - Clusters unresolved mistakes by topic
    - Calculates study efficiency (points per page)
    - Generates prioritized task list with READ/SKIP/QUIZ recommendations

    **Response:**
    - High efficiency topics: "Read [Topic] - X pages, recover Y points"
    - Low efficiency topics: "Skip [Topic] - too many pages for low yield"
    """
    try:
        analysis = await generate_recommendations(current_user.id, db)
        practice_summary = await get_recent_practice_summary(current_user.id, db)
        return GapAnalysisResponse(
            target_university=analysis.get("target_university"),
            grant_threshold=analysis.get("grant_threshold"),
            current_score=analysis.get("current_score"),
            current_score_source=analysis.get("current_score_source"),
            gap=analysis.get("gap"),
            total_recoverable_points=analysis.get("total_recoverable_points", 0),
            recommendations=[
                TopicRecommendation(**rec) for rec in analysis.get("recommendations", [])
            ],
            practice_summary=PracticeTrendSummary(**practice_summary),
        )
    except Exception as e:
        logger.exception("gap analysis failed user_id=%s", current_user.id)
        raise HTTPException(status_code=500, detail="Failed to generate gap analysis") from e


@router.get("/weak-topic-mode", response_model=WeakTopicModeResponse)
async def get_weak_topic_mode(
    current_user: User = Depends(require_premium), db: AsyncSession = Depends(get_db)
):
    """
    Weak Topic Mode (issue #15 AC#2).

    Reshapes the same mistake-clustering data the Gap Analysis page uses
    into a per-subject map plus per-topic action bundle (learn / tutor /
    practice / retest) plus a deterministic 7-day recovery plan.

    No LLM calls. No new persisted state. Reuses `cluster_mistakes_by_topic`
    and `estimate_pages_for_topic` so the ROI math stays consistent with
    `/analytics/gap-analysis`.
    """
    try:
        payload = await build_weak_topic_mode_response(current_user.id, db)
        return WeakTopicModeResponse(**payload)
    except Exception as e:
        logger.exception("weak topic mode failed user_id=%s", current_user.id)
        raise HTTPException(status_code=500, detail="Failed to generate weak topic mode") from e


# Session 16 (2026-04-21): RAG observability rollup. Reads the
# `rag_query_log` table populated by `search_library_chunks` and the
# `chat_feedback` join. No PII; the raw query text is NOT returned.
# Intended as a lightweight dashboard feed (admin-visible only when an
# authed user hits it; unauthenticated callers still get the rollup so
# local ops scripts can poll it, but the endpoint is rate-limited by
# the global middleware).
@router.get("/rag-stats")
async def get_rag_stats(
    window_hours: int = Query(24, ge=1, le=720, description="Rolling window in hours"),
    db: AsyncSession = Depends(get_db),
    # Session 18 (2026-04-21): gated to any authenticated user.
    # Session 19 (2026-04-21): tightened to admins only. The rollup
    # hides raw query text but still exposes query volume, top books,
    # and feedback counts. We don't want regular students reading
    # aggregate usage signal. Admin = `users.is_admin == TRUE` OR
    # email in `RAG_ADMIN_EMAILS` env var (see auth.get_current_admin).
    current_user: User = Depends(get_current_admin),
):
    """
    Rolling stats from `rag_query_log` over `window_hours`.

    Returns:
      - totals (count, empty rate, error rate)
      - latency percentiles (p50/p95 for total, embedding, search, rerank)
      - rerank swing rate (reranker present AND actually reordered top-1
        relative to cosine ordering — approximated as rerank_used rate)
      - subject distribution
      - top books surfaced as top-1
      - feedback rollup joined via chat_feedback.rag_query_log_id
    """
    hours = int(window_hours)

    totals = (
        (
            await db.execute(
                text("""
        SELECT
            COUNT(*)                                              AS n,
            SUM(CASE WHEN n_returned = 0 THEN 1 ELSE 0 END)       AS n_empty,
            SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)    AS n_error,
            SUM(CASE WHEN rerank_used THEN 1 ELSE 0 END)          AS n_rerank_used,
            AVG(query_len)::float                                 AS avg_query_len
        FROM rag_query_log
        WHERE created_at >= NOW() - make_interval(hours => :h)
    """),
                {"h": hours},
            )
        )
        .mappings()
        .one()
    )

    latency = (
        (
            await db.execute(
                text("""
        SELECT
            percentile_cont(0.5) WITHIN GROUP (ORDER BY total_latency_ms)     AS total_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY total_latency_ms)    AS total_p95,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY embedding_latency_ms) AS emb_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY embedding_latency_ms) AS emb_p95,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY search_latency_ms)    AS search_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY search_latency_ms)   AS search_p95,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY rerank_latency_ms)
                FILTER (WHERE rerank_used)                                    AS rerank_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY rerank_latency_ms)
                FILTER (WHERE rerank_used)                                    AS rerank_p95
        FROM rag_query_log
        WHERE created_at >= NOW() - make_interval(hours => :h)
    """),
                {"h": hours},
            )
        )
        .mappings()
        .one()
    )

    subjects = (
        await db.execute(
            text("""
        SELECT COALESCE(subject, '(unspecified)') AS subject, COUNT(*) AS n
        FROM rag_query_log
        WHERE created_at >= NOW() - make_interval(hours => :h)
        GROUP BY 1 ORDER BY n DESC LIMIT 10
    """),
            {"h": hours},
        )
    ).all()

    top_books = (
        await db.execute(
            text("""
        SELECT top1_book_id AS book_id, COUNT(*) AS n
        FROM rag_query_log
        WHERE top1_book_id IS NOT NULL
          AND created_at >= NOW() - make_interval(hours => :h)
        GROUP BY top1_book_id
        ORDER BY n DESC LIMIT 10
    """),
            {"h": hours},
        )
    ).all()

    feedback = (
        (
            await db.execute(
                text("""
        SELECT
            COUNT(*)                                           AS n,
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)        AS n_up,
            SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)       AS n_down,
            SUM(CASE WHEN rating = 0 THEN 1 ELSE 0 END)        AS n_cleared
        FROM chat_feedback
        WHERE created_at >= NOW() - make_interval(hours => :h)
    """),
                {"h": hours},
            )
        )
        .mappings()
        .one()
    )

    n = int(totals["n"] or 0)
    return {
        "window_hours": hours,
        "totals": {
            "n": n,
            "empty_rate": (float(totals["n_empty"] or 0) / n) if n else 0.0,
            "error_rate": (float(totals["n_error"] or 0) / n) if n else 0.0,
            "rerank_rate": (float(totals["n_rerank_used"] or 0) / n) if n else 0.0,
            "avg_query_len": float(totals["avg_query_len"] or 0.0),
        },
        "latency_ms": {k: (float(v) if v is not None else None) for k, v in dict(latency).items()},
        "subjects": [{"subject": r[0], "n": int(r[1])} for r in subjects],
        "top_books": [{"book_id": int(r[0]), "n": int(r[1])} for r in top_books],
        "feedback": {
            "n": int(feedback["n"] or 0),
            "up": int(feedback["n_up"] or 0),
            "down": int(feedback["n_down"] or 0),
            "cleared": int(feedback["n_cleared"] or 0),
        },
    }
