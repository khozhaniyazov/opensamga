"""Add composite indexes for high-traffic query patterns (SCALE-02)

Revision ID: scale02_composite_indexes
Revises: 3c3bc4460109
Create Date: 2026-04-06
"""

from alembic import op

# revision identifiers
revision = "scale02_composite_indexes"
down_revision = "3c3bc4460109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    # Use autocommit_block() to execute outside the migration transaction.
    with op.get_context().autocommit_block():
        # MistakeReview: /mistakes/trends, /mistakes/list
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_mistake_reviews_user_created "
            "ON mistake_reviews (user_id, created_at DESC)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_mistake_reviews_user_resolved "
            "ON mistake_reviews (user_id, is_resolved)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_mistake_reviews_user_topic "
            "ON mistake_reviews (user_id, topic_tag) WHERE topic_tag IS NOT NULL"
        )

        # ChatMessage: /chat/history
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_messages_user_created "
            "ON chat_messages (user_id, created_at DESC)"
        )

        # ExamAttempt: /exam/attempts, /exam/analytics
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_exam_attempts_user_submitted "
            "ON exam_attempts (user_id, submitted_at DESC)"
        )

        # ActivityLog: /social/feed
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_activity_logs_user_created "
            "ON activity_logs (user_id, created_at DESC)"
        )


def downgrade() -> None:
    op.drop_index("ix_activity_logs_user_created", table_name="activity_logs")
    op.drop_index("ix_exam_attempts_user_submitted", table_name="exam_attempts")
    op.drop_index("ix_chat_messages_user_created", table_name="chat_messages")
    op.drop_index("ix_mistake_reviews_user_topic", table_name="mistake_reviews")
    op.drop_index("ix_mistake_reviews_user_resolved", table_name="mistake_reviews")
    op.drop_index("ix_mistake_reviews_user_created", table_name="mistake_reviews")
