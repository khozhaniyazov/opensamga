"""v3.56 (2026-05-02): pin bundled router-side + tts_service print sweep.

Continues the post-v3.47 print-sweep arc:
  v3.45 (auth) -> v3.48 (library PDF) -> v3.49 (services x6)
  -> v3.51 (chat router) -> v3.52 (chat sub-services)
  -> v3.53 (question_generator)
  -> v3.54 (5 RAG/ingestion/strategy modules)
  -> v3.55 (notifications digest cron)
  -> v3.56 (router-side bundle).

Closes audit findings #34-#37 from the v3.44 post-ship inventory.

**Why bundled.** Same shape across all 5 modules — small print
counts (1-5 per module) on error / warning paths inside
existing exception handlers. Same approach as v3.49 (6 modules)
and v3.54 (5 modules). Bundling threshold landed on after v3.55:
≤ 6 prints per module + no business-logic touch needed + same
structural shape.

**Modules covered:**

- ``app/routers/practice.py`` — generate_question 500 handler
  (1 print + 1 traceback.print_exc + inline ``import traceback``).
  Bonus client-disclosure fix: 500 detail no longer interpolates
  ``str(e)`` — same pattern as v3.48 library PDF.
- ``app/routers/matching.py`` — find_buddies endpoint
  (4 prints + 1 traceback.print_exc + inline ``import traceback``).
  Per-match warnings + endpoint catch-all.
- ``app/routers/mistakes.py`` — exam-mistake batch loop
  (1 print). Cron-loop pattern v3.55: per-mistake failure ->
  ``logger.exception`` so DB-side errors are distinguishable
  from data bugs.
- ``app/routers/commuter.py`` — auto-resolve event (1 print).
  Kept at INFO with field=value format because auto-resolution
  is a meaningful business event, not a high-fanout per-iter log.
- ``app/services/tts_service.py`` — TTS generate (2 prints).
  Per-segment success at DEBUG, failure at ``logger.exception``.

Test strategy is the v3.54 dict-driven parametrized AST pattern.
"""

from __future__ import annotations

import ast
import importlib
import inspect
from pathlib import Path

import pytest

# (module-import-path, expected-canonical-message-substrings)
MODULES = {
    "app.routers.practice": [
        '"Error in generate_question endpoint"',
    ],
    "app.routers.matching": [
        '"Could not fetch university names for matching"',
        '"Skipping invalid match data: %s"',
        '"Error in find_buddies endpoint"',
    ],
    "app.routers.mistakes": [
        '"Failed to create exam mistake"',
    ],
    "app.routers.commuter": [
        '"Commuter auto-resolved mistake | mistake_id=%d listens=%d user_id=%d"',
    ],
    "app.services.tts_service": [
        '"TTS generated audio for mistake %d at %s"',
        '"TTS failed to generate audio for mistake %d"',
    ],
}


def _module_ast(mod_name: str) -> tuple[ast.Module, str]:
    mod = importlib.import_module(mod_name)
    path = Path(inspect.getfile(mod))
    src = path.read_text(encoding="utf-8")
    return ast.parse(src, filename=str(path)), src


@pytest.mark.parametrize("mod_name", list(MODULES.keys()))
def test_module_has_logger_attribute(mod_name: str):
    """v3.56 contract: each touched module defines a module logger.
    Without the attribute pin, a future refactor that drops the
    import would silently regress observability on these
    high-traffic router endpoints."""
    import logging as _logging

    mod = importlib.import_module(mod_name)
    assert hasattr(mod, "logger"), f"{mod_name} must define `logger = logging.getLogger(__name__)`."
    assert isinstance(mod.logger, _logging.Logger)


@pytest.mark.parametrize("mod_name", list(MODULES.keys()))
def test_no_print_in_module(mod_name: str):
    """v3.56 contract: zero ``print(...)`` calls survive in the
    five v3.56-touched files. Pin the swept output route so a
    future regression can't silently move it back to stdout-only.
    """
    tree, _ = _module_ast(mod_name)
    print_calls: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append(node.lineno)
    assert not print_calls, (
        f"{mod_name} must not call print(); "
        f"found {len(print_calls)} at lines {print_calls}. "
        "Use the module logger."
    )


@pytest.mark.parametrize("mod_name", list(MODULES.keys()))
def test_no_traceback_print_exc_in_module(mod_name: str):
    """v3.56 contract: ``traceback.print_exc()`` is redundant
    alongside ``logger.exception(...)``. Same rule pinned in
    v3.49 / v3.51 / v3.52 / v3.53 / v3.54 / v3.55."""
    tree, _ = _module_ast(mod_name)
    bad: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "print_exc"
        ):
            bad.append(node.lineno)
    assert not bad, f"{mod_name} must not call traceback.print_exc(); found at lines {bad}."


@pytest.mark.parametrize(
    "mod_name,expected",
    [(mod, msg) for mod, msgs in MODULES.items() for msg in msgs],
)
def test_canonical_logger_call_sites(mod_name: str, expected: str):
    """Belt-and-suspenders: pin the v3.56 logger call sites by
    message-string substring so a future refactor that drops them
    fails this test, even if the AST walks above keep passing.

    The strings cover one site per print()/traceback removed."""
    _, src = _module_ast(mod_name)
    assert expected in src, (
        f"{mod_name} must keep canonical v3.56 logger call-site "
        f"message string: {expected!r}. If you renamed it "
        "deliberately, update this test."
    )


def test_practice_500_does_not_leak_internal_exception_text():
    """v3.56 client-disclosure fix (carry-forward of v3.48
    pattern): the generate_question 500 handler must not
    interpolate ``str(e)`` into the response detail. Pre-v3.56
    the detail string was f"Failed to generate question:
    {str(e)}" which leaked internals (DB error names, KeyError
    keys, etc.) to the client."""
    _, src = _module_ast("app.routers.practice")
    # The pre-v3.56 leaky variants:
    assert "Failed to generate question: {" not in src, (
        "practice.py 500 handler must not f-interpolate exception text."
    )
    assert 'detail=f"Failed to generate question' not in src, (
        "practice.py must use a static client-safe detail string."
    )
    assert '"Failed to generate question"' in src, (
        'practice.py 500 handler must use the static detail "Failed to generate question".'
    )
