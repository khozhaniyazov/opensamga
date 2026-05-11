"""Session 22c extension — UNIQUE index on student_profiles.user_id

Revision ID: s22e_student_profile_user_unique
Revises: s22c_fk_hardening
Create Date: 2026-04-22

Why
---
Deep-audit (db_audit_suite + deep_audit.py, session 22c) surfaced that
`student_profiles.user_id` has

  - a FOREIGN KEY to users(id) ON DELETE CASCADE, but
  - NO individual index, and
  - NO uniqueness constraint,

even though the model treats `user_id` as a 1:1 owner pointer.

Consequences:
  1. Every `SELECT ... FROM student_profiles WHERE user_id = :u` is a
     seq-scan on a table that will only grow.
  2. A CASCADE-delete of a user row does a seq-scan of the same table
     per deleted user (n*m).
  3. Nothing prevents a second row with the same user_id from ever
     being inserted (we rely on service-layer checks).

Live duplicate count is 0 (audit verified), so a UNIQUE index can be
added without data surgery.

Using `CREATE UNIQUE INDEX IF NOT EXISTS ... CONCURRENTLY`-compatible
SQL is not possible inside an alembic migration (CONCURRENTLY forbids
running inside a transaction), so we use plain `CREATE UNIQUE INDEX
IF NOT EXISTS`. Table is tiny (~107 rows), lock window is milliseconds.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s22e_student_profile_user_unique"
down_revision: Union[str, Sequence[str], None] = "s22c_fk_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "ix_student_profiles_user_id"


def upgrade() -> None:
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public'
                   AND tablename  = 'student_profiles'
                   AND indexname  = '{INDEX_NAME}'
            ) THEN
                CREATE UNIQUE INDEX {INDEX_NAME}
                    ON student_profiles (user_id);
            END IF;
        END$$;
    """)


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME};")
