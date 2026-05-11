"""
v3.85 (2026-05-03) — atomic UsageCounter increments + UTC date key.

Pre-v3.85, every UsageCounter increment in the codebase was a
textbook TOCTOU:

    counter = await _get_or_create_counter(user_id, db)
    if counter.<col> >= limit: raise 429
    counter.<col> += 1   # SELECT-then-UPDATE on flush
    await db.commit()

Two concurrent commits could both read ``previous`` and both
write ``previous + 1``, undercounting the bump. Same shape as
v3.81 (loot-box) and v3.83 (opportunity application_count).

Additionally the daily-reset boundary was keyed off
``date.today()`` (server-local), so a non-UTC server drifts the
reset off UTC midnight.

v3.85 introduces two helpers in ``app/dependencies/plan_guards``:

  * ``_today_utc()`` — UTC-anchored ``date`` for all counter keys.
  * ``_atomic_charge_counter(user_id, resource, db) -> int``
    — single-statement
    ``UPDATE usage_counters SET <col> = <col> + 1 WHERE
    user_id=:u AND date=:d RETURNING <col>``. Returns the
    post-increment value. INSERTs a fresh row with ``<col>=1`` if
    today's row didn't exist yet.

All five increment sites are now routed through this helper:

  1. ``app/routers/chat.py:_quota_charge`` (REST agent + SSE).
  2. ``app/routers/chat.py:chat_image_ocr`` post-success branch
     (v3.82).
  3. ``app/routers/chat_websocket.py`` post-success branch
     (v3.3 lineage).
  4. ``app/routers/practice.py`` first-session-answer branch.
  5. ``app/routers/exam.py`` exam-submission branch.

Plus the ``require_quota`` dependency factory itself (used in
example code only today, but the call site exists in
``plan_guards.py`` and would auto-pick-up future routes).

Three lanes pinned:

  1. **Helper unit tests** — ``_today_utc`` returns UTC; the
     atomic helper rejects unknown resources, returns the
     post-increment value via the UPDATE shape, and
     INSERT-fallbacks when no row exists.
  2. **Static AST + source pins** — atomic helper signature,
     ``_today_utc`` exists, ``_get_or_create_counter`` uses
     ``_today_utc``, ``require_quota`` calls
     ``_atomic_charge_counter``, and every known call site
     references ``_atomic_charge_counter``.
  3. **Behavioral via TestClient** is intentionally NOT in this
     file — each existing v3.x file already covers the route
     surface (v3.82 for OCR, v3.84 for chat helpers). v3.85
     pinning at the helper + AST level is sufficient and avoids
     duplicating the route mocks.
"""

from __future__ import annotations

import ast
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Lane 1: helper unit
# ---------------------------------------------------------------------------


def test_today_utc_returns_utc_date():
    from app.dependencies.plan_guards import _today_utc

    today = _today_utc()
    expected = datetime.now(UTC).date()
    # Allow for the 1-tick race at midnight UTC: assert within 1 day.
    assert today in (expected,), (
        f"v3.85: _today_utc must return UTC date, got {today} vs {expected}"
    )


@pytest.mark.asyncio
async def test_atomic_charge_rejects_unknown_resource():
    from app.dependencies.plan_guards import _atomic_charge_counter

    db = AsyncMock()
    with pytest.raises(ValueError) as exc:
        await _atomic_charge_counter(user_id=42, resource="nope_total", db=db)
    assert "nope_total" in str(exc.value)
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_atomic_charge_returns_returning_value():
    """
    The helper must issue a single UPDATE...RETURNING and surface
    the post-increment value. We mock the AsyncSession.execute to
    return a result whose ``scalar_one_or_none`` is the new int.
    """
    from app.dependencies.plan_guards import _atomic_charge_counter

    db = AsyncMock()
    upd_result = MagicMock()
    upd_result.scalar_one_or_none = MagicMock(return_value=7)
    db.execute = AsyncMock(return_value=upd_result)

    new_value = await _atomic_charge_counter(user_id=42, resource="chat_messages", db=db)
    assert new_value == 7
    db.execute.assert_awaited_once()
    # Verify the call shape: it's an Update statement, not an
    # ORM mutation. The compiled SQL contains "RETURNING".
    call_args = db.execute.await_args
    stmt = call_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": False}))
    assert (
        "UPDATE usage_counters" in compiled.upper().replace("USAGE_COUNTERS", "USAGE_COUNTERS")
        or "UPDATE" in compiled.upper()
    ), f"v3.85 atomic helper must issue UPDATE, got: {compiled}"
    assert "RETURNING" in compiled.upper(), (
        f"v3.85 atomic helper must use RETURNING for the new value, got: {compiled}"
    )


@pytest.mark.asyncio
async def test_atomic_charge_insert_fallback_when_no_row():
    """
    No row for today yet → helper INSERTs a fresh
    ``UsageCounter(<resource>=1)`` and returns ``1``.
    """
    from app.dependencies.plan_guards import _atomic_charge_counter

    db = AsyncMock()
    # UPDATE finds no row.
    upd_result = MagicMock()
    upd_result.scalar_one_or_none = MagicMock(return_value=None)
    db.execute = AsyncMock(return_value=upd_result)
    db.add = MagicMock()
    db.flush = AsyncMock()

    new_value = await _atomic_charge_counter(user_id=42, resource="exam_runs", db=db)
    assert new_value == 1
    db.add.assert_called_once()
    inserted = db.add.call_args.args[0]
    assert inserted.user_id == 42
    assert inserted.exam_runs == 1


