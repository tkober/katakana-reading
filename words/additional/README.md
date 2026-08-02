# Additional vocabulary

Drop extra `*.json` files here (e.g. `business_words.json`, `movies.json`).
They are **ignored by git** and picked up by the backend on startup — handy
while developing locally.

> **For a deployment, upload instead.** The published images are built by
> GitHub Actions, which never sees these files, so only `basic/` ships inside
> them. Use the *Dictionaries* tab to upload the same JSON: it is stored in the
> database, survives image updates, and stays off GitHub. The tab also offers a
> template download and can export any dictionary back to this format.

Format — a JSON list of entries, same as `../basic/basic.json`:

```json
[
  { "katakana": "ミーティングルーム", "meaning": "meeting room", "level": 5 },
  { "katakana": "プレゼンテーション", "meaning": "presentation", "level": 4 }
]
```

- `level`: 1 (easy) … 5 (hard) — only the starting difficulty; ratings
  self-calibrate afterwards.
- Romaji is generated automatically from the katakana; small kana must be the
  correct Unicode characters (ィ vs. イ).
- Duplicate katakana: files in `additional/` override `basic/`, and uploaded
  dictionaries override both.
- Validate everything with `cd backend && uv run pytest` (the roundtrip test
  covers every loaded word), then rebuild: `docker compose up --build -d`.
