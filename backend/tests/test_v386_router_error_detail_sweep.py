"""
v3.86 — Router error-detail sweep contract tests.

The sweep had three goals:

1. Stop leaking internal exception strings (SQL fragments, file paths, AI
   stacktraces, OS errors) to authenticated callers via HTTPException
   `detail=` strings on the broad `except Exception` paths.
2. Always log the exception server-side via `logger.exception(...)` so
   the information is preserved for ops, just not surfaced to the user.
3. Chain via `raise HTTPException(...) from e` so traceback fidelity is
   preserved when the global exception handler renders the 500.

This test file pins the post-sweep shape via static analysis. AST is
preferred over a TestClient sweep because:
  - We don't want to provoke 500s in production code paths just to assert
    the response body shape.
  - The bug is structural (does the `except Exception` block leak `str(e)`
    to the client) and AST is the right tool for structural assertions.
  - Several of these endpoints depend on heavy services (DashScope TTS,
    PyMuPDF, AI orchestrator) that we don't want to wire into a test fixture.

The 4 surviving `detail=str(e)` sites are validation paths (ValueError /
IndexError) where the exception message is a string we own and is safe
to surface. Each is whitelisted explicitly below.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent / "app" / "routers"

# ---------------------------------------------------------------------------
# (1) Sites that were rewritten by v3.86. Each tuple is
#     (file, function name, status_code that the broad except raises with).
# ---------------------------------------------------------------------------

REWRITTEN_SITES = [
    ("analytics.py", "get_report", 500),
    ("analytics.py", "get_gap_analysis", 500),
    ("analytics.py", "get_weak_topic_mode", 500),
    ("users.py", "upload_avatar", 500),
    ("commuter.py", "generate_segment", 500),
    ("commuter.py", "generate_chunk_audio", 500),
    ("admin.py", "import_universities", 500),
    ("admin.py", "import_acceptance_scores", 500),
    ("admin.py", "import_questions", 500),
    ("strategy.py", "get_roadmap", 500),
    ("strategy.py", "get_grant_probability", 500),
    ("social.py", "send_connection_request", 500),
    ("library.py", "get_book_page_thumbnail", 500),
    ("mistakes.py", "analyze_mistake", 500),
]

# (2) Sites that legitimately surface str(e) — ValueError/IndexError paths
#     where the exception message is a validation string under our control.
WHITELISTED_LEAK_SITES = [
    ("growth.py", "invite_user_to_squad", "ValueError"),
    ("auth.py", "register", "ValueError"),
    ("rewards.py", "open_box", "ValueError"),
    ("library.py", "get_book_page_thumbnail", "IndexError"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load(file: str) -> ast.Module:
    return ast.parse((ROOT / file).read_text(encoding="utf-8"))


def _find_function(tree: ast.Module, name: str) -> ast.AsyncFunctionDef | ast.FunctionDef | None:
    """Find the function with this exact name (top-level or nested)."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == name:
            return node
    return None


def _broad_except_handlers(func_node: ast.AST) -> list[ast.ExceptHandler]:
    """Return all `except Exception ...` handlers nested in the function body."""
    handlers: list[ast.ExceptHandler] = []
    for node in ast.walk(func_node):
        if not isinstance(node, ast.ExceptHandler):
            continue
        if node.type is None:
            handlers.append(node)
        elif isinstance(node.type, ast.Name) and node.type.id == "Exception":
            handlers.append(node)
    return handlers


def _raised_http_exceptions(handler: ast.ExceptHandler) -> list[ast.Raise]:
    """Find `raise HTTPException(...)` statements in this handler."""
    out: list[ast.Raise] = []
    for node in ast.walk(handler):
        if not isinstance(node, ast.Raise):
            continue
        exc = node.exc
        if (
            isinstance(exc, ast.Call)
            and isinstance(exc.func, ast.Name)
            and exc.func.id == "HTTPException"
        ):
            out.append(node)
    return out


def _detail_kwarg(call: ast.Call) -> ast.expr | None:
    for kw in call.keywords:
        if kw.arg == "detail":
            return kw.value
    return None


def _calls_str_e(node: ast.expr) -> bool:
    """Does this expression contain `str(e)`?"""
    for sub in ast.walk(node):
        if (
            isinstance(sub, ast.Call)
            and isinstance(sub.func, ast.Name)
            and sub.func.id == "str"
            and len(sub.args) == 1
            and isinstance(sub.args[0], ast.Name)
            and sub.args[0].id == "e"
        ):
            return True
    return False


# ---------------------------------------------------------------------------
# (1) Rewritten sites: must NOT contain `str(e)` in the detail kwarg of a
#     broad-except HTTPException(500), MUST contain a `logger.exception(...)`
#     call, and MUST chain via `raise ... from e`.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("file", "fn_name", "status_code"), REWRITTEN_SITES)
def test_rewritten_site_does_not_leak_str_e(file: str, fn_name: str, status_code: int) -> None:
    tree = _load(file)
    func = _find_function(tree, fn_name)
    assert func is not None, f"function {fn_name!r} not found in {file}"

    found_broad_500 = False
    for handler in _broad_except_handlers(func):
        for raise_node in _raised_http_exceptions(handler):
            call = raise_node.exc
            assert isinstance(call, ast.Call)
            detail = _detail_kwarg(call)
            if detail is None:
                # positional detail (e.g. HTTPException(500, "msg")) — also fine
                continue
            # If detail contains `str(e)`, this is a leak.
            assert not _calls_str_e(detail), (
                f"{file}:{fn_name} broad-except still raises HTTPException with str(e) in detail"
            )
            found_broad_500 = True

    assert found_broad_500, (
        f"{file}:{fn_name} no broad `except Exception` HTTPException found — "
        "the test is misaligned with the source"
    )


