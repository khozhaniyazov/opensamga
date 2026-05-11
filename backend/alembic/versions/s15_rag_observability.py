"""Session 15 — RAG observability tables

Revision ID: s15_rag_observability
Revises: 3c3bc4460109
Create Date: 2026-04-21

Creates `rag_query_log` + `chat_feedback`. Kept idempotent so it can
run on a database where a previous one-off script already created the
tables.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s15_rag_observability"
down_revision: Union[str, Sequence[str], None] = "3c3bc4460109"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS rag_query_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    user_id INTEGER NULL,
    query TEXT NOT NULL,
    query_len INTEGER NOT NULL,
    subject TEXT NULL,
    grade INTEGER NULL,
    preferred_grade INTEGER NULL,
    subject_inferred TEXT NULL,
    n_candidates INTEGER NOT NULL DEFAULT 0,
    n_returned INTEGER NOT NULL DEFAULT 0,
    rerank_on BOOLEAN NOT NULL DEFAULT FALSE,
    rerank_used BOOLEAN NOT NULL DEFAULT FALSE,
    top1_book_id INTEGER NULL,
    top1_page INTEGER NULL,
    top1_score DOUBLE PRECISION NULL,
    top1_subject TEXT NULL,
    top1_grade INTEGER NULL,
    embedding_latency_ms INTEGER NULL,
    search_latency_ms INTEGER NULL,
    rerank_latency_ms INTEGER NULL,
    total_latency_ms INTEGER NULL,
    error TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_rag_query_log_created_at
    ON rag_query_log (created_at);
CREATE INDEX IF NOT EXISTS ix_rag_query_log_user_id
    ON rag_query_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_rag_query_log_subject
    ON rag_query_log (subject, created_at);

CREATE TABLE IF NOT EXISTS chat_feedback (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    user_id INTEGER NULL,
    message_id TEXT NOT NULL,
    rating SMALLINT NOT NULL,
    comment TEXT NULL,
    rag_query_log_id BIGINT NULL REFERENCES rag_query_log(id) ON DELETE SET NULL,
    CONSTRAINT chat_feedback_rating_range CHECK (rating IN (-1, 0, 1))
);

CREATE INDEX IF NOT EXISTS ix_chat_feedback_message_id
    ON chat_feedback (message_id);
CREATE INDEX IF NOT EXISTS ix_chat_feedback_user_created
    ON chat_feedback (user_id, created_at);
"""

DROP_SQL = """
DROP TABLE IF EXISTS chat_feedback;
DROP TABLE IF EXISTS rag_query_log;
"""


def upgrade() -> None:
    for stmt in [s.strip() for s in CREATE_SQL.split(";") if s.strip()]:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in [s.strip() for s in DROP_SQL.split(";") if s.strip()]:
        op.execute(stmt)
