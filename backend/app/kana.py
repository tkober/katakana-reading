"""Katakana tokenization, romaji matching and per-kana evaluation.

A word is split into tokens (single kana, digraphs like キャ, sokuon ッ,
chōon ー). Each token has a set of accepted romaji spellings. The user's
answer is aligned against the token sequence with a segment-level
edit-distance DP, so we can tell for every token whether it was read
correctly — even when the answer as a whole is wrong.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

VOWELS = "aiueo"

# Single kana -> accepted romaji spellings (first entry is canonical Hepburn).
BASE: dict[str, list[str]] = {
    "ア": ["a"], "イ": ["i"], "ウ": ["u"], "エ": ["e"], "オ": ["o"],
    "カ": ["ka"], "キ": ["ki"], "ク": ["ku"], "ケ": ["ke"], "コ": ["ko"],
    "サ": ["sa"], "シ": ["shi", "si"], "ス": ["su"], "セ": ["se"], "ソ": ["so"],
    "タ": ["ta"], "チ": ["chi", "ti"], "ツ": ["tsu", "tu"], "テ": ["te"], "ト": ["to"],
    "ナ": ["na"], "ニ": ["ni"], "ヌ": ["nu"], "ネ": ["ne"], "ノ": ["no"],
    "ハ": ["ha"], "ヒ": ["hi"], "フ": ["fu", "hu"], "ヘ": ["he"], "ホ": ["ho"],
    "マ": ["ma"], "ミ": ["mi"], "ム": ["mu"], "メ": ["me"], "モ": ["mo"],
    "ヤ": ["ya"], "ユ": ["yu"], "ヨ": ["yo"],
    "ラ": ["ra"], "リ": ["ri"], "ル": ["ru"], "レ": ["re"], "ロ": ["ro"],
    "ワ": ["wa"], "ヲ": ["wo", "o"],
    "ガ": ["ga"], "ギ": ["gi"], "グ": ["gu"], "ゲ": ["ge"], "ゴ": ["go"],
    "ザ": ["za"], "ジ": ["ji", "zi"], "ズ": ["zu"], "ゼ": ["ze"], "ゾ": ["zo"],
    "ダ": ["da"], "ヂ": ["ji", "di"], "ヅ": ["zu", "du"], "デ": ["de"], "ド": ["do"],
    "バ": ["ba"], "ビ": ["bi"], "ブ": ["bu"], "ベ": ["be"], "ボ": ["bo"],
    "パ": ["pa"], "ピ": ["pi"], "プ": ["pu"], "ペ": ["pe"], "ポ": ["po"],
    "ヴ": ["vu", "bu"],
}

# Two-character combinations (digraphs and extended katakana).
DIGRAPHS: dict[str, list[str]] = {
    "キャ": ["kya"], "キュ": ["kyu"], "キョ": ["kyo"],
    "シャ": ["sha", "sya"], "シュ": ["shu", "syu"], "ショ": ["sho", "syo"], "シェ": ["she", "sye"],
    "チャ": ["cha", "tya"], "チュ": ["chu", "tyu"], "チョ": ["cho", "tyo"], "チェ": ["che", "tye"],
    "ニャ": ["nya"], "ニュ": ["nyu"], "ニョ": ["nyo"],
    "ヒャ": ["hya"], "ヒュ": ["hyu"], "ヒョ": ["hyo"],
    "ミャ": ["mya"], "ミュ": ["myu"], "ミョ": ["myo"],
    "リャ": ["rya"], "リュ": ["ryu"], "リョ": ["ryo"],
    "ギャ": ["gya"], "ギュ": ["gyu"], "ギョ": ["gyo"],
    "ジャ": ["ja", "jya", "zya"], "ジュ": ["ju", "jyu", "zyu"], "ジョ": ["jo", "jyo", "zyo"],
    "ジェ": ["je", "jye", "zye"],
    "ビャ": ["bya"], "ビュ": ["byu"], "ビョ": ["byo"],
    "ピャ": ["pya"], "ピュ": ["pyu"], "ピョ": ["pyo"],
    "ファ": ["fa"], "フィ": ["fi"], "フェ": ["fe"], "フォ": ["fo"], "フュ": ["fyu"],
    "ティ": ["ti", "thi"], "トゥ": ["tu", "twu"], "テュ": ["tyu"],
    "ディ": ["di", "dhi"], "ドゥ": ["du", "dwu"], "デュ": ["dyu", "dhu"],
    "ウィ": ["wi", "ui"], "ウェ": ["we", "ue"], "ウォ": ["wo", "uo"],
    "ヴァ": ["va", "ba"], "ヴィ": ["vi", "bi"], "ヴェ": ["ve", "be"], "ヴォ": ["vo", "bo"],
    "ツァ": ["tsa"], "ツィ": ["tsi"], "ツェ": ["tse"], "ツォ": ["tso"],
    "イェ": ["ye"],
}

SOKUON = "ッ"
CHOON = "ー"
N = "ン"


@dataclass
class Token:
    kana: str
    variants: list[str] = field(default_factory=list)
    kind: str = "kana"  # kana | sokuon | choon | n

    @property
    def canonical(self) -> str:
        return self.variants[0] if self.variants else ""


def tokenize(word: str) -> list[Token]:
    """Split a katakana word into tokens with accepted romaji variants."""
    tokens: list[Token] = []
    i = 0
    while i < len(word):
        two = word[i : i + 2]
        c = word[i]
        if len(two) == 2 and two in DIGRAPHS:
            tokens.append(Token(two, list(DIGRAPHS[two])))
            i += 2
        elif c == SOKUON:
            tokens.append(Token(c, [], "sokuon"))
            i += 1
        elif c == CHOON:
            tokens.append(Token(c, [], "choon"))
            i += 1
        elif c == N:
            tokens.append(Token(c, ["n", "nn"], "n"))
            i += 1
        elif c in BASE:
            tokens.append(Token(c, list(BASE[c])))
            i += 1
        else:
            raise ValueError(f"Unknown kana {c!r} in {word!r}")

    # Resolve context-dependent tokens.
    for idx, t in enumerate(tokens):
        nxt = tokens[idx + 1] if idx + 1 < len(tokens) else None
        if t.kind == "sokuon":
            if nxt and nxt.variants and nxt.canonical[0] not in VOWELS:
                if nxt.canonical.startswith("ch"):
                    t.variants = ["t", "c"]  # matchi / macchi
                else:
                    t.variants = [nxt.canonical[0]]
            else:
                t.variants = ["t"]
        elif t.kind == "choon":
            prev = tokens[idx - 1] if idx > 0 else None
            v = prev.canonical[-1] if prev and prev.variants else ""
            t.variants = [v, "-"] if v in VOWELS else ["-"]
        elif t.kind == "n":
            if nxt and nxt.variants and nxt.canonical[0] in "bmp":
                t.variants = ["n", "m", "nn"]
    return tokens


def to_romaji(word: str) -> str:
    """Canonical Hepburn-style typing romaji for a katakana word."""
    return "".join(t.canonical for t in tokenize(word))


_MACRONS = {
    "ā": "aa", "ī": "ii", "ū": "uu", "ē": "ee", "ō": "oo",
    "â": "aa", "î": "ii", "û": "uu", "ê": "ee", "ô": "oo",
}


def normalize_answer(raw: str) -> str:
    s = unicodedata.normalize("NFKC", raw).lower().strip()
    for macron, repl in _MACRONS.items():
        s = s.replace(macron, repl)
    # Keep letters and "-" (accepted for ー); drop spaces, apostrophes etc.
    return re.sub(r"[^a-z\-]", "", s)


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


@dataclass
class TokenResult:
    kana: str
    expected: str
    given: str
    correct: bool


@dataclass
class Evaluation:
    correct: bool
    cost: int
    tokens: list[TokenResult]
    normalized_input: str

    @property
    def kana_total(self) -> int:
        return len(self.tokens)

    @property
    def kana_correct(self) -> int:
        return sum(1 for t in self.tokens if t.correct)


def evaluate(tokens: list[Token], answer: str) -> Evaluation:
    """Align the user's romaji answer against the token sequence.

    Segment-level DP: dp[i][j] = minimal edit cost of explaining input[:j]
    with tokens[:i]. A token is counted as correctly read iff its matched
    segment equals one of its accepted variants.
    """
    inp = normalize_answer(answer)
    S, L = len(tokens), len(inp)
    # dp value: (edit cost, -weighted exact-token matches). The secondary
    # component breaks ties so that e.g. "kohi" for コーヒー credits コ/ヒ
    # instead of stealing the "o" for the chōon.
    INF = (10**9, 0)

    dp = [[INF] * (L + 1) for _ in range(S + 1)]
    prev_j = [[-1] * (L + 1) for _ in range(S + 1)]
    dp[0][0] = (0, 0)
    for j in range(1, L + 1):  # leading extra characters
        dp[0][j] = (j, 0)
        prev_j[0][j] = j - 1

    for i in range(S):
        variants = tokens[i].variants or [""]
        max_len = max(len(v) for v in variants)
        exact_weight = 2 if tokens[i].kind in ("kana", "n") else 1
        for j in range(L + 1):
            base = dp[i][j]
            if base >= INF:
                continue
            hi = min(L, j + max_len + 2)
            for j2 in range(j, hi + 1):
                seg = inp[j:j2]
                cost = min(_levenshtein(v, seg) for v in variants)
                bonus = -exact_weight if seg in variants else 0
                cand = (base[0] + cost, base[1] + bonus)
                if cand < dp[i + 1][j2]:
                    dp[i + 1][j2] = cand
                    prev_j[i + 1][j2] = j

    # Allow trailing extra characters at 1 cost each; on ties prefer more
    # exact matches, then attributing as much input as possible to tokens.
    def final(j: int) -> tuple[int, int, int]:
        return (dp[S][j][0] + (L - j), dp[S][j][1], -j)

    end_j = min(range(L + 1), key=final)
    total = dp[S][end_j][0] + (L - end_j)

    # Backtrack matched segments.
    segments: list[str] = []
    j = end_j
    for i in range(S, 0, -1):
        pj = prev_j[i][j]
        segments.append(inp[pj:j])
        j = pj

    segments.reverse()
    results = [
        TokenResult(
            kana=t.kana,
            expected=t.canonical,
            given=seg,
            correct=seg in t.variants,
        )
        for t, seg in zip(tokens, segments)
    ]
    return Evaluation(correct=total == 0, cost=total, tokens=results, normalized_input=inp)


def evaluate_word(word: str, answer: str) -> Evaluation:
    return evaluate(tokenize(word), answer)