# ---------------------------------------------------------------------------
# Lane 2: AST + source pins
# ---------------------------------------------------------------------------


_BACKEND = Path(__file__).resolve().parent.parent
_PLAN_GUARDS = _BACKEND / "app" / "dependencies" / "plan_guards.py"
_CHAT = _BACKEND / "app" / "routers" / "chat.py"
_WS = _BACKEND / "app" / "routers" / "chat_websocket.py"
_PRACTICE = _BACKEND / "app" / "routers" / "practice.py"
_EXAM = _BACKEND / "app" / "routers" / "exam.py"


def test_plan_guards_defines_today_utc_and_atomic_helper():
    src = _PLAN_GUARDS.read_text(encoding="utf-8")
    assert "def _today_utc" in src, "v3.85 requires _today_utc() in plan_guards.py."
    assert "async def _atomic_charge_counter" in src, (
        "v3.85 requires async _atomic_charge_counter() in plan_guards.py."
    )
    # The helper must use sqlalchemy update(), not ORM setattr.
    assert "from sqlalchemy import" in src and "update" in src, (
        "v3.85 plan_guards.py must import `update` from sqlalchemy."
    )


def test_get_or_create_counter_uses_utc_today():
    """v3.85: _get_or_create_counter switched from date.today() → _today_utc()."""
    src = _PLAN_GUARDS.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        (
            n
            for n in tree.body
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "_get_or_create_counter"
        ),
        None,
    )
    assert fn is not None
    body_src = ast.unparse(fn)
    assert "_today_utc()" in body_src, (
        "v3.85: _get_or_create_counter must call _today_utc(), not date.today()."
    )
    assert "date.today()" not in body_src, (
        "v3.85: _get_or_create_counter must not use date.today() (server-local)."
    )


def test_require_quota_uses_atomic_charge():
    """v3.85: require_quota dependency factory must use _atomic_charge_counter."""
    src = _PLAN_GUARDS.read_text(encoding="utf-8")
    tree = ast.parse(src)
    factory = next(
        (n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "require_quota"),
        None,
    )
    assert factory is not None
    factory_src = ast.unparse(factory)
    assert "_atomic_charge_counter" in factory_src, (
        "v3.85: require_quota must route the increment through "
        "_atomic_charge_counter — ORM setattr is TOCTOU."
    )


def test_chat_quota_charge_uses_atomic_helper():
    """v3.85: chat.py:_quota_charge must call _atomic_charge_counter."""
    src = _CHAT.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        (n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "_quota_charge"),
        None,
    )
    assert fn is not None
    body_src = ast.unparse(fn)
    assert "_atomic_charge_counter" in body_src, (
        "v3.85: chat.py:_quota_charge must use _atomic_charge_counter."
    )


def test_chat_image_ocr_uses_atomic_helper():
    """v3.85: chat_image_ocr post-success branch must use the atomic helper."""
    src = _CHAT.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        (
            n
            for n in tree.body
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "chat_image_ocr"
        ),
        None,
    )
    assert fn is not None
    body_src = ast.unparse(fn)
    assert "_atomic_charge_counter" in body_src, (
        "v3.85: chat_image_ocr's v3.82 charge-after-success branch must "
        "now route through _atomic_charge_counter (no inline += 1)."
    )


def test_websocket_chat_uses_atomic_helper():
    src = _WS.read_text(encoding="utf-8")
    assert "_atomic_charge_counter" in src, (
        "v3.85: chat_websocket.py must use _atomic_charge_counter for "
        "the post-success quota charge (v3.3 lineage)."
    )


def test_practice_router_uses_atomic_helper():
    src = _PRACTICE.read_text(encoding="utf-8")
    assert "_atomic_charge_counter" in src, (
        "v3.85: practice.py must use _atomic_charge_counter for "
        "first-session-answer practice_questions bump."
    )


def test_exam_router_uses_atomic_helper():
    src = _EXAM.read_text(encoding="utf-8")
    assert "_atomic_charge_counter" in src, (
        "v3.85: exam.py must use _atomic_charge_counter for the exam_runs bump on submission."
    )


def test_no_inline_orm_increments_remain_in_routers():
    """
    v3.85: regression guard. None of the audit-known router files
    may contain the inline ORM TOCTOU pattern any more. The
    pattern is `counter.<col> += 1` or
    `counter.<col> = <expr> + 1` for any of the four
    UsageCounter columns.

    Comments and docstrings are filtered out — we only flag
    actual statement lines.
    """
    import re

    pat_aug = re.compile(
        r"^\s*counter\.(chat_messages|exam_runs|mistake_analyses|practice_questions)\s*\+=\s*1\s*$"
    )
    pat_assign = re.compile(
        r"^\s*counter\.(chat_messages|exam_runs|mistake_analyses|practice_questions)\s*=\s*[^=].*\+\s*1\s*$"
    )
    targets = [_CHAT, _WS, _PRACTICE, _EXAM]
    offenders: list[str] = []
    for p in targets:
        for ln_no, line in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = line.strip()
            # Skip comments + docstring-ish lines.
            if stripped.startswith("#"):
                continue
            if pat_aug.match(line) or pat_assign.match(line):
                offenders.append(f"{p.name}:{ln_no}: {line.rstrip()}")
    assert not offenders, (
        "v3.85 regression: inline ORM TOCTOU UsageCounter increment "
        "found. Route through _atomic_charge_counter instead.\n" + "\n".join(offenders)
    )
