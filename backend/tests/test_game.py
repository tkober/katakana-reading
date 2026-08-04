from app.game import (
    K_USER_GAIN,
    K_USER_LOSS,
    LEVEL_WIDTH,
    MAX_LEVEL,
    answer_score,
    effective_score,
    expected_score,
    level_for_elo,
    level_progress,
)


def elo_delta(user: float, word_rating: float, correct: bool, kana_correct: int,
              kana_total: int, fast: bool) -> float:
    """Mirror of the Elo update in submit_answer, for rating-math tests."""
    exp = expected_score(user, word_rating)
    score = effective_score(
        answer_score(correct, kana_correct, kana_total, 3000, fast), exp, correct
    )
    k = K_USER_GAIN if score >= exp else K_USER_LOSS
    return k * (score - exp)


def test_level_mapping():
    assert level_for_elo(700) == 1
    assert level_for_elo(750) == 1
    assert level_for_elo(750 + LEVEL_WIDTH) == 2
    assert level_for_elo(1700) == 13
    assert level_for_elo(10_000) == MAX_LEVEL


def test_level_progress_bounds():
    assert 0.0 <= level_progress(760) <= 1.0
    assert level_progress(10_000) == 1.0


def test_asymmetric_k_punishes_failing_easy_words():
    user, easy_word = 1700.0, 1200.0
    exp = expected_score(user, easy_word)
    fail = answer_score(False, 1, 5, 3000, False)
    win = answer_score(True, 5, 5, 3000, True)
    loss = K_USER_LOSS * (fail - exp)
    gain = K_USER_GAIN * (win - exp)
    # failing a much easier word costs far more than acing it earns
    assert loss < -25
    assert 0 < gain < 5
    assert abs(loss) > 5 * gain


def test_answer_score_tiers():
    assert answer_score(True, 5, 5, 1000, True) == 1.0
    assert answer_score(True, 5, 5, 9000, False) == 0.85
    assert answer_score(False, 0, 5, 1000, False) == 0.0
    assert 0 < answer_score(False, 3, 5, 1000, False) < 0.35


def test_correct_answer_never_loses_elo():
    # The real case: user 1183, イタリア rated 730, right but over the target
    # time. The raw 0.85 tier sits below the 0.93 expectation, which used to
    # cost ~3 Elo for a correct reading.
    slow = elo_delta(1183.4, 730.0, True, 4, 4, fast=False)
    assert slow == 0.0
    # ... at every distance, not just this one
    for word_rating in (1183.4, 1000.0, 800.0, 600.0, 300.0):
        assert elo_delta(1183.4, word_rating, True, 4, 4, fast=False) >= 0.0


def test_speed_still_decides_the_gain():
    fast = elo_delta(1183.4, 730.0, True, 4, 4, fast=True)
    slow = elo_delta(1183.4, 730.0, True, 4, 4, fast=False)
    assert fast > slow == 0.0
    # near the user's own level, being slow still pays — just less
    hard_fast = elo_delta(1000.0, 1000.0, True, 4, 4, fast=True)
    hard_slow = elo_delta(1000.0, 1000.0, True, 4, 4, fast=False)
    assert hard_fast > hard_slow > 0.0


def test_failing_a_review_word_still_hurts():
    # The floor must not soften wrong answers — that is what makes the
    # review words below the comfort zone worth serving.
    assert elo_delta(1183.4, 730.0, False, 2, 4, fast=False) < -25
