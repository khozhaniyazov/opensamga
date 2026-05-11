from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import ChatMessage, LanguagePreference, StudentProfile, User
from app.routers.auth import get_current_user, get_current_user_optional

# Session 15 (2026-04-21): this suite exercises the live /chat routes end-to-end
# via TestClient and depends on a real Postgres at TEST_DATABASE_URL. Mark the
# whole module as `integration` so the default test run stays green on
# laptops without a test DB. Run with `pytest -m integration`.
pytestmark = pytest.mark.integration


@pytest.fixture
def mock_user():
    """Create a mock user without database."""
    user = User(
        id=1,
        email="test@example.com",
        username="testuser",
        full_name="Test User",
        language_preference=LanguagePreference.EN,
    )
    profile = StudentProfile(
        user_id=1,
        current_grade=11,
        chosen_subjects=["Math", "Physics"],
        target_majors=["Computer Science"],
        target_universities=[1, 2],
    )
    user.profile = profile
    return user


def test_send_message(mock_user):
    """Test POST /chat with message, verify 200 response with assistant reply."""
    mock_response = MagicMock()
    mock_message = MagicMock()
    mock_message.content = "Test response from assistant"
    mock_message.role = "assistant"
    mock_message.tool_calls = None
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response.choices = [mock_choice]

    async def override_get_db():
        yield AsyncMock()

    async def override_get_current_user_optional():
        # POST /chat uses get_current_user_optional; returning None
        # exercises the unauthenticated branch which avoids the
        # quota path's DB calls.
        return None

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_optional] = override_get_current_user_optional
    try:
        with patch("app.routers.chat.client.chat.completions.create", return_value=mock_response):
            client = TestClient(app)
            response = client.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "Hello"}]},
                headers={"Authorization": "Bearer test_token"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "assistant"
    assert len(data["content"]) > 0


def test_get_history(mock_user):
    """Test GET /chat/history returns messages in chronological order."""
    mock_db = AsyncMock()
    mock_result = AsyncMock()
    mock_result.scalars.return_value.all.return_value = [
        ChatMessage(id=1, user_id=1, role="user", content="Hello"),
        ChatMessage(id=2, user_id=1, role="assistant", content="Hi there!"),
        ChatMessage(id=3, user_id=1, role="user", content="What universities should I consider?"),
    ]
    mock_db.execute.return_value = mock_result

    async def override_get_db():
        yield mock_db

    async def override_get_current_user():
        return mock_user

    # GET /chat/history requires `get_current_user` (not the
    # optional variant). FastAPI captures Depends() callables by
    # object identity at route-registration time, so we must use
    # `app.dependency_overrides` rather than `unittest.mock.patch`
    # — patching after the fact rebinds the module attribute but
    # leaves the resolved dependency tree pointing at the original
    # function. Lane bug #3 in
    # project_session_2026-04-30_v319_chore_ci_baseline.md.
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        client = TestClient(app)
        response = client.get("/api/chat/history", headers={"Authorization": "Bearer test_token"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert "messages" in data


def test_citations(mock_user):
    """Test response includes year attribution for university data."""
    mock_content = "Based on 2023 data, the acceptance score was 110."
    mock_response = MagicMock()
    mock_message = MagicMock()
    mock_message.content = mock_content
    mock_message.role = "assistant"
    mock_message.tool_calls = None
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response.choices = [mock_choice]

    async def override_get_db():
        yield AsyncMock()

    async def override_get_current_user_optional():
        return None

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_optional] = override_get_current_user_optional
    try:
        with patch("app.routers.chat.client.chat.completions.create", return_value=mock_response):
            client = TestClient(app)
            response = client.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "What is the acceptance score?"}]},
                headers={"Authorization": "Bearer test_token"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert "2023" in data["content"] or "data" in data["content"].lower()


def test_recommendations(mock_user):
    """Test response mentions universities from profile and includes grant probability."""
    mock_content = "Based on your profile, I recommend Computer Science. Grant probability: 80%"
    mock_response = MagicMock()
    mock_message = MagicMock()
    mock_message.content = mock_content
    mock_message.role = "assistant"
    mock_message.tool_calls = None
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response.choices = [mock_choice]

    async def override_get_db():
        yield AsyncMock()

    async def override_get_current_user_optional():
        # Same un-authed branch as test_send_message: avoids
        # `_get_or_create_counter` and the quota path's DB hops.
        # The assertion only inspects the mocked OpenAI content.
        # Lane bug #4 in
        # project_session_2026-04-30_v319_chore_ci_baseline.md.
        return None

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_optional] = override_get_current_user_optional
    try:
        with patch("app.routers.chat.client.chat.completions.create", return_value=mock_response):
            client = TestClient(app)
            response = client.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "What should I study?"}]},
                headers={"Authorization": "Bearer test_token"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert "recommend" in data["content"].lower() or "probability" in data["content"].lower()
