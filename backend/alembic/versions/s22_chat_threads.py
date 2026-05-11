"""Session 22 (BUG-S22-sidebar) — chat_threads table + chat_messages.thread_id

Revision ID: s22_chat_threads
Revises: s18_textbook_chunks_hnsw
Create Date: 2026-04-22

Why
---
Up until session 22 the chat UI was a single, never-ending scroll of
ALL of a user's turns. No way to start a fresh conversation without
`DELETE /api/chat/history`, which nuked all context forever. Boss-grade
product miss: ChatGPT / Claude / Gemini all ship a left-rail thread
list with a "New chat" button by year-one.

This migration adds the storage layer:
  - `chat_threads(id, user_id, title, created_at, updated_at)`
  - `chat_messages.thread_id` (nullable FK to chat_threads, CASCADE)
  - Supporting indexes for (user_id, updated_at DESC) on threads and
    (thread_id, created_at ASC) on messages.

Idempotent (IF NOT EXISTS / IF EXISTS guards on raw SQL) so repeated
runs against a DB where this already applied are safe.

NULL-thread pre-existing rows are treated by the FE as the legacy
"Main chat" bucket — no backfill runs here.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s22_chat_threads"
down_revision: Union[str, Sequence[str], None] = "s18_textbook_chunks_hnsw"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS chat_threads (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_chat_threads_user_id ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS ix_chat_threads_user_updated
    ON chat_threads(user_id, updated_at DESC);

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS thread_id INTEGER NULL
        REFERENCES chat_threads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_chat_messages_thread_id
    ON chat_messages(thread_id);
CREATE INDEX IF NOT EXISTS ix_chat_messages_thread_created
    ON chat_messages(thread_id, created_at ASC);
"""

DOWNGRADE_SQL = """
DROP INDEX IF EXISTS ix_chat_messages_thread_created;
DROP INDEX IF EXISTS ix_chat_messages_thread_id;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS thread_id;
DROP INDEX IF EXISTS ix_chat_threads_user_updated;
DROP INDEX IF EXISTS ix_chat_threads_user_id;
DROP TABLE IF EXISTS chat_threads;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
