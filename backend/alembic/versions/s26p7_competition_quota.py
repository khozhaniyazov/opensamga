"""Session 26 phase 7 — competition_quota on student profiles.

Revision ID: s26p7_competition_quota
Revises: s23c_mock_questions_vector_1024
Create Date: 2026-04-27

Adds the missing piece for "what are my chances?" minimal-prompt
answers: a persistent quota choice on the student's profile so the
chat agent doesn't have to ask "общий конкурс / сельская / сиротская"
on every turn. Today the only place quota lives is in the per-request
ChatRequest.user_quota field, which defaults to GENERAL — the LLM
correctly hedges when the user never typed it.

Why a new column instead of reusing target_majors[0] for everything:
quota orthogonally affects the score threshold the same applicant
will hit, and it changes between universities for some students
(rural quota requires registered village residency). Storing it on
the profile is a one-liner.

Values: "GENERAL" or "RURAL" (matches the strings the DB already uses
in historical_grant_thresholds.quota_type and AcceptanceScore.quota_type).
The chat tool registry advertises "ORPHAN" too, but no historical row
under this schema carries it; we keep the column NULL-able so the
absence is distinguishable from an explicit GENERAL.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s26p7_competition_quota"
down_revision: Union[str, Sequence[str], None] = "s23c_mock_questions_vector_1024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS competition_quota VARCHAR NULL;
"""

DOWNGRADE_SQL = """
ALTER TABLE student_profiles
    DROP COLUMN IF EXISTS competition_quota;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
