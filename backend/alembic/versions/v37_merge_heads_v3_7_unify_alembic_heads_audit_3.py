"""v3.7 unify alembic heads (audit #3)

Revision ID: v37_merge_heads
Revises: scale02_composite_indexes, d2c3606882dd, s22d_drop_dead_tables, s26p7_competition_quota
Create Date: 2026-04-30 10:17:10.694011

This is a no-op merge migration. Background:

The Alembic graph had four parallel heads
(`scale02_composite_indexes`, `d2c3606882dd`,
`s22d_drop_dead_tables`, `s26p7_competition_quota`) — a side
effect of `app.main.lifespan` running `Base.metadata.create_all`
on every startup, which masked the missing migrations.

Audit finding #3 (2026-04-29) called this out as a latent bomb:
adding `Column(nullable=False)` to a model without a real
migration meant `create_all` would silently skip existing tables
and trigger runtime INSERT errors. The schema was being kept in
sync by `create_all`, not by Alembic.

v3.7 closes the bomb in three steps:

  1. This merge revision unifies the four heads so
     `alembic upgrade head` resolves to a single point.
  2. `alembic stamp head` is the operator's first step on any
     existing DB (see the project README).
  3. `app.main.lifespan` no longer calls `create_all`. From
     here on, schema changes MUST go through a real Alembic
     revision.

The migration is intentionally `pass` — at the moment we merge,
the four heads are already in sync at the table level (every
production DB observed has them all applied via `create_all`).
If anyone is on an older DB they'll still need to apply the
intermediate revisions before stamping head; this merge does NOT
backfill anything.
"""

from typing import Union
from collections.abc import Sequence


# revision identifiers, used by Alembic.
revision: str = "v37_merge_heads"
down_revision: str | Sequence[str] | None = (
    "scale02_composite_indexes",
    "d2c3606882dd",
    "s22d_drop_dead_tables",
    "s26p7_competition_quota",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op: this is a merge revision unifying four parallel heads."""


def downgrade() -> None:
    """No-op: nothing to undo on a merge."""
