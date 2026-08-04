import json

from sqlalchemy import func, select

from app import db, game


def write_words(tmp_path, entries, name="basic/basic.json"):
    path = tmp_path / "words" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


async def setup_db(tmp_path, monkeypatch, entries):
    monkeypatch.setenv("WORDS_DIR", str(tmp_path / "words"))
    write_words(tmp_path, entries)
    await db.init_db()


async def katakana_in(session) -> set[str]:
    return set((await session.execute(select(db.Word.katakana))).scalars())


async def test_removed_words_are_pruned(session, tmp_path, monkeypatch):
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
        {"katakana": "パン", "meaning": "bread", "level": 1},
    ])
    assert len(await katakana_in(session)) == 2

    # パン disappears from the dictionary -> gone on next seed
    write_words(tmp_path, [{"katakana": "バス", "meaning": "bus", "level": 1}])
    await db.seed_words(session)
    await session.commit()
    assert await katakana_in(session) == {"バス"}


async def test_answered_words_survive_pruning(session, tmp_path, monkeypatch):
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
        {"katakana": "パン", "meaning": "bread", "level": 1},
    ])
    word_id = await session.scalar(
        select(db.Word.id).where(db.Word.katakana == "パン")
    )
    await game.submit_answer(session, word_id, "pan", 1200)

    write_words(tmp_path, [{"katakana": "バス", "meaning": "bus", "level": 1}])
    await db.seed_words(session)
    await session.commit()
    assert await katakana_in(session) == {"バス", "パン"}  # history keeps パン alive
    assert await session.scalar(select(func.count()).select_from(db.Attempt)) == 1


async def test_slow_but_correct_review_word_costs_nothing(
    session, tmp_path, monkeypatch
):
    """The real case from the DB: イタリア (730) answered right but slowly at
    Elo 1183 used to cost ~3 Elo. Same word rating, same distance, through
    the actual submit_answer path."""
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "イタリア", "meaning": "Italy", "level": 1},
    ])
    word = await session.scalar(select(db.Word).where(db.Word.katakana == "イタリア"))
    word.rating = 730.0
    user = await game.get_user(session)
    user.elo = 1183.4
    await session.commit()
    word_rating_before = word.rating

    slow = game.target_time_ms(4) + 3000
    result = await game.submit_answer(session, word.id, "itaria", slow)

    assert result["correct"] and not result["fast"]
    assert result["elo"]["delta"] == 0.0
    await session.refresh(word)
    assert word.rating == word_rating_before  # nothing learned, nothing moved

    # ... while getting it wrong on the same easy word still stings
    user.elo = 1183.4
    await session.commit()
    wrong = await game.submit_answer(session, word.id, "itaru", slow)
    assert not wrong["correct"]
    assert wrong["elo"]["delta"] < -20


async def test_rating_shifts_with_base_rating(session, tmp_path, monkeypatch):
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
    ])
    word = await session.scalar(select(db.Word).where(db.Word.katakana == "バス"))
    word.rating += 40
    await session.commit()
    before_rating, before_base = word.rating, word.base_rating

    # same word, harder level -> base rating jumps, learned offset survives
    write_words(tmp_path, [{"katakana": "バス", "meaning": "bus", "level": 3}])
    await db.seed_words(session)
    await session.commit()
    await session.refresh(word)
    assert word.base_rating > before_base
    assert round(word.rating - word.base_rating, 6) == round(
        before_rating - before_base, 6
    )


async def test_uploaded_dictionary_extends_and_overrides(session, tmp_path, monkeypatch):
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
    ])
    await db.save_dictionary(session, "work", [
        {"katakana": "バス", "meaning": "bus (work)", "level": 2},
        {"katakana": "サーバー", "meaning": "server", "level": 3},
    ])

    words = {
        w.katakana: w for w in (await session.execute(select(db.Word))).scalars()
    }
    assert set(words) == {"バス", "サーバー"}
    assert words["サーバー"].source == "work"
    # the upload wins over the file entry it shadows
    assert words["バス"].meaning == "bus (work)"
    assert words["バス"].source == "work"


async def test_deleting_a_dictionary_removes_its_unanswered_words(
    session, tmp_path, monkeypatch
):
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
    ])
    await db.save_dictionary(session, "work", [
        {"katakana": "サーバー", "meaning": "server", "level": 3},
        {"katakana": "データ", "meaning": "data", "level": 2},
    ])
    answered = await session.scalar(
        select(db.Word.id).where(db.Word.katakana == "データ")
    )
    await game.submit_answer(session, answered, "deeta", 1500)

    removed = await db.delete_dictionary(session, "work")
    assert removed == 1  # サーバー goes, データ stays for its history
    assert await katakana_in(session) == {"バス", "データ"}
    assert await db.uploaded_dictionaries(session) == {}


async def test_stored_dictionary_survives_a_broken_entry(
    session, tmp_path, monkeypatch
):
    """A bad row must never keep the app from booting — it is skipped, and the
    rest of the dictionary still seeds."""
    await setup_db(tmp_path, monkeypatch, [
        {"katakana": "バス", "meaning": "bus", "level": 1},
    ])
    session.add(
        db.Dictionary(
            name="broken",
            entries=[
                {"katakana": "サーバー", "meaning": "server", "level": 3},
                {"katakana": "not katakana", "meaning": "nope", "level": 1},
            ],
        )
    )
    await session.commit()

    await db.seed_words(session)
    await session.commit()
    assert await katakana_in(session) == {"バス", "サーバー"}
