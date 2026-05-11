"""Session 22c extension — university_details hardening

Revision ID: s22c_uni_details_hardening
Revises: s23_onboarding_profile_fields
Create Date: 2026-04-22

Why
---
Two small latent issues on `university_details`, surfaced during the
session-22c DB audit after the 12-orphan PDF-appendix backfill:

1. `short_name` column missing. The 2025 data appendix (pp. 1752-1754)
   carries official abbreviations (КазАСТ, МОК, АкГрАв, КазНУ, ЕНУ, ...)
   which are how Kazakh students actually refer to their schools. The
   univision.kz roster also supplies them. Not storing them forced the
   FE to either display the 10-word full_name or guess — both ugly.

2. Although a UNIQUE INDEX on `university_code` exists
   (`ix_university_details_university_code`), there is no matching
   table-level UNIQUE CONSTRAINT. Adding the named constraint makes
   PG error messages readable, lets ORM bulk-insert detect
   conflicts cleanly, and is the idiom the rest of this codebase
   follows (every other unique-index table also has the constraint).

The migration is idempotent — safe to run repeatedly. Downgrade drops
the constraint and the column but leaves the underlying unique index
alone, since it pre-existed this migration.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s22c_uni_details_hardening"
down_revision: Union[str, Sequence[str], None] = "s23_onboarding_profile_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
-- 1) short_name column (abbreviation like "КазАСТ", "МОК", "АкГрАв").
ALTER TABLE university_details
    ADD COLUMN IF NOT EXISTS short_name VARCHAR NULL;

-- 2) Named UNIQUE CONSTRAINT on university_code. A UNIQUE INDEX with
--    the same semantics already exists (ix_university_details_university_code);
--    we add the table constraint for nicer error reporting without
--    duplicating the underlying storage.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_university_details_university_code'
           AND conrelid = 'university_details'::regclass
    ) THEN
        ALTER TABLE university_details
            ADD CONSTRAINT uq_university_details_university_code
            UNIQUE USING INDEX ix_university_details_university_code;
    END IF;
END$$;

-- 3) Supporting index for fast short_name lookups (gamified search uses it).
CREATE INDEX IF NOT EXISTS ix_university_details_short_name
    ON university_details (short_name);
"""


DOWNGRADE_SQL = """
DROP INDEX IF EXISTS ix_university_details_short_name;

ALTER TABLE university_details
    DROP CONSTRAINT IF EXISTS uq_university_details_university_code;

-- Recreate the plain unique index so the downgrade is fully symmetric
-- with the pre-upgrade state (ALTER ... USING INDEX consumed it).
CREATE UNIQUE INDEX IF NOT EXISTS ix_university_details_university_code
    ON university_details (university_code);

ALTER TABLE university_details
    DROP COLUMN IF EXISTS short_name;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
