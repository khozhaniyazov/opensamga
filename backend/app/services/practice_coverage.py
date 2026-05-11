"""Read-only coverage labels for practice-bank questions.

The classifier deliberately uses only metadata already present on
generated/mock questions. It does not infer that unsupported tracks are
covered just because the subject looks similar.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

from app.constants.subjects import get_subject_by_name

PracticeTrack = Literal["standard_unt", "tipo_shortened", "creative_exam", "unknown"]
CoverageConfidence = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class PracticeCoverage:
    track: PracticeTrack
    confidence: CoverageConfidence
    source_kind: str
    subtopics: tuple[str, ...] = ()
    gaps: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["subtopics"] = list(self.subtopics)
        payload["gaps"] = list(self.gaps)
        payload["reasons"] = list(self.reasons)
        return payload


TIPO_MARKERS = (
    "tipo",
    "типо",
    "колледж",
    "college",
    "shortened",
    "сокращ",
    "қысқарт",
    "b062",
    "техникалық және кәсіптік",
)

CREATIVE_MARKERS = (
    "creative",
    "творчес",
    "шығарм",
    "дене шынықтыру",
    "физическая культура",
    "дизайн",
    "музыка",
    "өнер",
)

INFORMATICS_SUBTOPIC_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("python", ("python", "питон", "пайтон")),
    ("sql", ("sql", "select", "database", "база данных", "дерекқор")),
    ("excel", ("excel", "spreadsheet", "электронная таблица", "электрондық кесте")),
    ("html", ("html", "<html", "web-page", "web page", "веб-бет", "веб страница")),
    (
        "algorithms",
        ("algorithm", "алгоритм", "сортиров", "цикл", "loop", "array", "массив"),
    ),
    (
        "theory",
        ("информация", "ақпарат", "бит", "байт", "bit", "byte", "кодирование"),
    ),
)


def _text_blob(*values: object) -> str:
    return " ".join(str(value or "") for value in values).lower()


def _detect_informatics_subtopics(blob: str) -> tuple[str, ...]:
    labels: list[str] = []
    for label, markers in INFORMATICS_SUBTOPIC_MARKERS:
        if any(marker in blob for marker in markers):
            labels.append(label)
    return tuple(labels)


def classify_practice_coverage(
    *,
    subject: str | None,
    grade: int | None,
    language: str | None = None,
    source_kind: str = "unknown",
    topic_tag: str | None = None,
    source: str | None = None,
    source_url: str | None = None,
    question_text: str | None = None,
    citation: dict | None = None,
) -> PracticeCoverage:
    citation = citation or {}
    blob = _text_blob(
        subject,
        grade,
        language,
        source_kind,
        topic_tag,
        source,
        source_url,
        question_text,
        citation.get("book"),
        citation.get("subject"),
        citation.get("quote"),
    )
    subject_info = get_subject_by_name(subject or "")
    reasons: list[str] = []
    gaps: list[str] = []

    if any(marker in blob for marker in TIPO_MARKERS):
        track: PracticeTrack = "tipo_shortened"
        confidence: CoverageConfidence = "medium"
        reasons.append("tipo_marker")
    elif any(marker in blob for marker in CREATIVE_MARKERS):
        track = "creative_exam"
        confidence = "medium"
        reasons.append("creative_exam_marker")
    elif subject_info and grade in (10, 11):
        track = "standard_unt"
        confidence = "high"
        reasons.append("canonical_unt_subject_grade_10_11")
    elif subject_info and grade is None:
        track = "standard_unt"
        confidence = "medium"
        reasons.append("canonical_unt_subject_missing_grade")
        gaps.append("missing_grade")
    elif subject_info:
        track = "unknown"
        confidence = "low"
        reasons.append("canonical_subject_non_unt_grade")
        gaps.append("unsupported_or_unknown_track")
    else:
        track = "unknown"
        confidence = "low"
        reasons.append("unrecognized_subject")
        gaps.append("unrecognized_subject")

    subtopics: tuple[str, ...] = ()
    if subject_info and subject_info.name_en == "Informatics":
        subtopics = _detect_informatics_subtopics(blob)
        if not subtopics:
            gaps.append("informatics_subtopic_unknown")

    return PracticeCoverage(
        track=track,
        confidence=confidence,
        source_kind=source_kind,
        subtopics=subtopics,
        gaps=tuple(dict.fromkeys(gaps)),
        reasons=tuple(dict.fromkeys(reasons)),
    )


def generated_question_coverage(question: object) -> PracticeCoverage:
    return classify_practice_coverage(
        subject=getattr(question, "subject", None),
        grade=getattr(question, "grade", None),
        language=getattr(question, "language", None),
        source_kind="generated_textbook",
        topic_tag=getattr(question, "question_type", None),
        question_text=getattr(question, "question_text", None),
        citation=getattr(question, "citation", None) or {},
    )


def mock_question_coverage(question: object) -> PracticeCoverage:
    return classify_practice_coverage(
        subject=getattr(question, "subject", None),
        grade=getattr(question, "grade", None),
        language=getattr(question, "language", None),
        source_kind="mock_question",
        topic_tag=getattr(question, "topic_tag", None),
        source=getattr(question, "source", None),
        source_url=getattr(question, "source_url", None),
        question_text=getattr(question, "question_text", None),
    )
