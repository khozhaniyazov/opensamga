"""
Health check endpoints for deployment orchestration.

Provides separate liveness and readiness probes following Kubernetes conventions:
- /health/live: Process is alive (no external dependency checks)
- /health/ready: App can serve traffic (checks database connectivity)
- /health/detail: extended ops view (version, uptime, build SHA, component
  status). NOT a deploy probe — operator-facing only. v4.8.
"""

import asyncio
import os
import subprocess
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

router = APIRouter(tags=["health"])

# Timeout for database connectivity check (seconds)
READINESS_DB_TIMEOUT = 2

# Process-level uptime anchor. Imported at module load = process start.
_PROCESS_START = time.monotonic()


def _git_short_sha() -> str | None:
    """Best-effort: return the short git SHA at start time.

    Cached at module load so we never shell out per-request. Returns
    None in environments without git (Docker images that ship without
    .git, etc.) — which is the common case in prod.
    """
    if not os.path.isdir(os.path.join(os.getcwd(), ".git")):
        return None
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return out.decode("ascii", errors="replace").strip() or None
    except Exception:  # noqa: BLE001 — broad: git may be unavailable / timeout / not a repo → return None silently
        return None


_BUILD_SHA = _git_short_sha()


@router.get("/health")
async def health_shim():
    """
    Session 15 (2026-04-21): backward-compat shim for deploy scripts and
    Caddyfile that probe `/health`. Equivalent to `/health/live` — never
    touches the database so it cannot flap a liveness check.
    """
    return {
        "status": "ok",
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.get("/health/live")
async def liveness():
    """
    Liveness probe - returns 200 if FastAPI process is running.

    No external dependency checks. A failed liveness check signals the
    orchestrator to restart the container. Including DB checks here would
    cause unnecessary restart loops when the database is temporarily
    unavailable.
    """
    return {
        "status": "ok",
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.get("/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    """
    Readiness probe - returns 200 if the app can serve traffic.

    Checks database connectivity with a 2-second timeout. A failed
    readiness check tells the orchestrator to stop routing traffic
    to this instance until it recovers.
    """
    timestamp = datetime.now(UTC).isoformat()

    try:
        await asyncio.wait_for(
            db.execute(text("SELECT 1")),
            timeout=READINESS_DB_TIMEOUT,
        )
        return {
            "status": "ready",
            "checks": {"database": "connected"},
            "timestamp": timestamp,
        }
    except TimeoutError:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "checks": {"database": "timeout"},
                "timestamp": timestamp,
            },
        )
    except Exception:  # noqa: BLE001 — broad: any DB failure → not ready, ops gets 503
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "checks": {"database": "error"},
                "timestamp": timestamp,
            },
        )


# ---------------------------------------------------------------------------
# v4.8 (2026-05-05) — /health/detail
#
# Extended ops view aggregating "what's the state of this instance?".
# Read-only, intended for the ops dashboard / incident-response, NOT
# for deploy orchestration — use /health/live and /health/ready for
# orchestrator probes. All component checks are best-effort with hard
# timeouts; a degraded component returns ok=False but never throws.
#
# Promoted from spike/health-detail-endpoint. Auto-mounted via
# health.router (already include_router'd by app/main.py:422).
# ---------------------------------------------------------------------------


@router.get("/health/detail")
async def detail(db: AsyncSession = Depends(get_db)):
    """SPIKE: extended ops health view.

    Returns:
        - service: name + version (matches FastAPI app version)
        - build_sha: short git SHA at process start (None in deploy
          images that ship without .git)
        - uptime_seconds: monotonic seconds since process start
        - timestamp: server-side UTC timestamp
        - checks: per-component {ok: bool, latency_ms: float, detail: str}
            - database (SELECT 1 with READINESS_DB_TIMEOUT)
            - more components can be added later (redis cache,
              dashscope reachability, OpenAI quota, etc.)

    All checks are best-effort: a single component failure marks
    that component degraded but never tanks the response.
    """
    timestamp = datetime.now(UTC).isoformat()
    uptime_seconds = round(time.monotonic() - _PROCESS_START, 3)

    checks: dict[str, dict] = {}

    # database
    db_start = time.monotonic()
    try:
        await asyncio.wait_for(
            db.execute(text("SELECT 1")),
            timeout=READINESS_DB_TIMEOUT,
        )
        checks["database"] = {
            "ok": True,
            "latency_ms": round((time.monotonic() - db_start) * 1000, 2),
            "detail": "connected",
        }
    except TimeoutError:
        checks["database"] = {
            "ok": False,
            "latency_ms": round((time.monotonic() - db_start) * 1000, 2),
            "detail": f"timeout (>{READINESS_DB_TIMEOUT}s)",
        }
    except Exception as exc:  # noqa: BLE001 — broad: any DB failure → degraded; never throw from /health/detail
        checks["database"] = {
            "ok": False,
            "latency_ms": round((time.monotonic() - db_start) * 1000, 2),
            "detail": type(exc).__name__,
        }

    # NOTE: keep `version` in sync with FastAPI(version=...) in app/main.py.
    return {
        "service": "samga.ai-api",
        "version": "4.0.0",
        "build_sha": _BUILD_SHA,
        "uptime_seconds": uptime_seconds,
        "timestamp": timestamp,
        "checks": checks,
    }
