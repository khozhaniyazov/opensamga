from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.requests import Request

from app.models import StudentProfile, UniversityDetail, User
from app.routers import chat as chat_router


def _scalar_one_result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _scalars_all_result(values):
    result = MagicMock()
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=values)
    result.scalars = MagicMock(return_value=scalars)
    return result


def _scalar_result(value):
    result = MagicMock()
    result.scalar = MagicMock(return_value=value)
    return result


def _http_request(lang: str = "ru") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/chat",
            "headers": [(b"accept-language", lang.encode("ascii"))],
            "query_string": b"",
            "server": ("testserver", 80),
            "client": ("testclient", 123),
            "scheme": "http",
        }
    )


class _CapturingCompletions:
    def __init__(self):
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        message = SimpleNamespace(
            role="assistant",
            content="Профиліңіз бойынша қысқа жоспар дайын.",
            tool_calls=None,
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.mark.asyncio
async def test_chat_endpoint_sends_onboarding_context_to_model(monkeypatch):
    user = User(id=501, email="prompt@x.test", name="Prompt QA")
    user.profile = StudentProfile(
        user_id=user.id,
        chosen_subjects=["Geography", "Foreign Language"],
        target_university_id=91,
        weakest_subject="Geography",
        last_test_results={
            "History of Kazakhstan": [18],
            "Mathematical Literacy": [9],
            "Reading Literacy": [8],
            "Geography": [50],
            "Foreign Language": [45],
        },
    )
    user.gamification_profile = None

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([]),  # no mock exam activity
            _scalar_result(0),  # no unresolved mistakes
        ]
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", AsyncMock())
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())

    monkeypatch.setattr(
        "app.services.chat.context_builder.get_user_target_threshold",
        AsyncMock(return_value={"grant_threshold": 135}),
    )
    monkeypatch.setattr(
        "app.dependencies.plan_guards._is_premium",
        lambda _user: False,
    )
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="Напиши короткое мотивационное сообщение по моему профилю.",
            )
        ],
    )

    response = await chat_router.chat_endpoint(
        request,
        _http_request("ru"),
        db=db,
        current_user=user,
    )

    assert response["role"] == "assistant"
    assert completions.calls, "Expected chat completion call to be captured"
    system_message = completions.calls[0]["messages"][0]
    assert system_message["role"] == "system"

    system_content = system_message["content"]
    assert "КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ" in system_content
    assert "Prompt QA" in system_content
    assert "Astana IT University" in system_content
    assert "Профильные предметы" in system_content
    assert "Целевая специальность/группа программ" in system_content
    assert "Не выбрана" in system_content
    assert "География" in system_content
    assert "Иностранный язык" in system_content
    assert "Самый слабый предмет по профилю" in system_content
    assert "Последние результаты, введённые при регистрации" in system_content
    assert "50/50" in system_content
    assert "100%" in system_content
    assert "45/50" in system_content
    assert "90%" in system_content
    assert "130/140" in system_content
    assert "Разрыв до гранта" in system_content
    assert "не выбрана специальность/группа программ" in system_content
