"""Regression guard (session 22c extension, 2026-04-22).

Root bug (fixed in session 22c): the public `/api/data/universities/{id}`
endpoint was returning stale 2024 threshold years for ALL universities even
though 2025 per-university data had already been seeded into the
`acceptance_scores` table. Cause: the public API reads from
`historical_grant_thresholds` + `university_data`, which the 2025 seeder
had not populated. See `_session22c_min_score_2025_audit.md` at repo root.

This test locks in the fix: at least one major of a well-known university
(AITU, id=91) must report `thresholds.year >= 2025`. If a future migration
or seeder rollback re-breaks the pipeline, this test fires immediately.

We assert on catalog/DB-level output rather than the HTTP layer so the
test does not need a running uvicorn or auth plumbing.
"""

from __future__ import annotations

import pytest

from app.database import AsyncSessionLocal
from app.services.university_catalog import load_university_catalog


@pytest.mark.asyncio
async def test_aitu_has_2025_thresholds():
    """AITU (university_id=91) must expose at least one major with
    threshold year >= 2025. Locks in the session-22c 2025 backfill."""
    async with AsyncSessionLocal() as db:
        catalog = await load_university_catalog(db)

    aitu = catalog.details_by_id.get(91)
    assert aitu is not None, "Fixture precondition: university_id=91 (AITU) must exist"

    thresholds = catalog.history_by_id.get(91, [])
    assert thresholds, "AITU must have at least one historical_grant_thresholds row"

    years = {t.data_year for t in thresholds if t.data_year}
    assert max(years) >= 2025, (
        f"AITU latest threshold year = {max(years)}; "
        f"expected >= 2025 (session 22c backfill regression)"
    )


@pytest.mark.asyncio
async def test_at_least_half_of_universities_have_2025_or_newer():
    """At least 50% of universities that have ANY threshold data must
    have data_year >= 2025. Guards against a global rollback.

    Threshold of 50% is conservative (actual post-fix is ~85%).
    """
    async with AsyncSessionLocal() as db:
        catalog = await load_university_catalog(db)

    unis_with_data = 0
    unis_with_2025 = 0
    for _uid, rows in catalog.history_by_id.items():
        if not rows:
            continue
        unis_with_data += 1
        if any((r.data_year or 0) >= 2025 for r in rows):
            unis_with_2025 += 1

    assert unis_with_data > 0, "Expected some universities with threshold data"
    ratio = unis_with_2025 / unis_with_data
    assert ratio >= 0.50, (
        f"Only {unis_with_2025}/{unis_with_data} ({ratio:.0%}) of universities "
        f"have >=2025 threshold data; expected >=50%"
    )
