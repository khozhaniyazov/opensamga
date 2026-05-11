import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ["TESTING"] = "true"

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.database import Base
from app.models import ChatMessage, LanguagePreference, StudentProfile, User

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/unt_advisor_test"
)


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create test database engine."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(scope="session")
async def _ensure_schema(test_engine):
    """Materialize the SQLAlchemy schema once per test session.

    v3.7 (2026-04-29) intentionally removed `Base.metadata.create_all`
    from `app.main.lifespan` — schema management is the deploy
    operator's job (`alembic stamp v37_merge_heads` then `alembic
    upgrade head`). That invariant is pinned by
    `test_v37_alembic_baseline.py` and applies to **application
    runtime only**.

    The integration CI lane spins up a fresh Postgres container
    (with the `vector` extension already enabled by the workflow
    before pytest starts) every run. Without something on the
    test side to bring up the schema, every fixture that does an
    INSERT trips `UndefinedTableError "users"`.

    `alembic upgrade head` is not a viable option here because
    `s22d_drop_dead_tables` references three legacy tables
    (`langchain_pg_embedding`, `langchain_pg_collection`,
    `student_profile`) that have never existed on a fresh test
    DB — see CHANGELOG v3.7 "Fresh deploys: `alembic upgrade
    head` will fail at `s22d_drop_dead_tables`". The historical
    ordering only resolves cleanly via `alembic stamp head`,
    which is operationally identical to `create_all` for an
    empty database (both leave Alembic ignorant of the present
    state) — so we just call `create_all` directly here.

    Wired as a dependency of `async_db_session` rather than
    autouse-session, so no-DB suites that don't request a DB
    session never spin up `test_engine` (lazy) and never try
    to connect to Postgres. The session scope still guarantees
    the schema is materialized exactly once across an
    integration-lane run.
    """
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest_asyncio.fixture
async def async_db_session(test_engine, _ensure_schema):
    """Yields AsyncSession for test database operations."""
    async_session = async_sessionmaker(
        bind=test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def test_user(async_db_session: AsyncSession):
    """Creates and returns a User instance with StudentProfile.

    Each invocation generates a unique email + username so the
    fixture can be requested by multiple tests within the same
    session without colliding on the `ix_users_email` /
    `ix_users_username` unique constraints.

    Lane bug #2 from the chore(ci) baseline post-mortem (memory:
    project_session_2026-04-30_v319_chore_ci_baseline.md): the
    integration-pgvector lane shares a Postgres container across
    all tests in the run, and the previous hardcoded
    `test@example.com` / `testuser` collided across tests that
    each issued their own INSERT. Per-test rollback alone wasn't
    enough because `test_user` itself commits.
    """
    suffix = uuid.uuid4().hex[:8]
    user = User(
        email=f"test-{suffix}@example.com",
        username=f"testuser-{suffix}",
        full_name="Test User",
        language_preference=LanguagePreference.EN,
    )
    async_db_session.add(user)
    await async_db_session.flush()

    profile = StudentProfile(
        user_id=user.id,
        current_grade=11,
        chosen_subjects=["Math", "Physics"],
        target_majors=["Computer Science"],
        target_universities=[1, 2],
    )
    async_db_session.add(profile)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_chat_history(async_db_session: AsyncSession, test_user: User):
    """Creates sample ChatMessage records for history tests."""
    messages = [
        ChatMessage(user_id=test_user.id, role="user", content="Hello"),
        ChatMessage(user_id=test_user.id, role="assistant", content="Hi there!"),
        ChatMessage(
            user_id=test_user.id, role="user", content="What universities should I consider?"
        ),
    ]
    for msg in messages:
        async_db_session.add(msg)
    await async_db_session.commit()
    return messages
