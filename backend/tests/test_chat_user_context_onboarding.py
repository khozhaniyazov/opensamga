from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import ActivityLog, ActivityType, StudentProfile, UniversityDetail, User
from app.services.chat import context_builder
from app.services.gap_analyzer import RECENT_RELEVANT_MISTAKE_LIMIT


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


@pytest.mark.asyncio
async def test_user_context_prompt_includes_onboarding_profile(monkeypatch):
    user = User(id=123, email="context@x.test", name="Context QA")
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

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([]),  # no completed mock exams yet
            _scalar_result(0),  # no unresolved mistakes yet
        ]
    )

    monkeypatch.setattr(
        context_builder,
        "get_user_target_threshold",
        AsyncMock(return_value={"grant_threshold": 135}),
    )

    prompt = await context_builder.build_user_context_prompt(user, db, "ru")

    assert "КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ" in prompt
    assert "Context QA" in prompt
    assert "Astana IT University" in prompt
    assert "Профильные предметы" in prompt
    assert "Целевая специальность/группа программ" in prompt
    assert "Не выбрана" in prompt
    assert "География" in prompt
    assert "Иностранный язык" in prompt
    assert "Самый слабый предмет по профилю" in prompt
    assert "Последние результаты, введённые при регистрации" in prompt
    assert "50/50" in prompt
    assert "100%" in prompt
    assert "45/50" in prompt
    assert "90%" in prompt
    assert "130/140" in prompt
    assert "Разрыв до гранта" in prompt
    assert "не выбрана специальность/группа программ" in prompt


@pytest.mark.asyncio
async def test_user_context_prompt_surfaces_unresolved_major_mapping(monkeypatch):
    user = User(id=124, email="context-major@x.test", name="Context Major QA")
    user.profile = StudentProfile(
        user_id=user.id,
        chosen_subjects=["Geography", "Foreign Language"],
        target_university_id=91,
        target_majors=["mystery major"],
        weakest_subject="Geography",
        last_test_results={
            "History of Kazakhstan": [18],
            "Mathematical Literacy": [9],
            "Reading Literacy": [8],
            "Geography": [50],
            "Foreign Language": [45],
        },
    )

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([]),  # no completed mock exams yet
            _scalar_result(0),  # no unresolved mistakes yet
        ]
    )

    monkeypatch.setattr(
        context_builder,
        "resolve_major_titles",
        AsyncMock(return_value=["mystery major"]),
    )
    monkeypatch.setattr(
        context_builder,
        "get_user_target_threshold",
        AsyncMock(return_value={"grant_threshold": None, "source": "major_not_resolved"}),
    )

    prompt = await context_builder.build_user_context_prompt(user, db, "ru")

    assert "Целевая специальность/группа программ: mystery major" in prompt
    assert "Разрыв до гранта" in prompt
    assert (
        "код/название группы программ из профиля не удалось надёжно сопоставить с базой" in prompt
    )


@pytest.mark.asyncio
async def test_user_context_prompt_preserves_margin_above_target_threshold(monkeypatch):
    user = User(id=125, email="context-threshold@x.test", name="Context Threshold QA")
    user.profile = StudentProfile(
        user_id=user.id,
        chosen_subjects=["Mathematics", "Informatics"],
        target_university_id=91,
        target_majors=["B057"],
        weakest_subject="Informatics",
        last_test_results={
            "History of Kazakhstan": [16],
            "Mathematical Literacy": [9],
            "Reading Literacy": [10],
            "Mathematics": [49],
            "Informatics": [25],
        },
    )

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([]),  # no completed mock exams yet
            _scalar_result(0),  # no unresolved mistakes yet
        ]
    )

    monkeypatch.setattr(
        context_builder,
        "resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        context_builder,
        "get_user_target_threshold",
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

    prompt = await context_builder.build_user_context_prompt(user, db, "ru")

    assert "Информационные технологии (B057)" in prompt
    assert "Целевой грантовый порог: 50/140" in prompt
    assert "балл для сравнения: 109/140" in prompt
    assert "запас над ориентиром: +59 баллов" in prompt
    assert "текущий разрыв: 0 баллов" not in prompt


@pytest.mark.asyncio
async def test_user_context_prompt_ignores_abandoned_mock_exam_outlier(monkeypatch):
    user = User(id=126, email="context-outlier@x.test", name="Context Outlier QA")
    user.profile = StudentProfile(
        user_id=user.id,
        chosen_subjects=["Mathematics", "Informatics"],
        target_university_id=91,
        target_majors=["B057"],
        weakest_subject="Mathematics",
        last_test_results={
            "History of Kazakhstan": [18],
            "Mathematical Literacy": [10],
            "Reading Literacy": [10],
            "Mathematics": [36],
            "Informatics": [35],
        },
    )

    recent_logs = [
        ActivityLog(
            user_id=user.id,
            activity_type=ActivityType.TEST_COMPLETED,
            metadata_blob={
                "exam_attempt_id": 501,
                "score": 3,
                "max_score": 140,
                "total_questions": 120,
            },
        )
    ]

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result(recent_logs),
            _scalar_one_result(
                SimpleNamespace(
                    total_questions=120,
                    answers={"1": ["A"], "2": ["B"], "3": []},
                )
            ),
            _scalar_result(0),  # no unresolved mistakes yet
        ]
    )

    monkeypatch.setattr(
        context_builder,
        "resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        context_builder,
        "get_user_target_threshold",
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

    prompt = await context_builder.build_user_context_prompt(user, db, "ru")

    assert "балл для сравнения: 109/140" in prompt
    assert "запас над ориентиром: +59 баллов" in prompt
    assert "последний балл 3/140" not in prompt


@pytest.mark.asyncio
async def test_user_context_prompt_uses_recent_relevant_mistakes(monkeypatch):
    user = User(id=127, email="context-mistakes@x.test", name="Context Mistakes QA")
    user.profile = StudentProfile(
        user_id=user.id,
        chosen_subjects=["Mathematics", "Informatics"],
        target_university_id=91,
        target_majors=["B057"],
        weakest_subject="Mathematics",
        last_test_results={
            "History of Kazakhstan": [18],
            "Mathematical Literacy": [10],
            "Reading Literacy": [10],
            "Mathematics": [36],
            "Informatics": [35],
        },
    )

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalars_all_result([]),
        ]
    )

    monkeypatch.setattr(
        context_builder,
        "resolve_major_titles",
        AsyncMock(return_value=["B057 — Информационные технологии"]),
    )
    monkeypatch.setattr(
        context_builder,
        "get_user_target_threshold",
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
    count_mock = AsyncMock(return_value=5)
    monkeypatch.setattr(
        context_builder,
        "count_unresolved_mistakes",
        count_mock,
    )
    cluster_mock = AsyncMock(
        return_value=[
            {"topic": "Mathematics", "points_lost": 4, "mistake_count": 3},
            {"topic": "Informatics", "points_lost": 2, "mistake_count": 2},
        ]
    )
    monkeypatch.setattr(
        context_builder,
        "cluster_mistakes_by_topic",
        cluster_mock,
    )

    prompt = await context_builder.build_user_context_prompt(user, db, "ru")

    assert "Актуальные нерешённые ошибки: 5" in prompt
    assert "Математика: 3 ошибок, 4 потерянных баллов" in prompt
    assert "Информатика: 2 ошибок, 2 потерянных баллов" in prompt
    assert count_mock.await_args_list[0].kwargs["recent_limit"] == RECENT_RELEVANT_MISTAKE_LIMIT
    assert cluster_mock.await_args_list[0].kwargs["recent_limit"] == RECENT_RELEVANT_MISTAKE_LIMIT
