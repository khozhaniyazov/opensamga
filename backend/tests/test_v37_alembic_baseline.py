"""
Tests for v3.7 — Alembic baseline + remove `create_all` from lifespan.

Audit finding #3 (2026-04-29). The original audit:

  > `app.main.lifespan` runs `Base.metadata.create_all` on every
  > startup. This silently masks Alembic drift: there were FOUR
  > parallel heads in the migration graph, and any model change that
  > only modifies an *existing* column (NOT NULL, default, type) gets
  > skipped because `create_all` only creates missing tables. The
  > schema is being kept in sync by `create_all`, not by Alembic.

What v3.7 does:

  1. Adds a no-op merge revision `v37_merge_heads` that unifies the
     four parallel heads (`scale02_composite_indexes`,
     `d2c3606882dd`, `s22d_drop_dead_tables`,
     `s26p7_competition_quota`).
  2. Removes the `Base.metadata.create_all` call from
     `app.main.lifespan`.
  3. Adds `app/utils/alembic_check.py` which compares the live
     `alembic_version` row with the local heads. In production
     it raises; in dev it warns.
  4. Drops the now-unused `Base` import from `app.main`.

Tests are pure source/static where possible — exercising `create_app`
or the lifespan would require a live DB.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest


def test_alembic_graph_has_single_head():
    """The merge revision must reduce the graph to exactly one head.
    A regression here means a future migration was added without
    chaining its `down_revision` to the head — which would re-create
    a parallel-heads situation.

    Note: the literal head id moves forward with each new migration
    (e.g. v3.27 added ``v327_parent_report_share_tokens`` on top of
    ``v37_merge_heads``). What we lock down here is the *count*, not
    a specific revision name; the merge-revision file itself is
    pinned by the dedicated test below.
    """
    from app.utils.alembic_check import _read_local_heads

    heads = _read_local_heads()
    assert len(heads) == 1, f"expected exactly one alembic head, got {sorted(heads)}"


def test_merge_revision_file_is_present():
    versions_dir = Path(__file__).resolve().parent.parent / "alembic" / "versions"
    matches = list(versions_dir.glob("v37_merge_heads*.py"))
    assert matches, "expected to find v37_merge_heads_*.py under backend/alembic/versions/"

    # Sanity: the revision id must literally be 'v37_merge_heads'.
    src = matches[0].read_text(encoding="utf-8")
    assert re.search(r'revision\s*:\s*str\s*=\s*"v37_merge_heads"', src) or re.search(
        r"revision\s*=\s*['\"]v37_merge_heads['\"]", src
    )

    # All four pre-merge heads must be referenced as parents.
    for parent in (
        "scale02_composite_indexes",
        "d2c3606882dd",
        "s22d_drop_dead_tables",
        "s26p7_competition_quota",
    ):
        assert parent in src, f"merge revision must list {parent} as a parent"


def test_lifespan_does_not_call_create_all():
    """The single most dangerous line in the old lifespan was
    `Base.metadata.create_all`. Anyone re-introducing it (e.g. as a
    well-meaning "make tests pass without migrations" shortcut)
    fails this test.

    We allow the literal string `create_all` to appear inside
    comments (the lifespan retains a multi-paragraph explanation of
    why this branch was removed) but reject the actual call pattern
    `Base.metadata.create_all` and any `.create_all(` call."""
    from app import main

    src = inspect.getsource(main.lifespan)
    # Strip comments and docstrings before pattern-matching.
    code_only = "\n".join(line.split("#", 1)[0] for line in src.splitlines())
    assert ".create_all(" not in code_only, (
        "lifespan must not call .create_all(...). Schema lives in "
        "Alembic, not in a startup hook. Audit finding #3 (v3.7)."
    )
    assert "Base.metadata" not in code_only, (
        "lifespan must not touch Base.metadata. Audit finding #3 (v3.7)."
    )


def test_main_no_longer_imports_base():
    """Hygiene check: removing `create_all` also drops the only
    consumer of `Base` in `main.py`. Re-introducing the import
    suggests someone was about to wire `create_all` back in."""
    from app import main

    src = inspect.getsource(main)
    # Be specific so we don't trip on the Base64 type or similar.
    assert "from .database import" in src
    db_import = next(ln for ln in src.splitlines() if ln.startswith("from .database import"))
    assert "Base" not in db_import.split("import", 1)[1].split(",")
    # Also reject `from .database import Base` on its own line.
    assert ", Base" not in db_import and " Base," not in db_import


def test_alembic_drift_check_is_wired_into_lifespan():
    """Removing `create_all` is only half the story; the lifespan
    must also call the new drift check. Catches the regression
    where someone deletes the check thinking it's redundant."""
    from app import main

    src = inspect.getsource(main.lifespan)
    assert "warn_or_raise_on_alembic_drift" in src, (
        "lifespan must call warn_or_raise_on_alembic_drift. Audit finding #3 (v3.7)."
    )


