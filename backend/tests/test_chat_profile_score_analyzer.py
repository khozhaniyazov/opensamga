from __future__ import annotations

from datetime import UTC, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.requests import Request

from app.models import ExamAttempt, PracticeSession, StudentProfile, UniversityDetail, User
from app.routers import chat as chat_router
from app.services.chat.profile_score_analyzer import (
    MistakeClusterSignal,
    PracticeTrendSignal,
    StudySignals,
    _load_relevant_mistake_clusters,
    _load_study_signals,
    build_profile_score_analysis_response,
    detect_profile_prompt_conflict,
    should_handle_profile_score_analysis,
)
from app.services.gap_analyzer import RECENT_RELEVANT_MISTAKE_LIMIT


# Every test in this file pins the LEGACY non-agent chat path: it mocks
# `chat_router.client` with a sentinel and asserts that the deterministic
# `build_profile_score_analysis_response` (or `_build_personal_university_tool_fallback`)
# short-circuit returns the response without ever calling the LLM. When
# `settings.CHAT_AGENT_LOOP` is true (the production default since s24),
# `chat_endpoint` early-returns into `_run_chat_agent_loop_path`, which
# bypasses these legacy branches entirely and the sentinel response leaks
# through. Force the flag off for this whole module so the legacy
# behaviour is exercised regardless of .env / settings drift.
@pytest.fixture(autouse=True)
def _force_legacy_chat_path(monkeypatch):
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "CHAT_AGENT_LOOP", False)


@pytest.fixture(autouse=True)
def _stub_atomic_charge_counter(monkeypatch):
    """v3.85 added ``_atomic_charge_counter`` which issues an
    ``UPDATE ... RETURNING`` against ``UsageCounter`` and feeds the
    result through ``int(...)``. The legacy-path tests below mock
    ``db.execute`` with a single ``AsyncMock(return_value=<UniversityDetail>)``
    that's also consumed by the charge UPDATE, so ``int()`` blows up
    on the wrong shape.  Stub the helper to a constant 1 — these
    tests pin the legacy LLM path, not the quota-charge plumbing
    (which has its own dedicated tests under tests/test_v3{84,85}_*).
    """
    monkeypatch.setattr(
        "app.dependencies.plan_guards._atomic_charge_counter",
        AsyncMock(return_value=1),
    )


