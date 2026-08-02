"""Adaptive game logic: Elo rating, level mapping, word selection."""

from __future__ import annotations

import random
import sqlite3
from typing import Any

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


def target_time_ms(kana_count: int) -> int:
    """Reading-speed target: base + per-kana budget."""
    return 1500 + 700 * kana_count


def answer_score(correct: bool, kana_correct: int, kana_total: int,
                 time_ms: int, fast: bool) -> float:
    if correct:
        return 1.0 if fast else 0.85
    return 0.35 * (kana_correct / max(1, kana_total))


def get_user(conn: sqlite3.Connection) -> sqlite3.Row:
    return conn.execute("SELECT * FROM user_profile WHERE id = 1").fetchone()


def _kana_confidence(conn: sqlite3.Connection) -> dict[str, tuple[int, float]]:
    return {
        row["kana"]: (row["attempts"], row["ewma"])
        for row in conn.execute("SELECT kana, attempts, ewma FROM kana_stats")
    }


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


def pick_next_word(conn: sqlite3.Connection) -> sqlite3.Row:
    user = get_user(conn)
    elo = user["elo"]
    recent_ids = {
        row["word_id"]
        for row in conn.execute(
            "SELECT word_id FROM attempts ORDER BY id DESC LIMIT ?", (RECENT_WINDOW,)
        )
    }
    words = conn.execute("SELECT * FROM words").fetchall()
    fresh = [w for w in words if w["id"] not in recent_ids] or list(words)

    # Occasionally probe above the comfort zone to test the ceiling, or
    # re-test far below it (failing those is punished hard by the Elo math).
    roll = random.random()
    if roll < PROBE_CHANCE:
        probes = [w for w in fresh if elo + 120 <= w["rating"] <= elo + 400]
        if probes:
            return random.choice(probes)
    elif roll < PROBE_CHANCE + REVIEW_CHANCE:
        reviews = [
            w for w in fresh
            if elo - REVIEW_RANGE[1] <= w["rating"] <= elo - REVIEW_RANGE[0]
        ]
        if reviews:
            return random.choice(reviews)

    pool = [w for w in fresh if abs(w["rating"] - elo) <= POOL_RANGE]
    if len(pool) < 8:
        pool = [w for w in fresh if abs(w["rating"] - elo) <= 300]
    if len(pool) < 8:
        pool = sorted(fresh, key=lambda w: abs(w["rating"] - elo))[:20]

    # Weight towards words containing weak kana.
    conf = _kana_confidence(conn)
    weights = [1.0 + 3.0 * _word_weakness(w["katakana"], conf) for w in pool]
    return random.choices(pool, weights=weights, k=1)[0]


def submit_answer(conn: sqlite3.Connection, word_id: int, answer: str,
                  time_ms: int) -> dict[str, Any]:
    word = conn.execute("SELECT * FROM words WHERE id = ?", (word_id,)).fetchone()
    if word is None:
        raise KeyError(f"word {word_id} not found")

    time_ms = max(0, min(int(time_ms), 300_000))
    tokens = tokenize(word["katakana"])
    ev = evaluate(tokens, answer)
    fast = ev.correct and time_ms <= target_time_ms(len(tokens))

    user = get_user(conn)
    elo_before = user["elo"]
    score = answer_score(ev.correct, ev.kana_correct, ev.kana_total, time_ms, fast)
    exp = expected_score(elo_before, word["rating"])
    k_user = K_USER_GAIN if score >= exp else K_USER_LOSS
    elo_after = elo_before + k_user * (score - exp)
    new_word_rating = word["rating"] + K_WORD * ((1.0 - score) - (1.0 - exp))

    streak = user["current_streak"] + 1 if ev.correct else 0
    best = max(user["best_streak"], streak)
    conn.execute(
        "UPDATE user_profile SET elo = ?, current_streak = ?, best_streak = ?, "
        "updated_at = datetime('now') WHERE id = 1",
        (elo_after, streak, best),
    )
    conn.execute(
        "UPDATE words SET rating = ?, times_served = times_served + 1, "
        "times_correct = times_correct + ? WHERE id = ?",
        (new_word_rating, 1 if ev.correct else 0, word_id),
    )
    for tr in ev.tokens:
        conn.execute(
            """
            INSERT INTO kana_stats (kana, attempts, correct, ewma, updated_at)
            VALUES (?, 1, ?, ?, datetime('now'))
            ON CONFLICT(kana) DO UPDATE SET
                attempts = attempts + 1,
                correct = correct + excluded.correct,
                ewma = 0.8 * ewma + 0.2 * excluded.correct,
                updated_at = datetime('now')
            """,
            (tr.kana, 1 if tr.correct else 0, 1.0 if tr.correct else 0.0),
        )
    conn.execute(
        "INSERT INTO attempts (word_id, answer, correct, kana_total, kana_correct, "
        "time_ms, elo_before, elo_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (word_id, ev.normalized_input, 1 if ev.correct else 0,
         ev.kana_total, ev.kana_correct, time_ms, elo_before, elo_after),
    )
    conn.commit()

    return {
        "correct": ev.correct,
        "fast": fast,
        "target_time_ms": target_time_ms(len(tokens)),
        "romaji": word["romaji"],
        "meaning": word["meaning"],
        "katakana": word["katakana"],
        "level": word["level"],
        "source": word["source"],
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
