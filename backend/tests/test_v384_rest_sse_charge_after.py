"""
v3.84 (2026-05-03) — port v3.3 WS-path charge-after-success to REST + SSE.

Pre-v3.84 the REST and SSE chat paths charged the daily
``chat_messages`` counter BEFORE the model call:

  - ``_run_chat_agent_loop_path`` (POST /api/chat agent branch)
  - ``chat_stream_endpoint`` (POST /api/chat/stream SSE)
  - ``chat_endpoint`` legacy branch (POST /api/chat with
    CHAT_AGENT_LOOP off)

Every model timeout, content-filter trip, or upstream 5xx burned a
daily message off the user's budget. v3.3 fixed the WebSocket path
in 2026-04-29; v3.84 ports the same pattern to REST + SSE.

The fix splits the old ``_quota_check_and_increment`` into:

  - ``_quota_check_only(*, current_user, db) -> (premium, model_name, counter)``
    — raises 429 if at cap; returns the ORM counter row otherwise.
  - ``_quota_charge(*, counter, db) -> None``
    — increments + commits. No-op for anonymous users.

Each call site invokes ``_quota_check_only`` BEFORE the model call
and ``_quota_charge`` only AFTER the loop / first model call
returns successfully.

Three lanes pinned:

1. **Static AST** on the helpers — the new helpers exist with
   the v3.3-compatible signatures and the old
   ``_quota_check_and_increment`` is gone.
2. **Static source order** on all three call sites — the charge
   call appears AFTER the model invocation in each handler.
3. **Behavioral** on the helpers — quota check raises 429 at cap;
   anonymous users bypass; charge is a no-op for anonymous users;
   charge increments + commits for authenticated users.
"""

from __future__ import annotations

import ast
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import SubscriptionTier, UsageCounter, User

# ---------------------------------------------------------------------------
# Lane 1: helper signatures
# ---------------------------------------------------------------------------


_ROUTER_PATH = Path(__file__).resolve().parent.parent / "app" / "routers" / "chat.py"


def _load_module_ast() -> ast.Module:
    return ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))


def _find_function(module: ast.Module, name: str) -> ast.AsyncFunctionDef | None:
    for node in module.body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == name:
            return node
    return None


def test_v384_helper_quota_check_only_exists():
    """v3.84: ``_quota_check_only`` must be defined as an async function."""
    fn = _find_function(_load_module_ast(), "_quota_check_only")
    assert fn is not None, (
        "v3.84 requires `async def _quota_check_only(*, current_user, db)` "
        "in app/routers/chat.py — pre-call check that does NOT increment."
    )
    arg_names = [a.arg for a in fn.args.kwonlyargs]
    assert "current_user" in arg_names
    assert "db" in arg_names


def test_v384_helper_quota_charge_exists():
    """v3.84: ``_quota_charge`` must be defined as an async function."""
    fn = _find_function(_load_module_ast(), "_quota_charge")
    assert fn is not None, (
        "v3.84 requires `async def _quota_charge(*, counter, db)` in "
        "app/routers/chat.py — post-call increment + commit."
    )
    arg_names = [a.arg for a in fn.args.kwonlyargs]
    assert "counter" in arg_names
    assert "db" in arg_names


def test_v384_old_combined_helper_is_gone():
    """v3.84: ``_quota_check_and_increment`` must be removed."""
    fn = _find_function(_load_module_ast(), "_quota_check_and_increment")
    assert fn is None, (
        "v3.84 removes the combined `_quota_check_and_increment` helper "
        "in favor of `_quota_check_only` + `_quota_charge`. The combined "
        "name implied charge-before-call which is what we're fixing."
    )


def test_v384_quota_charge_increments_after_commit():
    """
    The charge helper body must increment chat_messages and commit.
    v3.85 (2026-05-03): the inline `counter.chat_messages += 1`
    was replaced with `_atomic_charge_counter(...)` to fix the
    underlying TOCTOU. We pin the call expression now.
    """
    fn = _find_function(_load_module_ast(), "_quota_charge")
    assert fn is not None
    src = ast.unparse(fn)
    assert "_atomic_charge_counter(" in src, (
        "v3.85: _quota_charge must call _atomic_charge_counter to "
        "increment chat_messages atomically."
    )
    # And it must still commit the surrounding transaction.
    assert "db.commit()" in src, "_quota_charge must commit the increment."


def test_v384_quota_check_only_does_not_increment():
    """
    The check-only helper body must NOT contain
    ``counter.chat_messages += 1`` — the whole point of v3.84 is
    that pre-call check does not write.
    """
    fn = _find_function(_load_module_ast(), "_quota_check_only")
    assert fn is not None
    src = ast.unparse(fn)
    assert "counter.chat_messages += 1" not in src, (
        "v3.84 _quota_check_only must NOT increment — that's exactly the bug it's fixing."
    )


# ---------------------------------------------------------------------------
# Lane 2: call-site body order on all three paths
# ---------------------------------------------------------------------------