def _scalar_one_result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _scalars_all_result(values):
    result = MagicMock()
    scalars = MagicMock()
    scalars.all.return_value = values
    result.scalars.return_value = scalars
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
            content="LLM response should not be used for this turn.",
            tool_calls=None,
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class _QueuedCompletions:
    def __init__(self, responses: list[dict]):
        self.calls: list[dict] = []
        self._responses = list(responses)

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        payload = self._responses.pop(0)
        message = SimpleNamespace(
            role=payload.get("role", "assistant"),
            content=payload.get("content"),
            tool_calls=payload.get("tool_calls"),
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _profile_user() -> User:
    user = User(id=777, email="score@x.test", name="Score QA")
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
    return user


def _stored_math_it_user() -> User:
    user = User(id=778, email="stored@x.test", name="Stored QA")
    user.profile = StudentProfile(
        user_id=user.id,
        chosen_subjects=["Mathematics", "Informatics"],
        target_university_id=91,
        weakest_subject="Informatics",
        last_test_results={
            "History of Kazakhstan": [16],
            "Mathematical Literacy": [9],
            "Reading Literacy": [10],
            "Mathematics": [49],
            "Informatics": [25],
        },
    )
    user.gamification_profile = None
    return user


@pytest.mark.asyncio
async def test_profile_score_analysis_uses_subject_maximums_without_invented_gap():
    user = _profile_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": None,
                "source": "not_found",
                "major_codes": [],
                "quota_type": "GENERAL",
                "data_year": None,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        (
            "Мой профиль Samga: профильные предметы География и Иностранный язык. "
            "Проанализируй мои последние результаты: какой предмет сильнее, "
            "какой слабее, сколько баллов нужно добрать для цели Astana IT University "
            "и для гранта."
        ),
    )

    assert response is not None
    assert "50/50 (100%)" in response
    assert "45/50 (90%)" in response
    assert "130/140" in response
    assert "резерв +5" in response
    assert "точный разрыв не считаю без выбранной программы" in response
    assert "выдумкой" in response
    assert "поднимать выше 50" in response
    assert "\n\n\n" not in response
    assert "3 шага дальше:\n\n1." in response
    assert "60" not in response
    assert "B057" not in response
    assert "Информационные технологии" not in response
    assert "средн" not in response.casefold()
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_profile_score_analysis_handles_follow_up_focus_prompt():
    user = _profile_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": None,
                "source": "not_found",
                "major_codes": [],
                "quota_type": "GENERAL",
                "data_year": None,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Учитывая мой профиль Samga, на чем мне сфокусироваться дальше?",
    )

    assert response is not None
    assert "Главный фокус сейчас — Иностранный язык: 45/50, резерв +5." in response
    assert "После этого добери История Казахстана: там ещё +2." in response
    assert "Итого по 5 предметам: 130/140" not in response
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_profile_score_analysis_flags_conflicting_prompt_profile_and_uses_stored_profile():
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": None,
                "source": "not_found",
                "major_codes": [],
                "quota_type": "GENERAL",
                "data_year": None,
            }
        ),
    )
    prompt = (
        "Мой профиль Samga: профильные предметы: География и Иностранный язык; "
        "самый слабый предмет: География; университет мечты: Astana IT University. "
        "Проанализируй мои последние результаты и скажи, что делать дальше."
    )

    conflict = await detect_profile_prompt_conflict(user, db, prompt)
    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        prompt,
        profile_conflict=conflict,
    )

    assert conflict is not None
    assert response is not None
    assert "расходятся с сохранённым профилем Samga" in response
    assert "в сообщении: География + Иностранный язык" in response
    assert "в сохранённом профиле: Математика + Информатика" in response
    assert "слабый предмет в сообщении: География; в профиле: Информатика" in response
    assert "Поэтому ниже опираюсь на сохранённый профиль аккаунта." in response
    assert "109/140" in response
    assert "49/50 (98%)" in response
    assert "25/50 (50%)" in response
    assert "Главный резерв сейчас: Информатика +25" in response
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_target_gap_response_humanizes_when_score_is_already_above_unyearly_target():
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 50,
                "source": "university_data",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": None,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Сколько баллов мне нужно для Astana IT University в моем профиле Samga?",
    )

    assert response is not None
    assert "Информационные технологии (B057)" in response
    assert "уже выше этого ориентира на +59" in response
    assert "примерно +0" not in response
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_profile_prompt_conflict_is_ignored_for_hypothetical_scenarios():
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    conflict = await detect_profile_prompt_conflict(
        user,
        db,
        (
            "Предположим, это гипотетический пример: профильные предметы: "
            "География и Иностранный язык; самый слабый предмет: География."
        ),
    )

    assert conflict is None


def test_profile_score_analysis_does_not_hijack_academic_questions():
    user = _profile_user()

    assert not should_handle_profile_score_analysis(
        "Объясни тему климатических поясов по географии.",
        user,
    )


@pytest.mark.asyncio
async def test_chat_endpoint_returns_profile_score_analysis_without_model(monkeypatch):
    user = _profile_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": None,
                "source": "not_found",
                "major_codes": [],
                "quota_type": "GENERAL",
                "data_year": None,
            }
        ),
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content=(
                    "Проанализируй мои последние результаты из профиля: какой "
                    "предмет сильнее, какой слабее, сколько баллов нужно добрать "
                    "для цели Astana IT University и для гранта."
                ),
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
    assert "50/50 (100%)" in response["content"]
    assert "130/140" in response["content"]
    assert "не считаю без выбранной программы" in response["content"]
    assert completions.calls == []
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_profile_score_analysis_supports_compact_today_focus(monkeypatch):
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    user.profile.target_majors = ["B057"]
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Скажи одной строкой, на чем мне сфокусироваться сегодня по моему профилю Samga.",
    )

    assert response is not None
    assert "Главный фокус сейчас — Информатика: 25/50, резерв +25." in response
    assert (
        "По общему конкурсу вижу порог 120/140 (2024), и от текущей базы 109/140 не хватает +11."
        in response
    )
    assert "табл" not in response.casefold()
    assert "| Предмет |" not in response


