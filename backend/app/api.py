"""HTTP API. All endpoints operate on the single global user."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import db, game
from .db import Attempt, KanaStat, Word, get_session
from .kana import tokenize
from .words import TEMPLATE_ENTRIES, file_sources, validate_entries

router = APIRouter(prefix="/api")

NAME_RE = re.compile(r"[^a-z0-9_-]+")


class AnswerIn(BaseModel):
    word_id: int
    answer: str = Field(max_length=200)
    time_ms: int = Field(ge=0)


class ResetIn(BaseModel):
    confirm: str


class TimeBudgetIn(BaseModel):
    time_base_ms: int = Field(
        ge=db.TIME_BASE_RANGE[0], le=db.TIME_BASE_RANGE[1]
    )
    time_per_kana_ms: int = Field(
        ge=db.TIME_PER_KANA_RANGE[0], le=db.TIME_PER_KANA_RANGE[1]
    )


class DictionaryIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    entries: Any  # validated by words.validate_entries, which owns the format


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/profile")
async def profile(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Cheap header state — no need to pull full stats just for the chips."""
    user = await game.get_user(session)
    return {
        "elo": round(user.elo, 1),
        "level": game.level_for_elo(user.elo),
        "streak": user.current_streak,
    }


@router.get("/settings")
async def get_settings(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    user = await game.get_user(session)
    return _settings_payload(user)


@router.put("/settings")
async def put_settings(
    body: TimeBudgetIn, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    user = await game.get_user(session)
    user.time_base_ms = body.time_base_ms
    user.time_per_kana_ms = body.time_per_kana_ms
    user.updated_at = func.now()
    await session.commit()
    return _settings_payload(user)


def _settings_payload(user: db.UserProfile) -> dict[str, Any]:
    """Includes the bounds and a few worked examples so the UI can label the
    sliders without duplicating the formula."""
    return {
        "time_base_ms": user.time_base_ms,
        "time_per_kana_ms": user.time_per_kana_ms,
        "defaults": {
            "time_base_ms": db.DEFAULT_TIME_BASE_MS,
            "time_per_kana_ms": db.DEFAULT_TIME_PER_KANA_MS,
        },
        "bounds": {
            "time_base_ms": list(db.TIME_BASE_RANGE),
            "time_per_kana_ms": list(db.TIME_PER_KANA_RANGE),
        },
        "examples": [
            {"kana": n, "target_time_ms": game.user_target_time_ms(user, n)}
            for n in (2, 4, 7)
        ],
    }


@router.get("/word/next")
async def next_word(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    word = await game.pick_next_word(session)
    user = await game.get_user(session)
    kana_count = len(tokenize(word.katakana))
    return {
        "word_id": word.id,
        "katakana": word.katakana,
        "level": word.level,
        "kana_count": kana_count,
        "target_time_ms": game.user_target_time_ms(user, kana_count),
        "user_level": game.level_for_elo(user.elo),
        "elo": round(user.elo, 1),
    }


@router.post("/answer")
async def answer(
    body: AnswerIn, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    try:
        return await game.submit_answer(session, body.word_id, body.answer, body.time_ms)
    except KeyError:
        raise HTTPException(status_code=404, detail="word not found")


@router.get("/stats")
async def stats(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    user = await game.get_user(session)
    total_attempts, correct_attempts = (
        await session.execute(
            select(
                func.count(Attempt.id),
                # correct is a boolean here, so FILTER rather than SUM
                func.count(Attempt.id).filter(Attempt.correct),
            )
        )
    ).one()

    window = (
        select(Attempt.time_ms, Attempt.kana_total)
        .order_by(Attempt.id.desc())
        .limit(100)
        .subquery()
    )
    avg_word, avg_kana = (
        await session.execute(
            select(
                func.coalesce(func.avg(window.c.time_ms), 0),
                func.coalesce(
                    func.sum(window.c.time_ms)
                    * 1.0
                    / func.nullif(func.sum(window.c.kana_total), 0),
                    0,
                ),
            )
        )
    ).one()

    kana_rows = [
        {
            "kana": r.kana,
            "attempts": r.attempts,
            "correct": r.correct,
            "accuracy": round(r.correct / r.attempts, 3) if r.attempts else None,
            "ewma": round(r.ewma, 3),
        }
        for r in (
            await session.execute(select(KanaStat).order_by(KanaStat.kana))
        ).scalars()
    ]

    recent = [
        {
            "katakana": katakana,
            "romaji": romaji,
            "answer": a.answer,
            "correct": a.correct,
            "kana_total": a.kana_total,
            "kana_correct": a.kana_correct,
            "time_ms": a.time_ms,
            "elo_delta": round(a.elo_after - a.elo_before, 1),
            "created_at": a.created_at,
        }
        for a, katakana, romaji in (
            await session.execute(
                select(Attempt, Word.katakana, Word.romaji)
                .join(Word, Word.id == Attempt.word_id)
                .order_by(Attempt.id.desc())
                .limit(12)
            )
        ).all()
    ]

    history_window = (
        select(Attempt.id, Attempt.elo_after)
        .order_by(Attempt.id.desc())
        .limit(60)
        .subquery()
    )
    elo_history = [
        round(v, 1)
        for v in (
            await session.execute(
                select(history_window.c.elo_after).order_by(history_window.c.id)
            )
        ).scalars()
    ]

    async def coverage(group_col: Any) -> list[dict[str, Any]]:
        rows = await session.execute(
            select(
                group_col,
                func.count(),
                func.count().filter(Word.times_served > 0),
                func.coalesce(func.sum(Word.times_served), 0),
                func.coalesce(func.sum(Word.times_correct), 0),
            )
            .group_by(group_col)
            .order_by(group_col)
        )
        return [
            {
                "key": str(key),
                "total": total,
                "seen": seen,
                "served": served,
                "correct": correct,
                "success": round(correct / served, 3) if served else None,
            }
            for key, total, seen, served, correct in rows
        ]

    return {
        "elo": round(user.elo, 1),
        "level": game.level_for_elo(user.elo),
        "level_progress": round(game.level_progress(user.elo), 3),
        "max_level": game.MAX_LEVEL,
        "current_streak": user.current_streak,
        "best_streak": user.best_streak,
        "total_attempts": total_attempts,
        "correct_attempts": correct_attempts,
        "accuracy": (
            round(correct_attempts / total_attempts, 3) if total_attempts else None
        ),
        "avg_time_ms": round(avg_word),
        "avg_time_per_kana_ms": round(avg_kana),
        "kana": kana_rows,
        "recent": recent,
        "elo_history": elo_history,
        "coverage": {
            "levels": await coverage(Word.level),
            "sources": await coverage(Word.source),
        },
    }


@router.get("/dictionaries")
async def dictionaries(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Composition of each vocabulary source: size, level mix, word length,
    rating span and how much of it has been practiced."""
    words = list((await session.execute(select(Word))).scalars())
    uploads = await db.uploaded_dictionaries(session)

    buckets: dict[str, list[Word]] = {}
    for w in words:
        buckets.setdefault(w.source, []).append(w)
    # An uploaded dictionary whose words all moved to another source (or that
    # was uploaded empty) still exists — show it instead of dropping it.
    for name in uploads:
        buckets.setdefault(name, [])

    def summarize(name: str, items: list[Word]) -> dict[str, Any]:
        kana_counts = [len(tokenize(w.katakana)) for w in items]
        served = sum(w.times_served for w in items)
        correct = sum(w.times_correct for w in items)
        seen = sum(1 for w in items if w.times_served > 0)
        by_level = {lvl: 0 for lvl in range(1, 6)}
        for w in items:
            by_level[w.level] = by_level.get(w.level, 0) + 1
        return {
            "source": name,
            "origin": "upload" if name in uploads else "file",
            "uploaded_at": uploads.get(name),
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
            "rating_min": round(min((w.rating for w in items), default=0)),
            "rating_max": round(max((w.rating for w in items), default=0)),
        }

    dicts = [summarize(name, items) for name, items in sorted(buckets.items())]
    return {
        "dictionaries": dicts,
        "all": summarize("all", words) if words else None,
    }


@router.get("/dictionaries/template")
async def dictionary_template() -> Response:
    """The JSON shape an upload has to have — offered as a download."""
    return _json_download(TEMPLATE_ENTRIES, "katakana-dictionary-template.json")


@router.post("/dictionaries", status_code=201)
async def upload_dictionary(
    body: DictionaryIn, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """Store an uploaded vocabulary list and fold it into the word pool.

    All-or-nothing: one unreadable entry rejects the whole file. That strictness
    is deliberate — a stored dictionary is re-read on every boot, so anything
    accepted here has to stay loadable.
    """
    name = NAME_RE.sub("-", body.name.strip().lower()).strip("-")
    if not name:
        raise HTTPException(
            status_code=400, detail="name must contain letters, digits, - or _"
        )
    if name in file_sources():
        raise HTTPException(
            status_code=409,
            detail=f'"{name}" is a built-in dictionary — pick another name',
        )

    entries, errors = validate_entries(body.entries, name)
    if errors:
        raise HTTPException(
            status_code=400,
            detail={"message": f"{len(errors)} invalid entr"
                    f"{'y' if len(errors) == 1 else 'ies'}", "errors": errors[:20]},
        )
    if not entries:
        raise HTTPException(status_code=400, detail="the dictionary is empty")

    existed = name in await db.uploaded_dictionaries(session)
    await db.save_dictionary(session, name, list(body.entries))
    words = await session.scalar(
        select(func.count()).select_from(Word).where(Word.source == name)
    )
    return {
        "source": name,
        "replaced": existed,
        "entries": len(entries),
        "words": words or 0,
    }


@router.delete("/dictionaries/{name}")
async def remove_dictionary(
    name: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """Delete an uploaded dictionary. Words that were already answered stay —
    their attempt history would go with them."""
    try:
        removed = await db.delete_dictionary(session, name)
    except KeyError:
        raise HTTPException(status_code=404, detail="no such uploaded dictionary")
    kept = await session.scalar(
        select(func.count()).select_from(Word).where(Word.source == name)
    )
    return {"source": name, "removed": removed, "kept": kept or 0}


@router.get("/dictionaries/{name}/export")
async def export_dictionary(
    name: str, session: AsyncSession = Depends(get_session)
) -> Response:
    """Download a dictionary in upload format — works for built-in ones too,
    which doubles as a backup path for uploads."""
    rows = (
        await session.execute(
            select(Word)
            .where(Word.source == name)
            .order_by(Word.level, Word.katakana)
        )
    ).scalars()
    entries = [
        {"katakana": w.katakana, "meaning": w.meaning, "level": w.level} for w in rows
    ]
    if not entries:
        raise HTTPException(status_code=404, detail="no such dictionary")
    return _json_download(entries, f"{name}.json")


@router.get("/words")
async def words(
    source: str | None = None,
    level: int | None = None,
    q: str | None = None,
    sort: str = "level",
    limit: int = 100,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Browsable word list with filters — for inspecting a dictionary."""
    conds = []
    if source:
        conds.append(Word.source == source)
    if level is not None:
        conds.append(Word.level == level)
    if q:
        # ilike, not like: Postgres' LIKE is case-sensitive (SQLite's was not)
        pattern = f"%{q}%"
        conds.append(
            Word.katakana.ilike(pattern)
            | Word.romaji.ilike(pattern)
            | Word.meaning.ilike(pattern)
        )

    order = {
        "level": (Word.level.asc(), Word.rating.asc(), Word.katakana.asc()),
        "rating": (Word.rating.desc(), Word.katakana.asc()),
        "served": (Word.times_served.desc(), Word.katakana.asc()),
        "alpha": (Word.katakana.asc(),),
    }.get(sort, (Word.level.asc(), Word.rating.asc(), Word.katakana.asc()))

    total = await session.scalar(
        select(func.count()).select_from(Word).where(*conds)
    )
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    rows = (
        await session.execute(
            select(Word).where(*conds).order_by(*order).limit(limit).offset(offset)
        )
    ).scalars()
    return {
        "total": total or 0,
        "offset": offset,
        "limit": limit,
        "words": [
            {
                "katakana": w.katakana,
                "romaji": w.romaji,
                "meaning": w.meaning,
                "level": w.level,
                "source": w.source,
                "rating": round(w.rating),
                "times_served": w.times_served,
                "times_correct": w.times_correct,
                "kana_count": len(tokenize(w.katakana)),
            }
            for w in rows
        ],
    }


@router.post("/reset")
async def reset(
    body: ResetIn, session: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail='confirmation must be "RESET"')
    await db.reset_all(session)
    return {"status": "reset"}


def _json_download(payload: Any, filename: str) -> Response:
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
