"""Vocabulary loading from JSON files.

Words live under <repo>/words/ (override with env WORDS_DIR):

    words/
      basic/         tracked in git — the base dictionary
      additional/    *.json ignored by git, still baked into the Docker image

Every *.json file below WORDS_DIR is a list of entries:

    [{"katakana": "コーヒー", "meaning": "coffee", "level": 2}, ...]

Files load in deterministic order (basic/ first, then everything else
sorted by path); on duplicate katakana the later file wins, so additional
files can override base entries. Romaji is never stored in the files — it
is generated from the tokenizer at seed time (see db.seed_words), so
dictionary and evaluation can never disagree.

Each word carries a `source` label for coverage stats: "basic" for
anything under basic/, otherwise the file stem (sap.json -> "sap").
"""

from __future__ import annotations

import json
import os
from pathlib import Path

REQUIRED_KEYS = {"katakana", "meaning", "level"}


def words_dir() -> Path:
    env = os.environ.get("WORDS_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "words"


def _word_files(root: Path) -> list[Path]:
    def sort_key(p: Path) -> tuple[int, str]:
        in_basic = "basic" in p.relative_to(root).parts
        return (0 if in_basic else 1, str(p))

    return sorted(root.rglob("*.json"), key=sort_key)


def load_words() -> list[tuple[str, str, int, str]]:
    root = words_dir()
    merged: dict[str, tuple[str, str, int, str]] = {}
    for f in _word_files(root):
        source = "basic" if "basic" in f.relative_to(root).parts else f.stem
        try:
            entries = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{f}: invalid JSON: {e}") from e
        if not isinstance(entries, list):
            raise ValueError(f"{f}: expected a JSON list of word entries")
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict) or not REQUIRED_KEYS <= entry.keys():
                raise ValueError(
                    f"{f} entry {i}: needs keys katakana/meaning/level, got {entry!r}"
                )
            katakana, meaning, level = entry["katakana"], entry["meaning"], entry["level"]
            if (
                not isinstance(katakana, str)
                or not katakana
                or not isinstance(meaning, str)
                or not isinstance(level, int)
                or not 1 <= level <= 5
            ):
                raise ValueError(
                    f"{f} entry {i} ({entry.get('katakana', '?')}): "
                    "katakana/meaning must be non-empty strings, level an int 1-5"
                )
            merged[katakana] = (katakana, meaning, level, source)
    if not merged:
        raise ValueError(f"no vocabulary found under {root}")
    return list(merged.values())
