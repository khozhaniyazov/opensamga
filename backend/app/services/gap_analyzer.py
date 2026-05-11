"""
app/services/gap_analyzer.py
----------------------------
Gap Closer Feature - Analytics Service

Calculates the gap between user's current score and target grant threshold,
clusters mistakes by topic, and generates prioritized recommendations based
on study efficiency (points recovered per pages to read).
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.subjects import (
    get_compulsory_subjects,
    get_max_score,
    normalize_subject_name,
)
from app.models import (
    ExamAttempt,
    HistoricalGrantThreshold,
    MistakeReview,
    PracticeSession,
    StudentProfile,
    Textbook,
    TextbookChunk,
    UniversityData,
    UniversityDetail,
)
from app.services.major_resolver import resolve_major_codes

UNT_MAX_SCORE = 140
RECENT_RELEVANT_MISTAKE_LIMIT = 24
RECENT_PRACTICE_TREND_LOOKBACK_LIMIT = 20
RECENT_EXAM_SCORE_LOOKBACK_LIMIT = 20
MIN_MEANINGFUL_EXAM_COMPLETION_RATIO = 0.35
MIN_REPRESENTATIVE_MOCK_TOTAL_QUESTIONS = 60


def _coerce_int(value) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_quota_type(quota_type: str | None) -> str:
    normalized = str(quota_type or "GENERAL").strip().upper()
    return normalized if normalized in {"GENERAL", "RURAL"} else "GENERAL"


def _normalize_string_filters(values: Sequence[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def count_meaningful_exam_answers(raw_answers: object) -> int:
    if not isinstance(raw_answers, dict):
        return 0

    meaningful = 0
    for value in raw_answers.values():
        if isinstance(value, (list, tuple, set)):
            if any(item not in (None, "", [], {}) for item in value):
                meaningful += 1
            continue
        if isinstance(value, dict):
            if any(item not in (None, "", [], {}) for item in value.values()):
                meaningful += 1
            continue
        if value not in (None, "", [], {}):
            meaningful += 1
    return meaningful


def is_representative_mock_exam(total_questions: int, raw_answers: object) -> bool:
    if total_questions <= 0:
        return True
    if total_questions < MIN_REPRESENTATIVE_MOCK_TOTAL_QUESTIONS:
        return False

    answered_count = count_meaningful_exam_answers(raw_answers)
    if answered_count <= 0:
        return False

    return (answered_count / total_questions) >= MIN_MEANINGFUL_EXAM_COMPLETION_RATIO


def compute_profile_latest_total(
    chosen_subjects: Sequence[str] | None,
    last_test_results: object,
) -> int | None:
    if not isinstance(last_test_results, dict):
        return None

    normalized_results: dict[str, list[int]] = {}
    for raw_subject, raw_scores in last_test_results.items():
        subject = normalize_subject_name(str(raw_subject or ""))
        if not subject or not isinstance(raw_scores, list):
            continue

        max_score = get_max_score(subject)
        clean_scores = []
        for raw_score in raw_scores[:5]:
            score = _coerce_int(raw_score)
            if score is None:
                continue
            if 0 <= score <= max_score:
                clean_scores.append(score)

        if clean_scores:
            normalized_results[subject] = clean_scores

    chosen = [
        normalize_subject_name(str(subject))
        for subject in (chosen_subjects or [])
        if str(subject or "").strip()
    ]
    if len(chosen) < 2:
        return None

    required_subjects = [*get_compulsory_subjects(), *chosen[:2]]
    if any(subject not in normalized_results for subject in required_subjects):
        return None

    return sum(normalized_results[subject][-1] for subject in required_subjects)


def _mistake_scope_conditions(
    *,
    user_id: int,
    recent_days: int | None = None,
    question_types: Sequence[str] | None = None,
    topic_tags: Sequence[str] | None = None,
    exam_attempt_id: int | None = None,
    practice_session_id: int | None = None,
):
    conditions = [
        MistakeReview.user_id == user_id,
        MistakeReview.is_resolved.is_(False),
        MistakeReview.topic_tag.isnot(None),
    ]

    if recent_days is not None and recent_days > 0:
        cutoff = datetime.now(UTC) - timedelta(days=recent_days)
        conditions.append(MistakeReview.created_at >= cutoff)

    normalized_question_types = _normalize_string_filters(question_types)
    if normalized_question_types:
        conditions.append(MistakeReview.question_type.in_(normalized_question_types))

    normalized_topic_tags = _normalize_string_filters(topic_tags)
    if normalized_topic_tags:
        conditions.append(MistakeReview.topic_tag.in_(normalized_topic_tags))

    if exam_attempt_id is not None and int(exam_attempt_id) > 0:
        conditions.append(
            MistakeReview.original_question_snapshot["exam_attempt_id"].as_string()
            == str(int(exam_attempt_id))
        )

    if practice_session_id is not None and int(practice_session_id) > 0:
        conditions.append(
            MistakeReview.original_question_snapshot["practice_session_id"].as_string()
            == str(int(practice_session_id))
        )

    return conditions


def _recent_mistake_ids_subquery(
    conditions,
    *,
    recent_limit: int | None = None,
):
    if recent_limit is None or recent_limit <= 0:
        return None

    return (
        select(MistakeReview.id.label("id"))
        .where(*conditions)
        .order_by(MistakeReview.created_at.desc(), MistakeReview.id.desc())
        .limit(recent_limit)
        .subquery()
    )


async def get_user_target_threshold(
    user_id: int,
    db: AsyncSession,
    quota_type: str = "GENERAL",
) -> dict:
    """
    Get the grant threshold for the user's target university.

    Lookup order:
    1. Get target_university_id from StudentProfile
    2. Query HistoricalGrantThreshold for the latest year
    3. Fallback to UniversityData when no dated threshold exists

    Returns:
        {
            "university_name": str | None,
            "grant_threshold": int | None,
            "source": "university_data" | "historical" | "not_found" | "major_not_resolved",
            "major_codes": list[str],
            "quota_type": "GENERAL" | "RURAL",
            "data_year": int | None,
        }
    """
    normalized_quota = _normalize_quota_type(quota_type)

    # Step 1: Get user's target university from profile
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()

    if not profile or not profile.target_university_id:
        return {
            "university_name": None,
            "grant_threshold": None,
            "source": "not_found",
            "major_codes": [],
            "quota_type": normalized_quota,
            "data_year": None,
        }

    target_uni_id = profile.target_university_id

    # Step 2: Try to get university details first (for name lookup)
    uni_detail_result = await db.execute(
        select(UniversityDetail).where(UniversityDetail.id == target_uni_id)
    )
    uni_detail = uni_detail_result.scalar_one_or_none()

    university_name = uni_detail.full_name if uni_detail else None

    target_major_values = [
        str(item).strip() for item in (profile.target_majors or []) if str(item or "").strip()
    ]
    if not target_major_values:
        return {
            "university_name": university_name,
            "grant_threshold": None,
            "source": "not_found",
            "major_codes": [],
            "quota_type": normalized_quota,
            "data_year": None,
        }

    resolved_major_codes = await resolve_major_codes(db, target_major_values)
    if not resolved_major_codes:
        return {
            "university_name": university_name,
            "grant_threshold": None,
            "source": "major_not_resolved",
            "major_codes": [],
            "quota_type": normalized_quota,
            "data_year": None,
        }

    # Step 3: Prefer the latest dated historical threshold when it exists.
    if university_name:
        historical_result = await db.execute(
            select(HistoricalGrantThreshold)
            .where(HistoricalGrantThreshold.uni_name.ilike(f"%{university_name}%"))
            .where(HistoricalGrantThreshold.major_code.in_(resolved_major_codes))
            .where(HistoricalGrantThreshold.quota_type == normalized_quota)
            .order_by(HistoricalGrantThreshold.data_year.desc())
            .limit(1)
        )
        historical = historical_result.scalar_one_or_none()

        if historical:
            return {
                "university_name": historical.uni_name,
                "grant_threshold": historical.min_score,
                "source": "historical",
                "major_codes": resolved_major_codes,
                "quota_type": normalized_quota,
                "data_year": historical.data_year,
            }

    # Step 4: Fallback to UniversityData when we do not have a dated row.
    if university_name:
        uni_data_result = await db.execute(
            select(UniversityData)
            .where(UniversityData.uni_name.ilike(f"%{university_name}%"))
            .where(UniversityData.major_code.in_(resolved_major_codes))
            .limit(1)
        )
        uni_data = uni_data_result.scalar_one_or_none()

        grant_threshold_value = (
            getattr(uni_data, "grant_threshold_general", None)
            if normalized_quota == "GENERAL"
            else getattr(uni_data, "grant_threshold_rural", None)
        )

        if uni_data and grant_threshold_value:
            return {
                "university_name": uni_data.uni_name,
                "grant_threshold": grant_threshold_value,
                "source": "university_data",
                "major_codes": resolved_major_codes,
                "quota_type": normalized_quota,
                "data_year": None,
            }

    return {
        "university_name": university_name,
        "grant_threshold": None,
        "source": "not_found",
        "major_codes": resolved_major_codes,
        "quota_type": normalized_quota,
        "data_year": None,
    }


async def get_latest_mock_score(user_id: int, db: AsyncSession) -> int | None:
    """
    Get the latest representative mock exam score.

    Tiny synthetic probes and abandoned attempts should not become the
    student's new baseline for gap analysis.
    """
    result = await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.user_id == user_id)
        .order_by(ExamAttempt.submitted_at.desc())
        .limit(RECENT_EXAM_SCORE_LOOKBACK_LIMIT)
    )
    attempts = result.scalars().all()

    for attempt in attempts:
        total_questions = _coerce_int(getattr(attempt, "total_questions", None)) or 0
        if not is_representative_mock_exam(total_questions, getattr(attempt, "answers", None)):
            continue
        return _coerce_int(getattr(attempt, "score", None))

    return None


async def get_profile_latest_total(user_id: int, db: AsyncSession) -> int | None:
    result = await db.execute(select(StudentProfile).where(StudentProfile.user_id == user_id))
    profile = result.scalar_one_or_none()
    if not profile:
        return None

    return compute_profile_latest_total(
        getattr(profile, "chosen_subjects", None),
        getattr(profile, "last_test_results", None),
    )


async def get_current_score_baseline(user_id: int, db: AsyncSession) -> dict[str, object | None]:
    latest_mock_score = await get_latest_mock_score(user_id, db)
    if latest_mock_score is not None:
        return {
            "score": latest_mock_score,
            "source": "mock_exam",
        }

    profile_latest_total = await get_profile_latest_total(user_id, db)
    if profile_latest_total is not None:
        return {
            "score": profile_latest_total,
            "source": "profile_results",
        }

    return {
        "score": None,
        "source": None,
    }


def _is_meaningful_practice_session(session: PracticeSession | None) -> bool:
    if session is None:
        return False
    answered_questions = _coerce_int(getattr(session, "answered_questions_count", None)) or 0
    return answered_questions > 0


async def get_recent_practice_summary(
    user_id: int,
    db: AsyncSession,
    *,
    lookback_limit: int = RECENT_PRACTICE_TREND_LOOKBACK_LIMIT,
) -> dict:
    result = await db.execute(
        select(PracticeSession)
        .where(PracticeSession.user_id == user_id)
        .order_by(PracticeSession.updated_at.desc(), PracticeSession.id.desc())
        .limit(max(1, int(lookback_limit))),
    )
    practice_rows = result.scalars().all()

    latest_practice = next(
        (session for session in practice_rows if _is_meaningful_practice_session(session)),
        None,
    )

    aggregates: dict[str, dict[str, object]] = {}
    for session in practice_rows:
        if not _is_meaningful_practice_session(session):
            continue

        raw_subject = str(getattr(session, "subject", "") or "").strip()
        if not raw_subject:
            continue

        subject = normalize_subject_name(raw_subject)
        answered = _coerce_int(getattr(session, "answered_questions_count", None)) or 0
        correct = _coerce_int(getattr(session, "correct_answers_count", None)) or 0
        if answered <= 0:
            continue

        stats = aggregates.setdefault(
            subject,
            {
                "subject": subject,
                "sessions": 0,
                "answered": 0,
                "correct": 0,
                "points_lost": 0,
                "latest_updated_at": None,
            },
        )
        stats["sessions"] = int(stats["sessions"]) + 1
        stats["answered"] = int(stats["answered"]) + answered
        stats["correct"] = int(stats["correct"]) + correct
        stats["points_lost"] = int(stats["points_lost"]) + max(0, answered - correct)

        updated_at = getattr(session, "updated_at", None) or getattr(session, "started_at", None)
        latest_seen = stats["latest_updated_at"]
        if updated_at and (latest_seen is None or updated_at > latest_seen):
            stats["latest_updated_at"] = updated_at

    trends = []
    for stats in aggregates.values():
        answered = int(stats["answered"])
        correct = int(stats["correct"])
        points_lost = int(stats["points_lost"])
        if answered <= 0 or points_lost <= 0:
            continue
        trends.append(
            {
                "subject": str(stats["subject"]),
                "sessions": int(stats["sessions"]),
                "answered": answered,
                "correct": correct,
                "points_lost": points_lost,
                "accuracy_rate": round(correct / answered, 4),
                "latest_updated_at": (
                    stats["latest_updated_at"].isoformat()
                    if stats["latest_updated_at"] is not None
                    else None
                ),
            }
        )

    trends.sort(
        key=lambda item: (
            item["points_lost"],
            item["sessions"],
            item["answered"],
            item["latest_updated_at"] or "",
            item["subject"],
        ),
        reverse=True,
    )

    latest_practice_payload = None
    if latest_practice is not None:
        latest_answered = _coerce_int(getattr(latest_practice, "answered_questions_count", None))
        latest_target = _coerce_int(getattr(latest_practice, "target_questions", None))
        latest_practice_payload = {
            "session_id": _coerce_int(getattr(latest_practice, "id", None)),
            "subject": getattr(latest_practice, "subject", None),
            "score": _coerce_int(getattr(latest_practice, "correct_answers_count", None)),
            "max_score": latest_answered
            if latest_answered and latest_answered > 0
            else latest_target,
            "updated_at": (
                (
                    getattr(latest_practice, "updated_at", None)
                    or getattr(latest_practice, "started_at", None)
                ).isoformat()
                if (
                    getattr(latest_practice, "updated_at", None)
                    or getattr(latest_practice, "started_at", None)
                )
                else None
            ),
        }

    return {
        "latest_practice": latest_practice_payload,
        "trends": trends[:3],
    }


async def count_unresolved_mistakes(
    user_id: int,
    db: AsyncSession,
    *,
    recent_days: int | None = None,
    question_types: Sequence[str] | None = None,
    topic_tags: Sequence[str] | None = None,
    exam_attempt_id: int | None = None,
    practice_session_id: int | None = None,
    recent_limit: int | None = None,
) -> int:
    conditions = _mistake_scope_conditions(
        user_id=user_id,
        recent_days=recent_days,
        question_types=question_types,
        topic_tags=topic_tags,
        exam_attempt_id=exam_attempt_id,
        practice_session_id=practice_session_id,
    )
    recent_scope = _recent_mistake_ids_subquery(
        conditions,
        recent_limit=recent_limit,
    )
    if recent_scope is not None:
        result = await db.execute(select(func.count()).select_from(recent_scope))
    else:
        result = await db.execute(select(func.count(MistakeReview.id)).where(*conditions))
    return int(result.scalar() or 0)


async def cluster_mistakes_by_topic(
    user_id: int,
    db: AsyncSession,
    *,
    recent_days: int | None = None,
    question_types: Sequence[str] | None = None,
    topic_tags: Sequence[str] | None = None,
    exam_attempt_id: int | None = None,
    practice_session_id: int | None = None,
    limit: int | None = None,
    recent_limit: int | None = None,
) -> list[dict]:
    """
    Cluster unresolved mistakes by topic_tag.

    Returns:
        [
            {"topic": "Mathematics", "points_lost": 8, "mistake_count": 8},
            {"topic": "History > 18th Century", "points_lost": 5, "mistake_count": 5},
            ...
        ]
    """
    conditions = _mistake_scope_conditions(
        user_id=user_id,
        recent_days=recent_days,
        question_types=question_types,
        topic_tags=topic_tags,
        exam_attempt_id=exam_attempt_id,
        practice_session_id=practice_session_id,
    )
    recent_scope = _recent_mistake_ids_subquery(
        conditions,
        recent_limit=recent_limit,
    )
    query = select(
        MistakeReview.topic_tag,
        func.sum(MistakeReview.points_lost).label("points_lost"),
        func.count(MistakeReview.id).label("mistake_count"),
    )
    if recent_scope is not None:
        query = query.select_from(MistakeReview).join(
            recent_scope, MistakeReview.id == recent_scope.c.id
        )
    else:
        query = query.where(*conditions)
    query = query.group_by(MistakeReview.topic_tag).order_by(
        func.sum(MistakeReview.points_lost).desc(),
        func.count(MistakeReview.id).desc(),
        MistakeReview.topic_tag.asc(),
    )
    if limit is not None and limit > 0:
        query = query.limit(limit)
    result = await db.execute(query)

    clusters = []
    for row in result:
        clusters.append(
            {
                "topic": row.topic_tag,
                "points_lost": int(row.points_lost or 0),
                "mistake_count": int(row.mistake_count or 0),
            }
        )

    return clusters


async def estimate_pages_for_topic(topic: str, db: AsyncSession) -> int:
    """
    Estimate the number of pages to study for a topic.

    Uses vector search similarity or keyword matching to find relevant
    textbook chunks and counts unique pages.

    If no direct match, returns a default estimate based on subject.
    """
    subject_defaults = {
        "Mathematics": 18,
        "Mathematical Literacy": 8,
        "Reading Literacy": 8,
        "History of Kazakhstan": 16,
        "Informatics": 18,
        "Physics": 14,
        "Chemistry": 12,
        "Biology": 12,
        "Geography": 10,
        "History": 16,
        "default": 10,
    }

    normalized_topic = (topic or "").strip().casefold()
    for subject, default_pages in subject_defaults.items():
        if subject == "default":
            continue
        if normalized_topic == subject.casefold():
            return default_pages

    # Try to find chunks with matching topic in content
    result = await db.execute(
        select(func.count(func.distinct(TextbookChunk.page_number)))
        .join(Textbook)
        .where((TextbookChunk.content.ilike(f"%{topic}%")) | (Textbook.subject.ilike(f"%{topic}%")))
    )
    page_count = result.scalar() or 0

    if page_count > 0:
        return page_count

    for subject, default_pages in subject_defaults.items():
        if subject.lower() in topic.lower():
            return default_pages

    return subject_defaults["default"]


async def calculate_topic_efficiency(topic: str, points_lost: int, db: AsyncSession) -> dict:
    """
    Calculate the efficiency of studying a topic.

    Efficiency = points_lost / pages_to_read
    Higher efficiency = better ROI (more points per page)

    Returns:
        {
            "topic": str,
            "points_lost": int,
            "pages_to_read": int,
            "efficiency": float,
            "priority": "HIGH" | "MEDIUM" | "LOW"
        }
    """
    pages = await estimate_pages_for_topic(topic, db)

    efficiency = points_lost / max(pages, 1)  # Avoid division by zero

    # Determine priority based on efficiency thresholds
    if efficiency >= 0.5:  # 1 point per 2 pages or better
        priority = "HIGH"
    elif efficiency >= 0.2:  # 1 point per 5 pages
        priority = "MEDIUM"
    else:
        priority = "LOW"

    return {
        "topic": topic,
        "points_lost": points_lost,
        "pages_to_read": pages,
        "efficiency": round(efficiency, 3),
        "priority": priority,
    }


async def generate_recommendations(user_id: int, db: AsyncSession) -> dict:
    """
    Generate tactical recommendations for closing the score gap.

    Main function that orchestrates:
    1. Calculate gap (threshold - current score)
    2. Cluster mistakes by topic
    3. Calculate efficiency for each topic
    4. Generate prioritized task list

    Returns:
        {
            "target_university": str | None,
            "grant_threshold": int | None,
            "current_score": int | None,
            "current_score_source": "mock_exam" | "profile_results" | None,
            "gap": int | None,
            "recommendations": [
                {
                    "topic": str,
                    "points_lost": int,
                    "pages_to_read": int,
                    "efficiency": float,
                    "action": "READ" | "SKIP" | "QUIZ",
                    "priority": "HIGH" | "MEDIUM" | "LOW",
                    "message": str
                }
            ]
        }
    """
    # Step 1: Get threshold and current score
    threshold_info = await get_user_target_threshold(user_id, db)
    current_score_info = await get_current_score_baseline(user_id, db)
    current_score = _coerce_int(current_score_info.get("score"))
    current_score_source = (
        str(current_score_info.get("source"))
        if current_score_info.get("source") is not None
        else None
    )

    grant_threshold = threshold_info.get("grant_threshold")
    gap = None
    if grant_threshold is not None and current_score is not None:
        gap = grant_threshold - current_score

    # Step 2: Cluster mistakes by topic
    topic_clusters = await cluster_mistakes_by_topic(user_id, db)

    # Step 3: Calculate efficiency for each topic
    recommendations = []
    for cluster in topic_clusters:
        efficiency_data = await calculate_topic_efficiency(
            cluster["topic"], cluster["points_lost"], db
        )

        # Determine action based on efficiency and priority
        if efficiency_data["priority"] == "HIGH":
            action = "READ"
            message = f"Read '{cluster['topic']}' - {efficiency_data['pages_to_read']} pages, recover {cluster['points_lost']} points"
        elif efficiency_data["priority"] == "MEDIUM":
            action = "QUIZ"
            message = f"Quiz on '{cluster['topic']}' - moderate ROI, {cluster['points_lost']} points available"
        else:
            action = "SKIP"
            message = f"Skip '{cluster['topic']}' - too many pages ({efficiency_data['pages_to_read']}) for low yield"

        recommendations.append(
            {
                "topic": cluster["topic"],
                "points_lost": cluster["points_lost"],
                "pages_to_read": efficiency_data["pages_to_read"],
                "efficiency": efficiency_data["efficiency"],
                "action": action,
                "priority": efficiency_data["priority"],
                "message": message,
            }
        )

    # Sort by efficiency (highest first)
    recommendations.sort(key=lambda x: x["efficiency"], reverse=True)

    point_budget: int | None = None
    if gap is not None and gap > 0:
        point_budget = gap
    elif current_score is not None:
        point_budget = max(0, UNT_MAX_SCORE - current_score)

    if point_budget is not None:
        capped_recommendations = []
        remaining_points = max(0, point_budget)
        for recommendation in recommendations:
            if remaining_points <= 0:
                break

            capped_points = min(recommendation["points_lost"], remaining_points)
            capped_recommendation = {
                **recommendation,
                "points_lost": capped_points,
            }
            capped_recommendation["message"] = (
                f"Read '{recommendation['topic']}' - {recommendation['pages_to_read']} pages, recover {capped_points} points"
                if capped_recommendation["action"] == "READ"
                else f"Quiz on '{recommendation['topic']}' - moderate ROI, {capped_points} points available"
                if capped_recommendation["action"] == "QUIZ"
                else f"Skip '{recommendation['topic']}' - too many pages ({recommendation['pages_to_read']}) for low yield"
            )
            capped_recommendations.append(capped_recommendation)
            remaining_points -= capped_points

        recommendations = capped_recommendations

    return {
        "target_university": threshold_info.get("university_name"),
        "grant_threshold": grant_threshold,
        "current_score": current_score,
        "current_score_source": current_score_source,
        "gap": gap,
        "total_recoverable_points": sum(r["points_lost"] for r in recommendations),
        "recommendations": recommendations,
    }
