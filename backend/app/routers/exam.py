import time
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.dependencies.plan_guards import (
    PLAN_QUOTAS,
    _atomic_charge_counter,
    _get_or_create_counter,
    require_premium,
)
from app.models import (
    ActivityLog,
    ActivityType,
    ExamAttempt,
    ExamQuestion,
    MistakeReview,
    SubscriptionTier,
    User,
)
from app.routers.auth import get_current_user
from app.services.exam_scoring import (
    score_question,
)

router = APIRouter(prefix="/exam", tags=["Exams"])


class ExamHistoryItem(BaseModel):
    id: int
    subjects: list[str]
    score: int
    max_score: int
    total_questions: int
    submitted_at: datetime
    time_taken_seconds: int


class QuestionData(BaseModel):
    """
    Question metadata submitted by the client for server-side scoring.
    Accepts both 'type' (legacy) and 'format' fields for backward compatibility.
    """

    id: str
    type: str | None = None
    format: str | None = None
    correct_answer: Any  # List[str] for choice types, dict for matching, etc.
    max_points: int = 1
    subject: str | None = None
    question_text: str | None = None
    options: dict[str, str] | None = None

    def get_format(self) -> str:
        """Return the effective format, preferring 'format' over 'type' for new types."""
        if self.format:
            return self.format
        # Map legacy frontend type names to scoring format constants
        type_to_format = {
            "single": "single_choice",
            "context": "context",
            "multi": "multiple_choice",
            "MULTIPLE": "multiple_choice",
            "multiple": "multiple_choice",
            "matching": "matching",
            "fill_blank": "fill_blank",
            "image": "image_choice",
            "ordering": "ordering",
        }
        return type_to_format.get(self.type or "", self.type or "")


class ExamSubmission(BaseModel):
    subjects: list[str]
    total_questions: int
    time_limit_seconds: int
    started_at: datetime
    time_taken_seconds: int
    answers: dict[str, Any]  # Any to support different answer shapes per format
    questions: list[QuestionData]


FRONTEND_SUBJECT_MAP = {
    "math": "Mathematics",
    "physics": "Physics",
    "chemistry": "Chemistry",
    "biology": "Biology",
    "geography": "Geography",
    "worldHist": "World History",
    "langLit": "Kazakh Literature",
    "foreignLang": "Foreign Language",
    "law": "Fundamentals of Law",
    "compSci": "Informatics",
}

SUBJECT_KEY_LABELS = {
    "histKz": "History of Kazakhstan",
    "readLit": "Reading Literacy",
    "mathLit": "Mathematical Literacy",
    "math": "Mathematics",
    "physics": "Physics",
    "chemistry": "Chemistry",
    "biology": "Biology",
    "geography": "Geography",
    "worldHist": "World History",
    "langLit": "Kazakh Literature",
    "foreignLang": "Foreign Language",
    "law": "Fundamentals of Law",
    "compSci": "Informatics",
}


def _subject_label(subject: str | None) -> str | None:
    if not subject:
        return None
    return SUBJECT_KEY_LABELS.get(subject, subject)


COMPULSORY_MAP = {
    "histKz": {"name": "History of Kazakhstan", "limit": 20},
    "readLit": {"name": "Reading Literacy", "limit": 10},
    "mathLit": {"name": "Mathematical Literacy", "limit": 10},
}

EXPECTED_SECTION_POINTS = {
    "histKz": 20,
    "readLit": 10,
    "mathLit": 10,
}
EXPECTED_PROFILE_QUESTIONS = 40
EXPECTED_PROFILE_POINTS = 50
EXPECTED_TOTAL_QUESTIONS = 120
EXPECTED_TOTAL_POINTS = 140

# ── Per-section time limits matching real UNT ─────────────────────────────────
SECTION_TIME_LIMITS = {
    "histKz": 30 * 60,  # 30 min
    "readLit": 15 * 60,  # 15 min
    "mathLit": 15 * 60,  # 15 min
}
DEFAULT_SECTION_TIME = 60 * 60  # 60 min for profile subjects