def test_alembic_env_bootstraps_empty_databases():
    """Fresh deploys must no longer require a historical create_all/stamp dance."""
    env_path = Path(__file__).resolve().parent.parent / "alembic" / "env.py"
    src = env_path.read_text(encoding="utf-8")

    assert "def _bootstrap_empty_database" in src
    assert "CREATE EXTENSION IF NOT EXISTS vector" in src
    assert "target_metadata.create_all(bind=connection)" in src
    assert "_create_non_model_artifacts(connection)" in src
    assert "_stamp_current_heads(connection)" in src


def test_runtime_requirements_include_sync_postgres_driver():
    """Alembic strips +asyncpg and therefore needs a sync psycopg driver."""
    reqs = Path(__file__).resolve().parent.parent / "requirements.txt"
    text = reqs.read_text(encoding="utf-8")
    assert "psycopg2-binary" in text


def test_env_example_uses_parseable_release_defaults():
    env_example = Path(__file__).resolve().parent.parent / ".env.docker.example"
    text = env_example.read_text(encoding="utf-8")

    assert "OPENAI_API_KEY=sk-" not in text
    assert 'ALLOWED_HOSTS=["localhost","127.0.0.1"]' in text
    assert 'ALLOWED_ORIGINS=["http://localhost:5174","http://127.0.0.1:5174"]' in text
    assert "CHAT_AGENT_LOOP=false" in text


def test_models_keep_restore_compatibility_columns():
    """Public data restores depend on these nullable compatibility columns."""
    from app.models import MockQuestion, Textbook, User

    assert hasattr(User, "phone")
    assert hasattr(Textbook, "ocr_status")
    assert hasattr(MockQuestion, "difficulty")


@pytest.mark.asyncio
async def test_drift_check_raises_in_production_when_version_mismatched():
    """The check must fail-fast in production if the live version
    doesn't match. This is the actual behavior change — without it,
    a deployed instance with a missing migration would silently
    serve traffic until something tried to INSERT into the affected
    table."""
    from app.utils import alembic_check

    fake_engine = _FakeEngine(version_num="some_old_revision_that_is_not_a_head")

    with pytest.raises(RuntimeError, match="Alembic drift"):
        await alembic_check.warn_or_raise_on_alembic_drift(fake_engine, environment="production")


@pytest.mark.asyncio
async def test_drift_check_warns_in_development(caplog):
    """Dev-mode is warning-only; a fresh laptop checkout shouldn't
    refuse to start."""
    import logging

    from app.utils import alembic_check

    fake_engine = _FakeEngine(version_num="some_old_revision_that_is_not_a_head")

    with caplog.at_level(logging.WARNING, logger="unt_platform.utils.alembic_check"):
        await alembic_check.warn_or_raise_on_alembic_drift(fake_engine, environment="development")

    # The exact logger name depends on the project's get_logger
    # convention; rather than couple to that, just make sure SOME
    # warning landed.
    assert any("Alembic drift" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_drift_check_passes_when_version_matches_head():
    """Happy path — a live version that's also a local head must
    not raise even in production."""
    from app.utils import alembic_check

    heads = alembic_check._read_local_heads()
    assert heads, "no local heads — test environment is broken"

    fake_engine = _FakeEngine(version_num=next(iter(heads)))
    # Must NOT raise.
    await alembic_check.warn_or_raise_on_alembic_drift(fake_engine, environment="production")


# ---------------------------------------------------------------------------
# Test helpers — minimal AsyncEngine stand-in.
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeConn:
    def __init__(self, value):
        self._value = value

    async def execute(self, _stmt):
        return _FakeResult(self._value)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _FakeBegin:
    def __init__(self, value):
        self._value = value

    async def __aenter__(self):
        return _FakeConn(self._value)

    async def __aexit__(self, *a):
        return False


class _FakeEngine:
    def __init__(self, version_num: str):
        self._version_num = version_num

    def begin(self):
        return _FakeBegin(self._version_num)
