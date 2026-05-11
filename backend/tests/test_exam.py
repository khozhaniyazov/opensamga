import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.main import app
from app.models import ExamAttempt, MistakeReview, SubscriptionTier, User
from app.routers.auth import get_current_user

# Session 15 (2026-04-21): depends on real Postgres (see pytest.ini note).
pytestmark = pytest.mark.integration


@pytest_asyncio.fixture
async def client(async_db_session: AsyncSession, test_user: User):
    test_user.subscription_tier = SubscriptionTier.PREMIUM
    await async_db_session.flush()

    async def override_get_db():
        yield async_db_session

    async def override_get_current_user():
        return test_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_submit_exam_rejects_free_users(
    async_db_session: AsyncSession,
    test_user: User,
):
    """Direct API submissions must obey the same premium gate as the UI."""

    async def override_get_db():
        yield async_db_session

    async def override_get_current_user():
        return test_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    submission = {
        "subjects": ["Mathematics"],
        "total_questions": 1,
        "time_limit_seconds": 240,
        "started_at": "2026-04-01T10:00:00Z",
        "time_taken_seconds": 60,
        "answers": {"q1": ["opt_0"]},
        "questions": [{"id": "q1", "type": "single", "correct_answer": ["opt_0"], "max_points": 1}],
    }

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post("/api/exam/submit", json=submission)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "premium_required"


@pytest.mark.asyncio
async def test_submit_exam_calculates_score(client: AsyncClient, async_db_session: AsyncSession):
    """Server recalculates score from answers, doesn't trust client"""
    submission = {
        "subjects": ["Mathematics", "Physics"],
        "total_questions": 3,
        "time_limit_seconds": 240,
        "started_at": "2026-04-01T10:00:00Z",
        "time_taken_seconds": 120,
        "answers": {"q1": ["opt_0"], "q2": ["opt_1"], "q3": ["opt_0", "opt_2"]},
        "questions": [
            {"id": "q1", "type": "single", "correct_answer": ["opt_0"], "max_points": 1},
            {"id": "q2", "type": "single", "correct_answer": ["opt_0"], "max_points": 1},
            {
                "id": "q3",
                "type": "multiple",
                "correct_answer": ["opt_0", "opt_1", "opt_2"],
                "max_points": 2,
            },
        ],
    }

    response = await client.post("/api/exam/submit", json=submission)
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 2
    assert "attempt_id" in data


@pytest.mark.asyncio
async def test_submit_exam_stores_attempt(
    client: AsyncClient, async_db_session: AsyncSession, test_user: User
):
    """Exam attempt is persisted with all fields"""
    submission = {
        "subjects": ["Mathematics"],
        "total_questions": 1,
        "time_limit_seconds": 240,
        "started_at": "2026-04-01T10:00:00Z",
        "time_taken_seconds": 60,
        "answers": {"q1": ["opt_0"]},
        "questions": [{"id": "q1", "type": "single", "correct_answer": ["opt_0"], "max_points": 1}],
    }

    response = await client.post("/api/exam/submit", json=submission)
    attempt_id = response.json()["attempt_id"]

    result = await async_db_session.execute(select(ExamAttempt).where(ExamAttempt.id == attempt_id))
    attempt = result.scalar_one()
    assert attempt.user_id == test_user.id
    assert attempt.score == 1
    assert attempt.subjects == ["Mathematics"]


@pytest.mark.asyncio
async def test_submit_exam_time_validation(client: AsyncClient):
    """Rejects submissions exceeding time limit + grace period"""
    submission = {
        "subjects": ["Mathematics"],
        "total_questions": 1,
        "time_limit_seconds": 100,
        "started_at": "2026-04-01T10:00:00Z",
        "time_taken_seconds": 120,
        "answers": {},
        "questions": [],
    }

    response = await client.post("/api/exam/submit", json=submission)
    assert response.status_code == 400
    assert "time" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_submit_exam_skips_blank_answers_in_mistake_queue(
    client: AsyncClient,
    async_db_session: AsyncSession,
    test_user: User,
):
    """Blank answers still lose points, but should not create MistakeReview rows."""
    submission = {
        "subjects": ["Mathematics"],
        "total_questions": 2,
        "time_limit_seconds": 240,
        "started_at": "2026-04-01T10:00:00Z",
        "time_taken_seconds": 90,
        "answers": {
            "q1": [],
            "q2": ["opt_1"],
        },
        "questions": [
            {
                "id": "q1",
                "type": "single",
                "correct_answer": ["opt_0"],
                "max_points": 1,
                "subject": "math",
                "question_text": "Skipped question",
                "options": {"opt_0": "A", "opt_1": "B"},
            },
            {
                "id": "q2",
                "type": "single",
                "correct_answer": ["opt_0"],
                "max_points": 1,
                "subject": "math",
                "question_text": "Wrong question",
                "options": {"opt_0": "A", "opt_1": "B"},
            },
        ],
    }

    response = await client.post("/api/exam/submit", json=submission)
    assert response.status_code == 200
    payload = response.json()
    assert payload["score"] == 0
    assert payload["mistakes_created"] == 1

    result = await async_db_session.execute(
        select(MistakeReview)
        .where(MistakeReview.user_id == test_user.id)
        .order_by(MistakeReview.id.asc())
    )
    mistakes = result.scalars().all()
    assert len(mistakes) == 1
    assert mistakes[0].original_question_snapshot["id"] == "q2"
    assert mistakes[0].user_answer == "B"
