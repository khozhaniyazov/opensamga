"""Session 18 — HNSW index on textbook_chunks.chunk_embedding (cosine)

Revision ID: s18_textbook_chunks_hnsw
Revises: s17_rag_log_feedback_view
Create Date: 2026-04-21

Session-19 operational note: this migration is being introduced as
s18_ because it was discovered during the session-19 post-OCR-bugfix
performance audit but belongs to the s18 hardening pass.

Background
----------
At 10,647 chunks, `ORDER BY chunk_embedding <=> :v LIMIT K` planned to
a Seq Scan + sort (85–300 ms on local hardware, 1–2 s under load).
Retrieval is the hot path, fires on every chat turn, so we want
sub-10 ms per vector probe even as the corpus scales into the 100k
chunk range.

With an HNSW index (m=16, ef_construction=64) the same query plans as
`Index Scan using ix_textbook_chunks_embedding_hnsw_cos` and completes
in ~2.7 ms on the same corpus. `hnsw.ef_search` defaults to 40 and can
be tuned per-session at retrieval time.

Upgrade uses `CREATE INDEX CONCURRENTLY` (autocommit block) so we can
apply this to a production database without blocking ingest.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s18_textbook_chunks_hnsw"
down_revision: Union[str, Sequence[str], None] = "s17_rag_log_feedback_view"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "ix_textbook_chunks_embedding_hnsw_cos"


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX_NAME} "
            f"ON textbook_chunks USING hnsw "
            f"(chunk_embedding vector_cosine_ops) "
            f"WITH (m = 16, ef_construction = 64)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX_NAME}")