def test_v384_agent_path_charges_after_loop():
    """
    ``_run_chat_agent_loop_path``: ``_quota_check_only`` must
    appear BEFORE the agent loop (``run_agent_loop``), and
    ``_quota_charge`` must appear AFTER it. Pre-v3.84 the single
    ``_quota_check_and_increment`` ran before the loop.
    """
    fn = _find_function(_load_module_ast(), "_run_chat_agent_loop_path")
    assert fn is not None
    src = ast.unparse(fn)
    check_idx = src.find("_quota_check_only")
    loop_idx = src.find("run_agent_loop")
    charge_idx = src.find("_quota_charge")

    assert check_idx > 0, "agent path must call _quota_check_only"
    assert loop_idx > 0, "agent path must call run_agent_loop"
    assert charge_idx > 0, "agent path must call _quota_charge"

    assert check_idx < loop_idx, (
        "v3.84: _quota_check_only must run BEFORE the agent loop "
        "(429 should short-circuit the model call)."
    )
    assert loop_idx < charge_idx, (
        "v3.84: _quota_charge must run AFTER the agent loop "
        "(charge-after-success). Agent-loop crashes must not "
        "consume a daily message."
    )


def test_v384_sse_path_charges_after_loop():
    """
    ``chat_stream_endpoint``: ``_quota_check_only`` must appear
    BEFORE the agent loop, and ``_quota_charge`` must appear AFTER
    the ``try/except Exception`` arm so a stream crash bails out
    via the ``return`` without charging.
    """
    fn = _find_function(_load_module_ast(), "chat_stream_endpoint")
    assert fn is not None
    src = ast.unparse(fn)
    check_idx = src.find("_quota_check_only")
    loop_idx = src.find("run_agent_loop")
    charge_idx = src.find("_quota_charge")

    assert check_idx > 0, "SSE path must call _quota_check_only"
    assert loop_idx > 0, "SSE path must call run_agent_loop"
    assert charge_idx > 0, "SSE path must call _quota_charge"

    assert check_idx < loop_idx, "v3.84: SSE _quota_check_only must run BEFORE the agent loop."
    assert loop_idx < charge_idx, (
        "v3.84: SSE _quota_charge must run AFTER the agent loop. "
        "A mid-stream crash returns BEFORE this line — user not charged."
    )


def test_v384_legacy_path_charges_after_first_model_call():
    """
    Legacy ``chat_endpoint``: charge must happen AFTER the first
    ``client.chat.completions.create`` call. The legacy path
    preserves its inline quota-check structure (it's gnarly to
    refactor) but moves the increment to post-call via
    ``_quota_charge``.
    """
    fn = _find_function(_load_module_ast(), "chat_endpoint")
    assert fn is not None
    src = ast.unparse(fn)

    # The pre-call quota check has the inline 429 raise:
    # `if counter.chat_messages >= limit: raise HTTPException(...)`
    pre_check_idx = src.find("counter.chat_messages >= limit")
    model_call_idx = src.find("client.chat.completions.create")
    charge_idx = src.find("_quota_charge")

    assert pre_check_idx > 0, (
        "legacy path must keep the pre-call `counter.chat_messages >= limit` 429 guard."
    )
    assert model_call_idx > 0, "legacy path must call client.chat.completions.create."
    assert charge_idx > 0, "legacy path must call _quota_charge to charge after success."

    assert pre_check_idx < model_call_idx, (
        "v3.84: pre-call quota guard must precede the first model call "
        "(at-cap users should get 429, not consume a model call)."
    )
    assert model_call_idx < charge_idx, (
        "v3.84: legacy _quota_charge must run AFTER the first model "
        "call so timeouts/content-filter/5xx don't consume a daily "
        "message."
    )


def test_v384_legacy_path_old_inline_increment_is_gone():
    """
    Legacy path used to inline `counter.chat_messages += 1; await
    db.commit()` BEFORE the model call. v3.84 removes that.
    The inline pattern must NOT appear before
    `client.chat.completions.create` in chat_endpoint anymore.
    """
    fn = _find_function(_load_module_ast(), "chat_endpoint")
    assert fn is not None
    src = ast.unparse(fn)
    inline_idx = src.find("counter.chat_messages += 1")
    model_call_idx = src.find("client.chat.completions.create")

    if inline_idx >= 0 and model_call_idx > 0:
        assert inline_idx > model_call_idx, (
            "v3.84: legacy path must not have an inline "
            "`counter.chat_messages += 1` before the model call. "
            "The increment must go through _quota_charge AFTER the "
            "model call returns."
        )


# ---------------------------------------------------------------------------
# Lane 3: behavioral on the helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def importable_chat_module():
    import importlib

    return importlib.import_module("app.routers.chat")


