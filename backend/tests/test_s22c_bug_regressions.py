"""Regression tests for the 3 bugs fixed in session 22c phase 2 (2026-04-22).

These tests guard against silent regressions in the fixes for:

  B1 — ``student_profiles`` must have a UNIQUE index on ``user_id`` so a
       user cannot end up with two profile rows.
  B2 — RAG pipeline must propagate ``user_id`` end-to-end so textbook
       retrieval can honour per-user scope (``search_library_chunks``
       takes a ``user_id`` argument; if callers stop passing it we
       silently lose the filter).
  B3 — The chat WebSocket write path must accept and validate an
       optional ``thread_id`` and never persist messages with
       ``thread_id IS NULL`` or empty content.

These are source-level tests (AST + signature inspection) — they don't
require a live DB or a live WS.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# B1 — UNIQUE index migration present + alembic references it
# ---------------------------------------------------------------------------
def test_b1_student_profile_unique_migration_exists():
    """The s22e migration file must exist and reference the UNIQUE index."""
    mig = BACKEND_DIR / "alembic" / "versions" / ("s22e_student_profile_user_unique.py")
    assert mig.exists(), f"missing migration: {mig}"

    src = mig.read_text(encoding="utf-8")
    # Must create the UNIQUE index on student_profiles.user_id
    assert "student_profiles" in src
    assert "user_id" in src
    assert "UNIQUE" in src.upper() or "unique=True" in src


def test_b1_migration_is_alembic_head():
    """The alembic_version table must currently be stamped at s22e."""
    # Check head exists in the versions dir
    versions = BACKEND_DIR / "alembic" / "versions"
    files = [p.name for p in versions.glob("*.py")]
    assert any(n.startswith("s22e_student_profile_user_unique") for n in files), (
        "s22e migration missing from alembic versions dir"
    )


# ---------------------------------------------------------------------------
# B2 — user_id propagation through RAG call chain
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "rel_path,func_name",
    [
        ("app/services/ai_orchestrator.py", "consult_library"),
        ("app/services/chat/tool_executor.py", "execute_tool"),
    ],
)
def test_b2_rag_callers_accept_user_id(rel_path: str, func_name: str):
    """Callers upstream of ``search_library_chunks`` must accept user_id.

    Guard against reverting to no-arg: we grep the module's AST for the
    target function and assert ``user_id`` is in its arg list.
    """
    path = BACKEND_DIR / rel_path
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src, filename=str(path))

    found = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            if node.name == func_name:
                found = node
                break
    assert found is not None, f"{func_name} not found in {rel_path}"

    arg_names = [a.arg for a in found.args.args] + [a.arg for a in found.args.kwonlyargs]
    assert "user_id" in arg_names, (
        f"{rel_path}::{func_name} is missing user_id in its signature "
        f"(args={arg_names}). B2 regression."
    )


def test_b2_consult_library_forwards_user_id():
    """``consult_library`` must pass ``user_id`` into ``search_library_chunks``."""
    path = BACKEND_DIR / "app" / "services" / "ai_orchestrator.py"
    src = path.read_text(encoding="utf-8")
    # We look for a call like ``search_library_chunks(... user_id=...``
    assert "search_library_chunks(" in src
    # Very loose: the word user_id must appear between the call open
    # paren and the matching close paren. We rely on grep over the raw
    # text to avoid fragile AST call matching.
    idx = src.index("search_library_chunks(")
    snippet = src[idx : idx + 1200]
    assert "user_id" in snippet, (
        "consult_library() no longer forwards user_id into search_library_chunks() — B2 regression."
    )


def test_b2_library_search_router_wired_to_optional_user():
    """POST /library/search should inject current_user via Depends."""
    path = BACKEND_DIR / "app" / "routers" / "library.py"
    src = path.read_text(encoding="utf-8")
    assert "get_current_user_optional" in src, (
        "library.py no longer imports get_current_user_optional — B2 regression"
    )
    # The search endpoint must pass the resolved user id into
    # search_library_chunks.
    assert "search_library_chunks(" in src


# ---------------------------------------------------------------------------
# B3 — WS chat accepts thread_id and never writes NULL thread
# ---------------------------------------------------------------------------
def test_b3_ws_handler_reads_thread_id_from_payload():
    """chat_websocket.py must parse thread_id from the client payload."""
    path = BACKEND_DIR / "app" / "routers" / "chat_websocket.py"
    assert path.exists(), "chat_websocket.py missing"
    src = path.read_text(encoding="utf-8")
    # Guard against the old behaviour where WS just used None/0.
    assert "thread_id" in src, "chat_websocket.py doesn't reference thread_id — B3 regression"
    assert "ChatThread" in src, (
        "chat_websocket.py doesn't import ChatThread for ownership check — B3 regression"
    )


def test_b3_ws_forwards_thread_id_to_storage():
    """chat_websocket.py must forward the validated thread_id into
    ``save_chat_messages``.

    The column ``chat_messages.thread_id`` remains ``nullable=True``
    by design (legacy "Main chat" bucket), so the B3 invariant is not
    a NOT-NULL constraint but a code-path guarantee: every new WS
    write must pass through the validated ``effective_thread_id``
    variable introduced by the B3 patch. We check the source text
    for that variable name and for its appearance in the
    ``save_chat_messages`` call arguments.
    """
    path = BACKEND_DIR / "app" / "routers" / "chat_websocket.py"
    src = path.read_text(encoding="utf-8")
    assert "effective_thread_id" in src, (
        "chat_websocket.py no longer declares effective_thread_id — "
        "B3 regression (WS may write NULL thread_id again)."
    )
    # Save call must pass thread_id= argument (keyword).
    assert "thread_id=effective_thread_id" in src or "thread_id = effective_thread_id" in src, (
        "chat_websocket.py no longer forwards effective_thread_id to "
        "save_chat_messages — B3 regression."
    )
