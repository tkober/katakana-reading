import json

import pytest

from app.words import load_words


def write(path, entries):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


def test_additional_files_extend_and_override(tmp_path, monkeypatch):
    monkeypatch.setenv("WORDS_DIR", str(tmp_path))
    write(tmp_path / "basic" / "basic.json", [
        {"katakana": "バス", "meaning": "bus", "level": 1},
        {"katakana": "パン", "meaning": "bread", "level": 1},
    ])
    write(tmp_path / "additional" / "movies.json", [
        {"katakana": "パン", "meaning": "bread (overridden)", "level": 2},
        {"katakana": "アニメ", "meaning": "anime", "level": 1},
    ])
    words = {k: (m, lvl) for k, m, lvl in load_words()}
    assert len(words) == 3
    assert words["バス"] == ("bus", 1)
    assert words["アニメ"] == ("anime", 1)
    # later (additional) file wins on duplicates
    assert words["パン"] == ("bread (overridden)", 2)


def test_invalid_entry_reports_file(tmp_path, monkeypatch):
    monkeypatch.setenv("WORDS_DIR", str(tmp_path))
    write(tmp_path / "basic" / "basic.json", [{"katakana": "バス", "level": 1}])
    with pytest.raises(ValueError, match="basic.json"):
        load_words()


def test_invalid_level_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("WORDS_DIR", str(tmp_path))
    write(tmp_path / "basic" / "basic.json", [
        {"katakana": "バス", "meaning": "bus", "level": 9},
    ])
    with pytest.raises(ValueError, match="level"):
        load_words()


def test_empty_dir_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("WORDS_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="no vocabulary"):
        load_words()
