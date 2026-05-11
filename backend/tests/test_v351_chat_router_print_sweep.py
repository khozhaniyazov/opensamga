"""v3.51 (2026-05-02): pin chat router print sweep.

Continues the v3.45 (auth) -> v3.48 (library) -> v3.49 (services)
print-sweep arc. Closes audit finding #15: 8x print() calls
across ``app/routers/chat.py`` plus 3x ``traceback.print_exc()``
and 3x bare ``except:`` blocks scattered through the chat
history CRUD + main /chat handler.

The chat router is the noisiest stdout source in the backend
(every chat turn previously dumped truncation traces to stdout).
Routing it through the module logger is hygiene; it also makes
log-grep queries actually catch chat-history failures, which
were previously print-only.

Per-call-site rationale (durable):
- /chat history-truncation (3x): two info-level traces during
  the message-shrinking loop + one at end of tool-call cycle.
  Now ``logger.info``.
- error fall-through ``lang`` resolution: bare ``except:``
  narrowed to ``except Exception:``. Bare except can swallow
  shutdown signals.
- /chat/history DELETE: ``print("ERROR clearing chat history")``
  + ``traceback.print_exc()`` + bare ``except:`` around
  ``db.rollback()`` -> ``logger.exception`` + narrowed except
  + debug-level rollback-failure log.
- /chat/history/truncate POST: same shape as DELETE.
- /chat/history/export GET: print + traceback.print_exc
  -> logger.exception. (No rollback handler — read-only path.)
- /chat/history/search GET: same.
- /chat/history GET: same.

Same AST-walk pattern as v3.49. Pure source, no DB, runs in the
smoke lane.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.routers import chat as chat_module


def _module_ast() -> ast.Module:
    path = Path(inspect.getfile(chat_module))
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def test_chat_router_has_logger_attribute():
    """v3.51 contract: ``app.routers.chat`` must keep the module
    logger so that future contributors writing into the file have
    somewhere to send diagnostics."""
    import logging as _logging

    assert hasattr(chat_module, "logger"), (
        "app.routers.chat must define `logger = logging.getLogger(__name__)`."
    )
    assert isinstance(chat_module.logger, _logging.Logger)


def test_no_print_statements_in_chat_router():
    """v3.51 contract: zero ``print(...)`` calls survive in
    ``app/routers/chat.py``. The chat router is the highest-volume
    stdout source in the backend; we pin it shut so it stays that
    way."""
    tree = _module_ast()
    print_calls: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append((node.lineno, ast.unparse(node)[:100]))
    assert not print_calls, (
        f"app/routers/chat.py must not call print(); found {len(print_calls)} at "
        f"lines {[lineno for lineno, _ in print_calls]}. Use the module logger."
    )


def test_no_traceback_print_exc_in_chat_router():
    """v3.51 contract: ``traceback.print_exc()`` is redundant
    alongside ``logger.exception(...)``. The pre-v3.51 file had
    five copies in the history-CRUD handlers; pin them gone so a
    copy-paste regression can't sneak the pattern back in."""
    tree = _module_ast()
    bad_calls: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "print_exc"
        ):
            bad_calls.append(node.lineno)
    assert not bad_calls, (
        f"app/routers/chat.py must not call traceback.print_exc(); "
        f"found at lines {bad_calls}. logger.exception(...) attaches the "
        "stack already."
    )


def test_no_bare_except_in_chat_router():
    """v3.51 contract: bare ``except:`` clauses are gone. The
    pre-v3.51 file had three: two around ``db.rollback()`` (DELETE
    + truncate) and one around request-language resolution. All
    narrowed to ``except Exception:``. Bare except swallows
    KeyboardInterrupt / SystemExit, which we never want in async
    handlers."""
    tree = _module_ast()
    bare_excepts: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            bare_excepts.append(node.lineno)
    assert not bare_excepts, (
        f"app/routers/chat.py must not use bare `except:`; found at "
        f"lines {bare_excepts}. Use `except Exception:`."
    )


def test_chat_history_handlers_use_logger_exception():
    """Belt-and-suspenders: the four chat-history GET/DELETE/POST
    handlers must each route their 500-fall-through error path
    through ``logger.exception(...)`` so dashboards picking up
    standard log scraping see them. Without this pin a future
    refactor could re-introduce silent-failure ``return {...}``
    branches."""
    src = Path(inspect.getfile(chat_module)).read_text(encoding="utf-8")
    # Each of these messages was introduced in v3.51 to replace
    # the corresponding pre-v3.51 print(f"ERROR ..."). They are
    # all exact strings — if a future refactor renames them, this
    # test should fail loudly so the ship author can confirm the
    # logging path still exists.
    expected = [
        'logger.exception("Error clearing chat history")',
        'logger.exception("Error truncating chat history tail")',
        'logger.exception("Error exporting chat history")',
        'logger.exception("Error searching chat history")',
        'logger.exception("Error fetching chat history")',
    ]
    missing = [e for e in expected if e not in src]
    assert not missing, (
        "v3.51 chat-history handlers must keep these logger.exception "
        f"call sites: missing {missing}. If you renamed the message, "
        "update this test deliberately."
    )
