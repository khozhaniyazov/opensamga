"""v3.52 (2026-05-02): pin chat-services print sweep.

Continues the post-v3.47 print-sweep arc:
  v3.45 (auth) -> v3.48 (library PDF) -> v3.49 (services x6)
  -> v3.51 (chat router) -> v3.52 (chat sub-services).

Closes audit findings #24-#26: ``app/services/chat/storage_manager.py``
and ``app/services/chat/tool_executor.py`` were the two remaining
files in the chat call graph still printing to stdout. Both are
on the hot path for every chat turn that hits the consult_library
tool or persists a thread message, so the same operational logic
that motivated v3.51 applies here verbatim.

Per-call-site rationale (durable):

- ``storage_manager.save_chat_messages``: ``print(f"ERROR: ...") +
  traceback.print_exc()`` on the message-persist failure path,
  then bare ``except:`` around ``db.rollback()``. Both replaced
  with ``logger.exception`` + ``except Exception:`` + debug-level
  rollback-failure log. This is the single path that captures
  every chat turn into ChatMessage; pre-v3.52 a write failure
  was print-only and dashboards never saw it.
- ``storage_manager.capture_failed_query``: same shape — print +
  bare except -> logger.exception + narrowed except. This is the
  feedback_loop ingestion point; if it silently fails the queue
  worker never sees those failed queries.
- ``tool_executor`` consult_library handler: ``print(f"Error in
  consult_library: {e}") + traceback.print_exc()`` ->
  ``logger.exception``. **The ``as e`` capture is kept** because
  ``str(e)`` is interpolated into the tool_response_content JSON
  that flows back to the model (and the model surfaces it to the
  user). Same deliberate exception in v3.49's
  ``feedback_loop.analyze_single_failed_query``.

Same AST + source-substring pattern as v3.49 / v3.51.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from app.services.chat import storage_manager as storage_manager_module
from app.services.chat import tool_executor as tool_executor_module

_MODULES = [
    ("app.services.chat.storage_manager", storage_manager_module),
    ("app.services.chat.tool_executor", tool_executor_module),
]


def _module_ast(mod) -> ast.Module:
    path = Path(inspect.getfile(mod))
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


@pytest.mark.parametrize("dotted,mod", _MODULES, ids=[m[0] for m in _MODULES])
def test_chat_service_module_has_logger_attribute(dotted, mod):
    """v3.52 contract: each chat sub-service module owns a module
    logger so future contributors have somewhere to send
    diagnostics. Without the attribute pin, a future refactor that
    drops the import would silently regress observability."""
    import logging as _logging

    assert hasattr(mod, "logger"), f"{dotted} must define `logger = logging.getLogger(__name__)`."
    assert isinstance(mod.logger, _logging.Logger)


@pytest.mark.parametrize("dotted,mod", _MODULES, ids=[m[0] for m in _MODULES])
def test_no_print_in_chat_service_module(dotted, mod):
    """v3.52 contract: zero ``print(...)`` calls survive in either
    chat sub-service. Both files are on the chat hot path."""
    tree = _module_ast(mod)
    print_calls: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append(node.lineno)
    assert not print_calls, (
        f"{dotted} must not call print(); found at lines {print_calls}. Use the module logger."
    )


@pytest.mark.parametrize("dotted,mod", _MODULES, ids=[m[0] for m in _MODULES])
def test_no_traceback_print_exc_in_chat_service_module(dotted, mod):
    """v3.52 contract: ``traceback.print_exc()`` is redundant
    alongside ``logger.exception(...)`` and was the second-half of
    every print() error site we just removed."""
    tree = _module_ast(mod)
    bad: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "print_exc"
        ):
            bad.append(node.lineno)
    assert not bad, (
        f"{dotted} must not call traceback.print_exc(); found at lines "
        f"{bad}. logger.exception(...) attaches the stack already."
    )


def test_no_bare_except_in_storage_manager():
    """v3.52 contract: ``storage_manager.py`` had two bare ``except:``
    clauses around ``db.rollback()`` (one per public function). Both
    narrowed to ``except Exception:`` so KeyboardInterrupt /
    SystemExit propagate cleanly during shutdown."""
    tree = _module_ast(storage_manager_module)
    bare: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            bare.append(node.lineno)
    assert not bare, (
        f"app/services/chat/storage_manager.py must not use bare "
        f"`except:`; found at lines {bare}. Use `except Exception:`."
    )


def test_storage_manager_uses_logger_exception_at_canonical_sites():
    """Belt-and-suspenders: pin the v3.52 exception-log call sites
    so a future refactor that drops the logger.exception line in
    favour of returning silently fails this test, even if the AST
    walks above keep passing."""
    src = Path(inspect.getfile(storage_manager_module)).read_text(encoding="utf-8")
    expected = [
        'logger.exception("Failed to save chat messages")',
        'logger.exception("Failed to capture failed query")',
    ]
    missing = [e for e in expected if e not in src]
    assert not missing, (
        "v3.52 storage_manager.py must keep these logger.exception call "
        f"sites: missing {missing}. If the message text was changed, "
        "update this test deliberately."
    )


def test_tool_executor_uses_logger_exception_for_consult_library():
    """Belt-and-suspenders: the consult_library tool branch was the
    only print() call in tool_executor.py. Pin its replacement so
    the print-then-rethrow pattern can't silently come back."""
    src = Path(inspect.getfile(tool_executor_module)).read_text(encoding="utf-8")
    assert 'logger.exception("Error in consult_library tool call")' in src, (
        "v3.52 tool_executor.py must keep the canonical "
        '`logger.exception("Error in consult_library tool call")` site.'
    )
