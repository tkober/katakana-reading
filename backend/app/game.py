"""Adaptive game logic: Elo rating, level mapping, word selection."""

from __future__ import annotations

import random
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from .db import (
    DEFAULT_TIME_BASE_MS,
    DEFAULT_TIME_PER_KANA_MS,
    Attempt,
    KanaStat,
    UserProfile,
    Word,
)
from .kana import evaluate, tokenize

# Asymmetric K: climbing is slow, failing hurts — especially failing an
# easy review word far below your rating.
K_USER_GAIN = 20.0
K_USER_LOSS = 36.0
K_WORD = 16.0
MIN_LEVEL, MAX_LEVEL = 1, 20
LEVEL_BASE_ELO = 750.0
LEVEL_WIDTH = 75.0
RECENT_WINDOW = 8  # don't repeat the last N answered words
PROBE_CHANCE = 0.15  # chance to serve a word above the comfort zone
REVIEW_CHANCE = 0.12  # chance to re-test a word well below the comfort zone
REVIEW_RANGE = (250.0, 600.0)  # how far below the user's Elo reviews sit
POOL_RANGE = 160.0  # rating window around the user's Elo


def expected_score(ra: float, rb: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))


def level_for_elo(elo: float) -> int:
    return max(MIN_LEVEL, min(MAX_LEVEL, 1 + int((elo - LEVEL_BASE_ELO) // LEVEL_WIDTH)))


def level_progress(elo: float) -> float:
    """Progress towards the next level, 0..1."""
    level = level_for_elo(elo)
    if level >= MAX_LEVEL:
        return 1.0
    floor = LEVEL_BASE_ELO + (level - 1) * LEVEL_WIDTH
    return max(0.0, min(1.0, (elo - floor) / LEVEL_WIDTH))


def target_time_ms(
    kana_count: int,
    base_ms: int = DEFAULT_TIME_BASE_MS,
    per_kana_ms: int = DEFAULT_TIME_PER_KANA_MS,
) -> int:
    """Reading-speed target: base + per-kana budget.

    The budget covers reading *and* typing, which is why it is tunable: a
    touchscreen keyboard needs noticeably more than a real one.
    """
    return base_ms + per_kana_ms * kana_count


def user_target_time_ms(user: UserProfile, kana_count: int) -> int:
    return target_time_ms(kana_count, user.time_base_ms, user.time_per_kana_ms)


def answer_score(correct: bool, kana_correct: int, kana_total: int,
                 time_ms: int, fast: bool) -> float:
    if correct:
        return 1.0 if fast else 0.85
    return 0.35 * (kana_correct / max(1, kana_total))


def effective_score(score: float, exp: float, correct: bool) -> float:
    """The score that actually goes into the Elo update.

    A correct reading must never cost Elo. On a review word far below the
    user (from ~300 Elo down) the expectation climbs above the 0.85 "correct
    but slow" tier, which used to turn a right answer into a loss. Lifting
    the score to the expectation makes speed decide how *much* you gain, not
    whether you lose. Wrong answers are untouched — that is what keeps the
    review words sharp.
    """
    return max(score, exp) if correct else score


async def get_user(session: AsyncSession) -> UserProfile:
    return await session.get_one(UserProfile, 1)


async def _kana_confidence(session: AsyncSession) -> dict[str, tuple[int, float]]:
    rows = await session.execute(select(KanaStat.kana, KanaStat.attempts, KanaStat.ewma))
    return {kana: (attempts, ewma) for kana, attempts, ewma in rows}


def _word_weakness(katakana: str, conf: dict[str, tuple[int, float]]) -> float:
    """0..1 — how much this word hits kana the user struggles with.

    Kana with fewer than 3 attempts count as moderately unknown (0.55) so
    unseen kana still get probed.
    """
    vals = []
    for tok in tokenize(katakana):
        stats = conf.get(tok.kana)
        if stats is None or stats[0] < 3:
            vals.append(0.55)
        else:
            vals.append(1.0 - stats[1])
    return sum(vals) / len(vals) if vals else 0.5


async def pick_next_word(session: AsyncSession) -> Word:
    user = await get_user(session)
    elo = user.elo
    recent_ids = set(
        (
            await session.execute(
                select(Attempt.word_id).order_by(Attempt.id.desc()).limit(RECENT_WINDOW)
            )
        ).scalars()
    )
    words = list((await session.execute(select(Word))).scalars())
    fresh = [w for w in words if w.id not in recent_ids] or words

    # Occasionally probe above the comfort zone to test the ceiling, or
    # re-test far below it (failing those is punished hard by the Elo math).
    roll = random.random()
    if roll < PROBE_CHANCE:
        probes = [w for w in fresh if elo + 120 <= w.rating <= elo + 400]
        if probes:
            return random.choice(probes)
    elif roll < PROBE_CHANCE + REVIEW_CHANCE:
        reviews = [
            w for w in fresh
            if elo - REVIEW_RANGE[1] <= w.rating <= elo - REVIEW_RANGE[0]
        ]
        if reviews:
            return random.choice(reviews)

    pool = [w for w in fresh if abs(w.rating - elo) <= POOL_RANGE]
    if len(pool) < 8:
        pool = [w for w in fresh if abs(w.rating - elo) <= 300]
    if len(pool) < 8:
        pool = sorted(fresh, key=lambda w: abs(w.rating - elo))[:20]

    # Weight towards words containing weak kana.
    conf = await _kana_confidence(session)
    weights = [1.0 + 3.0 * _word_weakness(w.katakana, conf) for w in pool]
    return random.choices(pool, weights=weights, k=1)[0]


async def submit_answer(session: AsyncSession, word_id: int, answer: str,
                        time_ms: int) -> dict[str, Any]:
    word = await session.get(Word, word_id)
    if word is None:
        raise KeyError(f"word {word_id} not found")

    time_ms = max(0, min(int(time_ms), 300_000))
    tokens = tokenize(word.katakana)
    ev = evaluate(tokens, answer)

    user = await get_user(session)
    target = user_target_time_ms(user, len(tokens))
    fast = ev.correct and time_ms <= target
    elo_before = user.elo
    exp = expected_score(elo_before, word.rating)
    score = effective_score(
        answer_score(ev.correct, ev.kana_correct, ev.kana_total, time_ms, fast),
        exp,
        ev.correct,
    )
    k_user = K_USER_GAIN if score >= exp else K_USER_LOSS
    elo_after = elo_before + k_user * (score - exp)
    new_word_rating = word.rating + K_WORD * ((1.0 - score) - (1.0 - exp))

    streak = user.current_streak + 1 if ev.correct else 0
    best = max(user.best_streak, streak)
    user.elo = elo_after
    user.current_streak = streak
    user.best_streak = best
    user.updated_at = func.now()

    word.rating = new_word_rating
    word.times_served += 1
    word.times_correct += 1 if ev.correct else 0

    for tr in ev.tokens:
        stmt = insert(KanaStat).values(
            kana=tr.kana,
            attempts=1,
            correct=1 if tr.correct else 0,
            ewma=1.0 if tr.correct else 0.0,
            updated_at=func.now(),
        )
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=[KanaStat.kana],
                set_={
                    "attempts": KanaStat.attempts + 1,
                    "correct": KanaStat.correct + stmt.excluded.correct,
                    "ewma": 0.8 * KanaStat.ewma + 0.2 * stmt.excluded.ewma,
                    "updated_at": func.now(),
                },
            )
        )
    session.add(
        Attempt(
            word_id=word_id,
            answer=ev.normalized_input,
            correct=ev.correct,
            kana_total=ev.kana_total,
            kana_correct=ev.kana_correct,
            time_ms=time_ms,
            elo_before=elo_before,
            elo_after=elo_after,
        )
    )
    await session.commit()

    return {
        "correct": ev.correct,
        "fast": fast,
        "target_time_ms": target,
        "romaji": word.romaji,
        "meaning": word.meaning,
        "katakana": word.katakana,
        "level": word.level,
        "source": word.source,
        "kana_total": ev.kana_total,
        "kana_correct": ev.kana_correct,
        "tokens": [
            {"kana": t.kana, "expected": t.expected, "given": t.given, "correct": t.correct}
            for t in ev.tokens
        ],
        "elo": {
            "before": round(elo_before, 1),
            "after": round(elo_after, 1),
            "delta": round(elo_after - elo_before, 1),
        },
        "user_level": level_for_elo(elo_after),
        "level_progress": round(level_progress(elo_after), 3),
        "streak": streak,
        "best_streak": best,
    }
