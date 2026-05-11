"""BUG-13 (s22) — unit tests for the library PDF + thumbnail auth gate.

Covers `app.routers.library.require_library_access`. We only verify the
auth contract — not the actual file streaming / rendering, which is
covered elsewhere (`test_thumbnail_s20c.py`) and requires a real PDF on
disk.

Contract:
  - no token of any kind              -> 401
  - malformed Bearer header           -> 401
  - invalid JWT via ?token=…          -> 401
  - valid JWT via Authorization header BUT user missing in DB  -> 401
  - valid JWT via ?token=…            BUT user missing in DB  -> 401
  - valid JWT + user exists (Bearer)  -> passes (returns User)
  - valid JWT + user exists (query)   -> passes (returns User)

These tests do NOT hit a real Postgres — they stub `AsyncSession.execute`
to return a canned user, matching the style of
`test_chat_history_truncate.py`.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.models import User
from app.routers.auth import create_access_token
from app.routers.library import require_library_access

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mk_request(*, authorization: str | None = None, token_qp: str | None = None):
    """Construct a minimal stand-in for starlette `Request` that our
    `require_library_access` helper only pokes in 2 places: `.headers` and
    `.query_params`. Both accept `.get(key)`."""

    class _Headers:
        def __init__(self, mapping):
            self._m = {k.lower(): v for k, v in mapping.items()}

        def get(self, key, default=None):
            return self._m.get(key.lower(), default)

    class _QueryParams:
        def __init__(self, mapping):
            self._m = dict(mapping)

        def get(self, key, default=None):
            return self._m.get(key, default)

    class _Req:
        pass

    r = _Req()
    r.headers = _Headers({"Authorization": authorization} if authorization else {})
    r.query_params = _QueryParams({"token": token_qp} if token_qp else {})
    return r


def _mk_db_stub(user_to_return: User | None):
    db = AsyncMock()
    result = MagicMock()
    scalars = MagicMock()
    scalars.first = MagicMock(return_value=user_to_return)
    result.scalars = MagicMock(return_value=scalars)

    async def execute(_stmt):
        return result

    db.execute = execute
    return db


# ---------------------------------------------------------------------------
# Negative paths — should raise 401 HTTPException
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rejects_missing_token():
    db = _mk_db_stub(None)
    req = _mk_request()
    with pytest.raises(HTTPException) as exc:
        await require_library_access(req, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_malformed_bearer_header():
    db = _mk_db_stub(None)
    # Missing the "Bearer " prefix entirely.
    req = _mk_request(authorization="not-a-bearer-token")
    with pytest.raises(HTTPException) as exc:
        await require_library_access(req, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_invalid_jwt_via_query_token():
    db = _mk_db_stub(None)
    req = _mk_request(token_qp="this.is.not.a.valid.jwt")
    with pytest.raises(HTTPException) as exc:
        await require_library_access(req, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_valid_jwt_but_unknown_user_bearer():
    # Mint a valid signed token, but the DB has no matching user.
    tok = create_access_token({"sub": "ghost@example.test"}, timedelta(minutes=5))
    db = _mk_db_stub(None)
    req = _mk_request(authorization=f"Bearer {tok}")
    with pytest.raises(HTTPException) as exc:
        await require_library_access(req, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_valid_jwt_but_unknown_user_query():
    tok = create_access_token({"sub": "ghost@example.test"}, timedelta(minutes=5))
    db = _mk_db_stub(None)
    req = _mk_request(token_qp=tok)
    with pytest.raises(HTTPException) as exc:
        await require_library_access(req, db=db)
    assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# Positive paths — should return the User instance.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_accepts_valid_jwt_via_bearer_header():
    email = "reader@example.test"
    tok = create_access_token({"sub": email}, timedelta(minutes=5))
    user = User(id=7, email=email, name="Reader")
    db = _mk_db_stub(user)
    req = _mk_request(authorization=f"Bearer {tok}")

    got = await require_library_access(req, db=db)
    assert got is user


@pytest.mark.asyncio
async def test_accepts_valid_jwt_via_query_parameter():
    email = "reader@example.test"
    tok = create_access_token({"sub": email}, timedelta(minutes=5))
    user = User(id=8, email=email, name="Reader-Q")
    db = _mk_db_stub(user)
    req = _mk_request(token_qp=tok)

    got = await require_library_access(req, db=db)
    assert got is user


@pytest.mark.asyncio
async def test_bearer_header_takes_precedence_over_query():
    """When both Bearer header and ?token= are present, the header wins."""
    email = "reader@example.test"
    tok_good = create_access_token({"sub": email}, timedelta(minutes=5))
    user = User(id=9, email=email, name="Reader-Mixed")
    db = _mk_db_stub(user)
    # Query param is garbage — if the header is preferred we should still pass.
    req = _mk_request(
        authorization=f"Bearer {tok_good}",
        token_qp="definitely-not-a-jwt",
    )
    got = await require_library_access(req, db=db)
    assert got is user
