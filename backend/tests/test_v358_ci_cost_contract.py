"""v3.58 (2026-05-02): pin CI-cost reductions so a future config
edit can't silently re-introduce the burn.

**Why this ship.** GitHub Actions free-tier private-repo budget
($12/month-equivalent) was exhausted in 2 days during the
v3.51-v3.57 print-sweep arc. Boss explicitly chose not to add
billing. v3.58 keeps the project under-quota by:

1. **Path-filtering FE-heavy lanes** so backend-only PRs don't
   waste minutes on unchanged FE code. The print-sweep arc
   shipped 10 backend-only PRs in 36 hours; pre-v3.58 each one
   ran ~10 minutes of FE-side CI (vitest+build, playwright,
   axe) for nothing. After v3.58: backend-only PRs trigger 0
   FE-side jobs.
2. **Dependabot monthly + smaller batches** instead of weekly +
   5 PRs/ecosystem. Each dependabot PR triggers ~5 lanes; weekly
   cadence was costing ~$1.50/month on its own.

The savings:

- Per backend-only PR: -7 to -9 minutes (depending on whether
  the PR also touches workflow files).
- Per month: ~50% reduction in dependabot-triggered minutes.

Combined effect should bring monthly burn under the free tier
even at the v3.51-v3.57 shipping cadence.

This test pins the policy so a future workflow edit that drops
``paths:`` or restores ``interval: weekly`` is caught at lint/CI
time.
"""

from __future__ import annotations

from pathlib import Path

import pytest

try:
    import yaml  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    pytest.skip(
        "PyYAML not installed; CI lane provides it",
        allow_module_level=True,
    )


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
DEPENDABOT = REPO_ROOT / ".github" / "dependabot.yml"


@pytest.mark.parametrize(
    "workflow",
    [
        "ci.yml",  # vitest + build (~4-5min, biggest single lane)
        "playwright.yml",  # ~3-4min
        "a11y.yml",  # ~1m30s
    ],
)
def test_fe_heavy_workflows_have_path_filters(workflow: str):
    """v3.58 contract: each of the FE-heavy CI workflows must
    declare a ``paths:`` filter on both the ``push`` and
    ``pull_request`` triggers. Without a filter, a backend-only PR
    runs the full FE lane on unchanged code — that was the cost
    pattern the v3.51-v3.57 arc exposed."""
    raw = (WORKFLOWS / workflow).read_text(encoding="utf-8")
    # PyYAML treats the ``on:`` key as Python ``True`` because YAML
    # 1.1 maps yes/no/on/off → bool. Use the True key.
    cfg = yaml.safe_load(raw)
    on_block = cfg.get(True) or cfg.get("on") or {}

    for trigger in ("push", "pull_request"):
        block = on_block.get(trigger)
        assert block is not None, (
            f"{workflow} must declare a `{trigger}:` trigger; got {on_block!r}."
        )
        paths = block.get("paths")
        assert paths, (
            f"{workflow} `{trigger}` trigger must declare a `paths:` "
            f"filter; got {block!r}. Without it, backend-only PRs "
            "trigger this FE-side lane and burn Actions minutes for "
            "nothing. See v3.58 CHANGELOG entry."
        )
        # Every FE-heavy lane should at minimum filter on
        # frontend/** so a pure backend ship doesn't trip it.
        assert any("frontend/" in p for p in paths), (
            f"{workflow} `{trigger}` paths filter must include a "
            f"`frontend/**` glob; got {paths!r}. The whole point of "
            "the v3.58 path filter is to skip FE-heavy lanes when "
            "FE code didn't change."
        )


def test_dependabot_cadence_is_monthly_not_weekly():
    """v3.58 contract: dependabot cadence must be ``monthly`` for
    every ecosystem. Weekly grouped PRs were costing ~$1.50/month
    in Actions burn (each dependabot PR triggers ~5 lanes).
    Monthly + smaller batches still picks up CVE-relevant updates
    within ~30 days; CVE alerts fire in real time via the security
    tab regardless of dependabot cadence."""
    cfg = yaml.safe_load(DEPENDABOT.read_text(encoding="utf-8"))
    updates = cfg.get("updates", [])
    assert updates, "dependabot.yml must declare update entries."

    bad = []
    for entry in updates:
        ecosystem = entry.get("package-ecosystem", "?")
        cadence = (entry.get("schedule") or {}).get("interval")
        if cadence != "monthly":
            bad.append((ecosystem, cadence))

    assert not bad, (
        "v3.58 contract violated: dependabot ecosystems must use "
        f"interval='monthly' (free-tier private-repo cost). Bad "
        f"entries: {bad}. If you need a faster cadence for a "
        "specific ecosystem, document the reason in dependabot.yml "
        "AND update this test to allow it explicitly."
    )


def test_dependabot_open_pr_limits_capped():
    """v3.58 contract: open-pull-requests-limit must be ≤ 3 per
    ecosystem so a single dependabot tick can't open 5+ PRs and
    burn 25+ CI minutes in one batch. Pre-v3.58 the npm/pip
    ecosystems were at 5; v3.58 dropped them to 3, and
    github-actions to 2 (smallest ecosystem)."""
    cfg = yaml.safe_load(DEPENDABOT.read_text(encoding="utf-8"))
    bad = []
    for entry in cfg.get("updates", []):
        eco = entry.get("package-ecosystem", "?")
        limit = entry.get("open-pull-requests-limit")
        if limit is None or limit > 3:
            bad.append((eco, limit))
    assert not bad, (
        "v3.58 contract violated: dependabot "
        "open-pull-requests-limit must be set and ≤ 3 per "
        f"ecosystem. Bad entries: {bad}."
    )
