import os

os.environ.setdefault("OPENAI_API_KEY", "test-key")

from app.models import MockQuestion
from app.routers.chat import (
    _extract_practice_bank_question_stem,
    _format_verified_practice_bank_answer,
)


def test_extract_practice_bank_question_stem_strips_mcq_options():
    text = "\nІрі балықтарды аулауға ыңғайлы ілмекті сүңгілер қай кезден бастап?\n\nA) Бір\nB) Екі"

    assert (
        _extract_practice_bank_question_stem(text)
        == "Ірі балықтарды аулауға ыңғайлы ілмекті сүңгілер қай кезден бастап?"
    )


def test_format_verified_practice_bank_answer_uses_answer_key_text():
    question = MockQuestion(
        correct_answer="C",
        options={"A": "Орта палеолитте.", "C": "Кейінгі палеолитте."},
    )

    assert _format_verified_practice_bank_answer(question, "kz") == (
        "Практика банкінде тексерілді.\n\nЖауап: C) Кейінгі палеолитте."
    )
