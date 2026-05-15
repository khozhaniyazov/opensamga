"""Canonical data restore compatibility columns.

Revision ID: v328_canonical_data_cols
Revises: v327_parent_report_share_tokens
Create Date: 2026-05-15

OpenSamga does not ship proprietary production data, but public users may
restore their own exported snapshots. Keep nullable compatibility columns that
existing data/export tooling expects.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "v328_canonical_data_cols"
down_revision: Union[str, Sequence[str], None] = "v327_parent_report_share_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR")
    op.execute("ALTER TABLE textbooks ADD COLUMN IF NOT EXISTS ocr_status TEXT")
    op.execute(
        "ALTER TABLE mock_questions ADD COLUMN IF NOT EXISTS difficulty VARCHAR DEFAULT 'MEDIUM'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE mock_questions DROP COLUMN IF EXISTS difficulty")
    op.execute("ALTER TABLE textbooks DROP COLUMN IF EXISTS ocr_status")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS phone")
