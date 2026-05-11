"""
UNT 2025 Scoring Utilities

Centralizes all UNT scoring logic to ensure consistency across the application.

UNT 2025 Structure:
- History of Kazakhstan: 20 questions = 20 points max
- Mathematical Literacy: 10 questions = 10 points max
- Reading Literacy: 10 questions = 10 points max
- Profile Subject 1: 40 questions = 50 points max
- Profile Subject 2: 40 questions = 50 points max
- Total Maximum: 140 points
"""

from ..constants.subjects import get_max_score as _get_max_score


def get_unt_max_points(subject_name: str) -> int:
    """
    Get the maximum UNT points for a given subject.

    Uses canonical subjects constants for accurate scoring.

    Args:
        subject_name: Name of the subject (in any language)

    Returns:
        Maximum UNT points for this subject (20, 10, or 50)

    Examples:
        >>> get_unt_max_points("History of Kazakhstan")
        20
        >>> get_unt_max_points("История Казахстана")
        20
        >>> get_unt_max_points("Physics")
        50
        >>> get_unt_max_points("Физика")
        50
    """
    return _get_max_score(subject_name)


def convert_to_unt_score(raw_score: float, max_score: float, subject_name: str) -> float:
    """
    Convert a raw test score to UNT scale.

    Args:
        raw_score: Points earned on the test
        max_score: Maximum possible points on the test
        subject_name: Name of the subject

    Returns:
        UNT-scaled score (between 0 and subject's max UNT points)

    Examples:
        >>> convert_to_unt_score(15, 20, "History of Kazakhstan")
        15.0  # 15/20 * 20 = 15
        >>> convert_to_unt_score(30, 40, "Physics")
        37.5  # 30/40 * 50 = 37.5
    """
    if not max_score or max_score <= 0:
        return 0.0

    unt_max = get_unt_max_points(subject_name)
    percentage = raw_score / max_score
    unt_score = percentage * unt_max

    return unt_score


def calculate_total_unt_score(subject_scores: dict) -> int:
    """
    Calculate total UNT score from multiple subjects.

    Args:
        subject_scores: Dict mapping subject names to {"score": int, "max_score": int}

    Returns:
        Total UNT score (rounded to integer)

    Example:
        >>> scores = {
        ...     "History of Kazakhstan": {"score": 15, "max_score": 20},
        ...     "Mathematical Literacy": {"score": 8, "max_score": 10},
        ...     "Reading Literacy": {"score": 7, "max_score": 10},
        ...     "Physics": {"score": 32, "max_score": 40},
        ...     "Mathematics": {"score": 36, "max_score": 40}
        ... }
        >>> calculate_total_unt_score(scores)
        120  # 15 + 8 + 7 + 40 + 45 = 115
    """
    total = 0.0

    for subject, data in subject_scores.items():
        raw_score = data.get("score", 0)
        max_score = data.get("max_score", 0)

        unt_score = convert_to_unt_score(raw_score, max_score, subject)
        total += unt_score

    return int(round(total))
