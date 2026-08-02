# Additional vocabulary

Drop extra `*.json` files here (e.g. `business_words.json`, `movies.json`).
They are **ignored by git** but picked up by the backend on startup and baked
into the Docker image at build time.

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
- Duplicate katakana: files in `additional/` override `basic/`.
- Validate everything with `cd backend && uv run pytest` (the roundtrip test
  covers every loaded word), then rebuild: `docker compose up --build -d`.
