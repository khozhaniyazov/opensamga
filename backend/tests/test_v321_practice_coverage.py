from types import SimpleNamespace

from app.services.practice_coverage import (
    classify_practice_coverage,
    generated_question_coverage,
    mock_question_coverage,
)


def test_standard_unt_generated_question_is_high_confidence():
    coverage = generated_question_coverage(
        SimpleNamespace(
            subject="Mathematics",
            grade=11,
            language="ru",
            question_type="factual",
            question_text="Find the derivative.",
            citation={"book": "Mathematics 11", "quote": "Derivative rules"},
        )
    )

    assert coverage.track == "standard_unt"
    assert coverage.confidence == "high"
    assert coverage.source_kind == "generated_textbook"
    assert coverage.gaps == ()
    assert "canonical_unt_subject_grade_10_11" in coverage.reasons


def test_tipo_marker_is_not_silently_marked_standard_unt():
    coverage = classify_practice_coverage(
        subject="Physics",
        grade=11,
        source_kind="mock_question",
        question_text="B062 shortened college path электрика question",
    )

    assert coverage.track == "tipo_shortened"
    assert coverage.confidence == "medium"
    assert "tipo_marker" in coverage.reasons


def test_creative_exam_marker_gets_own_track():
    coverage = classify_practice_coverage(
        subject="Дизайн",
        grade=11,
        question_text="Творческий экзамен: композиция және шығармашылық тапсырма",
    )

    assert coverage.track == "creative_exam"
    assert coverage.confidence == "medium"
    assert "creative_exam_marker" in coverage.reasons


def test_informatics_subtopics_are_detected_from_question_text():
    coverage = generated_question_coverage(
        SimpleNamespace(
            subject="Informatics",
            grade=11,
            language="ru",
            question_type="factual",
            question_text="Python алгоритм uses SQL SELECT and HTML table.",
            citation={"book": "Informatics 11", "quote": "Python and SQL"},
        )
    )

    assert coverage.track == "standard_unt"
    assert coverage.subtopics == ("python", "sql", "html", "algorithms")
    assert "informatics_subtopic_unknown" not in coverage.gaps


def test_informatics_without_subtopic_reports_gap():
    coverage = classify_practice_coverage(
        subject="Informatics",
        grade=11,
        question_text="General informatics question",
    )

    assert coverage.track == "standard_unt"
    assert coverage.subtopics == ()
    assert "informatics_subtopic_unknown" in coverage.gaps


def test_mock_question_wrapper_preserves_source_kind_and_missing_grade_gap():
    coverage = mock_question_coverage(
        SimpleNamespace(
            subject="History of Kazakhstan",
            grade=None,
            language="kz",
            source="ymnik",
            source_url="https://example.test",
            topic_tag="history",
            question_text="Қазақ хандығы туралы сұрақ",
        )
    )

    assert coverage.track == "standard_unt"
    assert coverage.confidence == "medium"
    assert coverage.source_kind == "mock_question"
    assert "missing_grade" in coverage.gaps
