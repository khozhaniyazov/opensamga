"""Session 17 — rag_query_with_feedback view

Revision ID: s17_rag_log_feedback_view
Revises: s16_commuter_and_match_requests
Create Date: 2026-04-21

Read-only convenience view joining rag_query_log with chat_feedback so
ops can `SELECT * FROM rag_query_with_feedback WHERE rating = -1
ORDER BY created_at DESC LIMIT 50` to see what users thumbs-downed.

The view exposes only the aggregation columns + a feedback label; it
does NOT exfiltrate free-text comments (ops can query chat_feedback
directly if they need those). The raw query text stays in
rag_query_log; this view never projects it so downstream dashboards
can safely leak it.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s17_rag_log_feedback_view"
down_revision: Union[str, Sequence[str], None] = "s16_commuter_and_match_requests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UP_SQL = """
CREATE OR REPLACE VIEW rag_query_with_feedback AS
SELECT
    q.id                          AS rag_query_log_id,
    q.created_at,
    q.user_id,
    q.subject,
    q.grade,
    q.preferred_grade,
    q.n_candidates,
    q.n_returned,
    q.rerank_on,
    q.rerank_used,
    q.top1_book_id,
    q.top1_page,
    q.top1_score,
    q.top1_subject,
    q.top1_grade,
    q.embedding_latency_ms,
    q.search_latency_ms,
    q.rerank_latency_ms,
    q.total_latency_ms,
    q.error,
    f.rating                      AS feedback_rating,
    f.message_id                  AS feedback_message_id,
    f.created_at                  AS feedback_at
FROM rag_query_log q
LEFT JOIN LATERAL (
    SELECT rating, message_id, created_at
    FROM chat_feedback cf
    WHERE cf.rag_query_log_id = q.id
    ORDER BY cf.id DESC
    LIMIT 1
) f ON TRUE;
"""

DOWN_SQL = "DROP VIEW IF EXISTS rag_query_with_feedback;"


def upgrade() -> None:
    op.execute(UP_SQL)


def downgrade() -> None:
    op.execute(DOWN_SQL)
