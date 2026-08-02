"""PostgreSQL persistence: ORM models, engines and vocabulary seeding.

Single global user, so ``user_profile`` holds exactly one row (id = 1).

Two roles are used (see :mod:`app.config`): the *owner* role runs DDL and the
startup seeding, the *app* role serves every request. The app role's access to
the owner-created tables comes from server-side ``ALTER DEFAULT PRIVILEGES``
(see ``dbeaver/grant_privileges.sql``), so no GRANT is issued from here.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterable, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    delete,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import app_database_url, owner_database_url
from .kana import to_romaji, tokenize
from .words import WordEntry, load_words, validate_entries

log = logging.getLogger(__name__)

START_ELO = 1000.0
UPSERT_CHUNK = 500  # rows per INSERT ... ON CONFLICT (keeps the bind count sane)


class Base(DeclarativeBase):
    pass


class UserProfile(Base):
    __tablename__ = "user_profile"
    __table_args__ = (CheckConstraint("id = 1", name="user_profile_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    elo: Mapped[float] = mapped_column(Float, nullable=False)
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Word(Base):
    __tablename__ = "words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    katakana: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    romaji: Mapped[str] = mapped_column(String, nullable=False)
    meaning: Mapped[str] = mapped_column(String, nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False, server_default="basic")
    rating: Mapped[float] = mapped_column(Float, nullable=False)
    base_rating: Mapped[float] = mapped_column(Float, nullable=False)
    times_served: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    times_correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (Index("idx_attempts_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    word_id: Mapped[int] = mapped_column(ForeignKey("words.id"), nullable=False)
    answer: Mapped[str] = mapped_column(String, nullable=False)
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    kana_total: Mapped[int] = mapped_column(Integer, nullable=False)
    kana_correct: Mapped[int] = mapped_column(Integer, nullable=False)
    time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    elo_before: Mapped[float] = mapped_column(Float, nullable=False)
    elo_after: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class KanaStat(Base):
    """One row per *token* (キャ is its own key, not キ + ャ)."""

    __tablename__ = "kana_stats"

    kana: Mapped[str] = mapped_column(String, primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ewma: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Dictionary(Base):
    """A vocabulary list uploaded through the UI.

    The image only ships the git-tracked ``basic`` file, so private vocabulary
    lives here instead: the raw (validated) JSON is kept verbatim, and every
    seeding run merges it on top of the file dictionaries. File-based sources
    have no row here — that absence is what marks a dictionary as "file".
    """

    __tablename__ = "dictionaries"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    entries: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


# --- engines ---------------------------------------------------------------

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """The request-time engine (app role), created on first use."""
    global _engine, _sessionmaker
    if _engine is None:
        _engine = create_async_engine(app_database_url(), future=True)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def reset_engines() -> None:
    """Drop the cached engine so the next use re-reads the configuration.

    Production never needs this; the tests do, because they point the process
    at a throwaway database between cases.
    """
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one app-role session per request."""
    async with get_sessionmaker()() as session:
        yield session


# --- schema + seeding ------------------------------------------------------


def base_rating_for(katakana: str, level: int) -> float:
    """Anchor rating by level, nudged by word length."""
    n_tokens = len(tokenize(katakana))
    nudge = max(-80, min(80, (n_tokens - 5) * 20))
    return 750.0 + (level - 1) * 250.0 + nudge


async def init_db() -> None:
    """Create the schema and refresh the vocabulary (run on startup).

    DDL requires the owner role, so this opens a short-lived owner connection.
    Seeding rides along on it: it is maintenance, not request work.
    """
    owner_engine = create_async_engine(owner_database_url(), future=True)
    try:
        async with owner_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(owner_engine, expire_on_commit=False)() as session:
            await ensure_profile(session)
            await seed_words(session)
            await session.commit()
    finally:
        await owner_engine.dispose()


async def ensure_profile(session: AsyncSession) -> None:
    await session.execute(
        insert(UserProfile)
        .values(id=1, elo=START_ELO)
        .on_conflict_do_nothing(index_elements=[UserProfile.id])
    )


