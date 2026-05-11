"""Regression tests for the 3 P1 bugs fixed on 2026-04-23.

B1 — ``chat.py`` must log a WARNING (not ``if False:``) when
     OPENAI_API_KEY is unset, so misconfigured deploys surface.
B2 — ``qwen_dashscope.rerank`` must LOG a warning before silently
     falling back to input order, so degraded RAG quality is visible
     in ops logs.
B3 — ``/data/ingest/grants`` and ``/data/ingest/questions`` must
     require admin auth (``require_admin``) and not plain
     ``get_current_user``.

All three are source-level tests — they don't need a live DB or live
HTTP server.
"""

from __future__ import annotations

import logging
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# B1 — chat.py must not disable OPENAI_API_KEY warning with `if False:`
# ---------------------------------------------------------------------------
def test_b1_chat_py_api_key_warning_not_dead_code():
    src = (BACKEND_DIR / "app" / "routers" / "chat.py").read_text(encoding="utf-8")
    # The `if False:` anti-pattern must be gone.
    assert "if False:" not in src, (
        "chat.py still contains `if False:` dead-code guard — the "
        "missing-API-key warning will not fire."
    )
    # And there must still be a real warning for the missing-key case.
    assert "OPENAI_API_KEY not set" in src, (
        "chat.py must still warn when OPENAI_API_KEY is missing."
    )


# ---------------------------------------------------------------------------
# B2 — rerank must emit a warning log before the identity fallback
# ---------------------------------------------------------------------------
def test_b2_rerank_logs_on_empty_payload(caplog):
    from app.services import qwen_dashscope

    # Patch _rerank_raw to return [] — simulates an empty upstream
    # response (rerank service reachable but returned nothing usable).
    with (
        patch.object(qwen_dashscope, "_rerank_raw", return_value=[]),
        caplog.at_level(logging.WARNING, logger="app.services.qwen_dashscope"),
    ):
        out = qwen_dashscope.rerank("q", ["a", "b", "c"])

    assert out == [0, 1, 2]  # identity fallback preserved
    assert any(
        "rerank returned empty" in rec.message.lower()
        or "rerank" in rec.message.lower()
        and "fall" in rec.message.lower()
        for rec in caplog.records
    ), "expected WARNING log when rerank returns empty payload"


def test_b2_rerank_logs_on_exception(caplog):
    from app.services import qwen_dashscope

    def _boom(*a, **kw):  # noqa: ARG001
        raise RuntimeError("DashScope exploded")

    with (
        patch.object(qwen_dashscope, "_rerank_raw", side_effect=_boom),
        caplog.at_level(logging.WARNING, logger="app.services.qwen_dashscope"),
    ):
        out = qwen_dashscope.rerank("q", ["a", "b", "c"])

    assert out == [0, 1, 2]
    assert any("rerank call failed" in rec.message.lower() for rec in caplog.records), (
        "expected WARNING log when rerank raises"
    )


# ---------------------------------------------------------------------------
# B3 — /data/ingest/* endpoints must require admin auth (not plain auth)
# ---------------------------------------------------------------------------
def test_b3_ingest_grants_requires_admin():
    src = (BACKEND_DIR / "app" / "routers" / "data.py").read_text(encoding="utf-8")
    # The TODO comment must be gone.
    assert "TODO: Add Admin role check" not in src, (
        "data.py still carries the 'TODO: Add Admin role check' "
        "comment — the admin check was never added."
    )
    # require_admin must be imported from .admin.
    assert "from .admin import require_admin" in src, (
        "data.py must import `require_admin` from .admin"
    )


def test_b3_ingest_endpoints_wire_require_admin():
    """AST-check: both /ingest/grants and /ingest/questions must have a
    `Depends(require_admin)` (not `Depends(get_current_user)`)."""
    import ast as _ast

    src = (BACKEND_DIR / "app" / "routers" / "data.py").read_text(encoding="utf-8")
    tree = _ast.parse(src)
    wired: dict[str, str] = {}
    for node in _ast.walk(tree):
        if not isinstance(node, (_ast.AsyncFunctionDef, _ast.FunctionDef)):
            continue
        if node.name not in ("ingest_grant_data", "ingest_mock_question"):
            continue
        # Scan default arg expressions for Depends(...) calls.
        for default in list(node.args.defaults) + list(node.args.kw_defaults):
            if default is None:
                continue
            if (
                isinstance(default, _ast.Call)
                and isinstance(default.func, _ast.Name)
                and default.func.id == "Depends"
            ):
                if default.args and isinstance(default.args[0], _ast.Name):
                    wired[node.name] = default.args[0].id
                    break

    assert wired.get("ingest_grant_data") == "require_admin", (
        f"ingest_grant_data should Depends(require_admin), "
        f"got Depends({wired.get('ingest_grant_data')})"
    )
    assert wired.get("ingest_mock_question") == "require_admin", (
        f"ingest_mock_question should Depends(require_admin), "
        f"got Depends({wired.get('ingest_mock_question')})"
    )
