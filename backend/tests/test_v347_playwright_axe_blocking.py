"""v3.47 (2026-05-02): pin axe-core public-screens lane as blocking.

After 28/28 green runs on master, the axe-core public-screens
advisory lane was promoted to blocking. This file pins that
decision so a future workflow edit can't silently re-introduce
`continue-on-error: true` or the trailing `|| true` exit-swallow.

Pattern mirrors `test_ci_pgvector_lane_blocking.py` (v3.19
chore). No-DB, runs in the smoke lane.

NOTE: The Playwright landing-smoke lane was originally part of
this promotion but reverted before merge — opening it as a
blocking lane surfaced that the lane had been silently broken
(`webServer` 120s timeout) the whole time, masked by
`continue-on-error: true`. The "green" job-level history was the
exit-swallow doing its job. The Playwright promotion is deferred
to a follow-up that fixes the webServer config first.

Memory pointer:
project_session_2026-05-02_v347_promote_axe_core_blocking.md
"""

from __future__ import annotations

import re
from pathlib import Path

WORKFLOWS_DIR = Path(__file__).parent.parent.parent / ".github" / "workflows"
A11Y_YML = WORKFLOWS_DIR / "a11y.yml"


def _find_job_block(workflow_text: str, job_id: str) -> str:
    """Return the YAML body of `job_id` up to the next top-level
    job (two-space-indented `<id>:` line) or end-of-file. Same
    naive slicer as `test_ci_pgvector_lane_blocking.py` — fine
    for the shapes of these workflows.
    """
    pattern = re.compile(rf"^  {re.escape(job_id)}:\s*$", re.MULTILINE)
    m = pattern.search(workflow_text)
    assert m is not None, (
        f"workflow must declare a job named `{job_id}` at "
        "two-space indent. The v3.47 contract pins this name."
    )
    start = m.end()
    next_job = re.search(r"^  [a-z][a-z0-9_-]*:\s*$", workflow_text[start:], re.MULTILINE)
    end = start + next_job.start() if next_job else len(workflow_text)
    return workflow_text[start:end]


def _strip_yaml_comments(block: str) -> str:
    """Drop any `#` comment tail from each line so contract checks
    don't false-positive on the v3.47 explainer comments that
    mention `|| true` literally as the thing being removed.
    Preserves quoted `#` because YAML run-script lines don't use
    them in this repo.
    """
    out_lines: list[str] = []
    for line in block.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        # Drop trailing inline comments — split on first " #" so
        # `# v3.47:` style block comments above the `run:` aren't
        # the only thing handled.
        idx = line.find(" #")
        if idx != -1:
            line = line[:idx]
        out_lines.append(line)
    return "\n".join(out_lines)


def test_axe_public_does_not_continue_on_error():
    """The axe-core public-screens job must not carry
    `continue-on-error: true`. v3.47 promoted this lane to
    blocking after a 28/28 green window."""
    text = A11Y_YML.read_text(encoding="utf-8")
    body = _find_job_block(text, "axe-public")
    assert "continue-on-error: true" not in body, (
        "axe-core `axe-public` job must stay blocking. If a new "
        "public-screen a11y violation lands, fix the violation; "
        "do not restore continue-on-error. Re-introducing the "
        "soft-fail switch is the v3.47 regression we are "
        "pinning against."
    )


def test_axe_public_does_not_swallow_failures():
    """The axe-core `npx playwright test` invocation must not be
    suffixed with `|| true`. v3.47 removed it.
    """
    text = A11Y_YML.read_text(encoding="utf-8")
    body = _find_job_block(text, "axe-public")
    axe_step = re.search(r"Run axe-core on public screens[\s\S]+?(?=\n      - name:|\Z)", body)
    assert axe_step is not None, (
        "a11y workflow must keep a `Run axe-core on public screens` "
        "step. If you renamed the step, update this contract test."
    )
    code_only = _strip_yaml_comments(axe_step.group(0))
    assert "|| true" not in code_only, (
        "`Run axe-core on public screens` step must not swallow "
        "failures with `|| true`. v3.47 removed that exit-swallow. "
        "(Comments mentioning `|| true` are stripped before this check.)"
    )


def test_a11y_still_has_chromium_install():
    """Sanity check: the lane must still install chromium so it
    actually exercises the page. A workflow refactor that drops
    the install would silently mask any failure (no browser → no
    test results, but lane could still pass)."""
    text = A11Y_YML.read_text(encoding="utf-8")
    assert "playwright install" in text and "chromium" in text, (
        f"{A11Y_YML.name} must keep its `npx playwright install --with-deps "
        "chromium` step. v3.47 contract."
    )
