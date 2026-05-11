"""Session 23 phase c — normalize mock_questions.question_embedding to 1024-dim

Revision ID: s23c_mock_questions_vector_1024
Revises: s23b_mock_questions_fill_columns
Create Date: 2026-04-23

Why
---
`mock_questions.question_embedding` was originally typed as ``vector(1536)``
to match OpenAI ``text-embedding-3-small``. Session 10 (2026-04-20) moved
the whole stack onto DashScope ``text-embedding-v4`` (1024-dim) and
`textbook_chunks.chunk_embedding` was created/migrated accordingly.

For session-23 mass-ingest of ymnik.kz + LLM-generated questions, we
want to embed with the **same** model so cross-table semantic
operations (e.g. "find the chunk a question was generated from",
"find practice questions for this textbook page") are possible.

This migration drops + recreates the column as ``vector(1024)``. The
three pre-existing 1536-dim embeddings are discarded — they're a trivial
hand-seed and will be re-embedded with text-embedding-v4 in the next
ingest pass (see `embed_mock_questions.py`).
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s23c_mock_questions_vector_1024"
down_revision: Union[str, Sequence[str], None] = "s23b_mock_questions_fill_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
ALTER TABLE mock_questions
    DROP COLUMN IF EXISTS question_embedding;
ALTER TABLE mock_questions
    ADD COLUMN question_embedding vector(1024);
"""

DOWNGRADE_SQL = """
ALTER TABLE mock_questions
    DROP COLUMN IF EXISTS question_embedding;
ALTER TABLE mock_questions
    ADD COLUMN question_embedding vector(1536);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
