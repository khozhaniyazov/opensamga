"""v3.53 (2026-05-02): pin question_generator print sweep.

Continues the post-v3.47 print-sweep arc:
  v3.45 (auth) -> v3.48 (library PDF) -> v3.49 (services x6)
  -> v3.51 (chat router) -> v3.52 (chat sub-services)
  -> v3.53 (question_generator).

Closes audit finding #27 from the v3.44 post-ship inventory.
``app/services/question_generator.py`` was the largest single
remaining print-sweep target on the audit shelf: **20+ print()
calls + 1 traceback.print_exc()**, scattered across
``select_anchor`` (4 sites), ``transform_to_question`` (5 sites
incl. raw-response preview + traceback), and
``generate_practice_question`` (11 sites — every step boundary
of the orchestrator was print()'d as decorated banners with
``{'=' * 60}`` separators).

This is the GQG (Grounded Question Generator) — the service
that mints practice MCQs from textbook chunks. It runs on every
request that needs a generated question (practice page, weak-
topic mode, etc.). Routing through the module logger means
generation failures land in standard log scrapers; the verbose
"banner" prints become structured ``logger.info`` lines that
log scrapers can index by ``subject`` / ``grade`` / ``id``.

**Per-call-site rationale (durable):**

- ``select_anchor`` — 3x ``print("No suitable anchor chunk
  found")`` at three distinct branches (exclude-pool exhausted,
  empty candidate pool, recursion limit hit). v3.53 routes each
  through ``logger.info`` with a distinguishing parenthetical so
  log scrapers can tell the three apart. Plus 1x ``print(f"Error
  selecting anchor: {e}")`` -> ``logger.exception``.
- ``transform_to_question`` — 5 sites: missing-field warning,
  success debug, error print + raw-response preview +
  ``traceback.print_exc()``. Routes through
  ``logger.warning``/``logger.debug``/``logger.exception``.
  ``str(e)`` is NOT consumed downstream here (the function
  returns ``None`` on failure), so the ``as e`` binding is
  collapsed to ``except Exception:`` — applying the
  v3.52-banked rule.
- ``generate_practice_question`` orchestrator — 11 sites: 4 banner
  prints, 4 step-boundary debug prints, 3 fallback info prints.
  All collapsed to structured ``logger.info``/``logger.debug``
  with explicit field labels (``subject=...`` ``grade=...``
  ``id=...``) so log scrapers can index them.

Same AST + source-substring contract pattern as v3.49 / v3.51 /
v3.52.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.services import question_generator as qg_module


def _module_ast() -> ast.Module:
    path = Path(inspect.getfile(qg_module))
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def test_question_generator_has_logger_attribute():
    """v3.53 contract: ``app.services.question_generator`` defines a
    module logger. Without the attribute pin, a future refactor that
    drops the import would silently regress observability on the
    GQG hot path."""
    import logging as _logging

    assert hasattr(qg_module, "logger"), (
        "app.services.question_generator must define `logger = logging.getLogger(__name__)`."
    )
    assert isinstance(qg_module.logger, _logging.Logger)


def test_no_print_in_question_generator():
    """v3.53 contract: zero ``print(...)`` calls survive in
    ``app/services/question_generator.py``. This was the largest
    single print-sweep target on the audit shelf — pin it shut."""
    tree = _module_ast()
    print_calls: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append(node.lineno)
    assert not print_calls, (
        f"app/services/question_generator.py must not call print(); "
        f"found {len(print_calls)} at lines {print_calls}. Use the "
        "module logger."
    )


def test_no_traceback_print_exc_in_question_generator():
    """v3.53 contract: ``traceback.print_exc()`` is redundant
    alongside ``logger.exception(...)``. The pre-v3.53 file had one
    inside ``transform_to_question`` after a discarded-import
    pattern; pin the regression shut."""
    tree = _module_ast()
    bad: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "print_exc"
        ):
            bad.append(node.lineno)
    assert not bad, (
        f"app/services/question_generator.py must not call "
        f"traceback.print_exc(); found at lines {bad}."
    )


def test_no_traceback_import_in_question_generator():
    """v3.53 contract: the ``import traceback`` was inline-imported
    inside the failing ``except`` block; v3.53 removes both the
    import and the ``traceback.print_exc()`` site. Pin the absence
    of the module-level reference too — keeps future copy-paste
    regression from sneaking the pattern back."""
    src = Path(inspect.getfile(qg_module)).read_text(encoding="utf-8")
    assert "import traceback" not in src, (
        "app/services/question_generator.py must not import traceback; "
        "logger.exception(...) is the canonical replacement."
    )
    assert "traceback." not in src, (
        "app/services/question_generator.py must not reference traceback at all post-v3.53."
    )


def test_question_generator_uses_logger_exception_at_canonical_sites():
    """Belt-and-suspenders: pin the v3.53 exception-log call sites
    so a future refactor that drops them in favour of returning
    silently fails this test, even if the AST walks above keep
    passing.

    These are the exact strings v3.53 introduced. If a future
    contributor renames them deliberately, the test should fail
    loudly so they update it consciously rather than the rename
    going unnoticed."""
    src = Path(inspect.getfile(qg_module)).read_text(encoding="utf-8")
    expected = [
        'logger.exception("Error selecting anchor chunk")',
        'logger.exception("Error transforming model response to question payload")',
    ]
    missing = [e for e in expected if e not in src]
    assert not missing, (
        "v3.53 question_generator.py must keep these logger.exception "
        f"call sites: missing {missing}."
    )
