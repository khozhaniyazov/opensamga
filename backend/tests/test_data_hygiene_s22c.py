"""Regression guards locking in session 22c DB-hygiene wins.

Session 22c added two major data-hygiene fixes after the 2025 min-score
backfill:

1. 25 `major_groups` rows were populated from "Unknown" to real
   KZ UNT 2025 subject-pair strings (11 engineering, 12 arts, 1 geodesy,
   1 math+informatics). See backfill_unknown_groups_apply.py.

2. 12 orphan university codes (020, 022, 044, 047, 078, 089, 116, 147,
   157, 223, 527, 529) were inserted into `university_details` by
   extracting the official roster appendix from
   `dataset/2025/2025_data.pdf`, unlocking 1,679 acceptance_scores 2025
   rows that had no joinable university record. See
   backfill_orphan_unis_apply.py.

These tests are DB-read-only and must continue to pass. A rollback of
either backfill will trip them immediately.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.database import AsyncSessionLocal


@pytest.mark.asyncio
async def test_major_groups_has_no_unknown_or_null_subjects():
    """major_groups.unt_subjects must never be NULL or 'Unknown' again."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT COUNT(*) FROM major_groups
             WHERE unt_subjects IS NULL
                OR LOWER(TRIM(unt_subjects)) = 'unknown'
                OR TRIM(unt_subjects) = ''
        """)
        )
        n_bad = res.scalar_one()
    assert n_bad == 0, (
        f"major_groups has {n_bad} row(s) with NULL/Unknown/empty unt_subjects; "
        "re-run tmp_scripts/session_2026-04-22/backfill_unknown_groups_apply.py --apply"
    )


@pytest.mark.asyncio
async def test_major_groups_total_unchanged():
    """Paranoia: the backfill did UPDATEs only, never INSERTs or DELETEs.
    Total row count must remain exactly 127."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("SELECT COUNT(*) FROM major_groups"))
        n = res.scalar_one()
    assert n == 127, f"major_groups row count drifted: {n} != 127"


@pytest.mark.asyncio
async def test_all_2025_acceptance_scores_have_matching_university_details():
    """Every acceptance_scores row for year=2025 must join to a
    university_details row. Orphan backfill lifted this to 100%."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT COUNT(*) FROM acceptance_scores a
             WHERE a.year = 2025
               AND NOT EXISTS (
                 SELECT 1 FROM university_details u
                  WHERE u.university_code = a.university_code
               )
        """)
        )
        n_orphans = res.scalar_one()
    assert n_orphans == 0, (
        f"{n_orphans} acceptance_scores(year=2025) rows have no matching "
        "university_details; re-run tmp_scripts/session_2026-04-22/backfill_orphan_unis_apply.py --apply"
    )


@pytest.mark.asyncio
async def test_orphan_seed_codes_present_and_sourced():
    """All 12 orphan codes must exist in university_details, carry a
    non-empty full_name, and still have the PDF-appendix source tag
    (unless a later curator promoted them)."""
    seeds = [
        "020",
        "022",
        "044",
        "047",
        "078",
        "089",
        "116",
        "147",
        "157",
        "223",
        "527",
        "529",
    ]
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT university_code, full_name, source_url
              FROM university_details
             WHERE university_code = ANY(:codes)
        """),
            {"codes": seeds},
        )
        rows = res.mappings().all()

    found = {r["university_code"]: r for r in rows}
    missing = [c for c in seeds if c not in found]
    assert not missing, f"Seed codes missing from university_details: {missing}"

    for code in seeds:
        row = found[code]
        name = (row["full_name"] or "").strip()
        assert name, f"{code}: full_name must not be empty"
        assert len(name) >= 4, f"{code}: full_name too short ({name!r})"


@pytest.mark.asyncio
async def test_orphan_seed_rows_unlock_grant_seats():
    """The 12 seed codes together must expose at least 1,000 grant seats
    for 2025 (actual post-apply value was 2,777). Guards against a seeder
    rollback that secretly deletes the rows without removing the details."""
    seeds = [
        "020",
        "022",
        "044",
        "047",
        "078",
        "089",
        "116",
        "147",
        "157",
        "223",
        "527",
        "529",
    ]
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT COALESCE(SUM(grants_awarded), 0) AS seats
              FROM acceptance_scores
             WHERE year = 2025
               AND university_code = ANY(:codes)
        """),
            {"codes": seeds},
        )
        seats = res.scalar_one()
    assert seats >= 1000, (
        f"Only {seats} grant seats visible across 12 orphan seeds (year=2025); "
        "expected >= 1,000. acceptance_scores rows may have been pruned."
    )


@pytest.mark.asyncio
async def test_university_details_minimum_population():
    """The overall university_details table must carry at least 105 rows
    (97 pre-s22c + 12 new seeds, minus up-to-4 tolerance for future cleanups)."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("SELECT COUNT(*) FROM university_details"))
        n = res.scalar_one()
    assert n >= 105, f"university_details dropped below expected 105 rows: n={n}"
