# Katakana Trainer

Kleine selbst-gehostete Web-App zum Üben des Katakana-Lesens: Wort in Katakana
lesen, Romaji eintippen, Feedback pro Kana bekommen. Die App passt die
Schwierigkeit per Elo-System laufend an und übt gezielt deine schwachen Kana.

## Starten (Docker)

```bash
docker compose up --build -d
```

Dann <http://localhost:8080> öffnen. Der Fortschritt liegt als SQLite-Datei im
Docker-Volume `katakana-data` und überlebt Neustarts und Rebuilds.

## Features

- **Adaptive Wortauswahl** — Elo-basiert (Wörter und User haben Ratings),
  regelmäßige „Probe“-Wörter oberhalb deines Levels, Gewichtung auf Kana mit
  niedriger Konfidenz.
- **Auswertung pro Kana** — auch bei falscher Antwort siehst du, welche Kana
  du richtig gelesen hast. Hepburn und Kunrei werden akzeptiert
  (`shi`/`si`, `koohii`/`kōhī`/`ko-hi-`, `matchi`/`macchi`, `shanpuu`/`shampuu`).
- **Statistik** — Level & Elo-Verlauf, Genauigkeit, Lesetempo (pro Kana und
  pro Wort), Streaks, Gojūon-Heatmap deiner Kana-Konfidenz.
- **Reset mit Mehrfach-Bestätigung** in den Einstellungen.
- **Eigenes Vokabular** — Basis-Wörterbuch in `words/basic/basic.json`;
  eigene Listen einfach als `words/additional/*.json` ablegen (bleiben
  außerhalb von git, landen aber im Docker-Image). Format: siehe
  [words/additional/README.md](words/additional/README.md).

## Entwicklung

```bash
cd backend && uv run uvicorn app.main:app --reload   # API auf :8000
cd frontend && npm start                             # UI auf :4200 (Proxy → :8000)
cd backend && uv run pytest                          # Tests
```

Mehr Details für (Coding-)Agenten und Menschen: [CLAUDE.md](CLAUDE.md).
