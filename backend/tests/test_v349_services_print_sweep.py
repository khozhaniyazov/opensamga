"""v3.49 (2026-05-02): pin small-files print sweep across services
+ embedding-generator routers.

Continues the v3.45 (auth) + v3.48 (library) print-sweep arc by
batching 5 small modules whose `print(...)` calls sit on either
hot paths (matchmaker, safety, mistake_service) or quiet
silent-failure paths (portfolio + opportunities embedding
generators) where stdout was actively making operator triage
harder.

Same AST-walk pattern as v3.45 / v3.48. Pure source, no DB,
runs in the smoke lane.

Module-by-module rationale (durable):
- matchmaker: 3x DEBUG prints fired on every find_study_buddies
  call, plus a CRITICAL-ERROR print + traceback.print_exc on
  failure. Now logger.debug + logger.exception.
- feedback_loop: 3x error prints + 1x bare `except: pass` around
  rollback. Bare except narrowed to `except Exception:` with a
  debug-level log that won't drown the queue worker scrollback.
- mistake_service: 4x error/warning prints around AI JSON parse
  + library lookup. Now logger.warning / logger.exception.
- safety: 2x prints — missing API key warning, moderation API
  error fall-open. Both now go through logger.
- portfolio + opportunities: 1x silent embedding-failure print
  each. Now logger.exception so retrieval-quality regressions
  show up in standard log scraping.
"""

from __future__ import annotations

import ast
import importlib
import inspect
from pathlib import Path

import pytest

MODULES = [
    "app.services.matchmaker",
    "app.services.feedback_loop",
    "app.services.mistake_service",
    "app.services.safety",
    "app.routers.portfolio",
    "app.routers.opportunities",
]


def _load(name: str):
    """Import-by-string so we don't pollute the test module
    namespace with six different `from x import y` imports.
    """
    return importlib.import_module(name)


def _module_ast(mod) -> ast.Module:
    path = Path(inspect.getfile(mod))
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


@pytest.mark.parametrize("module_name", MODULES)
def test_module_has_logger_attribute(module_name: str):
    """Each v3.49-touched module must expose `logger` so that the
    AST contract test below has somewhere for the conversion to
    have gone."""
    import logging as _logging

    mod = _load(module_name)
    assert hasattr(mod, "logger"), (
        f"{module_name} must define `logger = logging.getLogger(__name__)` per v3.49."
    )
    assert isinstance(mod.logger, _logging.Logger)


@pytest.mark.parametrize("module_name", MODULES)
def test_no_print_statements(module_name: str):
    """v3.49 contract: no `print(...)` calls survive in the
    six modules touched by this ship."""
    mod = _load(module_name)
    tree = _module_ast(mod)
    print_calls: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append((node.lineno, ast.unparse(node)[:100]))
    assert not print_calls, (
        f"{module_name} must not call print(); found {len(print_calls)} at lines "
        f"{[lineno for lineno, _ in print_calls]}. Use the module logger."
    )


@pytest.mark.parametrize("module_name", MODULES)
def test_no_traceback_print_exc(module_name: str):
    """v3.49 contract: `traceback.print_exc()` is redundant
    alongside `logger.exception(...)`. Pin it gone in all six
    modules to prevent a copy-paste regression."""
    mod = _load(module_name)
    tree = _module_ast(mod)
    bad_calls: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "print_exc"
        ):
            bad_calls.append(node.lineno)
    assert not bad_calls, (
        f"{module_name} must not call traceback.print_exc(); found at lines {bad_calls}. "
        "logger.exception(...) already attaches the stack."
    )


def test_feedback_loop_rollback_except_narrowed():
    """v3.49 specifically: feedback_loop.run_feedback_loop_batch
    used to wrap `await db.rollback()` in `except: pass`. Bare
    except swallows shutdown signals. v3.49 narrowed it to
    `except Exception:` + a debug-level log."""
    mod = _load("app.services.feedback_loop")
    src = inspect.getsource(mod)
    # Rough check: no bare `except:` survives in the file. (No
    # AST walk needed — at this length a string-search is fine
    # and the assertion message tells you where to look.)
    assert "    except:\n" not in src and "    except :\n" not in src, (
        "feedback_loop.py must not use bare `except:`; v3.49 narrowed "
        "the rollback handler to `except Exception:`."
    )


def test_safety_logger_used_in_moderate_content():
    """Belt-and-suspenders: the safety module is a
    content-moderation hot path; verify the logger is wired into
    `moderate_content` specifically (not just imported but
    unused)."""
    mod = _load("app.services.safety")
    src = inspect.getsource(mod.moderate_content)
    assert "logger.warning" in src or "logger.exception" in src, (
        "safety.moderate_content must use logger.warning / logger.exception "
        "for the missing-API-key + API-error paths (v3.49)."
    )


@pytest.mark.parametrize("module_name", ["app.routers.portfolio", "app.routers.opportunities"])
def test_embedding_router_uses_logger_exception(module_name: str):
    """The two routers' embedding generators previously swallowed
    failures via `print(f"Error ...")` and returned []. v3.49
    routed them through `logger.exception(...)` so retrieval-
    quality regressions are visible in standard log scraping.
    Pin the logger.exception presence so the silent-degradation
    pattern can't sneak back in."""
    mod = _load(module_name)
    src = inspect.getsource(mod)
    assert "logger.exception(" in src, (
        f"{module_name} must use logger.exception(...) for the embedding "
        "generator's failure path (v3.49). A silent print + return [] is "
        "the regression we are pinning against."
    )
