"""
2026-05-03 audit-cleanup contract test (untagged chore on top of v3.74).

Pins three invariants surfaced by the 2026-05-03 codebase audit:

1. ``app/routers/chat.py`` no longer contains the dead
   ``if language == "kz": pass / else: pass`` conditional that was
   doing nothing pre-cleanup.

2. ``app/services/chat/context_builder.py`` has a module-level
   ``logger`` and the two ``except Exception`` branches around the
   grant-gap and unresolved-mistakes context blocks log at DEBUG
   instead of swallowing silently.

3. ``app/routers/chat.py:consult_library`` payload-parse outer-except
   logs at DEBUG instead of swallowing silently.

These are AST-level checks — they read the source files and walk the
nodes — so they're stable across formatting changes.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = BACKEND_ROOT / "app"


def _read(rel: str) -> str:
    return (APP_ROOT / rel).read_text(encoding="utf-8")


def _walk(rel: str) -> ast.Module:
    return ast.parse(_read(rel))


def test_chat_router_no_dead_language_kz_branch() -> None:
    """The ``if language == "kz": pass / else: pass`` block is gone."""

    src = _read("routers/chat.py")
    # Match the literal shape we removed; whitespace-tolerant.
    needle = 'if language == "kz":\n            pass'
    assert needle not in src, (
        f"Dead conditional resurfaced in routers/chat.py — found {needle!r}. "
        "If you re-introduced language-conditional behavior here, give it a "
        "real body or delete the branch entirely."
    )


def test_context_builder_has_module_logger() -> None:
    """``context_builder.py`` exposes a module-level ``logger`` binding."""

    tree = _walk("services/chat/context_builder.py")
    found = False
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id == "logger":
                    found = True
    assert found, (
        "services/chat/context_builder.py must define a module-level "
        "`logger = logging.getLogger(__name__)` binding so the v3.x "
        "DEBUG fallbacks introduced 2026-05-03 keep working."
    )


@pytest.mark.parametrize(
    "needle",
    [
        # grant-gap context fallback (was: silent `except Exception: pass`)
        'logger.debug("grant-gap context skipped: %s", exc)',
        # unresolved-mistakes context fallback (was: silent `except Exception: pass`)
        'logger.debug("unresolved-mistakes context skipped: %s", exc)',
    ],
)
def test_context_builder_logs_skipped_blocks(needle: str) -> None:
    """Both optional-context try/except wrappers log at DEBUG."""

    src = _read("services/chat/context_builder.py")
    assert needle in src, (
        f"context_builder.py is missing the cleanup-2026-05-03 logger call: "
        f"{needle!r}. If you removed it, restore the DEBUG path so a "
        "regression in optional context assembly remains observable."
    )


def test_chat_router_consult_library_parse_logs_at_debug() -> None:
    """``consult_library`` payload-parse outer-except logs at DEBUG."""

    src = _read("routers/chat.py")
    needle = 'logger.debug("consult_library payload parse failed: %s", exc)'
    assert needle in src, (
        "routers/chat.py:consult_library payload-parse outer-except must "
        "emit a DEBUG log line so future shape drift in the tool-response "
        "payload remains observable rather than a silent metadata-None."
    )
