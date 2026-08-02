import json

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    words = tmp_path / "words" / "basic" / "basic.json"
    words.parent.mkdir(parents=True)
    words.write_text(
        json.dumps([
            {"katakana": "バス", "meaning": "bus", "level": 1},
            {"katakana": "コーヒー", "meaning": "coffee", "level": 2},
            {"katakana": "ファッション", "meaning": "fashion", "level": 5},
        ], ensure_ascii=False),
        encoding="utf-8",
    )
    extra = tmp_path / "words" / "additional" / "sap.json"
    extra.parent.mkdir(parents=True)
    extra.write_text(
        json.dumps([{"katakana": "ジュール", "meaning": "Joule", "level": 3}],
                   ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("WORDS_DIR", str(tmp_path / "words"))
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    conn = db.get_conn()
    db.init_db(conn)
    conn.close()
    with TestClient(app) as c:
        yield c


def test_dictionaries_summary(client):
    body = client.get("/api/dictionaries").json()
    by_name = {d["source"]: d for d in body["dictionaries"]}
    assert set(by_name) == {"basic", "sap"}
    assert by_name["basic"]["total"] == 3
    assert by_name["sap"]["total"] == 1
    assert body["all"]["total"] == 4

    levels = {row["level"]: row["count"] for row in by_name["basic"]["levels"]}
    assert levels == {1: 1, 2: 1, 3: 0, 4: 0, 5: 1}
    # コーヒー tokenizes to 4 kana, バス to 2, ファッション to 4 -> avg 3.3
    assert by_name["basic"]["avg_kana"] == pytest.approx(3.3, abs=0.1)
    assert by_name["basic"]["rating_min"] < by_name["basic"]["rating_max"]


def test_words_filtering_and_search(client):
    all_words = client.get("/api/words").json()
    assert all_words["total"] == 4

    only_sap = client.get("/api/words", params={"source": "sap"}).json()
    assert only_sap["total"] == 1
    assert only_sap["words"][0]["katakana"] == "ジュール"

    lvl5 = client.get("/api/words", params={"level": 5}).json()
    assert [w["katakana"] for w in lvl5["words"]] == ["ファッション"]

    # search hits romaji and meaning too
    assert client.get("/api/words", params={"q": "koohii"}).json()["total"] == 1
    assert client.get("/api/words", params={"q": "bus"}).json()["total"] == 1


def test_profile_endpoint(client):
    body = client.get("/api/profile").json()
    assert body["elo"] == 1000.0
    assert body["level"] >= 1
    assert body["streak"] == 0


def test_answer_reports_source_dictionary(client):
    word_id = client.get("/api/words", params={"source": "sap"}).json()
    assert word_id["words"][0]["katakana"] == "ジュール"
    listing = client.get("/api/words", params={"q": "ジュール"}).json()
    assert listing["total"] == 1

    # answering reveals which dictionary the word came from
    all_words = client.get("/api/words").json()["words"]
    target = next(w for w in all_words if w["katakana"] == "ジュール")
    ids = client.get("/api/word/next").json()  # ensures the endpoint works
    assert "word_id" in ids
    body = client.post(
        "/api/answer",
        json={"word_id": _id_of(client, target["katakana"]), "answer": "juuru",
              "time_ms": 1000},
    ).json()
    assert body["source"] == "sap"
    assert body["correct"] is True


def _id_of(client, katakana: str) -> int:
    """The public API exposes no ids in /api/words, so walk /word/next is not
    reliable — read it straight from the db the app just seeded."""
    import os
    import sqlite3

    conn = sqlite3.connect(os.environ["DB_PATH"])
    try:
        return conn.execute(
            "SELECT id FROM words WHERE katakana = ?", (katakana,)
        ).fetchone()[0]
    finally:
        conn.close()


def test_words_pagination_and_generated_fields(client):
    page = client.get("/api/words", params={"limit": 2, "sort": "alpha"}).json()
    assert len(page["words"]) == 2
    assert page["total"] == 4
    word = page["words"][0]
    assert word["romaji"] and word["kana_count"] > 0
