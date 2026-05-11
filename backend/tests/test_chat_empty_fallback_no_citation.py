"""Session 23 (2026-04-24): pin down the rag-eval-discovered UX bug where
the chat endpoint wrapped the "empty model response" sentinel in a real
library citation chip.

Evidence: ran `frontend/tests/rag_eval/run_eval.py` over a 20-Q RU+KZ
golden set; Physics RU id=12241 returned:

    <!-- samga-citation book_id=45 page=214 -->
    📚 *Источник: Physics - Physics 8 (Grade 8), Page 214*
    Извините, ответ от модели получился пустым. Попробуйте ещё раз.

…with `book_id=45, page_number=214` on the envelope. The student would
see a polished deep-link card to a book that was never actually used to
compose the answer (because no answer was composed).

Fix (chat.py): after all recovery attempts, if the visible content equals
`_empty_response_fallback(language)`, skip `apply_library_outcome_markers`
entirely and omit `book_id` / `page_number` / `rag_query_log_id` from the
response envelope.

These tests mirror the style of `test_chat.py` (TestClient + heavy
mocking of the OpenAI client, consult_library, and get_db).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import LanguagePreference, StudentProfile, User
from app.routers.chat import _empty_response_fallback

# Same integration marker as test_chat.py: the chat endpoint touches
# save_chat_messages / get_db indirectly even when mocked; keep out of
# the default laptop run.
pytestmark = pytest.mark.integration


def _mock_user() -> User:
    user = User(
        id=1,
        email="test@example.com",
        username="testuser",
        full_name="Test User",
        language_preference=LanguagePreference.RU,
    )
    user.profile = StudentProfile(
        user_id=1,
        current_grade=11,
        chosen_subjects=["Physics"],
        target_majors=["Physics"],
        target_universities=[1],
    )
    return user


def _blank_openai_response() -> MagicMock:
    """An OpenAI chat-completion that returns *nothing* visible (no content,
    no tool calls). This is what actually happens in prod when the provider
    decides to emit only a reasoning block."""
    message = MagicMock()
    message.content = ""
    message.role = "assistant"
    message.tool_calls = None
    choice = MagicMock()
    choice.message = message
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def _fake_library_hit() -> list[dict]:
    """Matches the shape consumed by chat_endpoint's prefetch path."""
    return [
        {
            "book_id": 45,
            "page_number": 214,
            "citation": "Physics - Physics 8 (Grade 8), Page 214",
            "content": "Проекционные аппараты: предмет между фокусом и двойным фокусом…",
            "rag_query_log_id": 777,
        }
    ]


async def _async_noop_get_db():
    yield AsyncMock()


def _patches_common(*, prefetch_hit: bool, recovery_returns: str):
    """Bundle of patches shared across the three tests."""
    consult_mock = AsyncMock(return_value=_fake_library_hit() if prefetch_hit else [])
    recover_mock = AsyncMock(return_value=recovery_returns)
    personal_mock = AsyncMock(return_value="")  # no personal-advice fallback
    save_mock = AsyncMock(return_value=None)
    return [
        patch(
            "app.routers.chat.client.chat.completions.create",
            AsyncMock(return_value=_blank_openai_response()),
        ),
        patch("app.routers.chat.consult_library", consult_mock),
        patch("app.routers.chat.should_use_library_context", return_value=True),
        patch("app.routers.chat.infer_subject_from_query", return_value="Physics"),
        patch("app.routers.chat._recover_blank_assistant_content", recover_mock),
        patch(
            "app.routers.chat._build_personal_university_tool_fallback",
            personal_mock,
        ),
        patch("app.routers.chat.save_chat_messages", save_mock),
        patch("app.routers.chat.get_db", _async_noop_get_db),
        patch(
            "app.routers.auth.get_current_user_optional",
            lambda *a, **kw: _mock_user(),
        ),
    ]


def _enter_all(patches):
    return [p.__enter__() for p in patches]


def _exit_all(patches):
    for p in reversed(patches):
        p.__exit__(None, None, None)


# ---------------------------------------------------------------------------
# RU: sentinel must NOT carry a citation chip or book_id/page metadata.
# ---------------------------------------------------------------------------


def test_empty_fallback_ru_strips_citation_and_book_metadata():
    sentinel_ru = _empty_response_fallback("ru")
    patches = _patches_common(prefetch_hit=True, recovery_returns=sentinel_ru)
    _enter_all(patches)
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/chat",
            json={
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Проекционные аппараты проецируют на экран — предмет располагают где?"
                        ),
                    }
                ],
                "language": "ru",
            },
            headers={
                "Accept-Language": "ru",
                "Authorization": "Bearer test_token",
            },
        )
    finally:
        _exit_all(patches)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    # The visible text is exactly the sentinel — no citation prose prepended.
    assert data["content"].strip() == sentinel_ru
    # No structured hint leaked into the content.
    assert "samga-citation" not in data["content"]
    assert "📚" not in data["content"]
    # Envelope metadata must be absent / null — the FE uses these to render
    # the deep-link card.
    assert data.get("book_id") in (None,)
    assert data.get("page_number") in (None,)
    assert data.get("rag_query_log_id") in (None,)


# ---------------------------------------------------------------------------
# KZ: same guarantee, Kazakh sentinel.
# ---------------------------------------------------------------------------


def test_empty_fallback_kz_strips_citation_and_book_metadata():
    sentinel_kz = _empty_response_fallback("kz")
    patches = _patches_common(prefetch_hit=True, recovery_returns=sentinel_kz)
    _enter_all(patches)
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/chat",
            json={
                "messages": [
                    {
                        "role": "user",
                        "content": "Физика сұрағы — диаскоп пен эпископ қалай жұмыс істейді?",
                    }
                ],
                "language": "kz",
            },
            headers={
                "Accept-Language": "kz",
                "Authorization": "Bearer test_token",
            },
        )
    finally:
        _exit_all(patches)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["content"].strip() == sentinel_kz
    assert "samga-citation" not in data["content"]
    assert "📚" not in data["content"]
    assert data.get("book_id") in (None,)
    assert data.get("page_number") in (None,)
    assert data.get("rag_query_log_id") in (None,)


# ---------------------------------------------------------------------------
# Positive control: real prose MUST still get the chip + envelope metadata.
# Proves the empty-fallback guard doesn't over-strip healthy answers.
# ---------------------------------------------------------------------------


def test_real_answer_still_gets_citation_chip_and_book_metadata():
    real_answer = (
        "Проекционные аппараты (диаскоп, эпископ) помещают предмет "
        "между фокусом и двойным фокусом — правильный ответ E."
    )
    patches = _patches_common(prefetch_hit=True, recovery_returns=real_answer)
    _enter_all(patches)
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/chat",
            json={
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Проекционные аппараты проецируют на экран — предмет располагают где?"
                        ),
                    }
                ],
                "language": "ru",
            },
            headers={
                "Accept-Language": "ru",
                "Authorization": "Bearer test_token",
            },
        )
    finally:
        _exit_all(patches)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Content kept plus library chip prepended.
    assert "фокусом" in data["content"]
    # Either an inline "📚 *Источник: …*" line OR the `<!-- samga-citation -->`
    # hint must be present — this is the whole point of the library outcome
    # markers on happy-path turns.
    assert ("samga-citation book_id=45 page=214" in data["content"]) or (
        "Источник: Physics" in data["content"]
    )
    # Envelope metadata preserved.
    assert data.get("book_id") == 45
    assert data.get("page_number") == 214
    assert data.get("rag_query_log_id") == 777
