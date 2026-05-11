"""v3.27 — parent_report_share_tokens table.

Revision ID: v327_parent_report_share_tokens
Revises: v37_merge_heads
Create Date: 2026-05-01

Adds the storage backing for v3.27 Issue #15 AC#5 (Parent Report).
A row represents a tokenized, time-bounded read-only share link the
student can mint and revoke. Token is opaque (`secrets.token_urlsafe`),
NOT a JWT — never used for student authentication, only for parent-side
read access to a sanitized snapshot.

PII surface of what the token unlocks (codified in
``app/services/parent_report.py:build_parent_report_payload``):
first name + grade + exam-history + chosen majors/universities + weak
topic snippets. No surname, no email, no telegram_id, no full
moderation/honor data.

Index on ``token`` is unique because the parent URL contains the
token directly; lookup must be O(log n) and collision-free
(``secrets.token_urlsafe(32)`` gives ~256 bits, collision-free in
practice but the DB uniqueness is the safety net).
"""

from collections.abc import Sequence
from typing import Union

from alembic import op


revision: str = "v327_parent_report_share_tokens"
down_revision: str | Sequence[str] | None = "v37_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS parent_report_share_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(64) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NULL,
    access_count    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_parent_report_share_tokens_token
    ON parent_report_share_tokens (token);
CREATE INDEX IF NOT EXISTS ix_parent_report_share_tokens_user_id
    ON parent_report_share_tokens (user_id);
"""

DOWNGRADE_SQL = """
DROP INDEX IF EXISTS ix_parent_report_share_tokens_user_id;
DROP INDEX IF EXISTS ix_parent_report_share_tokens_token;
DROP TABLE IF EXISTS parent_report_share_tokens;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