@pytest.mark.asyncio
async def test_profile_score_analysis_reports_exact_gap_when_threshold_is_grounded(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Сколько баллов мне не хватает до гранта в моем профиле Samga?",
    )

    assert response is not None
    assert "Программа: Информационные технологии (B057)." in response
    assert (
        "По общему конкурсу вижу порог 120/140 (2024), и от текущей базы 109/140 не хватает +11."
        in response
    )
    assert "Главный фокус сейчас — Информатика: 25/50, резерв +25." in response


@pytest.mark.asyncio
async def test_profile_score_analysis_handles_freeform_saved_target_question(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Смогу ли я поступить в AITU?",
    )

    assert response is not None
    assert "Astana IT University" in response
    assert "Информационные технологии (B057)" in response
    assert "не хватает +11" in response
    assert "Главный фокус сейчас — Информатика: 25/50, резерв +25." in response


@pytest.mark.asyncio
async def test_profile_score_analysis_handles_freeform_grant_follow_up(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Что мне делать дальше для гранта?",
    )

    assert response is not None
    assert "Главный фокус сейчас — Информатика: 25/50, резерв +25." in response
    assert "После этого добери История Казахстана: там ещё +4." in response
    assert (
        "По общему конкурсу вижу порог 120/140 (2024), и от текущей базы 109/140 не хватает +11."
        in response
    )


@pytest.mark.asyncio
async def test_profile_score_analysis_builds_weekly_plan_from_real_exam_and_mistakes(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    exam_attempt = ExamAttempt(
        id=541,
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([exam_attempt]),
        ]
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        AsyncMock(
            return_value=[
                {"topic": "Informatics", "points_lost": 7, "mistake_count": 4},
                {"topic": "History of Kazakhstan", "points_lost": 4, "mistake_count": 3},
            ]
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        AsyncMock(return_value=7),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Составь мне план на неделю по моему профилю Samga и последним ошибкам после экзамена.",
    )

    assert response is not None
    assert "Последний осмысленный экзамен: 112/140." in response
    assert (
        "По последнему осмысленному экзамену главный провал сейчас — Информатика: 7 потерянных баллов в 4 ошибках."
        in response
    )
    assert "по результату последнего осмысленного экзамена 112/140 не хватает +8" in response
    assert "текущая база 109/140" not in response
    assert "План на неделю:" in response
    assert "День 1 — Информатика: 70 минут точечных задач + 20 минут журнала ошибок." in response
    assert (
        "День 2 — Информатика: 60 минут тайм-сета + 20 минут повторного решения вчерашних ошибок."
        in response
    )
    assert (
        "День 3 — История Казахстана: 50 минут коротких дриллов + 20 минут теории и формул."
        in response
    )
    assert (
        "День 4 — Математика: 55 минут профильного mixed-сета + 15 минут разбора темпа." in response
    )
    assert (
        "День 5 — Математическая грамотность: 40 минут короткого сета + 15 минут разбора шаблонных ошибок."
        in response
    )
    assert (
        "День 6 — мини-пробник по 5 предметам: 80 минут смешанного блока + 20 минут разбора."
        in response
    )
    assert (
        "День 7 — контрольный пробник: в конце цикла сделай полный пробник и сверь новую базу с порогом 120/140 (2024, общий конкурс)."
        in response
    )


@pytest.mark.asyncio
async def test_profile_score_analysis_handles_mistake_review_prompt_without_grounded_mistakes(
    monkeypatch,
):
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([]),
        ]
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": None,
                "source": "not_found",
                "major_codes": [],
                "quota_type": "GENERAL",
                "data_year": None,
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        AsyncMock(return_value=[]),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Проанализируй мои ошибки после экзамена и скажи, что делать дальше.",
    )

    assert response is not None
    assert "По актуальным нерешённым ошибкам данных пока мало" in response
    assert "Что делать дальше:" in response
    assert "Параллельно держи профильный резерв по Информатика: там ещё +25." in response


