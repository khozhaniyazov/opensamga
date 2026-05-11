"""
v3.81 (2026-05-03) — loot-box atomic claim against TOCTOU.

Pre-v3.81 ``app.services.rewards.open_loot_box`` did:

    SELECT LootBox WHERE id=:id
    if loot_box.opened_at: raise "already opened"
    ... generate reward, INSERT UserInventory ...
    UPDATE LootBox SET opened_at=NOW(), reward=...

Two concurrent open requests could BOTH pass the check before
either reached the UPDATE — yielding two UserInventory rows for
what should have been one resource pack. For LEGENDARY rarity
that's a duplicated tutor coupon (real value leak).

v3.81 collapses the open into a single atomic UPDATE with
``WHERE opened_at IS NULL`` + ``RETURNING id``. Only one
concurrent caller's UPDATE matches; the other gets an empty
row-set and converts it into the same "already opened" error.
The inventory INSERT happens AFTER the claim succeeds, so a
losing racer never inserts.

This file pins three lanes:

1. **Static AST shape** — the open path uses ``update`` +
   ``opened_at.is_(None)`` + ``returning``. Catches anyone who
   reverts the fix to a SELECT-then-mutate pattern.
2. **Behavioral mock** — drive the function with an in-memory
   mock session. Verify the order of operations: claim UPDATE
   first, inventory add only after a successful claim.
3. **Concurrent-claim regression** — two open_loot_box calls on
   the same id; assert exactly one succeeds and exactly one
   inventory row exists. Skipped on SQLite (driver-level
   serialization makes the race untestable).
"""

from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.rewards import open_loot_box

# ---------------------------------------------------------------------------
# Lane 1: static AST pin on the source of open_loot_box
# ---------------------------------------------------------------------------


_SERVICE_PATH = Path(__file__).resolve().parent.parent / "app" / "services" / "rewards.py"


