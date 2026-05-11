"""
v3.87 (2026-05-04) — get_opportunity view_count atomic bump.

Pre-v3.87 ``GET /api/opportunities/{id}`` did:

    opportunity.view_count += 1
    await db.commit()

which translates to SELECT-then-UPDATE on ORM flush. Two
concurrent GETs could each read N and both write N+1,
undercounting the bump by one (TOCTOU). Same shape as the
v3.81 (loot-box claim) / v3.83 (apply count) /
v3.85 (UsageCounter) bugs.

v3.87 fixes this by issuing an explicit atomic UPDATE so the
DB serializes the +1:

    await db.execute(
        update(Opportunity)
        .where(Opportunity.id == opportunity_id)
        .values(view_count=Opportunity.view_count + 1)
    )
    await db.commit()

Two lanes pinned:

1. **Static AST shape** on
   ``app/routers/opportunities.py:get_opportunity`` —
   the atomic ``Opportunity.view_count + 1`` UPDATE
   expression is present, and the legacy
   ``opportunity.view_count += 1`` ORM mutation is gone.
2. **Tripwire** scanning the whole module to catch any
   future regression that re-introduces the ORM-level
   ``view_count += 1`` mutation outside the handler.

Behavioral coverage (the race-winner / race-loser flow) is
already covered structurally by the v3.83 apply-count tests
that exercise the same atomic-UPDATE shape; we don't duplicate
the AsyncSession harness here.
"""

from __future__ import annotations

import ast
from pathlib import Path

_ROUTER_PATH = Path(__file__).resolve().parent.parent / "app" / "routers" / "opportunities.py"


def _load_get_opportunity_ast() -> ast.AsyncFunctionDef:
    tree = ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "get_opportunity":
            return node
    raise AssertionError("get_opportunity not found in app/routers/opportunities.py")


# ---------------------------------------------------------------------------
# Lane 1: static AST shape on get_opportunity
# ---------------------------------------------------------------------------


def test_get_opportunity_uses_atomic_view_count_update():
    """
    v3.87: the view_count bump must be an atomic UPDATE expression
    so two concurrent GETs cannot under-count by one.
    """
    fn = _load_get_opportunity_ast()
    src = ast.unparse(fn)
    assert "Opportunity.view_count + 1" in src, (
        "v3.87 requires view_count bump to be an atomic UPDATE: "
        "`update(Opportunity).where(...).values("
        "view_count=Opportunity.view_count + 1)`. "
        "ORM-level `opportunity.view_count += 1` is TOCTOU."
    )


def test_get_opportunity_no_orm_view_count_mutation():
    """
    v3.87: the legacy ORM mutation `opportunity.view_count += 1`
    must be gone from the handler — a regression that re-introduces
    it would silently re-open the TOCTOU bug.
    """
    fn = _load_get_opportunity_ast()
    src = ast.unparse(fn)
    assert "view_count += 1" not in src, (
        "v3.87: `opportunity.view_count += 1` (TOCTOU SELECT-then-UPDATE) "
        "must be replaced with the atomic update() expression."
    )


def test_get_opportunity_calls_update_after_visibility_check():
    """
    v3.87: the atomic UPDATE must run AFTER the
    visibility/ownership check (status != ACTIVE branch). An
    inactive-and-not-owner GET returns 404 before any side
    effect — pinning this so an over-eager refactor doesn't
    move the UPDATE above the gate.
    """
    fn = _load_get_opportunity_ast()
    # Walk the body in source order; track whether we have seen
    # the visibility raise (404 in non-ACTIVE branch) before any
    # update() call.
    saw_visibility_raise = False
    saw_update_call = False
    for node in ast.walk(fn):
        if isinstance(node, ast.Raise):
            r = ast.unparse(node)
            if "404" in r and "Opportunity not found" in r:
                saw_visibility_raise = True
        if isinstance(node, ast.Call):
            c = ast.unparse(node)
            if c.startswith("update(Opportunity)"):
                saw_update_call = True
    assert saw_visibility_raise, (
        "v3.87 expects the 404 visibility raise to remain present in "
        "get_opportunity — the gate must run before the UPDATE side effect."
    )
    assert saw_update_call, (
        "v3.87 expects an `update(Opportunity)` call inside get_opportunity "
        "for the atomic view_count bump."
    )


# ---------------------------------------------------------------------------
# Lane 2: module-level tripwire — no other call site can re-introduce
# the ORM mutation pattern
# ---------------------------------------------------------------------------


def test_no_orm_view_count_mutation_anywhere_in_module():
    """
    v3.87 tripwire: the ORM-level `view_count += 1` pattern must not
    appear ANYWHERE in opportunities.py. If a future feature needs
    to bump view_count on a different code path, it must use the
    atomic UPDATE shape.
    """
    src = _ROUTER_PATH.read_text(encoding="utf-8")
    # Allow the comment that documents the historical TOCTOU shape.
    code_lines = [
        ln for ln in src.splitlines() if "view_count += 1" in ln and not ln.lstrip().startswith("#")
    ]
    assert code_lines == [], (
        "v3.87: ORM-level `view_count += 1` is forbidden — found in:\n  " + "\n  ".join(code_lines)
    )
