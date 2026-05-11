import os
import time

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool

from .config import settings
from .logging_config import get_logger

logger = get_logger("database")

DATABASE_URL = settings.DATABASE_URL

POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "30"))
POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "30"))
POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "1800"))

is_testing = os.getenv("TESTING", "false").lower() == "true"

if is_testing:
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        poolclass=NullPool,
    )
    logger.info("Database engine created (test mode, no pooling)")
else:
    # Connection Pool Configuration (PERF-04)
    # - pool_size=20: Base permanent connections (handles ~20 concurrent requests)
    # - max_overflow=30: Additional temporary connections (total capacity: 50)
    # - pool_timeout=30: Wait 30s for available connection before timeout
    # - pool_recycle=1800: Recycle connections after 30min (prevents stale connections)
    # - pool_pre_ping=True: Health check before use (handles DB restarts gracefully)
    #
    # This configuration supports ~50 concurrent users. Adjust via environment variables:
    # - DB_POOL_SIZE: Base pool size
    # - DB_MAX_OVERFLOW: Additional overflow connections
    # - DB_POOL_TIMEOUT: Connection checkout timeout (seconds)
    # - DB_POOL_RECYCLE: Connection recycle interval (seconds)
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        pool_size=POOL_SIZE,
        max_overflow=MAX_OVERFLOW,
        pool_timeout=POOL_TIMEOUT,
        pool_recycle=POOL_RECYCLE,
        pool_pre_ping=True,
    )
    logger.info(f"Database engine created (pool_size={POOL_SIZE}, max_overflow={MAX_OVERFLOW})")

# Slow query logging (SCALE-02, D-08)
# Logs queries exceeding 100ms threshold for performance monitoring
SLOW_QUERY_THRESHOLD = float(os.getenv("SLOW_QUERY_THRESHOLD", "0.1"))

if not is_testing:

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        context._query_start_time = time.perf_counter()

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        elapsed = time.perf_counter() - context._query_start_time
        if elapsed > SLOW_QUERY_THRESHOLD:
            # Truncate long statements to 500 chars for readability
            stmt_preview = statement[:500].replace("\n", " ")
            logger.warning(
                f"Slow query detected ({elapsed:.3f}s > {SLOW_QUERY_THRESHOLD}s): {stmt_preview}"
            )


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db():

    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            logger.exception("Database session error")
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_db_transaction():

    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            logger.exception("Database transaction error")
            await session.rollback()
            raise
        finally:
            await session.close()