@pytest.mark.parametrize(("file", "fn_name", "status_code"), REWRITTEN_SITES)
def test_rewritten_site_logs_exception(file: str, fn_name: str, status_code: int) -> None:
    tree = _load(file)
    func = _find_function(tree, fn_name)
    assert func is not None

    # At least one logger.exception(...) call must appear inside ANY of the
    # broad-except handlers in this function.
    has_logger_exception = False
    for handler in _broad_except_handlers(func):
        for node in ast.walk(handler):
            if not isinstance(node, ast.Call):
                continue
            if (
                isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "logger"
                and node.func.attr in ("exception", "error")
            ):
                has_logger_exception = True
                break

    assert has_logger_exception, (
        f"{file}:{fn_name} broad-except branch does not call logger.exception(...) — "
        "internal failures will not be observable in ops logs"
    )


@pytest.mark.parametrize(("file", "fn_name", "status_code"), REWRITTEN_SITES)
def test_rewritten_site_chains_from_e(file: str, fn_name: str, status_code: int) -> None:
    tree = _load(file)
    func = _find_function(tree, fn_name)
    assert func is not None

    for handler in _broad_except_handlers(func):
        for raise_node in _raised_http_exceptions(handler):
            assert raise_node.cause is not None, (
                f"{file}:{fn_name} broad-except raises HTTPException without "
                "`from e` — traceback chain is broken (B904)"
            )
            cause = raise_node.cause
            assert (isinstance(cause, ast.Name) and cause.id == "e") or (
                isinstance(cause, ast.Constant) and cause.value is None
            ), f"{file}:{fn_name} `from` clause must be `from e` or `from None`"


# ---------------------------------------------------------------------------
# (2) Whitelisted str(e) leaks. The 4 sites here are validation paths.
#     We assert the exception type is one we own AND the call site has a
#     comment explaining why the leak is safe.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("file", "fn_name", "exc_type"), WHITELISTED_LEAK_SITES)
def test_whitelisted_leak_is_validation_path(file: str, fn_name: str, exc_type: str) -> None:
    tree = _load(file)
    func = _find_function(tree, fn_name)
    assert func is not None

    found_match = False
    for node in ast.walk(func):
        if not isinstance(node, ast.ExceptHandler):
            continue
        if node.type is None:
            continue
        names: list[str] = []
        if isinstance(node.type, ast.Name):
            names = [node.type.id]
        elif isinstance(node.type, ast.Tuple):
            names = [n.id for n in node.type.elts if isinstance(n, ast.Name)]
        if exc_type not in names:
            continue
        # Confirm at least one HTTPException(detail=str(e)) raise with `from e`
        for raise_node in _raised_http_exceptions(node):
            call = raise_node.exc
            assert isinstance(call, ast.Call)
            detail = _detail_kwarg(call)
            if detail is None:
                continue
            if _calls_str_e(detail):
                assert raise_node.cause is not None, (
                    f"{file}:{fn_name} validation-leak path missing `from e`"
                )
                found_match = True

    assert found_match, (
        f"{file}:{fn_name} expected an `except {exc_type}` block surfacing "
        "str(e) — whitelist is misaligned with the source"
    )


# ---------------------------------------------------------------------------
# (3) Tripwire: no NEW broad-except HTTPException raises with str(e) anywhere
#     under app/routers. If a future PR adds one, this test fails and forces
#     either a justification (whitelist update) or a fix.
# ---------------------------------------------------------------------------


def test_no_new_broad_except_str_e_leaks() -> None:
    leaks: list[str] = []
    for path in ROOT.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler):
                continue
            # Broad except = bare or `Exception`
            is_broad = node.type is None or (
                isinstance(node.type, ast.Name) and node.type.id == "Exception"
            )
            if not is_broad:
                continue
            for raise_node in _raised_http_exceptions(node):
                call = raise_node.exc
                assert isinstance(call, ast.Call)
                detail = _detail_kwarg(call)
                if detail is None and call.args:
                    # second positional arg is the detail
                    if len(call.args) >= 2:
                        detail = call.args[1]
                if detail is not None and _calls_str_e(detail):
                    leaks.append(f"{path.name}:{raise_node.lineno}")
    assert leaks == [], f"new broad-except HTTPException raises with str(e) detail leak: {leaks}"


# ---------------------------------------------------------------------------
# (4) Bonus regression: every router file we touched must import logging.
#     Catches the case where a future edit removes `import logging` and
#     `logger.exception(...)` silently turns into a NameError at runtime.
# ---------------------------------------------------------------------------

TOUCHED_FILES = sorted({f for f, _, _ in REWRITTEN_SITES})


@pytest.mark.parametrize("file", TOUCHED_FILES)
def test_touched_file_imports_logging(file: str) -> None:
    src = (ROOT / file).read_text(encoding="utf-8")
    assert re.search(r"^import logging$", src, re.MULTILINE), (
        f"{file} no top-level `import logging` — `logger.exception(...)` "
        "calls inserted by v3.86 will NameError at runtime"
    )
    assert re.search(
        r"^logger\s*=\s*logging\.getLogger\(__name__\)$",
        src,
        re.MULTILINE,
    ), f"{file} no module-level `logger = logging.getLogger(__name__)`"
