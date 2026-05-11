"""
app/utils/http_client_registry.py
---------------------------------
Lightweight registry for module-level `httpx.AsyncClient` instances.

v3.4 (2026-04-29): Several modules historically created their own
`httpx.AsyncClient` at import time and never closed them. The lifespan
shutdown in `main.py` only disposed the SQLAlchemy engine and the
cache backend. On rolling restarts, those httpx clients were torn
down by GC at process exit (if at all), which leaks file descriptors
and the keep-alive connection pool.

The minimal-blast-radius fix is NOT to convert every callsite to
`app.state.http_client` — those module-level `client = AsyncOpenAI(...)`
expressions are referenced from many handler bodies that would need to
become `request.app.state.client`-aware. Instead we keep the
module-level client expressions, but every one of them registers
itself here at import time. The lifespan shutdown then iterates the
registry and `await client.aclose()`s each.

Usage from a module:

    from ..utils.http_client_registry import register_http_client
    http_client = httpx.AsyncClient(timeout=60.0)
    register_http_client(http_client)
    client = AsyncOpenAI(api_key=..., http_client=http_client)

Audit reference: backend health audit finding #5 (2026-04-29).
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)


_registered: list[httpx.AsyncClient] = []


def register_http_client(client: httpx.AsyncClient) -> httpx.AsyncClient:
    """Register an httpx.AsyncClient so the lifespan can close it.

    Returns the client unchanged so callers can write
    `register_http_client(httpx.AsyncClient(...))`.
    """
    _registered.append(client)
    return client


async def close_all_http_clients() -> None:
    """Close every registered httpx.AsyncClient. Best-effort: a single
    failing close must not abort the rest."""
    if not _registered:
        return
    logger.info("Closing %d registered httpx.AsyncClient instance(s)...", len(_registered))
    while _registered:
        client = _registered.pop()
        try:
            await client.aclose()
        except Exception:
            # Don't let a flaky close take down the rest of shutdown.
            logger.exception("Failed to close httpx.AsyncClient cleanly")


def registered_count() -> int:
    """Test helper: how many clients are currently registered."""
    return len(_registered)
