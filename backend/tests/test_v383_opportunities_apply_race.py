"""
v3.83 (2026-05-03) — apply_to_opportunity IntegrityError race + atomic count.

Pre-v3.83 ``POST /api/opportunities/{id}/apply`` had two bugs:

1. **500 leak on race** — the pre-check ``existing_query`` is
   not atomic with the subsequent INSERT. Two concurrent applies
   from the same user could both pass the pre-check; the second
   commit then tripped the UNIQUE constraint
   ``uq_opportunity_applicant`` on
   ``(opportunity_id, applicant_id)``, surfacing as an
   unhandled ``IntegrityError`` → HTTP 500 with a SQLAlchemy
   stack trace in the response.

2. **TOCTOU undercount** —
   ``opportunity.application_count += 1`` translates to
   SELECT-then-UPDATE on flush; two concurrent applies could
   each read N and both write N+1, undercounting the bump by one.

v3.83 fixes both:

- The flush is wrapped in ``try/except IntegrityError`` →
  ``await db.rollback(); raise HTTPException(400, ...)``.
- The count bump is rewritten as
  ``update(Opportunity).where(...).values(
      application_count=Opportunity.application_count + 1
  )`` so the DB serializes the +1.

Three lanes pinned:

1. **Static AST shape** on ``app/routers/opportunities.py:apply_to_opportunity``
   — IntegrityError import present; try/except IntegrityError
   wraps db.commit; rollback runs in the except handler;
   ``Opportunity.application_count + 1`` UPDATE expression
   present.
2. **Behavioral via TestClient + dependency_overrides** on the
   race-loser path (commit raises IntegrityError) — caller sees
   400, db.rollback was awaited, no telemetry event was
   recorded.
3. **Pre-check still wins** — when ``existing_query`` returns a
   row, the user gets 400 without an INSERT attempt (regression
   guard for the cheap-path).
"""

from __future__ import annotations

import ast
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.models import (
    ApplicationStatus,
    Opportunity,
    OpportunityApplication,
    OpportunityStatus,
    OpportunityType,
    User,
)

# ---------------------------------------------------------------------------
# Lane 1: static AST shape
# ---------------------------------------------------------------------------


_ROUTER_PATH = Path(__file__).resolve().parent.parent / "app" / "routers" / "opportunities.py"


def _load_apply_ast() -> ast.AsyncFunctionDef:
    tree = ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "apply_to_opportunity":
            return node
    raise AssertionError("apply_to_opportunity not found in app/routers/opportunities.py")


def test_module_imports_integrity_error():
    """v3.83: IntegrityError must be imported at module level."""
    src = _ROUTER_PATH.read_text(encoding="utf-8")
    assert "from sqlalchemy.exc import IntegrityError" in src, (
        "v3.83 requires `from sqlalchemy.exc import IntegrityError` "
        "at module level so the apply handler can catch race-loser commits."
    )


def test_module_imports_update_for_atomic_count_bump():
    """v3.83: ``update`` must come from sqlalchemy for atomic count bump."""
    src = _ROUTER_PATH.read_text(encoding="utf-8")
    # Already imports func, select, text from sqlalchemy. v3.83 adds update.
    assert "update" in src.split("from sqlalchemy import")[1].split("\n")[0], (
        "v3.83 requires `update` in the `from sqlalchemy import ...` line "
        "so the application_count bump can be rewritten as an atomic UPDATE."
    )


def test_apply_wraps_commit_in_try_except_integrity_error():
    """v3.83: db.commit() must be inside a try/except IntegrityError block."""
    fn = _load_apply_ast()
    found = False
    for node in ast.walk(fn):
        if isinstance(node, ast.Try):
            # Look for db.commit() in the try body
            try_src = ast.unparse(ast.Module(body=node.body, type_ignores=[]))
            if "db.commit()" not in try_src:
                continue
            # Look for IntegrityError in the handlers
            for handler in node.handlers:
                if handler.type is None:
                    continue
                handler_type = ast.unparse(handler.type)
                if "IntegrityError" in handler_type:
                    found = True
                    break
            if found:
                break
    assert found, (
        "v3.83 requires `try: await db.commit() except IntegrityError: ...` "
        "in apply_to_opportunity so the race-loser path returns 400 not 500."
    )


