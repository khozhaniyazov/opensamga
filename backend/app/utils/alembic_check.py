"""
app/utils/alembic_check.py
--------------------------
Lightweight runtime check that the live `alembic_version` row matches
the migration head shipped with this code.

v3.7 (2026-04-30) — audit finding #3 follow-up. Previously
`app.main.lifespan` ran `Base.metadata.create_all` on every startup,
which masked migration drift entirely. We've now removed that, so
this helper is the early-warning system: in production we refuse to
start when the live version doesn't match `alembic heads`; in dev
we log a warning so a fresh checkout can iterate without first
running `alembic upgrade head`.

Why a custom check instead of `alembic check`:

- `alembic check` is a blocking subprocess call. The lifespan needs
  an async, in-process check.
- `alembic check` compares models <-> DB schema; that diff is noisy
  on a real deploy (HNSW indexes, view definitions, partial-index
  conditions all churn). What we actually want is the simpler
  invariant: "the version recorded in `alembic_version` equals the
  head shipped on disk".
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)


def _read_local_heads() -> set[str]:
    """Return the set of Alembic head revision ids on disk.

    Uses Alembic's own `ScriptDirectory` so we don't reinvent the
    DAG walk. Returns an empty set on any failure (the caller logs).
    """
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        # `backend/` is the alembic.ini directory.
        ini_path = Path(__file__).resolve().parent.parent.parent / "alembic.ini"
        cfg = Config(str(ini_path))
        script = ScriptDirectory.from_config(cfg)
        return set(script.get_heads())
    except Exception as e:  # pragma: no cover — env-specific
        logger.warning("Alembic check: could not load script directory (%s)", e)
        return set()


async def warn_or_raise_on_alembic_drift(engine: AsyncEngine, environment: str) -> None:
    """Compare the live `alembic_version` row with the local heads.

    Raises `RuntimeError` in production if they diverge; logs a
    warning in dev. Returns silently when the alembic_version table
    is unreadable (e.g. during initial bootstrap before any
    migration has been applied).
    """

    local_heads = _read_local_heads()
    if not local_heads:
        logger.warning("Alembic check skipped: no local heads parsed")
        return

    async with engine.begin() as conn:
        try:
            row = (
                await conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
            ).scalar_one_or_none()
        except Exception as e:
            logger.warning("Alembic check: alembic_version table unreadable (%s)", e)
            return

    live = (row or "").strip()
    if not live:
        msg = "Alembic check: alembic_version is empty. Run `alembic upgrade head`."
        if environment == "production":
            raise RuntimeError(msg)
        logger.warning(msg)
        return

    if live not in local_heads:
        msg = (
            f"Alembic drift: live version is {live!r}, but local heads are "
            f"{sorted(local_heads)!r}. Run `alembic upgrade head` (or "
            f"`alembic stamp head` if the schema is already current)."
        )
        if environment == "production":
            raise RuntimeError(msg)
        logger.warning(msg)
        return

    logger.info("Alembic check: live version %s matches local head", live)
