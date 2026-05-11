"""v4.7 — B904/TRY400 sweep extended beyond ``app/``.

The v4.1 tripwire (`test_v410_router_b904_sweep.py`) only gated
``app/routers/``. The v4.4 tripwire
(`test_v440_b904_try400_stragglers.py`) extended that to all of
``app/``. Neither covered ``scripts/`` or ``tests/``.

A re-audit at v4.6 surfaced one B904 site in
``scripts/smoke_data_pillars.py`` (the SystemExit-after-SmokeFailure
catch arm in ``main()``). v4.7 fixes the lone site and extends the
tripwire to the entire ``backend/`` tree so ``scripts/`` and
``tests/`` can't silently regress either.

We don't pin per-site here for the same reason v4.4 didn't — these
sweeps are pure cleanup with no rewrites of detail strings or new
error contracts, so per-site pinning is churn-prone for no extra
signal beyond the zero-violations gate. The v4.1 site-list test
(`test_rewritten_site_has_from_clause`) remains in place for routers
because those sites embed user-visible error messages worth pinning.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


def _backend_root() -> Path:
    return Path(__file__).parent.parent


def _run_ruff(target: str, rule: str) -> tuple[int, str]:
    result = subprocess.run(
        [
            "ruff",
            "check",
            target,
            "--select",
            rule,
            "--output-format",
            "concise",
        ],
        cwd=_backend_root(),
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, result.stdout


@pytest.mark.parametrize("rule", ["B904", "TRY400"])
@pytest.mark.parametrize("target", ["scripts", "tests"])
def test_no_b904_or_try400_in_scripts_or_tests(target: str, rule: str) -> None:
    """B904 + TRY400 must stay clean under ``scripts/`` and ``tests/``.

    v4.4 covered ``app/``; v4.7 closes ``scripts/`` (where the v4.6
    audit found a SystemExit straggler) and ``tests/`` (which had
    accumulated zero hits but should be gated for symmetry).
    """
    rc, stdout = _run_ruff(target, rule)
    if rc != 0:
        violations = [line for line in stdout.splitlines() if rule in line]
        pytest.fail(
            f"ruff {rule} reintroduced under {target}/ ({len(violations)} sites):\n  "
            + "\n  ".join(violations)
        )
