"""
app/services/mistake_service.py
--------------------------------
Smart Mistake Killer Service

Analyzes student mistakes, diagnoses errors using AI, and generates
remedial practice questions based on library citations.
"""

import asyncio
import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import MistakeReview

# v3.49 (2026-05-02): replaced 4x print() with module logger.
# Service was using stdout for both warn-and-continue and
# fallback-after-failure paths, routing around the standard
# logging pipeline.
logger = logging.getLogger(__name__)
from app.services.ai_orchestrator import consult_library

from .openai_failover import OpenAIFailoverClient as OpenAI

# Initialize OpenAI client
client = OpenAI(api_key=settings.OPENAI_API_KEY.get_secret_value())


async def process_mistake(
    db: AsyncSession,
    user_id: int,
    question_data: dict,
    user_answer: str,
    correct_answer: str,
    # === NEW: Gap Closer System fields ===
    topic_tag: str | None = None,
    textbook_chunk_id: int | None = None,
    question_type: str = "practice",  # "practice", "exam", or "chat"
) -> MistakeReview:
    """
    Process a student mistake: analyze, diagnose, and generate remedial questions.

    Workflow:
    1. Get context from library (RAG)
    2. AI analysis with diagnosis and remedial questions
    3. Save to database with Gap Closer metadata
    4. Return MistakeReview object

    Args:
        db: Database session
        user_id: ID of the user who made the mistake
        question_data: Full question data (text, options, etc.)
        user_answer: The student's incorrect answer
        correct_answer: The correct answer
        topic_tag: Topic extracted via AI or from question metadata (for Gap Closer clustering)
        textbook_chunk_id: Source of truth chunk from textbook
        question_type: "practice", "exam", or "chat"

    Returns:
        MistakeReview: The created database record
    """

    # Step 1: Get Context from Library (RAG)
    library_citation = None
    book_context = ""

    try:
        # Extract question text for library search
        question_text = question_data.get("text", question_data.get("question", ""))

        if question_text:
            # Call consult_library to get relevant textbook content
            library_results = await consult_library(
                db=db,
                query=question_text,
                subject=question_data.get("subject"),
                user_id=user_id,
            )

            # Take the top result if available
            if library_results and len(library_results) > 0:
                top_result = library_results[0]

                # Extract citation information
                library_citation = {
                    "book_title": top_result.get("book_title"),
                    "page_number": top_result.get("page_number"),
                    "subject": top_result.get("subject"),
                    "grade": top_result.get("grade"),
                    "citation": top_result.get("citation"),
                    "similarity_score": top_result.get("similarity_score"),
                }

                # Get the content for AI context
                book_context = top_result.get("content", "")
            else:
                # No book found - note this in citation
                library_citation = {
                    "book_title": None,
                    "page_number": None,
                    "note": "No book found in library",
                }
    except Exception:
        # If library search fails, continue without context
        logger.warning(
            "mistake_service: library search failed, continuing without citation",
            exc_info=True,
        )
        library_citation = {"book_title": None, "page_number": None, "note": "Library search error"}

    # Step 2: AI Analysis
    system_prompt = """You are an expert UNT tutor. Diagnose the student's error and generate remedial questions. Output STRICT JSON.

CRITICAL LANGUAGE RULE:
- Detect the language of the user's original question (Russian or Kazakh).
- You MUST generate the diagnosis and ALL remedial_questions (text, options, explanations) in that EXACT SAME language.
- Do NOT output English under any circumstances.
- If the question is in Russian, output everything in Russian.
- If the question is in Kazakh, output everything in Kazakh.
- Translate any technical terms if necessary, but keep the language consistent.

Your task:
1. diagnosis: Explain the error in 1-2 sentences (in the same language as the question).
2. remedial_questions: A list of 3 new questions. Same logic/formula, different numbers. Each question must include:
   - text: The question text (in the same language as the original question)
   - options: An array of 4 options (A, B, C, D) - ALL in the same language
   - correct_answer: The correct option letter (A, B, C, or D)
   - explanation: Brief explanation of the solution (in the same language)

Output format (JSON):
{
  "diagnosis": "Brief explanation of why the student made this mistake (in original question language)",
  "remedial_questions": [
    {
      "text": "Question 1 text (in original question language)",
      "options": ["Option A (in original language)", "Option B (in original language)", "Option C (in original language)", "Option D (in original language)"],
      "correct_answer": "A",
      "explanation": "Why this is correct (in original question language)"
    },
    {
      "text": "Question 2 text (in original question language)",
      "options": ["Option A (in original language)", "Option B (in original language)", "Option C (in original language)", "Option D (in original language)"],
      "correct_answer": "B",
      "explanation": "Why this is correct (in original question language)"
    },
    {
      "text": "Question 3 text (in original question language)",
      "options": ["Option A (in original language)", "Option B (in original language)", "Option C (in original language)", "Option D (in original language)"],
      "correct_answer": "C",
      "explanation": "Why this is correct (in original question language)"
    }
  ]
}"""

    # Resolve the optional library-context block outside the prompt
    # f-string. (Python 3.11 disallows backslash escapes inside an
    # f-string expression — the previous inline `\n` triggered
    # ruff's invalid-syntax check.)
    _nl = "\n"
    book_context_block = (
        f"Book Context from Library:{_nl}{book_context}{_nl}"
        if book_context
        else "No book context found in library."
    )

    user_prompt = f"""Original Question:
{json.dumps(question_data, ensure_ascii=False, indent=2)}

Student's Answer: {user_answer}

Correct Answer: {correct_answer}

{book_context_block}

Please diagnose the student's mistake and generate 3 remedial practice questions with the same concept but different numbers."""

    try:
        # Call OpenAI with JSON response format
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
        )

        # Parse JSON response
        ai_response_text = response.choices[0].message.content
        ai_response = json.loads(ai_response_text)

        diagnosis = ai_response.get("diagnosis", "Error analysis unavailable.")
        remedial_questions = ai_response.get("remedial_questions", [])

        # Validate remedial questions structure
        if not isinstance(remedial_questions, list) or len(remedial_questions) != 3:
            # Fallback: create empty structure
            remedial_questions = [
                {
                    "text": "Remedial question 1",
                    "options": [],
                    "correct_answer": "",
                    "explanation": "",
                },
                {
                    "text": "Remedial question 2",
                    "options": [],
                    "correct_answer": "",
                    "explanation": "",
                },
                {
                    "text": "Remedial question 3",
                    "options": [],
                    "correct_answer": "",
                    "explanation": "",
                },
            ]

    except json.JSONDecodeError:
        logger.exception(
            "mistake_service: failed to parse AI JSON response; raw_len=%d raw_head=%r",
            len(ai_response_text or ""),
            (ai_response_text or "")[:200],
        )
        # Fallback values
        diagnosis = "Error: Could not parse AI diagnosis."
        remedial_questions = []

    except Exception:
        logger.exception("mistake_service: OpenAI API call failed")
        # Fallback values
        diagnosis = "Error: AI analysis unavailable."
        remedial_questions = []

    # Step 3: Save to Database (including Gap Closer System fields)
    mistake_review = MistakeReview(
        user_id=user_id,
        original_question_snapshot=question_data,
        user_answer=user_answer,
        correct_answer=correct_answer,
        ai_diagnosis=diagnosis,
        library_citation=library_citation,
        remedial_questions=remedial_questions,
        is_resolved=False,
        # === Gap Closer System fields ===
        topic_tag=topic_tag,
        textbook_chunk_id=textbook_chunk_id,
        question_type=question_type,
        points_lost=1,  # Fixed at 1 per requirement
        correct_answers_count=0,  # Start at 0, incremented by resurrection logic
    )

    db.add(mistake_review)

    # Step 4: Commit and return
    await db.commit()
    await db.refresh(mistake_review)

    return mistake_review
