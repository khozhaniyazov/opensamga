"""Session 22c extension - drop dead vector-store + legacy profile tables

Revision ID: s22d_drop_dead_tables
Revises: s22c_fk_hardening
Create Date: 2026-04-22

STATUS: WRITTEN BUT NOT APPLIED. Do not run this until the
commit freeze on HEAD=fe6e383 is lifted AND the drops are explicitly
approved by the boss.

Why
---
Phase-4 of the session-22c audit (see `DEAD_TABLES.md` at repo root)
classified three empty tables as fully superseded by active schema:

1. `langchain_pg_embedding`   - replaced by `textbook_chunks.chunk_embedding`
                                 (pgvector HNSW index; 18,013 rows live).
2. `langchain_pg_collection`  - paired with the embedding table; unused.
3. `student_profile`          - singular-named duplicate of `student_profiles`;
                                 0 rows, all reads use the plural.

All three are verified to have zero rows. `data_health.py check_student_profiles`
will trip to WARN if any row lands in `student_profile` before this
migration runs, preventing accidental data loss.

The migration uses DROP ... IF EXISTS CASCADE so it is idempotent.
`downgrade()` is intentionally a no-op: re-creating these tables from
scratch would require rehydrating langchain's schema + recreating the
singular profile table with its (undocumented) column set, and neither
is a reversal we would ever actually want.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s22d_drop_dead_tables"
# NOTE: s22e_student_profile_user_unique was applied ahead of this
# file (the ordering s22c -> s22e -> s22d reflects the real chronology
# of session 22c phase 2; s22d sat parked behind the commit freeze
# while s22e was authored and applied for the B1 bug). Keep s22d as
# a descendant of s22e so the alembic DAG stays linear.
down_revision: Union[str, Sequence[str], None] = "s22e_student_profile_user_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
-- Guarded drops. The `to_regclass` checks make the COUNT(*) safety
-- assertions skip cleanly on a fresh open-source install where these
-- legacy tables never existed in the first place; on the upstream
-- private DB they still run and abort if the tables carry data.
DO $$
BEGIN
    IF to_regclass('public.langchain_pg_embedding') IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM langchain_pg_embedding) > 0 THEN
            RAISE EXCEPTION 'langchain_pg_embedding is not empty; aborting drop';
        END IF;
    END IF;
    IF to_regclass('public.langchain_pg_collection') IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM langchain_pg_collection) > 1 THEN
            RAISE EXCEPTION 'langchain_pg_collection has > 1 row; aborting drop';
        END IF;
    END IF;
    IF to_regclass('public.student_profile') IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM student_profile) > 0 THEN
            RAISE EXCEPTION 'student_profile is not empty; aborting drop';
        END IF;
    END IF;
END$$;

DROP TABLE IF EXISTS langchain_pg_embedding CASCADE;
DROP TABLE IF EXISTS langchain_pg_collection CASCADE;
DROP TABLE IF EXISTS student_profile CASCADE;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    # Intentional no-op; dropped tables are fully superseded and
    # cannot be mechanically re-created without their original DDL.
    pass