@pytest.mark.asyncio
async def test_profile_score_analysis_builds_daily_plan_from_recent_signals(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    exam_attempt = ExamAttempt(
        id=654,
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([exam_attempt]),
        ]
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        AsyncMock(
            return_value=[
                {"topic": "Mathematics", "points_lost": 6, "mistake_count": 4},
                {"topic": "Informatics", "points_lost": 3, "mistake_count": 2},
            ]
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        AsyncMock(return_value=6),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Что мне учить сегодня по моему профилю Samga после последнего экзамена?",
    )

    assert response is not None
    assert "План на сегодня:" in response
    assert (
        "По последнему осмысленному экзамену главный провал сейчас — Математика: 6 потерянных баллов в 4 ошибках."
        in response
    )
    assert "1. Блок 1 — Математика: 55 минут точечных задач + 15 минут разбора." in response
    assert (
        "2. Блок 2 — Информатика: 35 минут короткого mixed-сета + 10 минут формул и правил."
        in response
    )
    assert (
        "3. Финал дня — 20 минут самопроверки: в конце цикла сделай полный пробник и сверь новую базу с порогом 120/140 (2024, общий конкурс)."
        in response
    )


@pytest.mark.asyncio
async def test_profile_score_analysis_builds_three_day_sprint(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    exam_attempt = ExamAttempt(
        id=722,
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([exam_attempt]),
        ]
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        AsyncMock(
            return_value=[
                {"topic": "Informatics", "points_lost": 7, "mistake_count": 4},
                {"topic": "Mathematics", "points_lost": 4, "mistake_count": 2},
            ]
        ),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        AsyncMock(return_value=6),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Собери мне 3-дневный спринт по моему профилю Samga после этого экзамена.",
    )

    assert response is not None
    assert "3-дневный спринт:" in response
    assert "День 1 — Информатика: 65 минут точечных задач + 20 минут разбора." in response
    assert "День 2 — Математика: 50 минут mixed-сета + 20 минут теории." in response
    assert (
        "День 3 — мини-пробник и разбор: в конце цикла сделай полный пробник и сверь новую базу с порогом 120/140 (2024, общий конкурс)."
        in response
    )


@pytest.mark.asyncio
async def test_load_relevant_mistake_clusters_prefers_recent_subject_scoped_window(monkeypatch):
    user = _stored_math_it_user()
    latest_exam = ExamAttempt(
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    cluster_mock = AsyncMock(
        side_effect=[
            [{"topic": "Informatics", "points_lost": 5, "mistake_count": 3}],
        ]
    )
    count_mock = AsyncMock(return_value=3)
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        cluster_mock,
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        count_mock,
    )

    unresolved_count, top_mistakes = await _load_relevant_mistake_clusters(
        user,
        AsyncMock(),
        latest_exam,
    )

    assert unresolved_count == 3
    assert len(top_mistakes) == 1
    assert top_mistakes[0].topic == "Informatics"
    first_call = cluster_mock.await_args_list[0]
    assert first_call.kwargs["recent_days"] == 45
    assert first_call.kwargs["question_types"] == ("exam", "practice")
    assert first_call.kwargs["recent_limit"] == RECENT_RELEVANT_MISTAKE_LIMIT
    assert "Mathematics" in first_call.kwargs["topic_tags"]
    assert "Informatics" in first_call.kwargs["topic_tags"]
    first_count_call = count_mock.await_args_list[0]
    assert first_count_call.kwargs["recent_limit"] == RECENT_RELEVANT_MISTAKE_LIMIT


@pytest.mark.asyncio
async def test_load_study_signals_prefers_exact_latest_exam_attempt(monkeypatch):
    user = _stored_math_it_user()
    latest_exam = ExamAttempt(
        id=321,
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result([latest_exam]))
    cluster_mock = AsyncMock(
        side_effect=[
            [{"topic": "Informatics", "points_lost": 6, "mistake_count": 4}],
        ]
    )
    count_mock = AsyncMock(return_value=4)
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        cluster_mock,
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        count_mock,
    )

    signals = await _load_study_signals(user, db)

    assert signals.latest_exam_attempt_id == 321
    assert signals.latest_exam_mistakes_are_exact is True
    assert signals.unresolved_mistakes_count == 4
    assert signals.primary_mistake is not None
    assert signals.primary_mistake.topic == "Informatics"
    first_cluster_call = cluster_mock.await_args_list[0]
    assert first_cluster_call.kwargs["exam_attempt_id"] == 321
    assert first_cluster_call.kwargs["question_types"] == ("exam",)
    first_count_call = count_mock.await_args_list[0]
    assert first_count_call.kwargs["exam_attempt_id"] == 321