def _mk_user(*, premium: bool = False, uid: int = 42) -> User:
    return User(
        id=uid,
        email=f"u{uid}@x.test",
        name="QuotaUser",
        subscription_tier=(SubscriptionTier.PREMIUM if premium else SubscriptionTier.FREE),
    )


def _mk_counter(chat_messages: int = 0, uid: int = 42) -> UsageCounter:
    return UsageCounter(user_id=uid, date=date.today(), chat_messages=chat_messages)


def _mk_db(counter: UsageCounter | None):
    """
    AsyncSession stub. v3.85: callers may issue both a SELECT
    (via _get_or_create_counter) and an atomic UPDATE (via
    _atomic_charge_counter). Sniff the compiled SQL to dispatch.
    The UPDATE responder mirrors the in-memory counter increment
    so test assertions on `counter.chat_messages` still work.
    """
    db = AsyncMock()

    def _on_execute(stmt, *_, **__):
        try:
            compiled = str(stmt.compile(compile_kwargs={"literal_binds": False}))
        except Exception:
            compiled = ""
        if (
            "UPDATE" in compiled.upper()
            and "usage_counters" in compiled.lower()
            and counter is not None
        ):
            counter.chat_messages += 1
            upd = MagicMock()
            upd.scalar_one_or_none = MagicMock(return_value=counter.chat_messages)
            return upd
        m = MagicMock()
        m.scalar_one_or_none = MagicMock(return_value=counter)
        return m

    db.execute = AsyncMock(side_effect=_on_execute)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_v384_quota_check_only_anonymous_returns_none_counter(
    importable_chat_module,
):
    """Anonymous user: returns (False, default_model, None), no DB touch."""
    mod = importable_chat_module
    db = _mk_db(counter=None)
    premium, model_name, counter = await mod._quota_check_only(current_user=None, db=db)
    assert premium is False
    assert model_name == mod.DEFAULT_CHAT_MODEL
    assert counter is None
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_v384_quota_check_only_below_cap_returns_counter(
    importable_chat_module,
):
    mod = importable_chat_module
    user = _mk_user(premium=False)
    counter_row = _mk_counter(chat_messages=5)
    db = _mk_db(counter=counter_row)

    premium, model_name, counter = await mod._quota_check_only(current_user=user, db=db)
    assert premium is False
    assert model_name == mod.DEFAULT_CHAT_MODEL
    assert counter is counter_row
    # CRUCIAL: the check did NOT increment.
    assert counter.chat_messages == 5
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_v384_quota_check_only_at_cap_raises_429(importable_chat_module):
    mod = importable_chat_module
    from fastapi import HTTPException

    user = _mk_user(premium=False)
    counter_row = _mk_counter(chat_messages=20)  # FREE limit
    db = _mk_db(counter=counter_row)

    with pytest.raises(HTTPException) as exc:
        await mod._quota_check_only(current_user=user, db=db)
    assert exc.value.status_code == 429
    assert exc.value.detail["error"] == "quota_exceeded"
    # And still didn't increment.
    assert counter_row.chat_messages == 20


@pytest.mark.asyncio
async def test_v384_quota_charge_anonymous_is_noop(importable_chat_module):
    """`counter is None` (anonymous) — charge must be a clean no-op."""
    mod = importable_chat_module
    db = _mk_db(counter=None)
    await mod._quota_charge(counter=None, db=db)
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_v384_quota_charge_increments_and_commits(importable_chat_module):
    mod = importable_chat_module
    counter_row = _mk_counter(chat_messages=5)
    db = _mk_db(counter=counter_row)

    await mod._quota_charge(counter=counter_row, db=db)
    assert counter_row.chat_messages == 6
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_v384_check_then_charge_round_trip(importable_chat_module):
    """End-to-end helper round-trip mimicking a real successful turn."""
    mod = importable_chat_module
    user = _mk_user(premium=True)
    counter_row = _mk_counter(chat_messages=42)
    db = _mk_db(counter=counter_row)

    premium, model_name, counter = await mod._quota_check_only(current_user=user, db=db)
    # Pre-call: still at 42, premium model selected.
    assert premium is True
    assert counter.chat_messages == 42
    db.commit.assert_not_called()

    # Simulate model call success here…

    await mod._quota_charge(counter=counter, db=db)
    # Post-call: 43, one commit.
    assert counter.chat_messages == 43
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_v384_check_without_charge_does_not_increment(importable_chat_module):
    """
    Simulates a model failure: caller invokes `_quota_check_only`
    successfully but the model call raises before reaching
    `_quota_charge`. The counter must remain unchanged.
    """
    mod = importable_chat_module
    user = _mk_user(premium=False)
    counter_row = _mk_counter(chat_messages=10)
    db = _mk_db(counter=counter_row)

    premium, model_name, counter = await mod._quota_check_only(current_user=user, db=db)
    # Simulated upstream failure here — caller raises and never
    # reaches _quota_charge. We just verify the counter is intact.
    assert counter.chat_messages == 10
    db.commit.assert_not_called()
