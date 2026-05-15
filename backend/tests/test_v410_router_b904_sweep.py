"""v4.1 — Router B904 sweep.

The v3.86 sweep (test_v386_router_error_detail_sweep.py) pinned the
14 broad-except sites that were rewriting their detail strings to
stop leaking ``str(e)``. v3.86 also chained those via ``from e`` (or
``from None``). What it did **not** do was clean up the long tail of
narrow-except sites — JWT decode rejects, validation ``ValueError``
paths, race-condition ``IntegrityError`` retries, etc. — that still
raised ``HTTPException`` without a ``from`` clause and tripped ruff
``B904``.

v4.1 closes that tail. 21 sites across 9 routers were rewritten:

  - 8 ``raise ... from None`` (security/validation rejects where we
    deliberately drop the original chain so JOSE / int() / enum
    internals don't surface in __cause__).
  - 13 ``raise ... from exc`` (paths where the original is logged
    via ``logger.exception(...)`` or is a domain signal worth
    keeping in the chain).

This test pins the post-sweep shape and acts as a tripwire so
future PRs can't reintroduce the warning.

The test is structural / static (AST), same posture as v3.86. We
don't want to provoke 500s in production code paths just to assert
``__cause__`` shape, and the whole point is to catch new violations
before they merge — not after they ship.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent / "app" / "routers"

# ---------------------------------------------------------------------------
# (1) Sites that v4.1 rewrote. Each tuple is (file, line, expected-cause-name)
#     where expected-cause-name is "exc" for `from exc`, "credentials_exc"
#     for `from credentials_exc`, or None for `from None`.
#
#     This list is NOT a regex over the source — it's the audit list pinned
#     manually so a refactor that quietly drops a `from` clause shows up
#     here as a missing entry.
# ---------------------------------------------------------------------------

REWRITTEN_SITES: list[tuple[str, int, str | None]] = [
    # Line numbers below match AST `Raise.lineno` (start of the
    # `raise` statement, not the line of `from <X>`). Re-derive by
    # grepping `from None` / `from exc` in the source if ever drifted.
    # auth.py — line numbers shifted by +5 in v4.17 (bcrypt 5.0
    # 72-byte guard added 5 lines to UserCreate.validate_password_strength).
    ("auth.py", 164, None),  # JWTError -> credentials_exception from None
    ("auth.py", 172, "exc"),  # broad Exception (logged) -> from exc
    ("auth.py", 196, "exc"),  # DB query failed (logged) -> from exc
    ("auth.py", 380, None),  # refresh JWTError -> credentials_exc from None
    # chat.py — line numbers shifted by -3 in v4.4 (TRY400 sweep collapsed
    # 4-line logger.error+format_exc block into 1-line logger.exception)
    # then by -1 in opensamga round-2 audit (top-level error handler dropped
    # the language-aware error_msg interpolation, removing one line).
    ("chat.py", 2761, None),  # int(drop_last) ValueError -> from None
    ("chat.py", 2883, "exc"),  # export-history broad except (logged)
    ("chat.py", 3265, "exc"),  # create-thread broad except (logged)
    ("chat.py", 3296, "exc"),  # rename-thread broad except (logged)
    ("chat.py", 3341, "exc"),  # delete-thread broad except (logged)
    # dev_console.py
    ("dev_console.py", 170, None),  # LeagueTier ValueError -> from None
    # library.py
    ("library.py", 92, None),  # JWTError -> credentials_exception from None
    ("library.py", 96, None),  # broad except (auth path) -> from None
    ("library.py", 397, "exc"),  # resolve_pdf_path failed (logged) -> from exc
    # parent_report.py
    ("parent_report.py", 195, "exc"),  # pdf_renderer infra fail -> from exc
    # portfolio.py
    ("portfolio.py", 288, "exc"),  # portfolio race -> from exc
    ("portfolio.py", 410, "exc"),  # portfolio race -> from exc
    # practice.py
    ("practice.py", 314, "exc"),  # generate_question broad except (logged)
    # strategy.py — opensamga round-2 audit added structured-extra logger
    # call inside the broad except, shifting raises by +5 lines.
    ("strategy.py", 229, "exc"),  # profile-pair ValueError -> from exc
    ("strategy.py", 238, "exc"),  # profile-pair broad -> from exc
    ("strategy.py", 273, "exc"),  # retake-guide broad -> from exc
    # users.py — opensamga round-2 audit hoisted MAX_AVATAR_BYTES /
    # _CONTENT_TYPE_TO_EXT constants above the schemas, shifting raises by
    # +8 lines.
    ("users.py", 164, None),  # int(score) ValueError -> from None
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load(file: str) -> ast.Module:
    return ast.parse((ROOT / file).read_text(encoding="utf-8"))


def _find_raise_at_line(tree: ast.Module, line: int) -> ast.Raise | None:
    """Return the ``ast.Raise`` whose ``lineno`` is ``line`` (or whose
    multi-line raise spans ``line``)."""
    candidates: list[ast.Raise] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Raise):
            continue
        start = node.lineno
        end = getattr(node, "end_lineno", None) or start
        if start <= line <= end:
            candidates.append(node)
    if not candidates:
        return None
    # Prefer the raise whose start line is closest to `line` (handles
    # nested raises inside if/else inside the same handler).
    candidates.sort(key=lambda n: abs(n.lineno - line))
    return candidates[0]


# ---------------------------------------------------------------------------
# (1) Per-site assertion: every rewritten raise has the right `from` clause.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("file", "line", "cause"), REWRITTEN_SITES)
def test_rewritten_site_has_from_clause(file: str, line: int, cause: str | None) -> None:
    tree = _load(file)
    raise_node = _find_raise_at_line(tree, line)
    assert raise_node is not None, (
        f"{file}:{line} expected a `raise` at this line — site list is misaligned "
        "with the source. Update REWRITTEN_SITES if the file changed."
    )

    assert raise_node.cause is not None, (
        f"{file}:{line} `raise` has no `from` clause — B904 violation reintroduced"
    )

    if cause is None:
        # Expecting `from None`
        assert isinstance(raise_node.cause, ast.Constant) and raise_node.cause.value is None, (
            f"{file}:{line} expected `from None`, got {ast.dump(raise_node.cause)}"
        )
    else:
        assert isinstance(raise_node.cause, ast.Name) and raise_node.cause.id == cause, (
            f"{file}:{line} expected `from {cause}`, got {ast.dump(raise_node.cause)}"
        )


# ---------------------------------------------------------------------------
# (2) Tripwire: ruff B904 must be clean across the entire routers tree.
#     If any new narrow-except `raise` lands without a `from` clause, this
#     fires. Belt-and-braces with the per-site list above: that list pins
#     known good shapes, this one pins "no new violations anywhere".
# ---------------------------------------------------------------------------


def test_no_b904_violations_in_routers() -> None:
    backend_root = Path(__file__).parent.parent
    result = subprocess.run(
        [
            "ruff",
            "check",
            "app/routers",
            "--select",
            "B904",
            "--output-format",
            "concise",
        ],
        cwd=backend_root,
        capture_output=True,
        text=True,
        check=False,
    )
    # ruff returns 0 when clean, 1 when violations found.
    if result.returncode != 0:
        violations = [line for line in result.stdout.splitlines() if "B904" in line]
        pytest.fail("ruff B904 reintroduced in app/routers/:\n  " + "\n  ".join(violations))


# ---------------------------------------------------------------------------
# (3) Spot-check: the v3.86 broad-except sites already had `from e`
#     (REWRITTEN_SITES from test_v386_*.py); the v4.1 sweep didn't touch
#     them but we want to make sure a careless refactor of v3.86 doesn't
#     drop the chain. Re-asserting via the existing test_v386 file is
#     enough for that — no duplication needed here.
# ---------------------------------------------------------------------------
