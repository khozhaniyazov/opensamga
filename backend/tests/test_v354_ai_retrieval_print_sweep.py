"""v3.54 (2026-05-02): pin AI/retrieval/ingestion print sweep.

Continues the post-v3.47 print-sweep arc:
  v3.45 (auth) -> v3.48 (library PDF) -> v3.49 (services x6)
  -> v3.51 (chat router) -> v3.52 (chat sub-services)
  -> v3.53 (question_generator)
  -> v3.54 (5 RAG/ingestion/strategy modules).

Closes audit findings #28-#32 from the v3.44 post-ship inventory
in a single bundled sweep — the same shape (small print counts
in error / warning / silent-failure paths) across:

- ``app/services/ai_orchestrator.py`` (RAG orchestrator, 3
  prints incl. consult_library catch-all).
- ``app/services/chunk_completer.py`` (Commuter-mode pipeline,
  6 prints across validate/complete/QA-generate stages).
- ``app/services/library_ingestion.py`` (PDF ingestion pipeline,
  3 prints + 1 bare ``except:`` for tiktoken-encoding fallback).
- ``app/services/library_retrieval.py`` (1 reranker-fallback
  print on the RAG hot path).
- ``app/services/strategy_service.py`` (2 prints in the AI
  roadmap-generation error-handler).

Bundling rationale matches v3.49: each diff is 1-6 prints, all
the same shape, and all the modules already had homogenous test
infrastructure. Shipping as 5 separate v3.x slots would have
been 5 near-identical contract tests; one parametrized test
covers them all.

Per-call-site rationale (durable, in case a future ship needs
to revisit):

- ``ai_orchestrator``:
  - RAG-optimizer drift detector: print -> ``logger.info`` with
    %.2f formatting. Real operational signal — when the model
    drifts to English on a Cyrillic input, we want it indexed
    in standard logs.
  - ``optimize_rag_query`` catch-all: print + str(e) ->
    ``logger.warning(..., exc_info=True)``. Up-leveled to
    WARNING because losing the optimizer means RAG falls back
    to the unoptimized query — that's a quality regression
    worth surfacing. ``as e`` collapsed (str(e) only used in
    removed print).
  - ``consult_library`` catch-all: print + str(e) ->
    ``logger.exception``. ``as e`` collapsed.
  - "RAG Optimization: 'q' -> 'q'" debug trace: print ->
    ``logger.debug``. Down-leveled because successful
    optimization is the common case.
- ``chunk_completer``:
  - 5 ``[CHUNK_COMPLETER] ...`` prefix-style prints + 1 bare-
    error print across validate_content / complete_content /
    generate_qa_from_content / process_chunk_for_commuter.
    All routed through the module logger — the
    ``[CHUNK_COMPLETER]`` prefix becomes the ``%(name)s``
    field via the standard logger format string.
- ``library_ingestion``:
  - Embedding-failure print -> ``logger.exception``.
  - "Skipping ... already exists" print -> ``logger.info``.
  - Per-page extraction-failure print -> ``logger.warning(...,
    exc_info=True)``.
  - Bare ``except:`` around tiktoken encoding fallback
    narrowed to ``except Exception:``. Bare except can swallow
    ImportError-via-KeyboardInterrupt scenarios.
- ``library_retrieval``:
  - Reranker-fallback print -> ``logger.info``. **The ``as exc``
    binding is intentionally kept** because the resulting
    ``rerank_error`` string flows downstream into the
    ``rag_query_log`` telemetry row (lines 990+ in this
    module). Direct application of the v3.52-banked rule;
    documented in source comment.
- ``strategy_service``:
  - 2 prints in the AI roadmap-generation handler (one for
    ``json.JSONDecodeError`` specifically, one for catch-all
    ``Exception``). Both -> ``logger.exception``. ``as e``
    collapsed.

Same parametrized AST + source-substring contract pattern as
v3.49 / v3.52.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from app.services import (
    ai_orchestrator as ai_orchestrator_module,
)
from app.services import (
    chunk_completer as chunk_completer_module,
)
from app.services import (
    library_ingestion as library_ingestion_module,
)
from app.services import (
    library_retrieval as library_retrieval_module,
)
from app.services import (
    strategy_service as strategy_service_module,
)

_MODULES = [
    ("app.services.ai_orchestrator", ai_orchestrator_module),
    ("app.services.chunk_completer", chunk_completer_module),
    ("app.services.library_ingestion", library_ingestion_module),
    ("app.services.library_retrieval", library_retrieval_module),
    ("app.services.strategy_service", strategy_service_module),
]


def _module_ast(mod) -> ast.Module:
    path = Path(inspect.getfile(mod))
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


@pytest.mark.parametrize("dotted,mod", _MODULES, ids=[m[0] for m in _MODULES])
def test_v354_module_has_logger_attribute(dotted, mod):
    """v3.54 contract: each of the 5 RAG/ingestion/strategy modules
    owns a module logger. Without the attribute pin, a future
    refactor that drops the import would silently regress
    observability on hot paths."""
    import logging as _logging

    assert hasattr(mod, "logger"), f"{dotted} must define `logger = logging.getLogger(__name__)`."
    assert isinstance(mod.logger, _logging.Logger)


@pytest.mark.parametrize("dotted,mod", _MODULES, ids=[m[0] for m in _MODULES])
def test_v354_no_print_in_module(dotted, mod):
    """v3.54 contract: zero ``print(...)`` calls survive in any
    of the 5 modules. Bundled to share one parametrized test
    across the sweep."""
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
def test_v354_no_traceback_print_exc_in_module(dotted, mod):
    """v3.54 contract: ``traceback.print_exc()`` is redundant
    alongside ``logger.exception(...)``; pin the shape gone."""
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


def test_v354_no_bare_except_in_library_ingestion():
    """v3.54 contract: ``library_ingestion.py`` had one bare
    ``except:`` around the tiktoken encoding fallback (``encoding =
    tiktoken.encoding_for_model("gpt-4")``). Narrowed to
    ``except Exception:`` so KeyboardInterrupt / SystemExit
    propagate cleanly during shutdown.

    Note: the other 4 modules in this sweep didn't have bare
    excepts, so this test is scoped to library_ingestion only."""
    tree = _module_ast(library_ingestion_module)
    bare: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            bare.append(node.lineno)
    assert not bare, (
        f"app/services/library_ingestion.py must not use bare "
        f"`except:`; found at lines {bare}. Use `except Exception:`."
    )


def test_v354_canonical_logger_exception_call_sites():
    """Belt-and-suspenders: pin a canonical ``logger.exception``
    call in each module that has one. A future refactor that
    drops them in favour of returning silently fails this test
    even if the AST walks above keep passing.

    Per-module canonical site:
    - ai_orchestrator: ``logger.exception("Error searching textbooks via consult_library")``
    - chunk_completer: ``logger.exception("Validation error")``
    - library_ingestion: ``logger.exception("Error generating embedding")``
    - library_retrieval: no logger.exception (the reranker site uses
      logger.info because reranker is best-effort, not an error). The
      logger.info site is pinned by source-substring instead.
    - strategy_service: ``logger.exception("Error during AI roadmap generation")``
    """
    expected = {
        "ai_orchestrator": (
            ai_orchestrator_module,
            'logger.exception("Error searching textbooks via consult_library")',
        ),
        "chunk_completer": (
            chunk_completer_module,
            'logger.exception("Validation error")',
        ),
        "library_ingestion": (
            library_ingestion_module,
            'logger.exception("Error generating embedding")',
        ),
        "library_retrieval": (
            library_retrieval_module,
            'logger.info("rerank fallback (cosine order kept): %s", rerank_error)',
        ),
        "strategy_service": (
            strategy_service_module,
            'logger.exception("Error during AI roadmap generation")',
        ),
    }
    missing: list[str] = []
    for name, (mod, needle) in expected.items():
        src = Path(inspect.getfile(mod)).read_text(encoding="utf-8")
        if needle not in src:
            missing.append(f"{name}: {needle!r}")
    assert not missing, (
        "v3.54 modules must keep these canonical logger call sites:\n  " + "\n  ".join(missing)
    )
