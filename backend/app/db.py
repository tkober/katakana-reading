"""SQLite persistence. Single global user, everything in one file."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from .kana import to_romaji, tokenize
from .words import WORDS

START_ELO = 1000.0


def db_path() -> str:
    return os.environ.get("DB_PATH", str(Path(__file__).resolve().parent.parent / "data" / "katakana.db"))


def get_conn() -> sqlite3.Connection:
    path = db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    elo REAL NOT NULL,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    katakana TEXT NOT NULL UNIQUE,
    romaji TEXT NOT NULL,
    meaning TEXT NOT NULL,
    level INTEGER NOT NULL,
    rating REAL NOT NULL,
    base_rating REAL NOT NULL,
    times_served INTEGER NOT NULL DEFAULT 0,
    times_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL REFERENCES words(id),
    answer TEXT NOT NULL,
    correct INTEGER NOT NULL,
    kana_total INTEGER NOT NULL,
    kana_correct INTEGER NOT NULL,
    time_ms INTEGER NOT NULL,
    elo_before REAL NOT NULL,
    elo_after REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts(created_at);

CREATE TABLE IF NOT EXISTS kana_stats (
    kana TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    ewma REAL NOT NULL DEFAULT 0.5,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def base_rating_for(katakana: str, level: int) -> float:
    """Anchor rating by level, nudged by word length."""
    n_tokens = len(tokenize(katakana))
    nudge = max(-60, min(60, (n_tokens - 5) * 15))
    return 800.0 + (level - 1) * 200.0 + nudge


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO user_profile (id, elo) VALUES (1, ?)", (START_ELO,)
    )
    seed_words(conn)
    conn.commit()


def seed_words(conn: sqlite3.Connection) -> None:
    """Insert new dictionary words, refresh metadata of existing ones
    (keeps the dynamically calibrated rating)."""
    for katakana, meaning, level in WORDS:
        romaji = to_romaji(katakana)  # raises on invalid kana -> fails fast
        base = base_rating_for(katakana, level)
        conn.execute(
            """
            INSERT INTO words (katakana, romaji, meaning, level, rating, base_rating)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(katakana) DO UPDATE SET
                romaji = excluded.romaji,
                meaning = excluded.meaning,
                level = excluded.level,
                base_rating = excluded.base_rating
            """,
            (katakana, romaji, meaning, level, base, base),
        )


def reset_all(conn: sqlite3.Connection) -> None:
    """Wipe all progress: attempts, kana stats, streaks, Elo, word ratings."""
    conn.execute("DELETE FROM attempts")
    conn.execute("DELETE FROM kana_stats")
    conn.execute(
        "UPDATE user_profile SET elo = ?, current_streak = 0, best_streak = 0, "
        "updated_at = datetime('now') WHERE id = 1",
        (START_ELO,),
    )
    conn.execute(
        "UPDATE words SET rating = base_rating, times_served = 0, times_correct = 0"
    )
    conn.commit()
