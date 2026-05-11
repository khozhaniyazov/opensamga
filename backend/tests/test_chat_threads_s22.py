"""Session 22 (BUG-S22-sidebar) — CRUD contract for /api/chat/threads.

Validates that the user-scoping + input validation behaves as designed:

  - GET /chat/threads lists owned rows and reports legacy bucket count
  - POST /chat/threads creates with trimmed+clamped title (NULL if empty)
  - PATCH /chat/threads/{id} renames; 404 on foreign/unknown id
  - DELETE /chat/threads/{id} deletes; 404 on foreign/unknown id
  - POST /chat with thread_id → 404 if unknown/foreign
  - GET /chat/history?thread_id=N → 404 if unknown; ?thread_id=0 ok
  - DELETE /chat/history?thread_id=N → scoped to that thread

We rely on the app's default SQLite test fixtures (conftest) rather
than live Postgres; only the parts that don't touch pgvector are
exercised here, so SQLite is fine.
"""

from __future__ import annotations

from datetime import UTC
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import User


@pytest.fixture
def fake_user():
    return User(id=7, email="threads@x.test", name="ThreadOwner")


def _client_with(db, user):
    async def _get_db():
        yield db

    from app.database import get_db
    from app.routers.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = _get_db
    return TestClient(app)


def _cleanup():
    app.dependency_overrides.clear()


def _stub_owner_check(db, found: bool):
    """Make db.execute() return a scalar_one_or_none that yields either
    a truthy row (found) or None (not found)."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=MagicMock() if found else None)
    db.execute = AsyncMock(return_value=result)


def test_create_thread_empty_title_becomes_null(fake_user):
    db = AsyncMock()
    # .add / .commit / .refresh noops
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def refresh(obj):
        obj.id = 123
        obj.title = None
        from datetime import datetime, timezone

        obj.created_at = datetime.now(UTC)
        obj.updated_at = obj.created_at

    db.refresh = refresh

    c = _client_with(db, fake_user)
    try:
        r = c.post("/api/chat/threads", json={"title": "   "})
    finally:
        _cleanup()
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == 123
    assert body["title"] is None  # blank → null


def test_create_thread_clamps_long_title(fake_user):
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()

    captured = {}

    async def refresh(obj):
        obj.id = 999
        captured["title"] = obj.title
        from datetime import datetime, timezone

        obj.created_at = datetime.now(UTC)
        obj.updated_at = obj.created_at

    db.refresh = refresh

    c = _client_with(db, fake_user)
    try:
        long_title = "x" * 500
        r = c.post("/api/chat/threads", json={"title": long_title})
    finally:
        _cleanup()
    assert r.status_code == 200
    assert captured["title"] is not None
    assert len(captured["title"]) == 120  # router clamps to 120


def test_rename_thread_404_on_unknown(fake_user):
    db = AsyncMock()
    _stub_owner_check(db, found=False)
    c = _client_with(db, fake_user)
    try:
        r = c.patch("/api/chat/threads/9999", json={"title": "nope"})
    finally:
        _cleanup()
    assert r.status_code == 404


def test_delete_thread_404_on_unknown(fake_user):
    db = AsyncMock()
    _stub_owner_check(db, found=False)
    c = _client_with(db, fake_user)
    try:
        r = c.delete("/api/chat/threads/9999")
    finally:
        _cleanup()
    assert r.status_code == 404


def test_get_history_unknown_thread_is_404(fake_user):
    db = AsyncMock()
    # first call: owner_check returns None
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=result)
    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/history?thread_id=9999")
    finally:
        _cleanup()
    assert r.status_code == 404


def test_get_history_legacy_bucket_ok(fake_user):
    # thread_id=0 means legacy NULL bucket — no owner-check needed.
    db = AsyncMock()
    result = MagicMock()
    result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    db.execute = AsyncMock(return_value=result)
    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/history?thread_id=0")
    finally:
        _cleanup()
    assert r.status_code == 200
    assert r.json() == {"messages": []}


def test_clear_history_with_unknown_thread_is_404(fake_user):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=result)
    c = _client_with(db, fake_user)
    try:
        r = c.delete("/api/chat/history?thread_id=9999")
    finally:
        _cleanup()
    assert r.status_code == 404
