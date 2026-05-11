"""Add exam_attempts table

Revision ID: 3c3bc4460109
Revises: 
Create Date: 2026-04-01 16:05:03.063926

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c3bc4460109'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('exam_attempts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('subjects', sa.ARRAY(sa.String()), nullable=False),
    sa.Column('total_questions', sa.Integer(), nullable=False),
    sa.Column('time_limit_seconds', sa.Integer(), nullable=False),
    sa.Column('score', sa.Integer(), nullable=False),
    sa.Column('max_score', sa.Integer(), nullable=False),
    sa.Column('answers', sa.JSON(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('time_taken_seconds', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_exam_attempts_id'), 'exam_attempts', ['id'], unique=False)
    op.create_index(op.f('ix_exam_attempts_user_id'), 'exam_attempts', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_exam_attempts_user_id'), table_name='exam_attempts')
    op.drop_index(op.f('ix_exam_attempts_id'), table_name='exam_attempts')
    op.drop_table('exam_attempts')