# ── Question format → frontend type mapping ──────────────────────────────────
FORMAT_TO_FRONTEND_TYPE = {
    "single_choice": "single",
    "multiple_choice": "multi",
    "context": "context",
    "matching": "matching",
    "fill_blank": "fill_blank",
    "image_choice": "image",
    "ordering": "ordering",
}
SUPPORTED_FRONTEND_FORMATS = ("single_choice", "multiple_choice", "context")


async def fetch_subject_questions(db: AsyncSession, subject_name: str, limit: int, key: str):
    """Fetch and format questions for a given subject, supporting all question types."""
    stmt = (
        select(ExamQuestion)
        .where(
            ExamQuestion.subject == subject_name,
            ExamQuestion.format.in_(SUPPORTED_FRONTEND_FORMATS),
        )
        .order_by(ExamQuestion.id.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    questions = result.scalars().all()

    if not questions:
        fallback_stmt = (
            select(ExamQuestion)
            .where(
                ExamQuestion.subject.ilike(f"%{subject_name}%"),
                ExamQuestion.format.in_(SUPPORTED_FRONTEND_FORMATS),
            )
            .order_by(ExamQuestion.id.asc())
            .limit(limit)
        )
        fallback_result = await db.execute(fallback_stmt)
        questions = fallback_result.scalars().all()

    formatted_questions = []

    for q in questions:
        # Determine frontend type from format
        frontend_type = FORMAT_TO_FRONTEND_TYPE.get(q.format, q.format)

        # Base question structure
        fq = {
            "id": q.source_id,
            "type": frontend_type,
            "format": q.format,
            "stem": {"kz": q.question_text_kz, "ru": q.question_text_ru},
            "maxPoints": q.max_points,
        }

        # ── Option-based formats (single, multi, context, image_choice) ──
        if q.format in ("single_choice", "multiple_choice", "context", "image_choice"):
            options = []
            for i in range(len(q.options_kz)):
                options.append(
                    {
                        "id": f"{q.source_id}_opt_{i}",
                        "text": {
                            "kz": q.options_kz[i] if i < len(q.options_kz) else "",
                            "ru": q.options_ru[i] if i < len(q.options_ru) else "",
                        },
                    }
                )
            fq["options"] = options
            fq["correctIds"] = [f"{q.source_id}_opt_{idx}" for idx in q.correct_answers_indices]

        # ── Context-specific fields ──
        if q.format == "context":
            fq["contextStimulus"] = {
                "kz": q.context_stimulus_kz or "",
                "ru": q.context_stimulus_ru or "",
            }
            fq["contextGroupId"] = q.context_group_id

        # ── Image-based question: include image URL ──
        if q.format == "image_choice" and q.image_url:
            fq["imageUrl"] = q.image_url

        # ── Matching format ──
        if q.format == "matching" and q.matching_pairs:
            fq["matchingPairs"] = q.matching_pairs
            # Build correct mapping for client reference (correctIds)
            fq["correctMapping"] = {f"left_{i}": f"right_{i}" for i in range(len(q.matching_pairs))}

        # ── Fill-in-the-blank format ──
        if q.format == "fill_blank" and q.accepted_answers:
            fq["acceptedAnswers"] = q.accepted_answers

        # ── Ordering format ──
        if q.format == "ordering" and q.correct_order:
            fq["orderItems"] = q.correct_order
            # Don't send correct order to client — only shuffled items

        formatted_questions.append(fq)

    return {
        "key": key,
        "questions": formatted_questions,
        "maxPoints": sum(q["maxPoints"] for q in formatted_questions),
    }


@router.get("/generate")
async def generate_exam(
    sub1: str = Query(..., description="First profile subject key"),
    sub2: str = Query(..., description="Second profile subject key"),
    _current_user: User = Depends(require_premium),
    db: AsyncSession = Depends(get_db),
):
    if sub1 not in FRONTEND_SUBJECT_MAP or sub2 not in FRONTEND_SUBJECT_MAP:
        raise HTTPException(status_code=400, detail="Invalid profile subject keys provided.")

    subjects_data = []
    total_max_points = 0

    # 1. Add compulsory subjects
    for key, info in COMPULSORY_MAP.items():
        section = await fetch_subject_questions(db, info["name"], info["limit"], key)
        section["timeLimit"] = SECTION_TIME_LIMITS.get(key, DEFAULT_SECTION_TIME)
        subjects_data.append(section)
        total_max_points += section["maxPoints"]

    # 2. Add profile subjects (limit 40 each)
    p1_section = await fetch_subject_questions(db, FRONTEND_SUBJECT_MAP[sub1], 40, sub1)
    p1_section["timeLimit"] = SECTION_TIME_LIMITS.get(sub1, DEFAULT_SECTION_TIME)
    subjects_data.append(p1_section)
    total_max_points += p1_section["maxPoints"]

    p2_section = await fetch_subject_questions(db, FRONTEND_SUBJECT_MAP[sub2], 40, sub2)
    p2_section["timeLimit"] = SECTION_TIME_LIMITS.get(sub2, DEFAULT_SECTION_TIME)
    subjects_data.append(p2_section)
    total_max_points += p2_section["maxPoints"]

    incomplete_sections = []
    for section in subjects_data:
        key = section["key"]
        expected_count = (
            COMPULSORY_MAP[key]["limit"] if key in COMPULSORY_MAP else EXPECTED_PROFILE_QUESTIONS
        )
        expected_points = (
            EXPECTED_SECTION_POINTS[key]
            if key in EXPECTED_SECTION_POINTS
            else EXPECTED_PROFILE_POINTS
        )
        actual_count = len(section["questions"])
        actual_points = section["maxPoints"]
        if actual_count < expected_count or actual_points < expected_points:
            incomplete_sections.append(
                {
                    "key": key,
                    "expectedQuestions": expected_count,
                    "actualQuestions": actual_count,
                    "expectedMaxPoints": expected_points,
                    "actualMaxPoints": actual_points,
                }
            )

    total_questions = sum(len(section["questions"]) for section in subjects_data)
    if (
        incomplete_sections
        or total_questions < EXPECTED_TOTAL_QUESTIONS
        or total_max_points < EXPECTED_TOTAL_POINTS
    ):
        raise HTTPException(
            status_code=503,
            detail={
                "error": "question_bank_incomplete",
                "message": "Exam question bank is not complete for this subject pair.",
                "sections": incomplete_sections,
                "totalQuestions": total_questions,
                "expectedTotalQuestions": EXPECTED_TOTAL_QUESTIONS,
                "totalMaxPoints": total_max_points,
                "expectedTotalMaxPoints": EXPECTED_TOTAL_POINTS,
            },
        )

    return {
        "id": str(uuid.uuid4()),
        "startTime": int(time.time() * 1000),
        "timeLimit": 14400,
        "subjects": subjects_data,
        "totalMaxPoints": total_max_points,
    }


def _answer_label(answer: Any, options: dict[str, str] | None) -> str:
    def label(value: Any) -> str:
        raw = str(value)
        return (options or {}).get(raw, raw)

    if isinstance(answer, list):
        if not answer:
            return ""
        return ", ".join(label(item) for item in answer)
    if isinstance(answer, dict):
        return ", ".join(f"{key}: {label(value)}" for key, value in answer.items())
    if answer is None:
        return ""
    return label(answer)


def _has_meaningful_answer(answer: Any) -> bool:
    if answer is None:
        return False
    if isinstance(answer, str):
        return bool(answer.strip())
    if isinstance(answer, (list, tuple, set)):
        return any(_has_meaningful_answer(item) for item in answer)
    if isinstance(answer, dict):
        return any(_has_meaningful_answer(value) for value in answer.values())
    return True


@router.post("/submit")
async def submit_exam(
    submission: ExamSubmission,
    current_user: User = Depends(require_premium),
    db: AsyncSession = Depends(get_db),
):
    # Validate time (10-second grace period for network latency)
    if submission.time_taken_seconds > submission.time_limit_seconds + 10:
        raise HTTPException(400, "Submission time exceeds exam duration")

    counter = await _get_or_create_counter(current_user.id, db)
    tier = (
        current_user.subscription_tier
        if current_user.subscription_tier in PLAN_QUOTAS
        else SubscriptionTier.FREE
    )
    limit = PLAN_QUOTAS[tier].get("exam_runs", 0)
    current_usage = counter.exam_runs or 0
    if limit == 0:
        raise HTTPException(status_code=403, detail="premium_required")
    if current_usage >= limit:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "resource": "exam_runs",
                "limit": limit,
                "used": current_usage,
                "plan": tier.value,
            },
        )

    # Calculate score server-side using centralized scoring service.
    question_dicts = [
        {
            "id": q.id,
            "format": q.get_format(),
            "correct_answer": q.correct_answer,
            "max_points": q.max_points,
            "subject": _subject_label(q.subject),
            "question_text": q.question_text,
            "options": q.options or {},
        }
        for q in submission.questions
    ]
    scored_questions = []
    score = 0
    for q in question_dicts:
        user_answer = submission.answers.get(str(q["id"]), [])
        points = score_question(
            q["format"],
            user_answer,
            q["correct_answer"],
            q["max_points"],
        )
        scored_questions.append({**q, "user_answer": user_answer, "points": points})
        score += points
    max_score = sum(q.max_points for q in submission.questions)
    canonical_subjects = [
        label for label in (_subject_label(subject) for subject in submission.subjects) if label
    ]

    # Store attempt
    attempt = ExamAttempt(
        user_id=current_user.id,
        subjects=canonical_subjects,
        total_questions=submission.total_questions,
        time_limit_seconds=submission.time_limit_seconds,
        score=score,
        max_score=max_score,
        answers=submission.answers,
        started_at=submission.started_at,
        time_taken_seconds=submission.time_taken_seconds,
    )
    db.add(attempt)
    await db.flush()

    # Backend-owned usage and progress tracking. The frontend may optimistically
    # increment usage when the exam starts, but billing/status must reflect the
    # persisted attempt after refresh.
    # v3.85 (2026-05-03): atomic UPDATE so two concurrent exam
    # submissions from the same user can't both read N and both
    # write N+1.
    new_value = await _atomic_charge_counter(user_id=current_user.id, resource="exam_runs", db=db)
    counter.exam_runs = new_value

    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity_type=ActivityType.TEST_COMPLETED,
            metadata_blob={
                "exam_attempt_id": attempt.id,
                "score": score,
                "max_score": max_score,
                "percentage": round((score / max_score) * 100, 1) if max_score else 0,
                "subjects": canonical_subjects,
                "total_questions": submission.total_questions,
                "time_taken_seconds": submission.time_taken_seconds,
            },
        )
    )

    mistakes_created = 0
    answered_count = 0
    skipped_count = 0
    wrong_answered_count = 0
    for q in scored_questions:
        has_meaningful_answer = _has_meaningful_answer(q.get("user_answer"))
        if has_meaningful_answer:
            answered_count += 1
        else:
            skipped_count += 1

        if q["points"] >= q["max_points"]:
            continue
        if not has_meaningful_answer:
            continue
        wrong_answered_count += 1

        subject = q["subject"]
        question_text = q.get("question_text") or str(q["id"])
        points_lost = max(1, int(q["max_points"] or 1) - int(q["points"] or 0))
        mistake = MistakeReview(
            user_id=current_user.id,
            original_question_snapshot={
                "id": q["id"],
                "text": question_text,
                "question": question_text,
                "options": q.get("options") or {},
                "subject": subject,
                "exam_attempt_id": attempt.id,
            },
            user_answer=_answer_label(q.get("user_answer"), q.get("options")),
            correct_answer=_answer_label(q.get("correct_answer"), q.get("options")),
            ai_diagnosis="Pending analysis",
            library_citation=None,
            remedial_questions=None,
            is_resolved=False,
            topic_tag=subject,
            textbook_chunk_id=None,
            question_type="exam",
            points_lost=points_lost,
            correct_answers_count=0,
        )
        db.add(mistake)
        mistakes_created += 1

    await db.commit()
    await db.refresh(attempt)

    return {
        "score": score,
        "max_score": max_score,
        "attempt_id": attempt.id,
        "mistakes_created": mistakes_created,
        "answered_count": answered_count,
        "skipped_count": skipped_count,
        "wrong_answered_count": wrong_answered_count,
    }


