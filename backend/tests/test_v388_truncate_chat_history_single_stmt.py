"""
v3.88 (2026-05-04) — truncate_chat_history_tail: single-statement DELETE.

Pre-v3.88, ``POST /api/chat/history/truncate`` was a
SELECT-then-DELETE pair:

    1. SELECT id ... ORDER BY created_at DESC LIMIT N
    2. DELETE WHERE id IN (<ids from step 1>)

If a concurrent INSERT landed between (1) and (2) — e.g. an
in-flight SSE writer persisting an assistant turn — the DELETE
would still target the original N ids. By the time it ran, those
ids might no longer be the *trailing* N rows; the user asked to
"rewind the last N turns" and ended up with mid-history holes
plus the new turn left dangling.

v3.88 folds the SELECT into the DELETE as a ``scalar_subquery()``
so the DB serializes "pick the trailing N ids" and "remove them"
under one row lock. Portable across PostgreSQL / SQLite / MySQL.

Two lanes pinned:

1. **Static AST shape** on
   ``app/routers/truncate_chat_history_tail`` —
   ``.scalar_subquery()`` is in the handler;
   ``id_result.all()`` and the ``ids_to_delete`` materialization
   are gone.
2. **Tripwire** scanning the handler for any other "two-step"
   shape that would silently re-open the race.
"""

from __future__ import annotations

import ast
from pathlib import Path

_ROUTER_PATH = Path(__file__).resolve().parent.parent / "app" / "routers" / "chat.py"


def _load_truncate_ast() -> ast.AsyncFunctionDef:
    tree = ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "truncate_chat_history_tail":
            return node
    raise AssertionError("truncate_chat_history_tail not found in app/routers/chat.py")


# ---------------------------------------------------------------------------
# Lane 1: AST shape — single-statement DELETE...IN (SELECT scalar_subquery)
# ---------------------------------------------------------------------------


def test_truncate_uses_scalar_subquery():
    """
    v3.88: the trailing-id SELECT must be folded into the DELETE
    as a scalar subquery so the whole operation runs in one
    statement under one row lock.
    """
    fn = _load_truncate_ast()
    src = ast.unparse(fn)
    assert ".scalar_subquery()" in src, (
        "v3.88 requires the trailing-id SELECT to be folded into "
        "the DELETE as a scalar_subquery() so a concurrent INSERT "
        "between SELECT and DELETE can't make us delete stale ids."
    )


def test_truncate_no_intermediate_id_materialization():
    """
    v3.88: the legacy `ids_to_delete = [row[0] for row in id_result.all()]`
    materialization must be gone. If it's back, the SELECT-then-DELETE
    race is back too.
    """
    fn = _load_truncate_ast()
    src = ast.unparse(fn)
    assert "ids_to_delete" not in src, (
        "v3.88: `ids_to_delete` materialization must be gone — its "
        "presence means the handler is back to two round-trips with "
        "a race window between them."
    )
    # Also guard the .all() pattern that fed ids_to_delete.
    assert "id_result.all()" not in src, (
        "v3.88: `id_result.all()` indicates the trailing-id SELECT "
        "is being run as a separate statement before the DELETE. "
        "Use `.scalar_subquery()` in the DELETE WHERE clause instead."
    )


def test_truncate_delete_uses_scalar_subquery_in_where():
    """
    v3.88: the DELETE must take the scalar subquery in its WHERE
    `id.in_(...)` clause. This pins the subquery wiring (not just
    its existence).
    """
    fn = _load_truncate_ast()
    src = ast.unparse(fn)
    # Look for the `delete(ChatMessageModel)` call that includes
    # `.in_(trailing_ids_subq)` as part of its WHERE.
    assert "delete(ChatMessageModel)" in src, (
        "v3.88 expects a `delete(ChatMessageModel)` in the handler."
    )
    assert "in_(trailing_ids_subq)" in src, (
        "v3.88: the DELETE must consume the `trailing_ids_subq` "
        "scalar subquery via `id.in_(trailing_ids_subq)`."
    )


def test_truncate_user_id_scope_preserved():
    """
    v3.88 regression guard: the per-user scope must remain in BOTH
    the SELECT subquery and the DELETE outer WHERE — the rewrite
    must not accidentally drop the user_id predicate from either
    side.
    """
    fn = _load_truncate_ast()
    src = ast.unparse(fn)
    # The simplest robust check: count how many times the per-user
    # scope appears. Both the inner SELECT and the outer DELETE
    # should reference current_user.id.
    occurrences = src.count("current_user.id")
    assert occurrences >= 2, (
        "v3.88: `current_user.id` must appear in BOTH the SELECT "
        "subquery and the DELETE WHERE. Found "
        f"{occurrences} occurrence(s) — cross-user truncation guard "
        "may have been weakened."
    )


# ---------------------------------------------------------------------------
# Lane 2: tripwire — no other shape can sneak the race back in
# ---------------------------------------------------------------------------


def test_truncate_no_separate_select_execute():
    """
    v3.88 tripwire: the handler must not run a SELECT statement
    via `await db.execute(select(...))` separately from the DELETE.
    A re-introduced separate SELECT is the canonical way for the
    SELECT-then-DELETE race to come back.
    """
    fn = _load_truncate_ast()
    # Walk for `await db.execute(select(...))` patterns. The
    # legitimate execute we keep is `await db.execute(delete(...))`.
    select_executes: list[str] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Await) and isinstance(node.value, ast.Call):
            call_src = ast.unparse(node.value)
            if call_src.startswith("db.execute(select("):
                select_executes.append(call_src)
    assert select_executes == [], (
        "v3.88: no `await db.execute(select(...))` allowed inside "
        "truncate_chat_history_tail — the trailing-id selection must "
        "live inside the DELETE as a scalar subquery. Found:\n  " + "\n  ".join(select_executes)
    )
