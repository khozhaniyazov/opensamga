"""Tests for the CI pgvector-lane fresh-DB baseline.

Pins the conftest invariant introduced 2026-04-30 as a chore on
top of v3.19:

  > The integration test lane runs against a freshly-spun
  > pgvector container that has no schema. The conftest must
  > bring the schema up via `Base.metadata.create_all` once per
  > test session, so DB-marked tests can INSERT without tripping
  > `UndefinedTableError`.

This is the **test side** of the v3.7 audit-finding-#3 fix: the
**app side** (`app.main.lifespan`) is forbidden from calling
`create_all` (pinned by `test_v37_alembic_baseline.py`). Both
tests must coexist; they describe two different code paths.

This fix landed as an untagged chore — the v3.18 slot was taken
by the parallel agent's user-voice research docs (commit
`f975870`), and we deliberately reserved feature/product slots
for the tag chain. Infra fixes ride along untagged.

These tests are no-DB — they read the conftest source and the
fixture object's pytest metadata. They run on every commit in
the smoke lane.
"""

from __future__ import annotations

import inspect
from pathlib import Path

CONFTEST_PATH = Path(__file__).parent / "conftest.py"


def test_conftest_exposes_session_scoped_schema_fixture():
    """The fixture function must exist and be wired session-scoped
    via pytest_asyncio."""
    from tests import conftest

    fixture_fn = getattr(conftest, "_ensure_schema", None)
    assert fixture_fn is not None, (
        "tests/conftest.py must expose a session-scoped fixture "
        "`_ensure_schema` that materializes the SQLAlchemy schema "
        "for the integration lane."
    )

    # pytest_asyncio.fixture stores its marker on a private
    # `_fixture_function_marker` attribute; classic pytest.fixture
    # uses `_pytestfixturefunction`. Accept either so a future
    # refactor that drops pytest_asyncio doesn't silently break
    # the contract.
    marker = getattr(fixture_fn, "_fixture_function_marker", None) or getattr(
        fixture_fn, "_pytestfixturefunction", None
    )
    assert marker is not None, (
        "_ensure_schema must be a pytest fixture (decorated with "
        "@pytest_asyncio.fixture or @pytest.fixture)."
    )
    assert marker.scope == "session", (
        f"_ensure_schema must be session-scoped (got {marker.scope!r}). "
        "Per-test scope would re-create the schema 500 times per CI run."
    )


def test_async_db_session_depends_on_ensure_schema():
    """The DB-session fixture must request `_ensure_schema` as a
    dependency, so any DB-marked test transitively triggers the
    one-time schema build. No-DB tests, by virtue of not asking
    for `async_db_session`, never trigger it."""
    from tests import conftest

    sig = inspect.signature(conftest.async_db_session)
    assert "_ensure_schema" in sig.parameters, (
        "async_db_session(...) must accept `_ensure_schema` as a "
        "fixture dependency. Without this, the fresh-DB CI lane "
        "trips UndefinedTableError on the first INSERT."
    )


def test_conftest_create_all_uses_run_sync_on_async_engine():
    """The schema materialization runs against the async engine
    via `run_sync(Base.metadata.create_all)`. A direct
    `Base.metadata.create_all(engine)` would deadlock — async
    engines don't accept the sync DDL API.

    This is also the textual signature CI grep would catch if a
    well-meaning refactor broke async-safety."""
    src = CONFTEST_PATH.read_text(encoding="utf-8")
    assert "run_sync(Base.metadata.create_all)" in src, (
        "tests/conftest.py must call `await conn.run_sync"
        "(Base.metadata.create_all)` inside the schema-materialization "
        "fixture. Sync `Base.metadata.create_all(engine)` deadlocks "
        "an async engine."
    )


def test_conftest_documents_v37_invariant_relationship():
    """The fixture's docstring must reference v3.7 + audit finding
    #3 so future readers understand why the **test** side calls
    create_all when the **app** side cannot.

    Without this signpost, a future audit could trigger a
    well-meaning revert of either side."""
    from tests import conftest

    src = inspect.getsource(conftest._ensure_schema)
    assert "v3.7" in src, (
        "_ensure_schema docstring must reference v3.7 — the audit "
        "finding that forbade app-side create_all. Without this "
        "context the test fixture looks like a regression."
    )
    assert "test_v37_alembic_baseline" in src or "lifespan" in src, (
        "_ensure_schema docstring must explicitly distinguish the "
        "test-side call from the app-side prohibition (cite "
        "test_v37_alembic_baseline.py or app.main.lifespan)."
    )


def test_app_lifespan_invariant_unchanged():
    """Defense-in-depth: re-assert the v3.7 invariant from this
    test's perspective. If a future agent breaks the v3.7 source
    check by sneaking `create_all` back into lifespan, both this
    test AND the v3.7 baseline test will fail — the failure
    message in this test points at the CI-baseline motivation
    (test-side create_all is fine; app-side is not)."""
    from app import main

    src = inspect.getsource(main.lifespan)
    code_only = "\n".join(line.split("#", 1)[0] for line in src.splitlines())
    assert ".create_all(" not in code_only, (
        "app.main.lifespan must NEVER call create_all — schema "
        "lives in Alembic at runtime. The CI-baseline conftest "
        "fixture exists precisely so the test lane doesn't need "
        "this shortcut on the app side."
    )