@pytest.mark.asyncio
async def test_load_study_signals_falls_back_when_latest_exam_bucket_is_empty(monkeypatch):
    user = _stored_math_it_user()
    latest_exam = ExamAttempt(
        id=654,
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result([latest_exam]))
    cluster_mock = AsyncMock(
        side_effect=[
            [],
            [{"topic": "Mathematics", "points_lost": 5, "mistake_count": 3}],
        ]
    )
    count_mock = AsyncMock(return_value=3)
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        cluster_mock,
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        count_mock,
    )

    signals = await _load_study_signals(user, db)

    assert signals.latest_exam_mistakes_are_exact is False
    assert signals.primary_mistake is not None
    assert signals.primary_mistake.topic == "Mathematics"
    assert cluster_mock.await_args_list[0].kwargs["exam_attempt_id"] == 654
    assert cluster_mock.await_args_list[1].kwargs["recent_days"] == 45


@pytest.mark.asyncio
async def test_load_study_signals_looks_past_recent_abandoned_attempts(monkeypatch):
    user = _stored_math_it_user()
    abandoned_attempts = [
        ExamAttempt(
            id=700 + index,
            user_id=user.id,
            subjects=["Mathematics", "Informatics"],
            total_questions=120,
            time_limit_seconds=7200,
            score=0,
            max_score=140,
            answers={str(q): "" for q in range(120)},
            started_at=datetime.now(UTC),
            submitted_at=datetime.now(UTC),
            time_taken_seconds=300,
        )
        for index in range(5)
    ]
    meaningful_attempt = ExamAttempt(
        id=706,
        user_id=user.id,
        subjects=["Mathematics", "Informatics"],
        total_questions=120,
        time_limit_seconds=7200,
        score=112,
        max_score=140,
        answers={str(index): "A" for index in range(50)},
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        time_taken_seconds=1800,
    )
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalars_all_result([*abandoned_attempts, meaningful_attempt])
    )
    cluster_mock = AsyncMock(
        return_value=[{"topic": "Informatics", "points_lost": 6, "mistake_count": 4}]
    )
    count_mock = AsyncMock(return_value=4)
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        cluster_mock,
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        count_mock,
    )

    signals = await _load_study_signals(user, db)

    assert signals.latest_exam_attempt_id == 706
    assert signals.latest_exam_mistakes_are_exact is True
    assert cluster_mock.await_args_list[0].kwargs["exam_attempt_id"] == 706


@pytest.mark.asyncio
async def test_load_study_signals_prefers_exact_latest_practice_session(monkeypatch):
    user = _stored_math_it_user()
    latest_practice = PracticeSession(
        id=912,
        user_id=user.id,
        subject="Informatics",
        target_questions=10,
        generated_questions_count=5,
        answered_questions_count=5,
        correct_answers_count=3,
        started_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result([latest_practice]))
    cluster_mock = AsyncMock(
        return_value=[{"topic": "Informatics", "points_lost": 4, "mistake_count": 3}]
    )
    count_mock = AsyncMock(return_value=3)
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.cluster_mistakes_by_topic",
        cluster_mock,
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.count_unresolved_mistakes",
        count_mock,
    )

    signals = await _load_study_signals(user, db, preference="practice")

    assert signals.latest_practice_session_id == 912
    assert signals.latest_practice_score == 3
    assert signals.latest_practice_max_score == 5
    assert signals.latest_practice_mistakes_are_exact is True
    assert signals.latest_exam_attempt_id is None
    assert signals.primary_mistake is not None
    assert signals.primary_mistake.topic == "Informatics"
    first_cluster_call = cluster_mock.await_args_list[0]
    assert first_cluster_call.kwargs["practice_session_id"] == 912
    assert first_cluster_call.kwargs["question_types"] == ("practice",)
    first_count_call = count_mock.await_args_list[0]
    assert first_count_call.kwargs["practice_session_id"] == 912


