from app.routers.exam import _has_meaningful_answer
from app.services.gap_analyzer import (
    compute_profile_latest_total,
    count_meaningful_exam_answers,
    is_representative_mock_exam,
)


def test_has_meaningful_answer_rejects_blank_payloads():
    assert _has_meaningful_answer(None) is False
    assert _has_meaningful_answer("") is False
    assert _has_meaningful_answer([]) is False
    assert _has_meaningful_answer(["", None]) is False
    assert _has_meaningful_answer({"q1": "", "q2": []}) is False


def test_has_meaningful_answer_accepts_real_selection():
    assert _has_meaningful_answer("A") is True
    assert _has_meaningful_answer(["A"]) is True
    assert _has_meaningful_answer({"q1": ["A"]}) is True


def test_count_meaningful_exam_answers_counts_only_real_attempts():
    answers = {
        "q1": [],
        "q2": ["A"],
        "q3": "",
        "q4": {"left": "", "right": "B"},
        "q5": None,
    }
    assert count_meaningful_exam_answers(answers) == 2


def test_is_representative_mock_exam_rejects_tiny_probe():
    assert (
        is_representative_mock_exam(
            2,
            {
                "q1": ["A"],
                "q2": [],
            },
        )
        is False
    )


def test_is_representative_mock_exam_accepts_partial_full_mock():
    answers = {f"q{i}": ["A"] if i < 45 else [] for i in range(120)}
    assert is_representative_mock_exam(120, answers) is True


def test_compute_profile_latest_total_uses_all_five_subjects():
    chosen_subjects = ["Mathematics", "Informatics"]
    last_test_results = {
        "History of Kazakhstan": [14, 16],
        "Mathematical Literacy": [7, 8],
        "Reading Literacy": [8, 9],
        "Mathematics": [32, 34],
        "Informatics": [41, 42],
    }

    assert compute_profile_latest_total(chosen_subjects, last_test_results) == 109


def test_compute_profile_latest_total_falls_back_to_last_valid_score_when_needed():
    chosen_subjects = ["Mathematics", "Informatics"]
    last_test_results = {
        "History of Kazakhstan": [14, 16],
        "Mathematical Literacy": [7, 12],
        "Reading Literacy": [8, 9],
        "Mathematics": [32, 34],
        "Informatics": [41, 42],
    }

    assert compute_profile_latest_total(chosen_subjects, last_test_results) == 108
