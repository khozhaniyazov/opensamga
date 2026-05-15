import sys
from logging.config import fileConfig
from pathlib import Path

from alembic.script import ScriptDirectory
from sqlalchemy import engine_from_config, inspect, pool, text

from alembic import context

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.models  # noqa: F401  # register model tables on Base.metadata
from app.config import settings
from app.database import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Set database URL from settings
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("+asyncpg", ""))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def _is_empty_database(connection) -> bool:
    """Return true only for a fresh database with no app tables."""
    table_names = set(inspect(connection).get_table_names(schema="public"))
    return not (table_names - {"alembic_version"})


def _stamp_current_heads(connection) -> None:
    """Create Alembic's version table and stamp every current head."""
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS alembic_version "
            "(version_num VARCHAR(64) NOT NULL PRIMARY KEY)"
        )
    )
    connection.execute(
        text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")
    )
    connection.execute(text("DELETE FROM alembic_version"))
    for head in heads:
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:head)"),
            {"head": head},
        )


def _create_non_model_artifacts(connection) -> None:
    """Create views, raw-SQL tables, and indexes not represented in models."""
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS rag_query_log (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
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
            )
            """
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_rag_query_log_created_at ON rag_query_log (created_at)")
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_rag_query_log_user_id ON rag_query_log (user_id, created_at)"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_rag_query_log_subject ON rag_query_log (subject, created_at)"
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS chat_feedback (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
                message_id TEXT NOT NULL,
                rating SMALLINT NOT NULL,
                comment TEXT NULL,
                rag_query_log_id BIGINT NULL REFERENCES rag_query_log(id) ON DELETE SET NULL,
                CONSTRAINT chat_feedback_rating_range CHECK (rating IN (-1, 0, 1))
            )
            """
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_chat_feedback_message_id ON chat_feedback (message_id)")
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_chat_feedback_user_created "
            "ON chat_feedback (user_id, created_at)"
        )
    )
    connection.execute(
        text(
            """
            CREATE OR REPLACE VIEW rag_query_with_feedback AS
            SELECT
                q.id AS rag_query_log_id,
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
                f.rating AS feedback_rating,
                f.message_id AS feedback_message_id,
                f.created_at AS feedback_at
            FROM rag_query_log q
            LEFT JOIN LATERAL (
                SELECT rating, message_id, created_at
                FROM chat_feedback cf
                WHERE cf.rag_query_log_id = q.id
                ORDER BY cf.id DESC
                LIMIT 1
            ) f ON TRUE
            """
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_textbook_chunks_embedding_hnsw_cos "
            "ON textbook_chunks USING hnsw "
            "(chunk_embedding vector_cosine_ops) "
            "WITH (m = 16, ef_construction = 64)"
        )
    )


def _bootstrap_empty_database(connection) -> bool:
    """Materialize the current schema for fresh deploys.

    The historical migration chain contains pre-baseline revisions that assume
    tables formerly created by ``Base.metadata.create_all`` in app startup.
    Editing those shipped revisions would be unsafe for existing databases, but
    a fresh public deployment still needs ``alembic upgrade head`` to succeed.

    On a truly empty database, create the current SQLAlchemy schema once and
    stamp the current Alembic head. Non-empty databases continue through the
    normal migration path so drift is still managed by Alembic.
    """
    if not _is_empty_database(connection):
        return False
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    target_metadata.create_all(bind=connection)
    _create_non_model_artifacts(connection)
    _stamp_current_heads(connection)
    connection.commit()
    return True


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        if _bootstrap_empty_database(connection):
            return

        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
