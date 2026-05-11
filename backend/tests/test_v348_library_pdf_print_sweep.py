"""v3.48 (2026-05-02): pin library.py PDF endpoint print sweep.

The `serve_pdf` endpoint (`backend/app/routers/library.py`) used
to call `print(...)` ~19 times per request and echo absolute
filesystem paths, CWD, and stored DB paths back to the HTTP
client in the error `detail` body. Both are path-disclosure
smells: stdout `print` for prod telemetry is bad enough; leaking
absolute server paths in 404/500 response bodies tells an
attacker exactly where the data lives on disk.

v3.48 sweeps all 19 prints out, routes server-side detail through
`logger`, and rewrites the four affected `HTTPException(detail=...)`
calls to use generic client-safe strings.

Same AST-walk pattern as v3.45's auth-router test. Pure source,
no DB, runs in the smoke lane.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.routers import library as library_mod

_LIBRARY_FILE = Path(inspect.getfile(library_mod))


def _module_ast() -> ast.Module:
    return ast.parse(_LIBRARY_FILE.read_text(encoding="utf-8"), filename=str(_LIBRARY_FILE))


def test_module_has_logger_attribute():
    """library.py must expose a module-level `logger`. (It already
    did pre-v3.48 — this test pins it so a refactor that removes
    the import while leaving stale `print()` calls fails fast.)"""
    import logging as _logging

    assert hasattr(library_mod, "logger"), (
        "library.py must define `logger = logging.getLogger(__name__)`."
    )
    assert isinstance(library_mod.logger, _logging.Logger)


def test_no_print_statements_in_library_router():
    """v3.48 contract: zero `print(...)` calls survive in
    library.py. Use the module logger instead.
    """
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
        f"library.py must not call print(); found {len(print_calls)}: {print_calls}. "
        "Use the module `logger` (logger.debug / logger.info / logger.warning / logger.exception)."
    )


def test_no_traceback_print_exc_in_library_router():
    """The pre-v3.48 shape called `traceback.print_exc()` inside
    the resolve-failure handler, dumping the full stack to stdout.
    `logger.exception(...)` already captures the stack, so
    `print_exc` is redundant.
    """
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
        f"library.py must not call traceback.print_exc(); found at lines {bad_calls}. "
        "logger.exception(...) already attaches the stack."
    )


def test_pdf_endpoint_does_not_leak_paths_in_http_detail():
    """The pre-v3.48 shape returned a multi-line `detail` string
    containing the stored path, the resolved absolute path, and
    `os.getcwd()` — all path-disclosure smells. The new shape uses
    generic detail strings; absolute paths only go to the logger.

    Pin: the literal substrings "Stored path:", "Resolved path:",
    and "CWD:" must not appear inside any HTTPException(detail=...)
    keyword inside the serve_pdf endpoint.
    """
    src = inspect.getsource(library_mod)
    # The disclosure substrings were unique to the old f-string.
    # If any of them re-appear, the regression is real — the pre-
    # v3.48 detail string was the only place these tokens existed.
    forbidden = ["Stored path:", "Resolved path:", f"CWD: {{os.getcwd"]  # noqa: F541
    leaked = [token for token in forbidden if token in src]
    assert not leaked, (
        f"library.py must not echo absolute filesystem paths in HTTP responses; "
        f"found leaked tokens: {leaked}. Server-side detail belongs in the logger only."
    )


def test_serve_pdf_resolution_failure_uses_generic_detail():
    """The 500-response handler for resolve_pdf_path() failure
    must NOT format the exception string into the HTTP detail
    (it can carry the absolute path that triggered the failure).

    Pin: search the source for the exact pre-v3.48 shape
    `f"Failed to resolve file path: {str(e)}"` and assert it's
    gone. We accept the new shape "Failed to resolve textbook
    file path" (no exception interpolation).
    """
    src = inspect.getsource(library_mod)
    assert "Failed to resolve file path: " not in src, (
        "v3.48: the 500-response detail must not interpolate the resolution "
        "exception (it can carry an absolute path). Use a static client-safe "
        "string and put detail in logger.exception(...)."
    )
    # Belt-and-suspenders: the new generic phrase is present.
    assert "Failed to resolve textbook file path" in src, (
        "v3.48: expected the static generic detail string to be present."
    )


def test_pdf_endpoints_still_exist():
    """Belt-and-suspenders: v3.48 didn't accidentally rename or
    delete the two PDF-serving entry points (`get_book_pdf`,
    which serves the file, and `get_book_page_thumbnail`, which
    reuses the same resolution path)."""
    for name in ("get_book_pdf", "get_book_page_thumbnail"):
        assert hasattr(library_mod, name) and callable(getattr(library_mod, name)), (
            f"library.{name} must still exist after v3.48 refactor."
        )
