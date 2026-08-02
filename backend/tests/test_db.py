import json

from app import db, game


def write_words(tmp_path, entries, name="basic/basic.json"):
    path = tmp_path / "words" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


def setup_db(tmp_path, monkeypatch, entries):
    monkeypatch.setenv("WORDS_DIR", str(tmp_path / "words"))
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    write_words(tmp_path, entries)
    conn = db.get_conn()
    db.init_db(conn)
    return conn


def test_removed_words_are_pruned(tmp_path, monkeypatch):
    conn = setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
        {"katakana": "パン", "meaning": "bread", "level": 1},
    ])
    assert conn.execute("SELECT COUNT(*) FROM words").fetchone()[0] == 2

    # パン disappears from the dictionary -> gone on next seed
    write_words(tmp_path, [{"katakana": "バス", "meaning": "bus", "level": 1}])
    db.seed_words(conn)
    kept = [r["katakana"] for r in conn.execute("SELECT katakana FROM words")]
    assert kept == ["バス"]


def test_answered_words_survive_pruning(tmp_path, monkeypatch):
    conn = setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
        {"katakana": "パン", "meaning": "bread", "level": 1},
    ])
    word_id = conn.execute(
        "SELECT id FROM words WHERE katakana = 'パン'"
    ).fetchone()["id"]
    game.submit_answer(conn, word_id, "pan", 1200)

    write_words(tmp_path, [{"katakana": "バス", "meaning": "bus", "level": 1}])
    db.seed_words(conn)
    kept = {r["katakana"] for r in conn.execute("SELECT katakana FROM words")}
    assert kept == {"バス", "パン"}  # history keeps パン alive
    assert conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0] == 1


def test_rating_shifts_with_base_rating(tmp_path, monkeypatch):
    conn = setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
    ])
    conn.execute("UPDATE words SET rating = rating + 40 WHERE katakana = 'バス'")
    before = conn.execute(
        "SELECT rating, base_rating FROM words WHERE katakana = 'バス'"
    ).fetchone()

    # same word, harder level -> base rating jumps, learned offset survives
    write_words(tmp_path, [{"katakana": "バス", "meaning": "bus", "level": 3}])
    db.seed_words(conn)
    after = conn.execute(
        "SELECT rating, base_rating FROM words WHERE katakana = 'バス'"
    ).fetchone()
    assert after["base_rating"] > before["base_rating"]
    assert round(after["rating"] - after["base_rating"], 6) == round(
        before["rating"] - before["base_rating"], 6
    )
