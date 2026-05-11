"""
Centralized exam scoring service for all question types.

Handles scoring for: single_choice, multiple_choice, context,
matching, fill_blank, image_choice, and ordering formats.

All scoring is server-side — never trust client scores.
"""

import math
from typing import Any

from ..logging_config import get_logger

logger = get_logger("exam_scoring")

# ── Format constants ──────────────────────────────────────────────────────────
FORMAT_SINGLE = "single_choice"
FORMAT_MULTIPLE = "multiple_choice"
FORMAT_CONTEXT = "context"
FORMAT_MATCHING = "matching"
FORMAT_FILL_BLANK = "fill_blank"
FORMAT_IMAGE = "image_choice"
FORMAT_ORDERING = "ordering"

ALL_FORMATS = {
    FORMAT_SINGLE,
    FORMAT_MULTIPLE,
    FORMAT_CONTEXT,
    FORMAT_MATCHING,
    FORMAT_FILL_BLANK,
    FORMAT_IMAGE,
    FORMAT_ORDERING,
}


# ── Per-type scoring helpers ──────────────────────────────────────────────────


def _score_single(user_answer: Any, correct_answer: Any, max_points: int) -> int:
    """
    Score a single-choice or context question.
    user_answer: list with 1 element (e.g. ["A"])
    correct_answer: list with 1 element (e.g. ["A"])
    Returns 0 or 1.
    """
    if not isinstance(user_answer, list) or len(user_answer) != 1:
        return 0
    correct = correct_answer[0] if isinstance(correct_answer, list) else correct_answer
    return 1 if user_answer[0] == correct else 0


def _score_multiple(user_answer: Any, correct_answer: Any, max_points: int) -> int:
    """
    Score a multiple-choice question with partial credit.
    Exact match = max_points (typically 2).
    1 error (symmetric difference) = max_points - 1.
    More errors = 0.
    """
    if not isinstance(user_answer, list):
        return 0
    if not isinstance(correct_answer, list):
        return 0

    user_set = set(user_answer)
    correct_set = set(correct_answer)

    if user_set == correct_set:
        return max_points

    errors = len(user_set ^ correct_set)
    if errors == 1:
        return max(max_points - 1, 0)

    return 0


def _score_matching(user_answer: Any, correct_answer: Any, max_points: int) -> int:
    """
    Score a matching question with partial credit.
    user_answer: dict like {"left_0": "right_2", "left_1": "right_0", ...}
    correct_answer: dict with same structure
    Score: floor(correct_count / total_pairs * max_points)
    """
    if not isinstance(user_answer, dict) or not isinstance(correct_answer, dict):
        return 0

    total_pairs = len(correct_answer)
    if total_pairs == 0:
        return 0

    correct_count = sum(1 for key, value in correct_answer.items() if user_answer.get(key) == value)

    if correct_count == total_pairs:
        return max_points

    return math.floor(correct_count / total_pairs * max_points)


def _normalize_text(text: str) -> str:
    """Normalize text for fill-in-the-blank comparison: strip whitespace, lowercase."""
    return text.strip().lower()


def _score_fill_blank(user_answer: Any, correct_answer: Any, max_points: int) -> int:
    """
    Score a fill-in-the-blank question.

    Single blank:
        user_answer: string
        correct_answer: list of acceptable strings
        Case-insensitive comparison with whitespace normalization.

    Multi-blank:
        user_answer: list of strings (one per blank)
        correct_answer: list of lists of acceptable strings
        Each blank scored independently; total = floor(correct / total * max_points)
    """
    if not isinstance(correct_answer, list) or len(correct_answer) == 0:
        return 0

    # Single blank: user_answer is a string, correct_answer is a flat list of accepted strings
    if isinstance(user_answer, str):
        normalized_user = _normalize_text(user_answer)
        for accepted in correct_answer:
            if isinstance(accepted, str) and _normalize_text(accepted) == normalized_user:
                return max_points
        return 0

    # Multi-blank: user_answer is a list, correct_answer is a list of lists
    if (
        isinstance(user_answer, list)
        and len(correct_answer) > 0
        and isinstance(correct_answer[0], list)
    ):
        total_blanks = len(correct_answer)
        correct_count = 0

        for i, accepted_list in enumerate(correct_answer):
            if i >= len(user_answer):
                continue
            normalized_user = _normalize_text(str(user_answer[i]))
            for accepted in accepted_list:
                if isinstance(accepted, str) and _normalize_text(accepted) == normalized_user:
                    correct_count += 1
                    break

        if correct_count == total_blanks:
            return max_points
        return math.floor(correct_count / total_blanks * max_points)

    return 0


