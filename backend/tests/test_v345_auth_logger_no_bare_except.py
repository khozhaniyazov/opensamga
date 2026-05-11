"""v3.45 (2026-05-02): regression lock for auth.py logger conversion.

Closes the four `print(f"ERROR …")` calls and one bare `except:` that
audit finding #25 surfaced in `backend/app/routers/auth.py`. The bare
`except:` in `get_current_user_optional` previously swallowed
`KeyboardInterrupt` and `SystemExit` along with auth failures — a
shutdown / Ctrl-C hazard in dev. The `print` calls also leaked
exception strings to stdout instead of the logger that the rest of
the routers use.

These are pure-source AST tests (no DB, no fixtures, no network) so
they can run in the smoke lane.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from app.routers import auth as auth_mod

_AUTH_FILE = Path(inspect.getfile(auth_mod))


def _module_ast() -> ast.Module:
    return ast.parse(_AUTH_FILE.read_text(encoding="utf-8"), filename=str(_AUTH_FILE))


def test_module_has_logger_attribute():
    """auth router must expose a module-level `logger` for telemetry."""
    assert hasattr(auth_mod, "logger"), (
        "auth.py must define `logger = logging.getLogger(__name__)` so "
        "that JWT / DB failures route through the standard logging "
        "pipeline instead of stdout `print()`."
    )
    import logging as _logging

    assert isinstance(auth_mod.logger, _logging.Logger)


def test_no_print_statements_in_auth_router():
    """v3.45 contract: auth router must not call `print(...)`.

    Any failure here means a `print()` call sneaked back in. Replace
    it with `logger.warning` / `logger.exception` per the v3.45
    pattern.
    """
    tree = _module_ast()
    print_calls: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append((node.lineno, ast.unparse(node)[:80]))
    assert not print_calls, (
        f"auth.py must not call print(); found {len(print_calls)}: {print_calls}. "
        "Use the module `logger` (logger.warning / logger.exception) instead."
    )


def test_no_bare_except_in_auth_router():
    """v3.45 contract: no bare `except:` in auth router.

    Bare except clauses swallow `KeyboardInterrupt` and `SystemExit`,
    which masks Ctrl-C and graceful-shutdown signals. Use
    `except Exception:` (or a narrower exception class) instead.
    """
    tree = _module_ast()
    bare_excepts: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            bare_excepts.append(node.lineno)
    assert not bare_excepts, (
        f"auth.py must not use bare `except:`; found at lines {bare_excepts}. "
        "Use `except Exception:` so KeyboardInterrupt/SystemExit propagate."
    )


def test_get_current_user_optional_narrows_exceptions():
    """The optional-auth helper must explicitly catch HTTPException
    AND Exception (not bare). Pinning the shape so a refactor can't
    silently widen the catch back to bare.
    """
    src = inspect.getsource(auth_mod.get_current_user_optional)
    assert "except HTTPException" in src, (
        "get_current_user_optional must catch HTTPException explicitly so "
        "the 401/403 fallback path is documented."
    )
    assert "except Exception" in src, (
        "get_current_user_optional must catch Exception (not bare) so "
        "KeyboardInterrupt and SystemExit propagate during shutdown."
    )
    # Belt-and-suspenders: the literal `except:\n` (bare) must not
    # appear in the function body.
    assert "    except:\n" not in src and "    except :\n" not in src, (
        "Bare except: detected in get_current_user_optional"
    )


@pytest.mark.parametrize(
    "func_name",
    ["get_current_user", "get_current_user_optional"],
)
def test_auth_helpers_still_exist(func_name: str):
    """Belt-and-suspenders: the v3.45 refactor did not delete the
    helpers it touched.
    """
    assert hasattr(auth_mod, func_name), (
        f"auth.{func_name} must remain exported after v3.45 refactor."
    )
    assert callable(getattr(auth_mod, func_name))