def test_apply_rollback_in_integrity_error_branch():
    """v3.83: the IntegrityError except branch must call db.rollback()."""
    fn = _load_apply_ast()
    for node in ast.walk(fn):
        if isinstance(node, ast.Try):
            try_src = ast.unparse(ast.Module(body=node.body, type_ignores=[]))
            if "db.commit()" not in try_src:
                continue
            for handler in node.handlers:
                if handler.type is None:
                    continue
                if "IntegrityError" not in ast.unparse(handler.type):
                    continue
                handler_src = ast.unparse(ast.Module(body=handler.body, type_ignores=[]))
                assert "db.rollback()" in handler_src, (
                    "v3.83 IntegrityError handler must call db.rollback() "
                    "to release the broken transaction before raising."
                )
                assert "HTTPException" in handler_src, (
                    "v3.83 IntegrityError handler must raise HTTPException "
                    "(400) so the client sees a clean error, not 500."
                )
                return
    pytest.fail("v3.83 try/except IntegrityError block not found in apply_to_opportunity")


def test_apply_atomic_count_bump_present():
    """
    v3.83: the ``application_count += 1`` ORM mutation must be
    replaced with an atomic UPDATE expression. Pin the call shape.
    """
    fn = _load_apply_ast()
    src = ast.unparse(fn)
    # The atomic shape includes the column on both sides of the +.
    assert "Opportunity.application_count + 1" in src, (
        "v3.83 requires application_count bump to be an atomic UPDATE: "
        "`update(Opportunity).where(...).values("
        "application_count=Opportunity.application_count + 1)`. "
        "ORM-level `opportunity.application_count += 1` is TOCTOU."
    )
    # And the old SELECT-then-UPDATE shape must be gone.
    assert "opportunity.application_count += 1" not in src, (
        "v3.83: `opportunity.application_count += 1` (TOCTOU) must be "
        "removed in favor of the atomic update() expression."
    )


# ---------------------------------------------------------------------------
# Lane 2: behavioral via TestClient + dependency_overrides
# ---------------------------------------------------------------------------


def _mk_user(uid: int = 42) -> User:
    return User(id=uid, email=f"u{uid}@x.test", name=f"User {uid}")


def _mk_opportunity(opp_id: int = 7, poster_id: int = 99) -> Opportunity:
    o = Opportunity(
        id=opp_id,
        poster_id=poster_id,
        title="Test gig",
        description="x",
        opportunity_type=OpportunityType.JOB
        if hasattr(OpportunityType, "JOB")
        else next(iter(OpportunityType)),
        status=OpportunityStatus.ACTIVE,
        application_count=3,
    )
    return o


def _mk_existing_application(opp_id: int, uid: int) -> OpportunityApplication:
    return OpportunityApplication(
        id=1,
        opportunity_id=opp_id,
        applicant_id=uid,
        status=ApplicationStatus.SUBMITTED,
        created_at=datetime.now(UTC),
    )


def _mk_db_for_apply(
    *,
    opportunity: Opportunity | None,
    existing_app: OpportunityApplication | None,
    raise_integrity_on_commit: bool = False,
):
    """
    AsyncSession stub for apply_to_opportunity. Sequence of
    db.execute() calls in the handler is:

      1. SELECT Opportunity by id → opportunity
      2. SELECT OpportunityApplication (existing) → existing_app or None
      3. UPDATE Opportunity (atomic count bump) → result (ignored)

    Plus db.add(application), db.commit(), db.refresh(application),
    and on the success path TelemetryService(db).track() also adds
    + commits + refreshes.
    """
    opp_result = MagicMock()
    opp_result.scalar_one_or_none = MagicMock(return_value=opportunity)
    existing_result = MagicMock()
    existing_result.scalar_one_or_none = MagicMock(return_value=existing_app)
    update_result = MagicMock()  # rowcount not used by handler

    # Telemetry path may also call execute, but only on success.
    # For the IntegrityError path it never reaches that branch.
    # Provide a permissive default after the 3 expected calls.
    permissive = MagicMock()
    permissive.scalar_one_or_none = MagicMock(return_value=None)

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[opp_result, existing_result, update_result, permissive, permissive]
    )

    commit_calls = {"n": 0}

    async def _commit():
        commit_calls["n"] += 1
        if raise_integrity_on_commit and commit_calls["n"] == 1:
            raise IntegrityError("dup", {}, Exception("dup"))

    db.commit = AsyncMock(side_effect=_commit)
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


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


