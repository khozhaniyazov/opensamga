"""Session 16 — commuter mode + study match requests

Revision ID: s16_commuter_and_match_requests
Revises: s15_rag_observability
Create Date: 2026-04-21

Consolidates the commuter-mode and match-requests bare-SQL DDL that
previously lived as one-off scripts. Idempotent (CREATE TABLE/INDEX/
ALTER ... IF NOT EXISTS) so this is safe to run against databases
where the one-offs already applied.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s16_commuter_and_match_requests"
down_revision: Union[str, Sequence[str], None] = "s15_rag_observability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
-- Commuter mode: audio fields on textbook_chunks
ALTER TABLE textbook_chunks
    ADD COLUMN IF NOT EXISTS audio_file_path VARCHAR NULL;
ALTER TABLE textbook_chunks
    ADD COLUMN IF NOT EXISTS audio_generated_at TIMESTAMP WITH TIME ZONE NULL;

-- Commuter mode: playback log
CREATE TABLE IF NOT EXISTS audio_playback_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    mistake_review_id INTEGER REFERENCES mistake_reviews(id) ON DELETE CASCADE,
    segment_index INTEGER DEFAULT 0,
    playback_completed BOOLEAN DEFAULT FALSE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_playback_user_mistake
    ON audio_playback_logs (user_id, mistake_review_id);
CREATE INDEX IF NOT EXISTS ix_audio_playback_logs_user_id
    ON audio_playback_logs (user_id);

-- Study match requests
CREATE TABLE IF NOT EXISTS study_match_requests (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES users(id),
    receiver_id INTEGER REFERENCES users(id),
    match_reason VARCHAR,
    status VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_study_match_requests_receiver
    ON study_match_requests (receiver_id, status);
CREATE INDEX IF NOT EXISTS ix_study_match_requests_sender
    ON study_match_requests (sender_id, created_at);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS study_match_requests;
DROP TABLE IF EXISTS audio_playback_logs;
ALTER TABLE textbook_chunks DROP COLUMN IF EXISTS audio_generated_at;
ALTER TABLE textbook_chunks DROP COLUMN IF EXISTS audio_file_path;
"""


def upgrade() -> None:
    for stmt in [s.strip() for s in UPGRADE_SQL.split(";") if s.strip()]:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in [s.strip() for s in DOWNGRADE_SQL.split(";") if s.strip()]:
        op.execute(stmt)
