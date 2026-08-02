import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from app import config, db
from app.main import app


@pytest.fixture
def client(db_schema, tmp_path, monkeypatch):
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
    # TestClient runs the lifespan, which creates the schema and seeds.
    with TestClient(app) as c:
        yield c


def test_dictionaries_summary(client):
    body = client.get("/api/dictionaries").json()
    by_name = {d["source"]: d for d in body["dictionaries"]}
    assert set(by_name) == {"basic", "sap"}
    assert by_name["basic"]["total"] == 3
    assert by_name["sap"]["total"] == 1
    assert by_name["basic"]["origin"] == "file"
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

    # search hits romaji and meaning too, case-insensitively
    assert client.get("/api/words", params={"q": "koohii"}).json()["total"] == 1
    assert client.get("/api/words", params={"q": "bus"}).json()["total"] == 1
    assert client.get("/api/words", params={"q": "BUS"}).json()["total"] == 1


def test_profile_endpoint(client):
    body = client.get("/api/profile").json()
    assert body["elo"] == 1000.0
    assert body["level"] >= 1
    assert body["streak"] == 0


def test_answer_reports_source_dictionary(client):
    listing = client.get("/api/words", params={"q": "ジュール"}).json()
    assert listing["total"] == 1

    ids = client.get("/api/word/next").json()  # ensures the endpoint works
    assert "word_id" in ids

    # answering reveals which dictionary the word came from
    body = client.post(
        "/api/answer",
        json={"word_id": _id_of("ジュール"), "answer": "juuru", "time_ms": 1000},
    ).json()
    assert body["source"] == "sap"
    assert body["correct"] is True


def test_stats_after_an_answer(client):
    client.post(
        "/api/answer",
        json={"word_id": _id_of("バス"), "answer": "basu", "time_ms": 900},
    )
    body = client.get("/api/stats").json()
    assert body["total_attempts"] == 1
    assert body["correct_attempts"] == 1
    assert body["accuracy"] == 1.0
    assert body["avg_time_ms"] == 900
    assert len(body["elo_history"]) == 1
    assert body["recent"][0]["katakana"] == "バス"
    assert body["recent"][0]["created_at"]  # ISO-8601 straight from timestamptz
    assert {r["kana"] for r in body["kana"]} == {"バ", "ス"}
    levels = {row["key"]: row for row in body["coverage"]["levels"]}
    assert levels["1"]["seen"] == 1


def test_words_pagination_and_generated_fields(client):
    page = client.get("/api/words", params={"limit": 2, "sort": "alpha"}).json()
    assert len(page["words"]) == 2
    assert page["total"] == 4
    word = page["words"][0]
    assert word["romaji"] and word["kana_count"] > 0


def test_upload_dictionary_adds_words(client):
    body = client.post(
        "/api/dictionaries",
        json={"name": "Work Stuff", "entries": [
            {"katakana": "サーバー", "meaning": "server", "level": 3},
            {"katakana": "データ", "meaning": "data", "level": 2},
        ]},
    )
    assert body.status_code == 201
    result = body.json()
    assert result["source"] == "work-stuff"  # normalized
    assert result["replaced"] is False
    assert result["words"] == 2

    listing = client.get("/api/words", params={"source": "work-stuff"}).json()
    assert {w["katakana"] for w in listing["words"]} == {"サーバー", "データ"}
    assert listing["words"][0]["romaji"]  # generated on seed, never uploaded

    dicts = {d["source"]: d for d in client.get("/api/dictionaries").json()["dictionaries"]}
    assert dicts["work-stuff"]["origin"] == "upload"
    assert dicts["work-stuff"]["uploaded_at"]


def test_upload_rejects_invalid_entries(client):
    body = client.post(
        "/api/dictionaries",
        json={"name": "broken", "entries": [
            {"katakana": "サーバー", "meaning": "server", "level": 3},
            {"katakana": "サーバー", "meaning": "server", "level": 9},
            {"katakana": "not katakana", "meaning": "nope", "level": 1},
        ]},
    )
    assert body.status_code == 400
    errors = body.json()["detail"]["errors"]
    assert len(errors) == 2
    assert any("level" in e for e in errors)
    assert any("katakana" in e for e in errors)
    # nothing was stored — an upload is all or nothing
    assert client.get("/api/words", params={"source": "broken"}).json()["total"] == 0


def test_upload_cannot_shadow_a_file_dictionary(client):
    body = client.post(
        "/api/dictionaries",
        json={"name": "basic", "entries": [
            {"katakana": "サーバー", "meaning": "server", "level": 3},
        ]},
    )
    assert body.status_code == 409


def test_upload_replaces_a_previous_version(client):
    entries = [{"katakana": "サーバー", "meaning": "server", "level": 3}]
    client.post("/api/dictionaries", json={"name": "work", "entries": entries})
    again = client.post(
        "/api/dictionaries",
        json={"name": "work", "entries": [
            {"katakana": "データ", "meaning": "data", "level": 2},
        ]},
    ).json()
    assert again["replaced"] is True
    listing = client.get("/api/words", params={"source": "work"}).json()
    assert [w["katakana"] for w in listing["words"]] == ["データ"]


def test_delete_dictionary(client):
    client.post(
        "/api/dictionaries",
        json={"name": "work", "entries": [
            {"katakana": "サーバー", "meaning": "server", "level": 3},
        ]},
    )
    body = client.delete("/api/dictionaries/work").json()
    assert body == {"source": "work", "removed": 1, "kept": 0}
    assert client.get("/api/words", params={"source": "work"}).json()["total"] == 0
    assert client.delete("/api/dictionaries/work").status_code == 404


def test_template_is_a_valid_upload(client):
    template = client.get("/api/dictionaries/template")
    assert "attachment" in template.headers["content-disposition"]
    body = client.post(
        "/api/dictionaries", json={"name": "from-template", "entries": template.json()}
    )
    assert body.status_code == 201


def test_export_round_trips(client):
    export = client.get("/api/dictionaries/basic/export")
    assert "attachment" in export.headers["content-disposition"]
    entries = export.json()
    assert {e["katakana"] for e in entries} == {"バス", "コーヒー", "ファッション"}
    assert set(entries[0]) == {"katakana", "meaning", "level"}  # upload format

    body = client.post("/api/dictionaries", json={"name": "copy", "entries": entries})
    assert body.status_code == 201
    assert client.get("/api/dictionaries/unknown/export").status_code == 404


def _id_of(katakana: str) -> int:
    """Word ids stay out of the public API, so read one straight from the DB.

    Runs on its own engine: the cached one belongs to the TestClient's event
    loop, and asyncpg connections cannot be used from another.
    """

    async def query() -> int:
        engine = create_async_engine(config.app_database_url())
        try:
            async with engine.connect() as conn:
                return await conn.scalar(
                    select(db.Word.id).where(db.Word.katakana == katakana)
                )
        finally:
            await engine.dispose()

    return asyncio.run(query())