class ScoreTrendItem(BaseModel):
    date: str
    score: int
    max_score: int
    percentage: float


class SubjectPerformanceItem(BaseModel):
    subject: str
    avg_score: float
    avg_max: float
    attempts: int


class ExamAnalytics(BaseModel):
    score_trend: list[ScoreTrendItem]
    subject_performance: list[SubjectPerformanceItem]
    total_attempts: int
    avg_score: float
    avg_percentage: float
    best_score: int
    best_percentage: float


@router.get("/analytics", response_model=ExamAnalytics)
async def get_exam_analytics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, description="Max attempts to analyze"),
):
    """Return aggregated performance analytics for the current user's exam history."""
    stmt = (
        select(ExamAttempt)
        .where(ExamAttempt.user_id == current_user.id)
        .order_by(ExamAttempt.submitted_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    attempts = result.scalars().all()

    if not attempts:
        return ExamAnalytics(
            score_trend=[],
            subject_performance=[],
            total_attempts=0,
            avg_score=0.0,
            avg_percentage=0.0,
            best_score=0,
            best_percentage=0.0,
        )

    # Build score trend (reverse to chronological order — oldest first)
    score_trend = []
    for a in reversed(attempts):
        pct = round((a.score / a.max_score) * 100, 1) if a.max_score > 0 else 0.0
        date_str = a.submitted_at.strftime("%Y-%m-%d") if a.submitted_at else ""
        score_trend.append(
            ScoreTrendItem(date=date_str, score=a.score, max_score=a.max_score, percentage=pct)
        )

    # Build subject performance
    # subjects is an ARRAY of subject names per attempt — aggregate per unique subject combination
    subject_agg: dict[str, dict] = {}
    for a in attempts:
        # Report per individual subject present in the attempt
        for subj in a.subjects or []:
            if subj not in subject_agg:
                subject_agg[subj] = {"total_score": 0, "total_max": 0, "count": 0}
            subject_agg[subj]["total_score"] += a.score
            subject_agg[subj]["total_max"] += a.max_score
            subject_agg[subj]["count"] += 1

    subject_performance = [
        SubjectPerformanceItem(
            subject=subj,
            avg_score=round(data["total_score"] / data["count"], 1),
            avg_max=round(data["total_max"] / data["count"], 1),
            attempts=data["count"],
        )
        for subj, data in subject_agg.items()
    ]

    # Overall stats
    total_attempts = len(attempts)
    avg_score = round(sum(a.score for a in attempts) / total_attempts, 1)
    percentages = [
        round((a.score / a.max_score) * 100, 1) if a.max_score > 0 else 0.0 for a in attempts
    ]
    avg_percentage = round(sum(percentages) / total_attempts, 1)
    best_score = max(a.score for a in attempts)
    best_percentage = max(percentages)

    return ExamAnalytics(
        score_trend=score_trend,
        subject_performance=subject_performance,
        total_attempts=total_attempts,
        avg_score=avg_score,
        avg_percentage=avg_percentage,
        best_score=best_score,
        best_percentage=best_percentage,
    )


@router.get("/history", response_model=list[ExamHistoryItem])
async def get_exam_history(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(ExamAttempt)
        .where(ExamAttempt.user_id == current_user.id)
        .order_by(ExamAttempt.submitted_at.desc())
    )

    result = await db.execute(stmt)
    attempts = result.scalars().all()

    return [
        ExamHistoryItem(
            id=a.id,
            subjects=a.subjects,
            score=a.score,
            max_score=a.max_score,
            total_questions=a.total_questions,
            submitted_at=a.submitted_at,
            time_taken_seconds=a.time_taken_seconds,
        )
        for a in attempts
    ]
