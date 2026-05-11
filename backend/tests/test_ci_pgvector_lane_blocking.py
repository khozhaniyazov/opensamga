"""Pin the pgvector integration lane as blocking in CI.

Pins the workflow invariant introduced 2026-04-30 as a chore on
top of v3.20:

  > After the chore(ci) schema baseline + the three chore(tests)
  > fixes (httpx ASGITransport, test_user uuid uniquification,
  > test_chat dependency_overrides), the
  > `pytest (integration, pgvector)` lane finally went green on
  > master. Drop `continue-on-error: true` so a future regression
  > blocks the merge instead of going unnoticed.

This is a no-DB test — it reads the workflow YAML. It runs on
every commit in the smoke lane. A failure here means somebody
soft-failed the lane again; the diff message will tell you which
PR.

Memory pointer: project_session_2026-04-30_v319_chore_ci_baseline.md
"""

from __future__ import annotations

import re
from pathlib import Path

WORKFLOW_PATH = Path(__file__).parent.parent.parent / ".github" / "workflows" / "backend.yml"


def _find_job_block(workflow_text: str, job_id: str) -> str:
    """Return the YAML body of `job_id` up to the next top-level
    job (two-space-indented `<id>:` line) or end-of-file. Naive
    string slicing is fine here because backend.yml only has two
    jobs and they're flat at the same indent level."""
    pattern = re.compile(rf"^  {re.escape(job_id)}:\s*$", re.MULTILINE)
    m = pattern.search(workflow_text)
    assert m is not None, (
        f"backend.yml must declare a job named `{job_id}` at "
        "two-space indent. The pgvector contract pins this name."
    )
    start = m.end()
    next_job = re.search(r"^  [a-z][a-z0-9_-]*:\s*$", workflow_text[start:], re.MULTILINE)
    end = start + next_job.start() if next_job else len(workflow_text)
    return workflow_text[start:end]


def test_pgvector_lane_does_not_continue_on_error():
    """The integration-pgvector job must not carry
    `continue-on-error: true`. That flag was the historical
    soft-fail switch (introduced when the fresh-DB lane couldn't
    even materialize the schema); the four chores landed
    2026-04-30 closed every known failure mode, so the lane is
    now expected to stay green."""
    text = WORKFLOW_PATH.read_text(encoding="utf-8")
    body = _find_job_block(text, "pytest-integration")

    assert "continue-on-error: true" not in body, (
        "`pytest-integration` is now a blocking lane. If you "
        "need to soft-fail it again, you are about to undo the "
        "four-fix arc that closed lane bugs #1-#4 (see memory "
        "project_session_2026-04-30_v319_chore_ci_baseline.md). "
        "Investigate the regression first instead of disabling "
        "the gate."
    )


def test_smoke_lane_still_blocking():
    """Defense-in-depth: the smoke lane must also stay blocking.
    A workflow refactor that demoted `pytest-smoke` would let a
    broken collect-only ride into master."""
    text = WORKFLOW_PATH.read_text(encoding="utf-8")
    body = _find_job_block(text, "pytest-smoke")

    assert "continue-on-error: true" not in body, (
        "`pytest-smoke` must be blocking — it covers the "
        "no-DB contract tests (auth surface, alembic baseline, "
        "ci-pgvector-baseline, ci-test-user-isolation, "
        "pgvector-lane-blocking, …). Soft-failing it would let "
        "import-time regressions slip in unnoticed."
    )


def test_workflow_has_pgvector_extension_step():
    """Sanity check: the integration lane must still install the
    `vector` extension before pytest runs. Without it, the
    schema baseline trips on Vector(1024) columns."""
    text = WORKFLOW_PATH.read_text(encoding="utf-8")
    body = _find_job_block(text, "pytest-integration")
    assert "CREATE EXTENSION IF NOT EXISTS vector" in body, (
        "`pytest-integration` must install pgvector before "
        "pytest. The schema-baseline conftest fixture calls "
        "Base.metadata.create_all which fails on Vector(1024) "
        "columns without the extension."
    )
