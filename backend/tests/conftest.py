"""Shared fixtures: every DB test runs against a real Postgres.

A session-scoped throwaway container backs the whole suite (or ``TEST_DB_URL``,
if you'd rather point at your own database); each test starts from an empty
schema, which ``db.init_db()`` then creates from the ORM metadata.

Both roles are the same superuser here — the owner/app privilege split is a
deployment concern and is exercised by the compose stack, not by the tests.
"""

import asyncio
import os

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.community.postgres import PostgresContainer

from app import config, db


@pytest.fixture(scope="session")
def pg_url():
    raw = os.environ.get("TEST_DB_URL")
    if raw:
        yield make_url(raw)
        return
    with PostgresContainer("postgres:17-alpine") as pg:
        yield make_url(pg.get_connection_url())


@pytest.fixture
def db_schema(pg_url, monkeypatch):
    """Point the app at the test database and wipe whatever the last test left."""
    monkeypatch.setenv(
        "DB_URL", f"postgresql://{pg_url.host}:{pg_url.port}/{pg_url.database}"
    )
    monkeypatch.setenv("DB_USER", pg_url.username or "")
    monkeypatch.setenv("DB_PASSWORD", pg_url.password or "")
    monkeypatch.setenv("DB_OWNER_USER", pg_url.username or "")
    monkeypatch.setenv("DB_OWNER_PASSWORD", pg_url.password or "")
    asyncio.run(_drop_all())
    yield


@pytest.fixture
async def session(db_schema):
    """App-role session for the current test.

    The engine is disposed here rather than in a sync teardown: asyncpg
    connections belong to the event loop that opened them, and this fixture
    shares the test's loop.
    """
    async with db.get_sessionmaker()() as s:
        yield s
    await db.reset_engines()


async def _drop_all() -> None:
    engine = create_async_engine(config.owner_database_url())
    try:
        async with engine.begin() as conn:
            await conn.run_sync(db.Base.metadata.drop_all)
    finally:
        await engine.dispose()
