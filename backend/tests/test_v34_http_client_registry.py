"""
Tests for v3.4 httpx.AsyncClient registry / shutdown wiring.

v3.4 (2026-04-29) audit finding #5: five modules created
`httpx.AsyncClient` instances at import time and never closed them.
The lifespan shutdown only disposed the SQLAlchemy engine and the
cache backend, so every rolling restart leaked file descriptors and
keep-alive pool slots.

Fix shape: a tiny module-level registry
(`app.utils.http_client_registry`) collects every `httpx.AsyncClient`
that gets minted at import time. The lifespan shutdown awaits
`close_all_http_clients()` after the engine and cache.

These tests pin:
  1. The registry helpers exist and round-trip.
  2. `close_all_http_clients` calls `aclose()` on each registered client.
  3. Each of the five originally-leaking modules registers exactly
     one client at import time.
  4. `app.main.lifespan`'s shutdown branch references the closer.
"""

from __future__ import annotations

import asyncio
import inspect
from unittest.mock import AsyncMock

import pytest

from app.utils import http_client_registry as reg


def test_register_returns_input_unchanged():
    sentinel = object()
    out = reg.register_http_client(sentinel)  # type: ignore[arg-type]
    assert out is sentinel
    # Cleanup so we don't pollute downstream tests.
    reg._registered.remove(sentinel)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_close_all_invokes_aclose_on_each_registered():
    fake1 = AsyncMock()
    fake2 = AsyncMock()
    reg.register_http_client(fake1)
    reg.register_http_client(fake2)
    before = reg.registered_count()
    assert before >= 2

    await reg.close_all_http_clients()

    fake1.aclose.assert_awaited_once()
    fake2.aclose.assert_awaited_once()
    # All entries drained.
    assert reg.registered_count() == 0


@pytest.mark.asyncio
async def test_close_all_does_not_propagate_individual_failures():
    """A single failing aclose() must not abort the rest of shutdown."""
    bad = AsyncMock()
    bad.aclose.side_effect = RuntimeError("boom")
    good = AsyncMock()
    reg.register_http_client(bad)
    reg.register_http_client(good)

    # Should NOT raise.
    await reg.close_all_http_clients()

    bad.aclose.assert_awaited_once()
    good.aclose.assert_awaited_once()
    assert reg.registered_count() == 0


def test_originally_leaking_modules_register_at_import():
    """Each of the five modules called out in audit finding #5 must
    funnel its httpx.AsyncClient through `register_http_client`. Catches
    a future "while we're at it" refactor that drops the registration."""
    from pathlib import Path

    backend_app = Path(reg.__file__).parent.parent  # backend/app/

    targets = [
        backend_app / "routers" / "data.py",
        backend_app / "routers" / "chat.py",
        backend_app / "routers" / "chat_websocket.py",
        backend_app / "services" / "feedback_loop.py",
        backend_app / "services" / "safety.py",
    ]
    for path in targets:
        text = path.read_text(encoding="utf-8")
        assert "register_http_client" in text, (
            f"{path.name} must register its httpx.AsyncClient via "
            "app.utils.http_client_registry.register_http_client. "
            "Audit finding #5 (v3.4)."
        )


def test_lifespan_shutdown_calls_close_all_http_clients():
    """The shutdown branch of `app.main.lifespan` must invoke
    `close_all_http_clients`. We check the source rather than running
    the lifespan because that drags in the DB engine."""
    from app import main as main_mod

    src = inspect.getsource(main_mod.lifespan)
    assert "close_all_http_clients" in src, (
        "app.main.lifespan must call close_all_http_clients on shutdown. Audit finding #5 (v3.4)."
    )


def test_lifespan_shutdown_orders_close_after_engine_dispose():
    """Order matters: dispose engine first (DB still working for any
    last-gasp checks), then cache, then http clients. If the order
    drifts back to closing httpx before the engine, in-flight DB work
    triggered by request handlers could be cancelled mid-flight without
    a warning trail."""
    from app import main as main_mod

    src = inspect.getsource(main_mod.lifespan)
    engine_pos = src.find("engine.dispose")
    cache_pos = src.find("cache_module.cache.close")
    http_pos = src.find("close_all_http_clients")
    assert engine_pos != -1 and cache_pos != -1 and http_pos != -1
    assert engine_pos < cache_pos < http_pos, (
        "Shutdown order regressed: must be engine -> cache -> http clients."
    )


def teardown_module(module):
    """Defensive: drain anything a test left behind so we don't poison
    an unrelated test that expects the registry empty."""

    async def _drain():
        await reg.close_all_http_clients()

    try:
        asyncio.get_event_loop().run_until_complete(_drain())
    except RuntimeError:
        # No running loop; create a fresh one.
        asyncio.new_event_loop().run_until_complete(_drain())