@pytest.mark.asyncio
async def test_load_study_signals_builds_recent_practice_trends(monkeypatch):
    user = _stored_math_it_user()
    now = datetime.now(UTC)
    practice_rows = [
        PracticeSession(
            id=930,
            user_id=user.id,
            subject="Informatics",
            target_questions=10,
            generated_questions_count=5,
            answered_questions_count=5,
            correct_answers_count=3,
            started_at=now,
            updated_at=now,
        ),
        PracticeSession(
            id=929,
            user_id=user.id,
            subject="Mathematics",
            target_questions=10,
            generated_questions_count=5,
            answered_questions_count=5,
            correct_answers_count=2,
            started_at=now,
            updated_at=now,
        ),
        PracticeSession(
            id=928,
            user_id=user.id,
            subject="Mathematics",
            target_questions=10,
            generated_questions_count=4,
            answered_questions_count=4,
            correct_answers_count=2,
            started_at=now,
            updated_at=now,
        ),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result(practice_rows))
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer._load_latest_practice_mistake_clusters",
        AsyncMock(return_value=(0, ())),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer._load_relevant_mistake_clusters",
        AsyncMock(return_value=(0, ())),
    )

    signals = await _load_study_signals(user, db, preference="practice")

    assert len(signals.recent_practice_trends) >= 2
    assert signals.recent_practice_trends[0].subject == "Mathematics"
    assert signals.recent_practice_trends[0].sessions == 2
    assert signals.recent_practice_trends[0].points_lost == 5
    assert signals.recent_practice_trends[1].subject == "Informatics"
    assert signals.recent_practice_trends[1].points_lost == 2


@pytest.mark.asyncio
async def test_profile_score_analysis_routes_practice_prompt_to_practice_signals(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "university_name": "Astana IT University",
                "grant_threshold": 50,
                "quota_type": "GENERAL",
                "data_year": 2025,
            }
        ),
    )
    load_signals_mock = AsyncMock(
        return_value=StudySignals(
            latest_exam_attempt_id=None,
            latest_exam_score=None,
            latest_exam_max_score=None,
            latest_exam_subjects=(),
            latest_exam_mistakes_are_exact=False,
            latest_practice_session_id=77,
            latest_practice_score=3,
            latest_practice_max_score=5,
            latest_practice_subjects=("Informatics",),
            latest_practice_mistakes_are_exact=True,
            recent_practice_trends=(),
            unresolved_mistakes_count=3,
            top_mistakes=(MistakeClusterSignal("Informatics", 4, 3),),
        )
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer._load_study_signals",
        load_signals_mock,
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Что мне учить сегодня после этой практики в Samga Practice?",
    )

    assert response is not None
    load_signals_mock.assert_awaited_once()
    assert load_signals_mock.await_args.kwargs["preference"] == "practice"
    assert "последней практике" in response or "последней практики" in response


@pytest.mark.asyncio
async def test_profile_score_analysis_broader_practice_followup_uses_practice_study_signals(
    monkeypatch,
):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "university_name": "Astana IT University",
                "grant_threshold": 50,
                "quota_type": "GENERAL",
                "data_year": 2025,
            }
        ),
    )
    load_signals_mock = AsyncMock(
        return_value=StudySignals(
            latest_practice_session_id=77,
            latest_practice_score=3,
            latest_practice_max_score=5,
            latest_practice_subjects=("Informatics",),
            latest_practice_mistakes_are_exact=True,
            recent_practice_trends=(
                PracticeTrendSignal(
                    subject="Mathematics",
                    sessions=2,
                    answered=9,
                    correct=4,
                    points_lost=5,
                ),
            ),
            unresolved_mistakes_count=3,
            top_mistakes=(MistakeClusterSignal("Informatics", 4, 3),),
        )
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer._load_study_signals",
        load_signals_mock,
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "Что мне делать дальше после этой практики в Samga Practice?",
    )

    assert response is not None
    load_signals_mock.assert_awaited_once()
    assert load_signals_mock.await_args.kwargs["preference"] == "practice"
    assert "Последняя практика: 3/5." in response
    assert "Математика" in response
    assert "Что делать дальше:" in response


@pytest.mark.asyncio
async def test_profile_score_analysis_does_not_hijack_other_university_prompt(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )

    response = await build_profile_score_analysis_response(
        user,
        db,
        "ru",
        "С моим профилем Samga смогу ли я поступить в KBTU?",
    )

    assert response is None


