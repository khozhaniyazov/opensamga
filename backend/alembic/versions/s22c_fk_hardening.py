"""Session 22c extension — FK hardening on telemetry/feedback tables

Revision ID: s22c_fk_hardening
Revises: s22c_uni_details_hardening
Create Date: 2026-04-22

Why
---
Phase-2 FK sweep found 6 tables with a `user_id` column that has no
corresponding FK to `users(id)`:

    chat_feedback.user_id
    rag_query_log.user_id
    telemetry_errors.user_id
    telemetry_logs.user_id
    telemetry_requests.user_id

(Also rag_query_with_feedback.user_id, but that is a VIEW, not a base
table, and gets its FK transitively from rag_query_log.)

Live orphan count is 0 across all 5 base tables (scripts/p2_fk_sweep.py
verified), so constraints can be added without data surgery.

Adding these closes a class of silent bugs where deleting a user would
leave dangling telemetry / feedback rows referencing a gone PK. ON
DELETE CASCADE matches how every *other* user_id in this schema is
configured — see `chat_messages`, `exam_attempts`, `mistake_reviews`,
`portfolios`, etc.

The migration is idempotent (constraint added IF NOT EXISTS via
a pg_constraint guard). Safe to run repeatedly.

ERR case (chat_feedback.message_id) is NOT fixed here: that column is
TEXT holding a client-side composite string like "1776854348694-assistant",
not an INT referencing chat_messages.id. It is correctly not an FK.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s22c_fk_hardening"
down_revision: Union[str, Sequence[str], None] = "s22c_uni_details_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES_TO_FK = [
    ("chat_feedback",      "fk_chat_feedback_user_id",      "user_id"),
    ("rag_query_log",      "fk_rag_query_log_user_id",      "user_id"),
    ("telemetry_errors",   "fk_telemetry_errors_user_id",   "user_id"),
    ("telemetry_logs",     "fk_telemetry_logs_user_id",     "user_id"),
    ("telemetry_requests", "fk_telemetry_requests_user_id", "user_id"),
]


def _upgrade_sql() -> str:
    parts = []
    for tbl, conname, col in TABLES_TO_FK:
        parts.append(f"""
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = '{conname}'
           AND conrelid = '{tbl}'::regclass
    ) THEN
        ALTER TABLE {tbl}
            ADD CONSTRAINT {conname}
            FOREIGN KEY ({col}) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END$$;
""".strip())
    return "\n".join(parts)


def _downgrade_sql() -> str:
    return "\n".join(
        f"ALTER TABLE {tbl} DROP CONSTRAINT IF EXISTS {conname};"
        for tbl, conname, _col in TABLES_TO_FK
    )


def upgrade() -> None:
    op.execute(_upgrade_sql())


def downgrade() -> None:
    op.execute(_downgrade_sql())
