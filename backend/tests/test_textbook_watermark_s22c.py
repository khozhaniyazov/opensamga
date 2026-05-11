"""Regression test: no OKULYK.KZ-family watermark content should live
in ``textbook_chunks`` after the session-22c scrub (2026-04-22).

If this test fails, the ingest pipeline has regressed — something is
inserting new chunks with the publisher watermark, OR an earlier
chunk got un-scrubbed.  See
``tmp_scripts/session_2026-04-22/scrub_watermarks.py`` for the
canonical strip regex.

The test is gated behind a real DB connection: if the DB is not
reachable in CI, it's skipped.  When it does run it's a cheap
``SELECT COUNT(*)`` on a small number of ILIKE patterns, so it's
safe to have in the main suite.
"""

from __future__ import annotations

import asyncio
import os

import pytest

# ``pytest_plugins`` in root conftest already sets up the event loop.


PATTERNS = [
    # domains (each wrapped in %…% for ILIKE)
    "%OKULYK.KZ%",
    "%OKULYK.COM%",
    "%OKULIK.KZ%",
    "%OKULUK.KZ%",
    "%ОКУЛУК.KZ%",
    "%ОКУУК.KZ%",
    "%ULYK.KZ%",
    "%ZULYK.KZ%",
    "%3ULYK.KZ%",
    # orphan preambles
    "%Все учебники Казахстана на%",
    "%Бсе учебники Казахстана на%",
    "%Все учебники Казахстана ищите%",
    "%Всё учебник% Казах% сайт%",
    "%Без учебника% Казах% сайт%",
]


@pytest.mark.asyncio
async def test_no_publisher_watermark_in_chunks():
    try:
        from sqlalchemy import text  # noqa: WPS433 (runtime import ok)

        from app.database import engine
    except Exception as e:  # pragma: no cover
        pytest.skip(f"DB module not importable: {e}")

    # Also skip if no DSN configured in env (CI without DB).
    if not os.environ.get("DATABASE_URL") and not os.environ.get("PGHOST"):
        # Still try — may pass via local default — but guard for no DB.
        pass

    try:
        async with engine.begin() as conn:
            residual: dict[str, int] = {}
            for pat in PATTERNS:
                r = await conn.execute(
                    text("SELECT COUNT(*) FROM textbook_chunks WHERE content ILIKE :p"),
                    {"p": pat},
                )
                residual[pat] = r.scalar() or 0
    except Exception as e:
        pytest.skip(f"DB unavailable: {e}")

    # All patterns must be 0.  If any non-zero, report the offender
    # list in the failure message so the operator knows what to scrub.
    offenders = {k: v for k, v in residual.items() if v}
    assert not offenders, (
        f"Watermark residue detected in textbook_chunks: {offenders}.\n"
        "Run tmp_scripts/session_2026-04-22/scrub_watermarks.py --apply"
        " to re-scrub + re-embed."
    )
