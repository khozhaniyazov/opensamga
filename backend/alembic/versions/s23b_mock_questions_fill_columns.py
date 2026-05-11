"""Session 23 phase b — fill missing columns on mock_questions

Revision ID: s23b_mock_questions_fill_columns
Revises: s23_onboarding_profile_fields
Create Date: 2026-04-23

Why
---
`mock_questions` (the practice-exam bank) was created long ago with a
schema tuned for the hand-seeded 3 rows currently living in it:
`(id, topic_tag, question_text, options, correct_answer, difficulty,
question_embedding)`.

Session 23 is bulk-filling this table from:
  - scraped UNT banks (ymnik.kz primarily, plus testent.ru variants)
  - LLM-generated grounded questions synthesized from `textbook_chunks`

For the chat/practice UI to query usefully we need:
  * `subject` — canonical UNT subject name for filtering
  * `grade` — 7..11 where known, NULL for bank-style unmarked items
  * `language` — 'ru' | 'kz' | 'en' (ymnik.kz serves both, our bank is ru-dominant)
  * `source` — 'curated' | 'ymnik' | 'testent' | 'generated' | other
  * `source_url` — for citation / attribution
  * `content_hash` — SHA256 of normalized question_text for idempotent
    upsert and near-dedup signal (UNIQUE)
  * `created_at` — timestamp so we can see ingest timeline

Also adding helpful indexes:
  * `ix_mock_questions_subject`
  * `ix_mock_questions_language`
  * `ix_mock_questions_source`
  * unique on `content_hash`

All adds use `IF NOT EXISTS` so applying on top of partial prior state
is safe.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s23b_mock_questions_fill_columns"
down_revision: Union[str, Sequence[str], None] = "s23_onboarding_profile_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
ALTER TABLE mock_questions
    ADD COLUMN IF NOT EXISTS subject VARCHAR(64),
    ADD COLUMN IF NOT EXISTS grade INTEGER,
    ADD COLUMN IF NOT EXISTS language VARCHAR(8) DEFAULT 'ru',
    ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'curated',
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_questions_content_hash
    ON mock_questions(content_hash)
 WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_mock_questions_subject
    ON mock_questions(subject);
CREATE INDEX IF NOT EXISTS ix_mock_questions_language
    ON mock_questions(language);
CREATE INDEX IF NOT EXISTS ix_mock_questions_source
    ON mock_questions(source);
"""

DOWNGRADE_SQL = """
DROP INDEX IF EXISTS ix_mock_questions_source;
DROP INDEX IF EXISTS ix_mock_questions_language;
DROP INDEX IF EXISTS ix_mock_questions_subject;
DROP INDEX IF EXISTS uq_mock_questions_content_hash;

ALTER TABLE mock_questions
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS content_hash,
    DROP COLUMN IF EXISTS source_url,
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS language,
    DROP COLUMN IF EXISTS grade,
    DROP COLUMN IF EXISTS subject;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
