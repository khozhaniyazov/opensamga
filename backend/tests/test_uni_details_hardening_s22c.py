"""Regression guards for session 22c `university_details` hardening.

Covers the migration s22c_uni_details_hardening + the subsequent
short_name backfill:

1. `short_name` column exists.
2. Table-level UNIQUE constraint on `university_code` exists
   (named `uq_university_details_university_code`).
3. Support index `ix_university_details_short_name` exists.
4. Every row has a non-empty `short_name` (100% coverage).
5. No duplicate `short_name` values (we required distinct abbrs
   during the backfill to avoid FE ambiguity).
6. The seed-code abbreviations are exactly as captured from the PDF
   appendix — drift alarm.
7. INSERTing a duplicate university_code is rejected at the DB layer.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSessionLocal


@pytest.mark.asyncio
async def test_short_name_column_exists():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT column_name FROM information_schema.columns
             WHERE table_name='university_details' AND column_name='short_name'
        """)
        )
        assert res.scalar_one_or_none() == "short_name", (
            "university_details.short_name missing; run "
            "alembic upgrade head (s22c_uni_details_hardening)"
        )


@pytest.mark.asyncio
async def test_unique_constraint_on_university_code():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT conname FROM pg_constraint
             WHERE conrelid = 'university_details'::regclass
               AND conname = 'uq_university_details_university_code'
        """)
        )
        assert res.scalar_one_or_none() is not None, (
            "Named UNIQUE constraint missing on university_details.university_code"
        )


@pytest.mark.asyncio
async def test_short_name_index_exists():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("""
            SELECT indexname FROM pg_indexes
             WHERE tablename='university_details'
               AND indexname='ix_university_details_short_name'
        """)
        )
        assert res.scalar_one_or_none() is not None, (
            "Support index ix_university_details_short_name missing"
        )


@pytest.mark.asyncio
async def test_short_name_full_coverage():
    async with AsyncSessionLocal() as db:
        total = (await db.execute(text("SELECT COUNT(*) FROM university_details"))).scalar_one()
        populated = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM university_details "
                    " WHERE short_name IS NOT NULL AND short_name <> ''"
                )
            )
        ).scalar_one()
    assert total > 0, "university_details is empty"
    assert populated == total, (
        f"short_name coverage is {populated}/{total}; "
        "re-run tmp_scripts/session_2026-04-22/backfill_short_names.py --apply"
    )


@pytest.mark.asyncio
async def test_no_duplicate_short_names():
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT short_name, COUNT(*) AS n FROM university_details
             GROUP BY short_name HAVING COUNT(*) > 1
        """)
            )
        ).fetchall()
    assert not rows, f"duplicate short_names detected: {[r[0] for r in rows]}"


@pytest.mark.asyncio
async def test_seed_short_names_match_pdf_appendix():
    """12 orphan codes (session 22c) must carry the exact abbr that
    appears in the 2025 PDF appendix."""
    expected = {
        "020": "КазАСТ",
        "022": "МОК",
        "044": "ЮКМА",
        "047": "ЕврГИ",
        "078": "КазАДИ",
        "089": "QUni",
        "116": "Bolashaq",
        "147": "ЕкибИТИ",
        "157": "АкГрАв",
        "223": "МТУ",
        "527": "АФКМС",
        "529": "КНУВХИ",
    }
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT university_code, short_name FROM university_details
             WHERE university_code = ANY(:codes)
        """),
                {"codes": list(expected.keys())},
            )
        ).fetchall()

    got = {r[0]: r[1] for r in rows}
    missing = [c for c in expected if c not in got]
    assert not missing, f"seed codes missing: {missing}"
    mismatched = [(c, got[c], expected[c]) for c in expected if got[c] != expected[c]]
    assert not mismatched, f"short_name drift: {mismatched}"


@pytest.mark.asyncio
async def test_unique_constraint_rejects_duplicate_code():
    """Inserting a second row with an existing university_code must
    raise IntegrityError. Wrapped in a nested savepoint so the fixture
    rollback leaves the DB pristine."""
    async with AsyncSessionLocal() as db:
        await db.execute(text("BEGIN"))
        try:
            # Grab any real code.
            code = (
                await db.execute(text("SELECT university_code FROM university_details LIMIT 1"))
            ).scalar_one()
            # Try to insert a duplicate.
            with pytest.raises(IntegrityError):
                await db.execute(
                    text(
                        "INSERT INTO university_details "
                        "(full_name, university_code, source_url) "
                        "VALUES (:n, :c, 'test:dup')"
                    ),
                    {"n": "test dup", "c": code},
                )
                await db.flush()
        finally:
            await db.rollback()