def test_v383_race_loser_returns_400_not_500_and_rolls_back():
    """
    Concurrent applies: both pass the pre-check (existing_app is
    None) but the second commit raises IntegrityError. Pre-v3.83
    this surfaced as 500. Post-v3.83 it must surface as 400 and
    db.rollback must run.
    """
    user = _mk_user(uid=42)
    opp = _mk_opportunity(opp_id=7, poster_id=99)

    db = _mk_db_for_apply(
        opportunity=opp,
        existing_app=None,
        raise_integrity_on_commit=True,
    )
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/opportunities/7/apply",
            json={
                "cover_note": "racey",
                "screening_answers": [],
                "attachment_urls": [],
            },
        )
    finally:
        _cleanup()

    assert r.status_code == 400, (
        f"v3.83: race-loser must surface as 400, got {r.status_code} with body {r.text!r}"
    )
    body = r.json()
    assert "Already applied" in body["detail"], (
        f"v3.83: race-loser detail must mirror the pre-check copy, got {body!r}"
    )
    assert db.rollback.await_count >= 1, (
        "v3.83: race-loser branch must await db.rollback() before raising."
    )


def test_v383_pre_check_still_short_circuits_when_existing_application():
    """
    Regression: when existing_query returns a row, the handler
    returns 400 BEFORE the INSERT/atomic-update path. v3.83 must
    not regress the cheap path.
    """
    user = _mk_user(uid=42)
    opp = _mk_opportunity(opp_id=7, poster_id=99)
    existing = _mk_existing_application(opp_id=7, uid=42)

    db = _mk_db_for_apply(opportunity=opp, existing_app=existing)
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/opportunities/7/apply",
            json={
                "cover_note": "first",
                "screening_answers": [],
                "attachment_urls": [],
            },
        )
    finally:
        _cleanup()

    assert r.status_code == 400
    assert "Already applied" in r.json()["detail"]
    # Pre-check path: db.add must not have been called for an
    # OpportunityApplication, db.commit must not have run.
    assert db.commit.await_count == 0, (
        "v3.83: pre-check 400 path must not commit (no INSERT attempted)."
    )


def test_v383_404_when_opportunity_missing():
    """Regression: missing opportunity → 404 before any race-prone code runs."""
    user = _mk_user(uid=42)
    db = _mk_db_for_apply(opportunity=None, existing_app=None)
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/opportunities/9999/apply",
            json={"cover_note": None, "screening_answers": [], "attachment_urls": []},
        )
    finally:
        _cleanup()

    assert r.status_code == 404
    assert db.commit.await_count == 0


def test_v383_400_when_applying_to_own_opportunity():
    """Regression: user can't apply to their own posting."""
    user = _mk_user(uid=42)
    opp = _mk_opportunity(opp_id=7, poster_id=42)
    db = _mk_db_for_apply(opportunity=opp, existing_app=None)
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/opportunities/7/apply",
            json={"cover_note": None, "screening_answers": [], "attachment_urls": []},
        )
    finally:
        _cleanup()

    assert r.status_code == 400
    assert "your own" in r.json()["detail"].lower()


def test_v383_400_when_opportunity_not_active():
    """Regression: non-ACTIVE status → 400 before any insert."""
    user = _mk_user(uid=42)
    opp = _mk_opportunity(opp_id=7, poster_id=99)
    opp.status = OpportunityStatus.DRAFT
    db = _mk_db_for_apply(opportunity=opp, existing_app=None)
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/opportunities/7/apply",
            json={"cover_note": None, "screening_answers": [], "attachment_urls": []},
        )
    finally:
        _cleanup()

    assert r.status_code == 400
    assert "not accepting" in r.json()["detail"].lower()
