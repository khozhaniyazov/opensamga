"""Session 23 — required onboarding profile fields

Revision ID: s23_onboarding_profile_fields
Revises: s22_chat_threads
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s23_onboarding_profile_fields"
down_revision: Union[str, Sequence[str], None] = "s22_chat_threads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS last_test_results JSONB NULL,
    ADD COLUMN IF NOT EXISTS weakest_subject VARCHAR NULL;
"""

DOWNGRADE_SQL = """
ALTER TABLE student_profiles
    DROP COLUMN IF EXISTS weakest_subject,
    DROP COLUMN IF EXISTS last_test_results;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