@pytest.mark.asyncio
async def test_chat_endpoint_adds_profile_conflict_note_to_system_prompt(monkeypatch):
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(
        chat_router,
        "build_user_context_prompt",
        AsyncMock(
            return_value="КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ\n- Профильные предметы: Математика, Информатика"
        ),
    )
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content=(
                    "Мой профиль Samga: профильные предметы: География и Иностранный язык; "
                    "самый слабый предмет: География. Напиши мне короткое мотивационное сообщение."
                ),
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
    assert completions.calls, "Expected generic LLM path to be used"
    system_content = completions.calls[0]["messages"][0]["content"]
    assert "КОНТРОЛЬ ПРОФИЛЯ" in system_content
    assert "не совпадают с сохранённым профилем Samga" in system_content
    assert "в сообщении: География + Иностранный язык" in system_content
    assert "в сохранённом профиле: Математика + Информатика" in system_content
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_skips_user_context_for_nonpersonal_turn(monkeypatch):
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    context_builder = AsyncMock(
        return_value="ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:\n- Целевой университет: Astana IT University"
    )
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(chat_router, "build_user_context_prompt", context_builder)
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="Привет, что ты умеешь?",
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
    context_builder.assert_not_awaited()
    system_content = completions.calls[0]["messages"][0]["content"]
    # The literal label "ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:" appears as a *reference*
    # in the system-prompt guidance ("Цифры из блока ПРОФИЛЬ
    # ПОЛЬЗОВАТЕЛЯ: …") regardless of injection. What we actually want
    # to assert is that the user's data wasn't injected — assert against
    # the unique payload from the mocked context_builder.
    assert "Целевой университет: Astana IT University" not in system_content
    assert "ПЕРСОНАЛИЗАЦИЯ:" not in system_content
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_handles_freeform_saved_target_without_model(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        "app.services.chat.profile_score_analyzer.get_user_target_threshold",
        AsyncMock(
            return_value={
                "grant_threshold": 120,
                "source": "historical",
                "major_codes": ["B057"],
                "quota_type": "GENERAL",
                "data_year": 2024,
            }
        ),
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="Смогу ли я поступить в AITU?",
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
    assert "Astana IT University" in response["content"]
    assert "не хватает +11" in response["content"]
    assert completions.calls == []
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_recovers_when_tool_path_finishes_with_blank_content(monkeypatch):
    user = _stored_math_it_user()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    tool_call = SimpleNamespace(
        id="tc_1",
        type="function",
        function=SimpleNamespace(
            name="find_universities_by_score",
            arguments='{"score": 109, "major_code": "B057", "quota_type": "GENERAL"}',
        ),
    )
    completions = _QueuedCompletions(
        [
            {"content": "", "tool_calls": [tool_call]},
            {"content": ""},
            {"content": "Recovered KBTU answer"},
        ]
    )
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(
        chat_router,
        "build_user_context_prompt",
        AsyncMock(
            return_value="КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ\n- Целевой университет: Astana IT University"
        ),
    )
    monkeypatch.setattr(chat_router, "execute_tool", AsyncMock(return_value='{"ok": true}'))
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="С моим профилем Samga смогу ли я поступить в KBTU?",
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
    assert response["content"] == "Recovered KBTU answer"
    assert len(completions.calls) == 3
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_uses_personal_university_tool_path_without_model(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(
        chat_router,
        "execute_tool",
        AsyncMock(
            return_value='{"статус":"рискованный","сообщение":"Ваш балл (109) близок к порогу (110).","data_year":2025}'
        ),
    )
    monkeypatch.setattr(
        "app.routers.chat.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="С моим профилем Samga смогу ли я поступить в KBTU?",
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
    assert (
        "По KBTU для Информационные технологии (B057) вижу ориентир 110/140 (2025)."
        in response["content"]
    )
    assert "от текущей базы 109/140 не хватает +1" in response["content"]
    assert completions.calls == []
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_compares_universities_from_saved_profile_without_model(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(
        chat_router,
        "execute_tool",
        AsyncMock(
            side_effect=[
                '{"статус":"рискованный","сообщение":"Ваш балл (109) близок к порогу (110).","data_year":2025}',
                '{"статус":"безопасный","сообщение":"Ваш балл (109) значительно выше порога (50).","data_year":2025}',
            ]
        ),
    )
    monkeypatch.setattr(
        "app.routers.chat.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="Стоит ли мне выбирать KBTU вместо AITU?",
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
    assert (
        "С твоей текущей Samga-базой 109/140 по Информационные технологии (B057) разница такая:"
        in response["content"]
    )
    assert "- KBTU: 110/140 (2025), от текущей базы 109/140 не хватает +1." in response["content"]
    assert (
        "- Astana IT University: 50/140 (2025), от текущей базы 109/140 это запас +59."
        in response["content"]
    )
    assert "более уверенный вариант — Astana IT University" in response["content"]
    assert completions.calls == []
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_returns_safe_and_target_universities_without_model(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(
        chat_router,
        "execute_tool",
        AsyncMock(
            return_value=(
                '{"student_score":109,"quota_type":"GENERAL",'
                '"safe_universities":[{"uni_name":"Astana IT University","major_code":"B057","min_score":98,"your_margin":11,"data_year":2024}],'
                '"target_universities":[{"uni_name":"SDU University","major_code":"B057","min_score":108,"your_margin":1,"data_year":2024}],'
                '"reach_universities":[{"uni_name":"KBTU","major_code":"B057","min_score":110,"your_margin":-1,"data_year":2025}],'
                '"recommendation":"Рекомендуем: 2 БЕЗОПАСНЫХ + 1 ЦЕЛЕВОЙ + 1 МЕЧТА"}'
            )
        ),
    )
    monkeypatch.setattr(
        "app.routers.chat.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="Какие у меня безопасные и целевые вузы?",
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
    assert (
        "С твоей Samga-базой 109/140 по Информационные технологии (B057) я бы разложил варианты так:"
        in response["content"]
    )
    assert "Безопасные варианты:" in response["content"]
    assert "Astana IT University: 98/140 (2024), запас +11" in response["content"]
    assert "Целевые варианты:" in response["content"]
    assert "SDU University: 108/140 (2024), запас +1" in response["content"]
    assert "Более рискованные, но ещё рабочие варианты:" in response["content"]
    assert "KBTU: 110/140 (2025), не хватает +1" in response["content"]
    assert completions.calls == []
    save_chat_messages.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_endpoint_handles_where_should_i_apply_prompt_without_model(monkeypatch):
    user = _stored_math_it_user()
    user.profile.target_majors = ["B057"]
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalar_one_result(UniversityDetail(full_name="Astana IT University"))
    )

    completions = _CapturingCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    save_chat_messages = AsyncMock()
    monkeypatch.setattr(chat_router, "client", fake_client)
    monkeypatch.setattr(chat_router, "save_chat_messages", save_chat_messages)
    monkeypatch.setattr(chat_router, "capture_failed_query", AsyncMock())
    monkeypatch.setattr(
        chat_router,
        "execute_tool",
        AsyncMock(
            return_value=(
                '{"student_score":109,"quota_type":"GENERAL",'
                '"safe_universities":[{"uni_name":"Astana IT University","major_code":"B057","min_score":98,"your_margin":11,"data_year":2024}],'
                '"target_universities":[{"uni_name":"SDU University","major_code":"B057","min_score":108,"your_margin":1,"data_year":2024}],'
                '"reach_universities":[{"uni_name":"KBTU","major_code":"B057","min_score":110,"your_margin":-1,"data_year":2025}],'
                '"recommendation":"Рекомендуем: 2 БЕЗОПАСНЫХ + 1 ЦЕЛЕВОЙ + 1 МЕЧТА"}'
            )
        ),
    )
    monkeypatch.setattr(
        "app.routers.chat.resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr("app.dependencies.plan_guards._is_premium", lambda _user: False)
    monkeypatch.setattr(
        "app.dependencies.plan_guards._get_or_create_counter",
        AsyncMock(return_value=SimpleNamespace(user_id=778, chat_messages=0)),
    )

    request = chat_router.ChatRequest(
        language="ru",
        messages=[
            chat_router.ChatMessage(
                role="user",
                content="Куда мне лучше подать с моим профилем?",
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
    assert "Рабочая стратегия подачи: 2 безопасных + 1 целевой вариант." in response["content"]
    assert "Astana IT University: 98/140 (2024), запас +11" in response["content"]
    assert "KBTU: 110/140 (2025), не хватает +1" in response["content"]
    assert completions.calls == []
    save_chat_messages.assert_awaited_once()
