from datetime import UTC, datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.main import app
from app.models import ExamAttempt, User
from app.routers.auth import get_current_user

# Session 15 (2026-04-21): depends on real Postgres (see pytest.ini note).
pytestmark = pytest.mark.integration


@pytest_asyncio.fixture
async def client(async_db_session: AsyncSession, test_user: User):
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
async def test_empty_history(client: AsyncClient):
    """Test GET /exam/history returns empty list for user with no attempts"""
    response = await client.get("/api/exam/history")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_history_sorted_by_date(
    client: AsyncClient, async_db_session: AsyncSession, test_user: User
):
    """Test GET /exam/history returns attempts sorted by submitted_at DESC"""
    attempt1 = ExamAttempt(
        user_id=test_user.id,
        subjects=["Mathematics", "Physics"],
        total_questions=100,
        time_limit_seconds=14400,
        score=80,
        max_score=120,
        answers={},
        started_at=datetime(2026, 3, 1, 10, 0, 0, tzinfo=UTC),
        submitted_at=datetime(2026, 3, 1, 14, 0, 0, tzinfo=UTC),
        time_taken_seconds=14000,
    )
    attempt2 = ExamAttempt(
        user_id=test_user.id,
        subjects=["Chemistry", "Biology"],
        total_questions=100,
        time_limit_seconds=14400,
        score=90,
        max_score=120,
        answers={},
        started_at=datetime(2026, 3, 15, 10, 0, 0, tzinfo=UTC),
        submitted_at=datetime(2026, 3, 15, 14, 0, 0, tzinfo=UTC),
        time_taken_seconds=13000,
    )

    async_db_session.add(attempt1)
    async_db_session.add(attempt2)
    await async_db_session.commit()

    response = await client.get("/api/exam/history")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["score"] == 90
    assert data[1]["score"] == 80


@pytest.mark.asyncio
async def test_history_includes_required_fields(
    client: AsyncClient, async_db_session: AsyncSession, test_user: User
):
    """Test response includes all required fields"""
    attempt = ExamAttempt(
        user_id=test_user.id,
        subjects=["Mathematics", "Physics"],
        total_questions=100,
        time_limit_seconds=14400,
        score=85,
        max_score=120,
        answers={},
        started_at=datetime(2026, 3, 20, 10, 0, 0, tzinfo=UTC),
        submitted_at=datetime(2026, 3, 20, 14, 0, 0, tzinfo=UTC),
        time_taken_seconds=14200,
    )

    async_db_session.add(attempt)
    await async_db_session.commit()
    await async_db_session.refresh(attempt)

    response = await client.get("/api/exam/history")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1

    item = data[0]
    assert "id" in item
    assert item["subjects"] == ["Mathematics", "Physics"]
    assert item["score"] == 85
    assert item["max_score"] == 120
    assert item["total_questions"] == 100
    assert "submitted_at" in item
    assert item["time_taken_seconds"] == 14200