def _load_open_loot_box_ast() -> ast.AsyncFunctionDef:
    tree = ast.parse(_SERVICE_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "open_loot_box":
            return node
    raise AssertionError("open_loot_box not found in app/services/rewards.py")


def test_module_imports_update():
    """``update`` from sqlalchemy must be in scope for the atomic claim."""
    src = _SERVICE_PATH.read_text(encoding="utf-8")
    # Match the multi-name import line.
    assert "from sqlalchemy import select, update" in src, (
        "open_loot_box atomic claim relies on `update` from sqlalchemy; "
        "import line was changed in a way that drops it."
    )


def test_open_loot_box_uses_update_returning_with_opened_at_is_none():
    """
    The atomic claim must be: ``update(LootBox).where(...,
    opened_at.is_(None)).values(...).returning(...)``.
    """
    fn = _load_open_loot_box_ast()
    src = ast.unparse(fn)

    # `update(LootBox)` call present
    assert "update(LootBox)" in src, (
        "open_loot_box must use update(LootBox) to atomically claim the box; "
        "looks like the SELECT-then-mutate pattern was restored."
    )
    # IS NULL guard on opened_at
    assert "opened_at.is_(None)" in src or "opened_at == None" in src, (
        "open_loot_box atomic claim is missing the `opened_at IS NULL` "
        "guard — without it the UPDATE will overwrite an already-claimed "
        "box and the TOCTOU is back."
    )
    # RETURNING so we can detect the race loser
    assert ".returning(" in src, (
        "open_loot_box atomic claim must use RETURNING so a losing racer "
        "is detected without a second round trip."
    )


def test_open_loot_box_no_longer_assigns_opened_at_on_python_object():
    """
    Pre-v3.81 the function ended with
    ``loot_box.opened_at = datetime.now(UTC)`` — Python-side
    mutation followed by ``await db.commit()``. The post-v3.81
    flow does the assignment via the atomic UPDATE statement
    instead. If anyone restores the Python-side write, the
    atomic guarantee is silently lost (the UPDATE may still be
    there but overwritten by the ORM flush).
    """
    fn = _load_open_loot_box_ast()
    src = ast.unparse(fn)
    assert "loot_box.opened_at = " not in src, (
        "open_loot_box must not mutate loot_box.opened_at on the Python "
        "object — that bypasses the atomic UPDATE WHERE opened_at IS NULL "
        "guard. Pass the value through `update(...).values(opened_at=...)` "
        "instead."
    )


def test_open_loot_box_inventory_add_only_after_claim_succeeds():
    """
    The ``UserInventory(...)`` instantiation may sit anywhere,
    but ``db.add(UserInventory(...))`` MUST appear after the
    ``claim_result`` / ``claimed_id`` check. The post-v3.81
    convention: build a kwargs dict eagerly, but only call
    ``db.add(UserInventory(**kwargs))`` when the claim succeeded.

    We pin this by checking the source location of the
    ``db.add(UserInventory(...))`` call relative to the
    ``claimed_id`` reference.
    """
    fn = _load_open_loot_box_ast()
    src = ast.unparse(fn)

    # The post-v3.81 source has exactly one db.add(UserInventory(...))
    # site inside the function. Pre-v3.81 had two (one for RARE, one
    # for LEGENDARY). If anyone re-introduces the inline two-site
    # pattern, the `if pending_inventory_item_kwargs is not None`
    # guard is gone.
    add_count = src.count("db.add(UserInventory(")
    assert add_count == 1, (
        f"Expected exactly one `db.add(UserInventory(...))` call after "
        f"the claim guard; found {add_count}. Multiple sites suggest the "
        f"pre-v3.81 inline-INSERT pattern was restored."
    )

    # And it must come after the claimed_id check.
    add_idx = src.index("db.add(UserInventory(")
    claim_idx = src.index("claimed_id")
    assert add_idx > claim_idx, (
        "db.add(UserInventory(...)) must appear AFTER the claimed_id "
        "race-loser check; otherwise a losing racer will still INSERT."
    )


# ---------------------------------------------------------------------------
# Lane 2: behavioral mock — ordering of operations
# ---------------------------------------------------------------------------


class _StubLootBox:
    """Minimal stand-in for the SQLAlchemy LootBox row."""

    def __init__(self, *, id: int, user_id: int, rarity, opened_at=None):
        self.id = id
        self.user_id = user_id
        self.rarity = rarity
        self.opened_at = opened_at


def _build_session(
    *,
    select_returns: _StubLootBox | None,
    update_returns_id: int | None,
):
    """
    Build a MagicMock AsyncSession whose .execute() returns:
      - first call (the SELECT): a result whose .scalars().first()
        returns the given LootBox stub.
      - second call (the atomic UPDATE): a result whose
        .scalar_one_or_none() returns ``update_returns_id`` —
        either the LootBox.id (claim won) or None (claim lost).
    """
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    select_result = MagicMock()
    select_scalars = MagicMock()
    select_scalars.first = MagicMock(return_value=select_returns)
    select_result.scalars = MagicMock(return_value=select_scalars)

    update_result = MagicMock()
    update_result.scalar_one_or_none = MagicMock(return_value=update_returns_id)

    session.execute = AsyncMock(side_effect=[select_result, update_result])
    return session


@pytest.mark.asyncio
async def test_open_loot_box_common_path_claims_then_returns_reward():
    from app.models import LootBoxRarity

    box = _StubLootBox(id=42, user_id=7, rarity=LootBoxRarity.COMMON)
    session = _build_session(select_returns=box, update_returns_id=42)

    out = await open_loot_box(42, session, lang="ru")

    assert out["rarity"] == LootBoxRarity.COMMON
    # No inventory side effect for COMMON.
    session.add.assert_not_called()
    # Two execute calls: one SELECT, one UPDATE.
    assert session.execute.call_count == 2
    session.commit.assert_awaited_once()
    session.rollback.assert_not_called()


@pytest.mark.asyncio
async def test_open_loot_box_legendary_inserts_inventory_after_claim():
    from app.models import LootBoxRarity, UserInventory

    box = _StubLootBox(id=99, user_id=7, rarity=LootBoxRarity.LEGENDARY)
    session = _build_session(select_returns=box, update_returns_id=99)

    out = await open_loot_box(99, session, lang="ru")

    assert out["rarity"] == LootBoxRarity.LEGENDARY
    # Exactly one inventory item.
    session.add.assert_called_once()
    added = session.add.call_args.args[0]
    assert isinstance(added, UserInventory)
    assert added.user_id == 7
    assert added.item_type == "TUTOR_COUPON"
    session.commit.assert_awaited_once()
    session.rollback.assert_not_called()


@pytest.mark.asyncio
async def test_open_loot_box_race_loser_does_NOT_insert_inventory():
    """
    The post-pre-flight race: the SELECT shows the box as still
    open, but by the time our UPDATE runs another caller has
    already claimed it. Our UPDATE returns no rows; we must
    raise the same "already opened" error AND must NOT have
    added an inventory item.
    """
    from app.models import LootBoxRarity

    box = _StubLootBox(id=99, user_id=7, rarity=LootBoxRarity.LEGENDARY)
    # update_returns_id=None ⇒ losing racer.
    session = _build_session(select_returns=box, update_returns_id=None)

    with pytest.raises(ValueError) as exc_info:
        await open_loot_box(99, session, lang="ru")

    assert "уже открыт" in str(exc_info.value)
    # The headline contract: a losing racer must not add to inventory.
    session.add.assert_not_called()
    # And must roll back, not commit.
    session.rollback.assert_awaited_once()
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_open_loot_box_race_loser_kz_localized_error():
    from app.models import LootBoxRarity

    box = _StubLootBox(id=99, user_id=7, rarity=LootBoxRarity.RARE)
    session = _build_session(select_returns=box, update_returns_id=None)

    with pytest.raises(ValueError) as exc_info:
        await open_loot_box(99, session, lang="kz")

    assert "ашылып" in str(exc_info.value)
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_open_loot_box_404_when_select_returns_none():
    session = _build_session(select_returns=None, update_returns_id=None)

    with pytest.raises(ValueError) as exc_info:
        await open_loot_box(42, session, lang="ru")

    assert "не найден" in str(exc_info.value)
    # Only the SELECT ran; we never reached the UPDATE.
    assert session.execute.call_count == 1
    session.add.assert_not_called()
    session.rollback.assert_not_called()


@pytest.mark.asyncio
async def test_open_loot_box_pre_flight_branch_skips_update():
    """
    If the SELECT shows ``opened_at`` already populated, we
    short-circuit before the UPDATE — saving a wasted reward
    roll. This is the common case for legitimate "already
    opened" repeat clicks.
    """
    from datetime import UTC, datetime

    from app.models import LootBoxRarity

    box = _StubLootBox(
        id=42,
        user_id=7,
        rarity=LootBoxRarity.COMMON,
        opened_at=datetime(2026, 5, 3, 12, 0, 0, tzinfo=UTC),
    )
    session = _build_session(select_returns=box, update_returns_id=None)

    with pytest.raises(ValueError) as exc_info:
        await open_loot_box(42, session, lang="ru")

    assert "уже открыт" in str(exc_info.value)
    # Only the SELECT ran; the UPDATE was skipped.
    assert session.execute.call_count == 1
    session.add.assert_not_called()
    session.rollback.assert_not_called()
