"""HTTP API. All endpoints operate on the single global user."""

from __future__ import annotations

import sqlite3
from typing import Any, Iterator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, game
from .kana import tokenize

router = APIRouter(prefix="/api")


def get_db() -> Iterator[sqlite3.Connection]:
    conn = db.get_conn()
    try:
        yield conn
    finally:
        conn.close()


class AnswerIn(BaseModel):
    word_id: int
    answer: str = Field(max_length=200)
    time_ms: int = Field(ge=0)


class ResetIn(BaseModel):
    confirm: str


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/word/next")
def next_word(conn: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    word = game.pick_next_word(conn)
    user = game.get_user(conn)
    return {
        "word_id": word["id"],
        "katakana": word["katakana"],
        "level": word["level"],
        "kana_count": len(tokenize(word["katakana"])),
        "target_time_ms": game.target_time_ms(len(tokenize(word["katakana"]))),
        "user_level": game.level_for_elo(user["elo"]),
        "elo": round(user["elo"], 1),
    }


@router.post("/answer")
def answer(body: AnswerIn, conn: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    try:
        return game.submit_answer(conn, body.word_id, body.answer, body.time_ms)
    except KeyError:
        raise HTTPException(status_code=404, detail="word not found")


@router.get("/stats")
def stats(conn: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    user = game.get_user(conn)
    totals = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM attempts"
    ).fetchone()
    timing = conn.execute(
        """
        SELECT COALESCE(AVG(time_ms), 0) AS avg_word,
               COALESCE(SUM(time_ms) * 1.0 / NULLIF(SUM(kana_total), 0), 0) AS avg_kana
        FROM (SELECT time_ms, kana_total FROM attempts ORDER BY id DESC LIMIT 100)
        """
    ).fetchone()
    kana_rows = [
        {
            "kana": r["kana"],
            "attempts": r["attempts"],
            "correct": r["correct"],
            "accuracy": round(r["correct"] / r["attempts"], 3) if r["attempts"] else None,
            "ewma": round(r["ewma"], 3),
        }
        for r in conn.execute("SELECT * FROM kana_stats ORDER BY kana")
    ]
    recent = [
        {
            "katakana": r["katakana"],
            "romaji": r["romaji"],
            "answer": r["answer"],
            "correct": bool(r["correct"]),
            "kana_total": r["kana_total"],
            "kana_correct": r["kana_correct"],
            "time_ms": r["time_ms"],
            "elo_delta": round(r["elo_after"] - r["elo_before"], 1),
            "created_at": r["created_at"],
        }
        for r in conn.execute(
            """
            SELECT a.*, w.katakana, w.romaji FROM attempts a
            JOIN words w ON w.id = a.word_id
            ORDER BY a.id DESC LIMIT 12
            """
        )
    ]
    elo_history = [
        round(r["elo_after"], 1)
        for r in conn.execute(
            "SELECT elo_after FROM (SELECT id, elo_after FROM attempts "
            "ORDER BY id DESC LIMIT 60) ORDER BY id"
        )
    ]

    def coverage(group_col: str) -> list[dict[str, Any]]:
        return [
            {
                "key": str(r["k"]),
                "total": r["total"],
                "seen": r["seen"],
                "served": r["served"],
                "correct": r["correct"],
                "success": round(r["correct"] / r["served"], 3) if r["served"] else None,
            }
            for r in conn.execute(
                f"""
                SELECT {group_col} AS k,
                       COUNT(*) AS total,
                       SUM(CASE WHEN times_served > 0 THEN 1 ELSE 0 END) AS seen,
                       COALESCE(SUM(times_served), 0) AS served,
                       COALESCE(SUM(times_correct), 0) AS correct
                FROM words GROUP BY {group_col} ORDER BY {group_col}
                """
            )
        ]

    return {
        "elo": round(user["elo"], 1),
        "level": game.level_for_elo(user["elo"]),
        "level_progress": round(game.level_progress(user["elo"]), 3),
        "max_level": game.MAX_LEVEL,
        "current_streak": user["current_streak"],
        "best_streak": user["best_streak"],
        "total_attempts": totals["n"],
        "correct_attempts": totals["c"],
        "accuracy": round(totals["c"] / totals["n"], 3) if totals["n"] else None,
        "avg_time_ms": round(timing["avg_word"]),
        "avg_time_per_kana_ms": round(timing["avg_kana"]),
        "kana": kana_rows,
        "recent": recent,
        "elo_history": elo_history,
        "coverage": {
            "levels": coverage("level"),
            "sources": coverage("source"),
        },
    }


@router.get("/dictionaries")
def dictionaries(conn: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    """Composition of each vocabulary file: size, level mix, word length,
    rating span and how much of it has been practiced."""
    rows = conn.execute(
        "SELECT katakana, source, level, rating, times_served, times_correct FROM words"
    ).fetchall()

    buckets: dict[str, list[sqlite3.Row]] = {}
    for r in rows:
        buckets.setdefault(r["source"], []).append(r)

    def summarize(name: str, items: list[sqlite3.Row]) -> dict[str, Any]:
        kana_counts = [len(tokenize(r["katakana"])) for r in items]
        served = sum(r["times_served"] for r in items)
        correct = sum(r["times_correct"] for r in items)
        seen = sum(1 for r in items if r["times_served"] > 0)
        by_level = {lvl: 0 for lvl in range(1, 6)}
        for r in items:
            by_level[r["level"]] = by_level.get(r["level"], 0) + 1
        return {
            "source": name,
            "total": len(items),
            "seen": seen,
            "served": served,
            "correct": correct,
            "success": round(correct / served, 3) if served else None,
            "levels": [
                {"level": lvl, "count": n} for lvl, n in sorted(by_level.items())
            ],
            "avg_kana": round(sum(kana_counts) / len(kana_counts), 1) if kana_counts else 0,
            "min_kana": min(kana_counts, default=0),
            "max_kana": max(kana_counts, default=0),
            "rating_min": round(min((r["rating"] for r in items), default=0)),
            "rating_max": round(max((r["rating"] for r in items), default=0)),
        }

    dicts = [summarize(name, items) for name, items in sorted(buckets.items())]
    return {
        "dictionaries": dicts,
        "all": summarize("all", rows) if rows else None,
    }


@router.get("/words")
def words(
    source: str | None = None,
    level: int | None = None,
    q: str | None = None,
    sort: str = "level",
    limit: int = 100,
    offset: int = 0,
    conn: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Browsable word list with filters — for inspecting a dictionary."""
    where: list[str] = []
    params: list[Any] = []
    if source:
        where.append("source = ?")
        params.append(source)
    if level is not None:
        where.append("level = ?")
        params.append(level)
    if q:
        where.append("(katakana LIKE ? OR romaji LIKE ? OR meaning LIKE ?)")
        params += [f"%{q}%"] * 3
    clause = f"WHERE {' AND '.join(where)}" if where else ""

    order = {
        "level": "level ASC, rating ASC, katakana ASC",
        "rating": "rating DESC, katakana ASC",
        "served": "times_served DESC, katakana ASC",
        "alpha": "katakana ASC",
    }.get(sort, "level ASC, rating ASC, katakana ASC")

    total = conn.execute(f"SELECT COUNT(*) FROM words {clause}", params).fetchone()[0]
    limit = max(1, min(limit, 500))
    rows = conn.execute(
        f"""
        SELECT katakana, romaji, meaning, level, source, rating,
               times_served, times_correct
        FROM words {clause} ORDER BY {order} LIMIT ? OFFSET ?
        """,
        [*params, limit, max(0, offset)],
    ).fetchall()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "words": [
            {
                "katakana": r["katakana"],
                "romaji": r["romaji"],
                "meaning": r["meaning"],
                "level": r["level"],
                "source": r["source"],
                "rating": round(r["rating"]),
                "times_served": r["times_served"],
                "times_correct": r["times_correct"],
                "kana_count": len(tokenize(r["katakana"])),
            }
            for r in rows
        ],
    }


@router.post("/reset")
def reset(body: ResetIn, conn: sqlite3.Connection = Depends(get_db)) -> dict[str, str]:
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail='confirmation must be "RESET"')
    db.reset_all(conn)
    return {"status": "reset"}
