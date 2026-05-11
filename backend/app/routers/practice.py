"""
app/routers/practice.py
-----------------------
Grounded Question Generator API

Provides endpoints for:
- Generating practice questions from textbook content
- Submitting answers and getting explanations
- Retrieving question citations
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies.plan_guards import (
    PLAN_QUOTAS,
    _atomic_charge_counter,
    _get_or_create_counter,
    require_premium,
)
from ..models import (
    GeneratedQuestion,
    MistakeReview,
    PracticeSession,
    PracticeSessionQuestion,
    SubscriptionTier,
    User,
)
from ..services.practice_coverage import generated_question_coverage
from ..services.question_generator import generate_practice_question

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/practice", tags=["practice"])
DEFAULT_PRACTICE_TARGET_QUESTIONS = 10


# --- PYDANTIC SCHEMAS ---


class GenerateQuestionRequest(BaseModel):
    """Request to generate a new practice question."""

    subject: str | None = None  # e.g., "Mathematics", "History of Kazakhstan"
    grade: int | None = None  # e.g., 10, 11
    difficulty: str = "MEDIUM"  # EASY, MEDIUM, HARD
    language: str = "kz"  # "kz" or "ru"
    session_id: int | None = None


class QuestionOption(BaseModel):
    """A single option in a multiple-choice question."""

    key: str  # "A", "B", "C", "D"
    text: str


class GeneratedQuestionResponse(BaseModel):
    """Response containing a generated question."""

    id: int
    session_id: int | None = None
    question: str
    options: list[QuestionOption]
    subject: str
    grade: int
    difficulty: str
    language: str
    coverage: dict | None = None
    # Note: correct answer is NOT included - revealed after submission


class Citation(BaseModel):
    """Source citation for a question."""

    book: str
    subject: str
    grade: int
    page: int
    quote: str


class AnswerSubmission(BaseModel):
    """Request to submit an answer."""

    answer: str  # "A", "B", "C", or "D"
    session_id: int | None = None


class AnswerResultResponse(BaseModel):
    """Result after submitting an answer."""

    is_correct: bool
    session_id: int | None = None
    correct_answer: str
    explanation: str
    citation: Citation


class ExplanationResponse(BaseModel):
    """Full explanation for a question."""

    question: str
    correct_answer: str
    options: list[QuestionOption]
    explanations: dict
    citation: Citation


# --- ENDPOINTS ---


async def _get_practice_session(
    session_id: int,
    user_id: int,
    db: AsyncSession,
) -> PracticeSession | None:
    result = await db.execute(
        select(PracticeSession).where(
            PracticeSession.id == session_id,
            PracticeSession.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def _resolve_session_for_generate(
    request: GenerateQuestionRequest,
    current_user: User,
    db: AsyncSession,
) -> PracticeSession | None:
    if not request.session_id:
        return None

    session = await _get_practice_session(request.session_id, current_user.id, db)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Practice session {request.session_id} not found",
        )
    if (
        session.completed_at is not None
        or session.answered_questions_count >= session.target_questions
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Practice session already completed",
        )
    return session


async def _resolve_session_for_answer(
    *,
    session_id: int | None,
    question_id: int,
    user_id: int,
    db: AsyncSession,
) -> tuple[PracticeSession | None, PracticeSessionQuestion | None]:
    query = (
        select(PracticeSessionQuestion, PracticeSession)
        .join(
            PracticeSession,
            PracticeSessionQuestion.practice_session_id == PracticeSession.id,
        )
        .where(
            PracticeSessionQuestion.question_id == question_id,
            PracticeSession.user_id == user_id,
        )
        .order_by(PracticeSessionQuestion.id.desc())
        .limit(1)
    )
    if session_id:
        query = query.where(PracticeSessionQuestion.practice_session_id == session_id)

    result = await db.execute(query)
    row = result.first()
    if not row:
        return None, None
    return row[1], row[0]


@router.post("/generate", response_model=GeneratedQuestionResponse)
async def generate_question(
    request: GenerateQuestionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_premium),
):
    """
    Generate a new practice question grounded in textbook content.

    The question is guaranteed to have:
    - A correct answer derived from an official textbook
    - Distractors from semantically similar content
    - A verifiable citation

    Returns the question without revealing the correct answer.
    """
    try:
        counter = await _get_or_create_counter(current_user.id, db)
        tier = (
            current_user.subscription_tier
            if current_user.subscription_tier in PLAN_QUOTAS
            else SubscriptionTier.PREMIUM
        )
        limit = PLAN_QUOTAS[tier]["practice_questions"]
        current_usage = counter.practice_questions or 0

        if current_usage >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "quota_exceeded",
                    "resource": "practice_questions",
                    "limit": limit,
                    "used": current_usage,
                    "plan": tier.value,
                },
            )

        practice_session = await _resolve_session_for_generate(request, current_user, db)
        if (
            practice_session
            and practice_session.generated_questions_count >= practice_session.target_questions
        ):
            practice_session.completed_at = practice_session.completed_at or datetime.now(UTC)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Practice session already generated all questions",
            )

        question = await generate_practice_question(
            db=db,
            subject=practice_session.subject
            if practice_session and practice_session.subject
            else request.subject,
            grade=practice_session.grade
            if practice_session and practice_session.grade
            else request.grade,
            difficulty=practice_session.difficulty if practice_session else request.difficulty,
            language=practice_session.language if practice_session else request.language,
            user_id=current_user.id,
        )

        if not question:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate question. Please try again.",
            )

        # Options are already shuffled by GPT-4 during generation
        options = [
            QuestionOption(key="A", text=question.option_a),
            QuestionOption(key="B", text=question.option_b),
            QuestionOption(key="C", text=question.option_c),
            QuestionOption(key="D", text=question.option_d),
        ]

        if not practice_session:
            practice_session = PracticeSession(
                user_id=current_user.id,
                subject=question.subject,
                grade=question.grade,
                difficulty=question.difficulty,
                language=question.language,
                target_questions=DEFAULT_PRACTICE_TARGET_QUESTIONS,
            )
            db.add(practice_session)
            await db.flush()

        sequence_number = (practice_session.generated_questions_count or 0) + 1
        db.add(
            PracticeSessionQuestion(
                practice_session_id=practice_session.id,
                question_id=question.id,
                sequence_number=sequence_number,
            )
        )

        # Track serving separately from quota. The paid usage counter moves
        # only when the learner actually submits an answer.
        question.times_served += 1
        practice_session.generated_questions_count = sequence_number
        practice_session.updated_at = datetime.now(UTC)
        await db.commit()

        return GeneratedQuestionResponse(
            id=question.id,
            session_id=practice_session.id,
            question=question.question_text,
            options=options,
            subject=question.subject,
            grade=question.grade,
            difficulty=question.difficulty,
            language=question.language,
            coverage=generated_question_coverage(question).to_dict(),
        )

    except HTTPException:
        raise
    except Exception as exc:
        # v3.56: stop leaking internal exception text to the client
        # (str(e) previously interpolated into the 500 detail). The
        # generic message + stack-attached log is the v3.48 pattern.
        # The chain (`from exc`) keeps __cause__ for log correlation
        # without affecting the client-visible detail string.
        logger.exception("Error in generate_question endpoint")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate question",
        ) from exc


@router.post("/{question_id}/answer", response_model=AnswerResultResponse)
async def submit_answer(
    question_id: int,
    submission: AnswerSubmission,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_premium),
):
    """
    Submit an answer for a question.

    Returns whether the answer is correct, along with:
    - The correct answer
    - Explanation
    - Citation from the textbook

    Auto-captures mistakes when answer is incorrect (MistakeReview & Gap Closer System).
    """
    # Get the question
    result = await db.execute(select(GeneratedQuestion).where(GeneratedQuestion.id == question_id))
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Question {question_id} not found"
        )

    practice_session, practice_session_question = await _resolve_session_for_answer(
        session_id=submission.session_id,
        question_id=question_id,
        user_id=current_user.id,
        db=db,
    )
    if submission.session_id and not practice_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Practice session {submission.session_id} not found for question {question_id}",
        )

    counter = await _get_or_create_counter(current_user.id, db)
    tier = (
        current_user.subscription_tier
        if current_user.subscription_tier in PLAN_QUOTAS
        else SubscriptionTier.PREMIUM
    )
    limit = PLAN_QUOTAS[tier]["practice_questions"]
    current_usage = counter.practice_questions or 0

    if current_usage >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "quota_exceeded",
                "resource": "practice_questions",
                "limit": limit,
                "used": current_usage,
                "plan": tier.value,
            },
        )

    # Get correct position from explanations (set during shuffle)
    explanations = question.explanations or {}
    correct_position = explanations.get("correct_position", "A")  # Fallback to A for old questions

    # Check answer
    is_correct = submission.answer.upper() == correct_position
    is_first_session_answer = (
        practice_session_question is None or practice_session_question.answered_at is None
    )

    # Update analytics
    if is_correct and is_first_session_answer:
        question.times_answered_correctly += 1

    # === CACHE citation and explanation data BEFORE any blocking operations ===
    # This ensures response is instant even if process_mistake takes long
    citation_data = question.citation or {}
    citation = Citation(
        book=citation_data.get("book", "Unknown"),
        subject=citation_data.get("subject", question.subject),
        grade=citation_data.get("grade", question.grade),
        page=citation_data.get("page", 0),
        quote=citation_data.get("quote", "")[:300],  # Limit quote length
    )
    explanation = explanations.get("a", "Бұл - оқулықтағы дұрыс жауап.")

    # Cache question attributes needed for process_mistake (before commit expires them)
    question_snapshot_data = {
        "id": question.id,
        "text": question.question_text,
        "question": question.question_text,
        "options": {
            "A": question.option_a,
            "B": question.option_b,
            "C": question.option_c,
            "D": question.option_d,
        },
        "subject": question.subject,
        "grade": question.grade,
        "difficulty": question.difficulty,
    }
    correct_option_map = {
        "A": question.option_a,
        "B": question.option_b,
        "C": question.option_c,
        "D": question.option_d,
    }
    correct_answer_text = correct_option_map.get(correct_position, correct_position)
    cached_subject = question.subject
    cached_anchor_chunk_id = question.anchor_chunk_id
    session_id = practice_session.id if practice_session else None
    question_index = (
        practice_session_question.sequence_number if practice_session_question is not None else None
    )

    # === AUTO-CAPTURE MISTAKE (MistakeReview & Gap Closer System) ===
    # Keep this lightweight and non-AI so answer submission stays instant.
    # Full diagnosis can be generated later from the saved snapshot.
    if not is_correct and is_first_session_answer:
        mistake = MistakeReview(
            user_id=current_user.id,
            original_question_snapshot={
                **question_snapshot_data,
                **(
                    {
                        "practice_session_id": session_id,
                        "practice_question_index": question_index,
                    }
                    if session_id
                    else {}
                ),
            },
            user_answer=submission.answer.upper(),
            correct_answer=correct_answer_text,
            ai_diagnosis=explanation or "Pending analysis",
            library_citation={
                "book": citation_data.get("book", "Unknown"),
                "book_title": citation_data.get("book", "Unknown"),
                "page": citation_data.get("page", 0),
                "page_number": citation_data.get("page", 0),
                "quote": citation_data.get("quote", "")[:300],
                "subject": citation_data.get("subject", question.subject),
                "grade": citation_data.get("grade", question.grade),
            },
            remedial_questions=None,
            is_resolved=False,
            topic_tag=cached_subject,
            textbook_chunk_id=cached_anchor_chunk_id,
            question_type="practice",
            points_lost=1,
            correct_answers_count=0,
        )
        db.add(mistake)

    if (
        practice_session
        and practice_session_question
        and practice_session_question.answered_at is None
    ):
        practice_session_question.answered_at = datetime.now(UTC)
        practice_session_question.answered_correctly = is_correct
        practice_session.answered_questions_count = (
            practice_session.answered_questions_count or 0
        ) + 1
        if is_correct:
            practice_session.correct_answers_count = (
                practice_session.correct_answers_count or 0
            ) + 1
        if practice_session.answered_questions_count >= practice_session.target_questions:
            practice_session.completed_at = datetime.now(UTC)
        practice_session.updated_at = datetime.now(UTC)

    if is_first_session_answer:
        # v3.85 (2026-05-03): atomic UPDATE so two concurrent
        # answers from the same user can't both read N and both
        # write N+1. Each first-session-answer counts exactly once.
        new_value = await _atomic_charge_counter(
            user_id=current_user.id, resource="practice_questions", db=db
        )
        counter.practice_questions = new_value
    await db.commit()

    return AnswerResultResponse(
        is_correct=is_correct,
        session_id=session_id,
        correct_answer=correct_position,
        explanation=explanation,
        citation=citation,
    )


@router.get("/{question_id}/explain", response_model=ExplanationResponse)
async def explain_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_premium),
):
    """
    Get full explanation for a question.

    Shows:
    - The question and all options
    - Which answer is correct
    - Why each option is right/wrong
    - Full citation from the textbook
    """
    # Get the question
    result = await db.execute(select(GeneratedQuestion).where(GeneratedQuestion.id == question_id))
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Question {question_id} not found"
        )

    # Format options
    options = [
        QuestionOption(key="A", text=question.option_a),
        QuestionOption(key="B", text=question.option_b),
        QuestionOption(key="C", text=question.option_c),
        QuestionOption(key="D", text=question.option_d),
    ]

    # Get correct position
    explanations_data = question.explanations or {}
    correct_position = explanations_data.get("correct_position", "A")

    # Get citation
    citation_data = question.citation or {}
    citation = Citation(
        book=citation_data.get("book", "Unknown"),
        subject=citation_data.get("subject", question.subject),
        grade=citation_data.get("grade", question.grade),
        page=citation_data.get("page", 0),
        quote=citation_data.get("quote", ""),
    )

    return ExplanationResponse(
        question=question.question_text,
        correct_answer=correct_position,
        options=options,
        explanations=explanations_data,
        citation=citation,
    )


@router.get("/history", response_model=list[GeneratedQuestionResponse])
async def get_question_history(
    subject: str | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_premium),
):
    """
    Get previously generated questions.

    Useful for reviewing past practice sessions.
    """
    query = (
        select(GeneratedQuestion, PracticeSessionQuestion.practice_session_id)
        .join(
            PracticeSessionQuestion,
            PracticeSessionQuestion.question_id == GeneratedQuestion.id,
        )
        .join(
            PracticeSession,
            PracticeSession.id == PracticeSessionQuestion.practice_session_id,
        )
        .where(PracticeSession.user_id == current_user.id)
        .order_by(
            PracticeSessionQuestion.created_at.desc(),
            GeneratedQuestion.created_at.desc(),
        )
    )

    if subject:
        query = query.where(GeneratedQuestion.subject.ilike(f"%{subject}%"))

    query = query.limit(limit)

    result = await db.execute(query)
    question_rows = result.all()

    return [
        GeneratedQuestionResponse(
            id=question.id,
            session_id=practice_session_id,
            question=question.question_text,
            options=[
                QuestionOption(key="A", text=question.option_a),
                QuestionOption(key="B", text=question.option_b),
                QuestionOption(key="C", text=question.option_c),
                QuestionOption(key="D", text=question.option_d),
            ],
            subject=question.subject,
            grade=question.grade,
            difficulty=question.difficulty,
            language=question.language,
            coverage=generated_question_coverage(question).to_dict(),
        )
        for question, practice_session_id in question_rows
    ]
