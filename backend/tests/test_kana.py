import pytest

from app.kana import evaluate_word, to_romaji, tokenize
from app.words import WORDS


# ---------------------------------------------------------------- tokenizer

def test_tokenize_simple():
    assert [t.kana for t in tokenize("カメラ")] == ["カ", "メ", "ラ"]


def test_tokenize_digraph_and_specials():
    assert [t.kana for t in tokenize("チョコレート")] == ["チョ", "コ", "レ", "ー", "ト"]
    assert [t.kana for t in tokenize("マッチ")] == ["マ", "ッ", "チ"]
    assert [t.kana for t in tokenize("ファッション")] == ["ファ", "ッ", "ショ", "ン"]


def test_canonical_romaji():
    assert to_romaji("コーヒー") == "koohii"
    assert to_romaji("チョコレート") == "chokoreeto"
    assert to_romaji("マッチ") == "matchi"
    assert to_romaji("キッチン") == "kitchin"
    assert to_romaji("シャンプー") == "shanpuu"
    assert to_romaji("パーティー") == "paatii"
    assert to_romaji("ミネラルウォーター") == "mineraruwootaa"
    assert to_romaji("チェックイン") == "chekkuin"


# ---------------------------------------------------------------- evaluation

def test_exact_answer_correct():
    ev = evaluate_word("コーヒー", "koohii")
    assert ev.correct
    assert all(t.correct for t in ev.tokens)


@pytest.mark.parametrize(
    "word,answer",
    [
        ("コーヒー", "ko-hi-"),        # dash for chōon
        ("コーヒー", "kōhī"),          # macrons
        ("コーヒー", "KOOHII "),       # case/whitespace
        ("マッチ", "macchi"),          # sokuon variant
        ("マッチ", "matchi"),
        ("シャンプー", "shampuu"),     # n -> m before p
        ("シャンプー", "shanpuu"),
        ("シャワー", "syawa-"),        # kunrei-style sha
        ("チャンネル", "channeru"),
        ("キッチン", "kicchin"),
        ("フランス", "huransu"),       # fu/hu
        ("タクシー", "takusii"),       # shi/si
    ],
)
def test_accepted_variants(word, answer):
    assert evaluate_word(word, answer).correct


def test_partial_credit_marks_only_missed_kana():
    # "kohi" misses both chōon marks but reads コ and ヒ correctly.
    ev = evaluate_word("コーヒー", "kohi")
    assert not ev.correct
    by_kana = [(t.kana, t.correct) for t in ev.tokens]
    assert by_kana == [("コ", True), ("ー", False), ("ヒ", True), ("ー", False)]


def test_partial_credit_wrong_consonant():
    # Misreading シ as ツ: "tsuatsu" for シャツ.
    ev = evaluate_word("シャツ", "tsuatsu")
    assert not ev.correct
    assert ev.tokens[-1].correct  # ツ read correctly
    assert not ev.tokens[0].correct  # シャ not read correctly


def test_missing_sokuon_detected():
    ev = evaluate_word("ファッション", "fashon")
    assert not ev.correct
    marks = {t.kana: t.correct for t in ev.tokens}
    assert marks["ファ"] and marks["ショ"] and marks["ン"]
    assert not marks["ッ"]


def test_empty_answer():
    ev = evaluate_word("バス", "")
    assert not ev.correct
    assert ev.kana_correct == 0


def test_extra_characters_not_correct():
    assert not evaluate_word("バス", "basuu").correct


# ---------------------------------------------------------------- dictionary

def test_all_words_tokenize_and_roundtrip():
    seen = set()
    for katakana, meaning, level in WORDS:
        assert katakana not in seen, f"duplicate word {katakana}"
        seen.add(katakana)
        assert 1 <= level <= 5
        romaji = to_romaji(katakana)  # raises on invalid kana
        assert romaji
        ev = evaluate_word(katakana, romaji)
        assert ev.correct, f"{katakana}: canonical {romaji!r} not accepted"
        assert all(t.correct for t in ev.tokens), f"{katakana}: token mismatch"
