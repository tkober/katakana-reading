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
    }


@router.post("/reset")
def reset(body: ResetIn, conn: sqlite3.Connection = Depends(get_db)) -> dict[str, str]:
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail='confirmation must be "RESET"')
    db.reset_all(conn)
    return {"status": "reset"}