def _score_image(user_answer: Any, correct_answer: Any, max_points: int) -> int:
    """
    Score an image-based question.
    Image is just presentation — scoring is identical to single or multiple choice.
    Dispatches based on whether correct_answer has 1 or multiple elements.
    """
    if not isinstance(correct_answer, list):
        return 0

    if len(correct_answer) == 1:
        return _score_single(user_answer, correct_answer, max_points)
    else:
        return _score_multiple(user_answer, correct_answer, max_points)


def _score_ordering(user_answer: Any, correct_answer: Any, max_points: int) -> int:
    """
    Score an ordering/sequencing question with partial credit.
    user_answer: list of item IDs in user's order
    correct_answer: list of item IDs in correct order
    Exact match = max_points.
    Partial credit: floor(items_in_correct_position / total_items * max_points)
    """
    if not isinstance(user_answer, list) or not isinstance(correct_answer, list):
        return 0

    total_items = len(correct_answer)
    if total_items == 0:
        return 0

    correct_count = sum(
        1
        for i, item in enumerate(correct_answer)
        if i < len(user_answer) and user_answer[i] == item
    )

    if correct_count == total_items:
        return max_points

    return math.floor(correct_count / total_items * max_points)


# ── Dispatch table ────────────────────────────────────────────────────────────

_SCORERS = {
    FORMAT_SINGLE: _score_single,
    FORMAT_CONTEXT: _score_single,
    FORMAT_MULTIPLE: _score_multiple,
    FORMAT_MATCHING: _score_matching,
    FORMAT_FILL_BLANK: _score_fill_blank,
    FORMAT_IMAGE: _score_image,
    FORMAT_ORDERING: _score_ordering,
}


# ── Public API ────────────────────────────────────────────────────────────────


def score_question(
    format: str,
    user_answer: Any,
    correct_answer: Any,
    max_points: int,
) -> int:
    """
    Score a single question by dispatching to the appropriate type handler.

    Args:
        format: Question format string (one of FORMAT_* constants).
        user_answer: The student's submitted answer (type varies by format).
        correct_answer: The correct/accepted answer(s) (type varies by format).
        max_points: Maximum points awardable for this question.

    Returns:
        Integer score in range [0, max_points].
    """
    scorer = _SCORERS.get(format)
    if scorer is None:
        logger.warning("Unknown question format '%s' — awarding 0 points", format)
        return 0

    try:
        points = scorer(user_answer, correct_answer, max_points)
        return min(max(points, 0), max_points)  # Clamp to [0, max_points]
    except Exception:
        logger.error("Error scoring question with format '%s'", format, exc_info=True)
        return 0


def score_exam(
    answers: dict[str, Any],
    questions: list[dict[str, Any]],
) -> int:
    """
    Score a full exam by iterating all questions and summing per-question scores.

    Args:
        answers: Dict mapping question ID to the student's answer.
        questions: List of question dicts, each with keys:
            - id (str): question identifier
            - format or type (str): question format
            - correct_answer (any): correct/accepted answer(s)
            - max_points (int): maximum points for this question

    Returns:
        Total integer score across all questions.
    """
    total = 0

    for q in questions:
        q_id = str(q.get("id", ""))
        q_format = q.get("format") or q.get("type", "")
        correct = q.get("correct_answer")
        max_pts = q.get("max_points", 1)

        user_answer = answers.get(q_id, [])

        points = score_question(q_format, user_answer, correct, max_pts)
        total += points

    return total
