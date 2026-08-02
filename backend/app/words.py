"""Vocabulary loading and validation.

Words reach the app from two directions:

* **JSON files** under ``<repo>/words/`` (override with env ``WORDS_DIR``):
  ``basic/`` is tracked in git and ships inside the backend image,
  ``additional/*.json`` is git-ignored and only exists on a dev machine.
* **Uploaded dictionaries**, stored in Postgres (``db.Dictionary``) — the way
  private vocabulary gets into a deployment whose image is built by a public
  CI run.

Both go through :func:`validate_entries` here, so the two paths can never
disagree on what a valid entry is. A file list looks like::

    [{"katakana": "コーヒー", "meaning": "coffee", "level": 2}, ...]

Files load in deterministic order (``basic/`` first, then everything else
sorted by path); on duplicate katakana the later file wins. Uploaded
dictionaries are merged on top of the files (see ``db.desired_words``).

Romaji is never stored — it is generated from the tokenizer at seed time, so
dictionary and evaluation cannot drift apart. Validation calls the tokenizer
too, which is what keeps an unreadable word from being accepted in the first
place.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, NamedTuple

from .kana import to_romaji

REQUIRED_KEYS = {"katakana", "meaning", "level"}
MAX_ENTRIES = 5000  # ceiling for a single uploaded dictionary

#: Example payload handed out by the UI's "download template" button.
TEMPLATE_ENTRIES: list[dict[str, Any]] = [
    {"katakana": "コーヒー", "meaning": "coffee", "level": 1},
    {"katakana": "ソフトウェア", "meaning": "software", "level": 3},
    {"katakana": "プロジェクト", "meaning": "project", "level": 4},
]


class WordEntry(NamedTuple):
    katakana: str
    meaning: str
    level: int
    source: str


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


def _parse_entry(entry: Any, source: str, index: int) -> WordEntry:
    if not isinstance(entry, dict) or not REQUIRED_KEYS <= entry.keys():
        raise ValueError(
            f"entry {index}: needs keys katakana/meaning/level, got {entry!r}"
        )
    katakana, meaning, level = entry["katakana"], entry["meaning"], entry["level"]
    label = f"entry {index} ({katakana if isinstance(katakana, str) else '?'})"
    if not isinstance(katakana, str) or not katakana or not isinstance(meaning, str):
        raise ValueError(f"{label}: katakana/meaning must be non-empty strings")
    # bool is an int subclass — "level": true would sneak through otherwise
    if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 5:
        raise ValueError(f"{label}: level must be an int 1-5, got {level!r}")
    try:
        to_romaji(katakana)
    except ValueError as e:
        raise ValueError(f"{label}: not readable as katakana ({e})") from e
    return WordEntry(katakana, meaning, level, source)


def validate_entries(raw: Any, source: str) -> tuple[list[WordEntry], list[str]]:
    """Split a raw JSON word list into accepted entries and error messages.

    Never raises — the caller decides how strict to be. Uploads reject the
    whole file when anything is wrong; a *stored* upload is re-validated on
    every boot and simply skips bad rows, because a single broken entry must
    not be able to keep the container from starting.
    """
    if not isinstance(raw, list):
        return [], ["expected a JSON list of word entries"]
    if len(raw) > MAX_ENTRIES:
        return [], [f"too many entries ({len(raw)}), the limit is {MAX_ENTRIES}"]
    entries: list[WordEntry] = []
    errors: list[str] = []
    for i, entry in enumerate(raw):
        try:
            entries.append(_parse_entry(entry, source, i))
        except ValueError as e:
            errors.append(str(e))
    return entries, errors


def parse_entries(raw: Any, source: str, where: str) -> list[WordEntry]:
    """Validate strictly, raising on the first problems. Used for files, whose
    content is developer-controlled and covered by the roundtrip test."""
    entries, errors = validate_entries(raw, source)
    if errors:
        detail = "; ".join(errors[:5])
        if len(errors) > 5:
            detail += f" (+{len(errors) - 5} more)"
        raise ValueError(f"{where}: {detail}")
    return entries


def load_words() -> list[WordEntry]:
    """Merge every JSON file below WORDS_DIR into one word list."""
    root = words_dir()
    merged: dict[str, WordEntry] = {}
    for f in _word_files(root):
        source = "basic" if "basic" in f.relative_to(root).parts else f.stem
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{f}: invalid JSON: {e}") from e
        for entry in parse_entries(raw, source, where=str(f)):
            merged[entry.katakana] = entry
    if not merged:
        raise ValueError(f"no vocabulary found under {root}")
    return list(merged.values())


def file_sources() -> set[str]:
    """Source labels owned by the JSON files — reserved for uploads."""
    root = words_dir()
    if not root.is_dir():
        return set()
    return {
        "basic" if "basic" in f.relative_to(root).parts else f.stem
        for f in _word_files(root)
    }
