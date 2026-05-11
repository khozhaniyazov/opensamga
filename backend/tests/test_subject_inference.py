"""Regression tests for subject inference (BUG-12 v3 follow-up).

The prefetched-library path in `chat.chat_endpoint` uses
`infer_subject_from_query` to decide which subject to filter on before
calling `consult_library`. If it returns `None`, the vector search runs
over the entire corpus, and short RU cosine scores can let Informatics
chunks outrank Mathematics chunks for a quadratic-equation question.

These tests pin the current mappings so a future edit cannot silently
regress them.
"""

from __future__ import annotations

import pytest

from app.services.library_retrieval import infer_subject_from_query


@pytest.mark.parametrize(
    "query,expected",
    [
        # Mathematics — short concept names
        ("Объясни дискриминант", "Mathematics"),
        ("Как решать квадратные уравнения через дискриминант?", "Mathematics"),
        ("Дискриминант арқылы квадраттық теңдеуді қалай шешеміз?", "Mathematics"),
        ("квадратное уравнение ax^2+bx+c=0", "Mathematics"),
        ("найди корни уравнения", "Mathematics"),
        # Physics
        ("Сформулируй закон всемирного тяготения", "Physics"),
        ("что такое гравитационная сила", "Physics"),
        ("ауырлық күші деген не", "Physics"),
        # Chemistry
        ("что такое моль в химии", "Chemistry"),
        ("реакция окисления", "Chemistry"),
        # Biology
        ("что такое клетка", "Biology"),
        ("расскажи про митоз", "Biology"),
        # History of Kazakhstan
        ("расскажи про казахское ханство", "History of Kazakhstan"),
        ("Кенесары кім болды", "History of Kazakhstan"),
        # Geography — use queries that don't also match "казахстан" keyword
        ("политическая карта мира", "Geography"),
        ("горы и реки материка", "Geography"),
        # Informatics — should survive the Mathematics expansion
        ("напиши sql запрос", "Informatics"),
        ("что такое алгоритм сортировки", "Informatics"),
    ],
)
def test_subject_inference_routes_correctly(query: str, expected: str) -> None:
    assert infer_subject_from_query(query) == expected


def test_subject_inference_returns_none_for_nonacademic_questions() -> None:
    assert infer_subject_from_query("как приготовить борщ") is None
    assert infer_subject_from_query("расскажи анекдот") is None
