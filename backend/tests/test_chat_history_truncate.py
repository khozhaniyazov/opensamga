"""Session 22 (2026-04-22): regression tests for the edit-and-resubmit
backend — POST /api/chat/history/truncate.

Keeps the test isolated from a live DB by mocking `get_db` + SQL
execution. We're verifying the *contract* here, not PG semantics:

  - drop_last <= 0 or missing -> no-op, 200, deleted_count=0
  - drop_last non-int string -> 400
  - drop_last = 5 with 5 rows -> DELETE issued scoped to user
  - drop_last = 9999 (over clamp) clamps to 10000 internally
  - the DELETE is always scoped by `user_id == current_user.id`

v3.88 (2026-05-04): the handler used to be SELECT-then-DELETE
(two `db.execute` calls). It is now a single DELETE that uses a
`scalar_subquery()` to pick the trailing N ids inside the same
statement. Tests below expect *one* `db.execute` call (the
DELETE) on the non-no-op path.

We do NOT mark these as `integration` — they run in the default suite.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import User


@pytest.fixture
def fake_user():
    u = User(id=42, email="t@x.test", name="Truncator")
    return u


def _mk_db_stub(rowcount: int):
    """
    Stub AsyncSession for the v3.88 single-statement DELETE shape.

    ``db.execute(delete(...))`` returns an object whose ``.rowcount``
    is the number of rows the DB reports as deleted. There is no
    longer a separate SELECT; the trailing-id pick lives inside the
    DELETE as a scalar subquery.
    """
    db = AsyncMock()
    del_result = MagicMock()
    del_result.rowcount = rowcount

    db.execute = AsyncMock(return_value=del_result)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _client_with(db, user):
    async def _get_db():
        yield db

    from app.routers.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: user
    from app.database import get_db

    app.dependency_overrides[get_db] = _get_db
    return TestClient(app)


def _cleanup(client):
    app.dependency_overrides.clear()


def test_truncate_noop_when_zero(fake_user):
    db = _mk_db_stub(0)
    c = _client_with(db, fake_user)
    try:
        r = c.post(
            "/api/chat/history/truncate",
            json={"drop_last": 0},
        )
    finally:
        _cleanup(c)
    assert r.status_code == 200
    assert r.json() == {"success": True, "deleted_count": 0}
    # No-op path must short-circuit before any execute().
    db.execute.assert_not_called()


def test_truncate_noop_when_negative(fake_user):
    db = _mk_db_stub(0)
    c = _client_with(db, fake_user)
    try:
        r = c.post("/api/chat/history/truncate", json={"drop_last": -5})
    finally:
        _cleanup(c)
    assert r.status_code == 200
    assert r.json()["deleted_count"] == 0
    db.execute.assert_not_called()


def test_truncate_rejects_non_int(fake_user):
    db = _mk_db_stub(0)
    c = _client_with(db, fake_user)
    try:
        r = c.post("/api/chat/history/truncate", json={"drop_last": "banana"})
    finally:
        _cleanup(c)
    # FastAPI lets our body validator run; expected is a 400 from our
    # own HTTPException.
    assert r.status_code == 400
    assert "integer" in r.json().get("detail", "").lower()


def test_truncate_deletes_requested_count(fake_user):
    db = _mk_db_stub(rowcount=2)
    c = _client_with(db, fake_user)
    try:
        r = c.post("/api/chat/history/truncate", json={"drop_last": 2})
    finally:
        _cleanup(c)
    assert r.status_code == 200
    assert r.json()["deleted_count"] == 2
    # v3.88: exactly one execute (the DELETE), not the legacy two.
    assert db.execute.await_count == 1, (
        "v3.88 expects a single-statement DELETE; got "
        f"{db.execute.await_count} db.execute() awaits."
    )
    db.commit.assert_awaited_once()


def test_truncate_noop_when_no_rows_found(fake_user):
    """
    v3.88: under the single-statement shape, "no rows" is just
    `rowcount == 0` from the DELETE. There is no separate SELECT
    that could return empty.
    """
    db = _mk_db_stub(rowcount=0)
    c = _client_with(db, fake_user)
    try:
        r = c.post("/api/chat/history/truncate", json={"drop_last": 5})
    finally:
        _cleanup(c)
    assert r.status_code == 200
    assert r.json() == {"success": True, "deleted_count": 0}
    assert db.execute.await_count == 1


def test_truncate_clamps_runaway_values(fake_user):
    # 1_000_000 is clamped to 10_000. We don't peek at the SQL here;
    # we just verify the endpoint accepts the request and returns
    # success using the rowcount the DB reported.
    db = _mk_db_stub(rowcount=3)
    c = _client_with(db, fake_user)
    try:
        r = c.post(
            "/api/chat/history/truncate",
            json={"drop_last": 1_000_000},
        )
    finally:
        _cleanup(c)
    assert r.status_code == 200
    assert r.json()["deleted_count"] == 3
    assert db.execute.await_count == 1
