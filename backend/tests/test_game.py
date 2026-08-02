from app.game import (
    K_USER_GAIN,
    K_USER_LOSS,
    LEVEL_WIDTH,
    MAX_LEVEL,
    answer_score,
    expected_score,
    level_for_elo,
    level_progress,
)


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