async def desired_words(session: AsyncSession) -> list[WordEntry]:
    """The vocabulary the database should hold: files first, uploads on top.

    A stored upload is re-validated here rather than trusted: entries that no
    longer parse are skipped with a log line, so one bad row cannot stop the
    app from booting.
    """
    merged = {w.katakana: w for w in load_words()}
    rows = (
        await session.execute(select(Dictionary).order_by(Dictionary.name))
    ).scalars()
    for row in rows:
        entries, errors = validate_entries(row.entries, row.name)
        if errors:
            log.warning(
                "dictionary %r: skipping %d invalid entr%s (%s)",
                row.name, len(errors), "y" if len(errors) == 1 else "ies",
                "; ".join(errors[:3]),
            )
        for entry in entries:
            merged[entry.katakana] = entry
    return list(merged.values())


async def seed_words(session: AsyncSession) -> None:
    """Insert new words, refresh the metadata of existing ones (keeping their
    calibrated rating) and drop the ones that vanished."""
    words = await desired_words(session)
    values = [
        {
            "katakana": w.katakana,
            "romaji": to_romaji(w.katakana),  # generated, never hand-maintained
            "meaning": w.meaning,
            "level": w.level,
            "source": w.source,
            "rating": base_rating_for(w.katakana, w.level),
            "base_rating": base_rating_for(w.katakana, w.level),
        }
        for w in words
    ]
    for chunk in _chunks(values, UPSERT_CHUNK):
        stmt = insert(Word).values(chunk)
        # On base-rating changes (rebalanced formula, level edits) shift the
        # dynamic rating by the same delta, keeping the learned calibration.
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=[Word.katakana],
                set_={
                    "romaji": stmt.excluded.romaji,
                    "meaning": stmt.excluded.meaning,
                    "level": stmt.excluded.level,
                    "source": stmt.excluded.source,
                    "rating": Word.rating
                    + (stmt.excluded.base_rating - Word.base_rating),
                    "base_rating": stmt.excluded.base_rating,
                },
            )
        )
    await prune_words(session, {w.katakana for w in words})


def _chunks(rows: Sequence[dict[str, Any]], size: int) -> Iterable[Sequence[dict]]:
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


async def prune_words(session: AsyncSession, keep: set[str]) -> int:
    """Remove words that are no longer in any dictionary.

    Words that were already answered stay regardless — ``attempts`` references
    them, and deleting would erase the answer history. Returns the row count.
    """
    result = await session.execute(
        delete(Word).where(
            Word.katakana.notin_(keep),
            Word.id.notin_(select(Attempt.word_id).distinct()),
        )
    )
    return result.rowcount or 0


async def save_dictionary(
    session: AsyncSession, name: str, entries: list[dict[str, Any]]
) -> None:
    """Store (or replace) an uploaded dictionary and fold it into the words."""
    stmt = insert(Dictionary).values(name=name, entries=entries)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[Dictionary.name],
            set_={"entries": stmt.excluded.entries, "uploaded_at": func.now()},
        )
    )
    await seed_words(session)
    await session.commit()


async def delete_dictionary(session: AsyncSession, name: str) -> int:
    """Drop an uploaded dictionary; returns how many of its words went with it.

    Answered words survive (see :func:`prune_words`) — the attempt history is
    worth more than a tidy word list.
    """
    result = await session.execute(delete(Dictionary).where(Dictionary.name == name))
    if not result.rowcount:
        raise KeyError(name)
    before = await session.scalar(
        select(func.count()).select_from(Word).where(Word.source == name)
    )
    await seed_words(session)
    after = await session.scalar(
        select(func.count()).select_from(Word).where(Word.source == name)
    )
    await session.commit()
    return (before or 0) - (after or 0)


async def uploaded_dictionaries(session: AsyncSession) -> dict[str, datetime]:
    """Name -> upload time, for telling uploaded dictionaries from file ones."""
    rows = await session.execute(select(Dictionary.name, Dictionary.uploaded_at))
    return {name: uploaded_at for name, uploaded_at in rows}


async def reset_all(session: AsyncSession) -> None:
    """Wipe all progress: attempts, kana stats, streaks, Elo, word ratings.

    Uploaded dictionaries are vocabulary, not progress — they stay.
    """
    await session.execute(delete(Attempt))
    await session.execute(delete(KanaStat))
    await session.execute(
        update(UserProfile)
        .where(UserProfile.id == 1)
        .values(
            elo=START_ELO, current_streak=0, best_streak=0, updated_at=func.now()
        )
    )
    await session.execute(
        update(Word).values(rating=Word.base_rating, times_served=0, times_correct=0)
    )
    await session.commit()
