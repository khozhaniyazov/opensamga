"""
app/services/library_upload_janitor.py
--------------------------------------
Janitor for stuck `LibraryUploadJob` rows.

v3.6 (2026-04-29) — audit finding #9. The library upload pipeline
runs OCR + embedding as a FastAPI BackgroundTask after returning
the HTTP response. If the worker is killed mid-OCR (deploy, OOM,
crash), the row stays in `PROCESSING_OCR` (or `PROCESSING_VECTOR`)
forever — there's no janitor and no retry. Eventually the admin UI
fills with rows that look like they're still working.

This module exposes a single coroutine,
`mark_stuck_uploads_failed`, that flips `PROCESSING_*` rows older
than a configurable cutoff to `FAILED` with a log line explaining
why. We deliberately don't retry — retry is a policy decision and
needs idempotent OCR, which we don't have yet.

Wiring: `app.main.lifespan` runs this once on startup. If you want
periodic sweeps, schedule it in a background task. For now, "once
on startup" matches the actual failure mode (worker died on the
last deploy → the next deploy janitors the leftovers).

Audit reference: backend health audit finding #9 (2026-04-29).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import LibraryUploadJob, UploadJobStatus

logger = logging.getLogger(__name__)


# Default cutoff. A real OCR + embedding pass on the largest
# textbook we ingest fits comfortably under 30 minutes. Anything
# older than 60 minutes is unambiguously stuck.
DEFAULT_STUCK_AFTER = timedelta(minutes=60)

_PROCESSING_STATES = (
    UploadJobStatus.PROCESSING_OCR,
    UploadJobStatus.PROCESSING_VECTOR,
)


async def mark_stuck_uploads_failed(
    db: AsyncSession,
    *,
    stuck_after: timedelta = DEFAULT_STUCK_AFTER,
    now: datetime | None = None,
) -> int:
    """Flip `PROCESSING_*` rows older than `stuck_after` to FAILED.

    Returns the number of rows flipped. Idempotent: a second call
    in the same window returns 0.
    """
    cutoff = (now or datetime.now(UTC)) - stuck_after

    # Identify candidates first so we can log them. Doing this in
    # one statement (UPDATE ... RETURNING) is tempting but harder
    # to assert in tests because asyncpg's RETURNING-row shape is
    # driver-specific.
    select_stmt = select(LibraryUploadJob.id, LibraryUploadJob.filename).where(
        LibraryUploadJob.status.in_(_PROCESSING_STATES),
        LibraryUploadJob.created_at < cutoff,
    )
    result = await db.execute(select_stmt)
    rows = result.all()
    if not rows:
        return 0

    ids = [row.id for row in rows]
    logger.warning(
        "library upload janitor: marking %d stuck job(s) as FAILED: %s",
        len(ids),
        ", ".join(f"#{r.id} ({r.filename})" for r in rows),
    )

    update_stmt = (
        update(LibraryUploadJob)
        .where(LibraryUploadJob.id.in_(ids))
        .values(
            status=UploadJobStatus.FAILED,
            logs=(
                "Marked FAILED by library_upload_janitor (stuck > "
                f"{int(stuck_after.total_seconds() // 60)}m). "
                "Worker process likely died mid-OCR. Re-upload to retry."
            ),
        )
    )
    await db.execute(update_stmt)
    await db.commit()
    return len(ids)
