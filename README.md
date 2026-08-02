# Katakana Trainer

Kleine selbst-gehostete Web-App zum Üben des Katakana-Lesens: Wort in Katakana
lesen, Romaji eintippen, Feedback pro Kana bekommen. Die App passt die
Schwierigkeit per Elo-System laufend an und übt gezielt deine schwachen Kana.

## Starten (Docker)

```bash
docker compose up --build -d
```

Dann <http://localhost:8080> öffnen. Der Stack besteht aus drei Containern:
Postgres, dem FastAPI-Backend und einem nginx, das die Angular-App ausliefert
und `/api` ans Backend weiterreicht. Der Fortschritt liegt im Volume
`katakana-db` und überlebt Neustarts und Rebuilds.

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
- **Eigenes Vokabular** — im Tab *Dictionaries* eine JSON-Liste hochladen
  (Vorlage gibt es dort zum Download). Hochgeladene Wörterbücher liegen in der
  Datenbank, überleben also Updates und landen nie im Image oder auf GitHub.
  Jedes Wörterbuch lässt sich wieder als JSON exportieren.
  Das Basis-Wörterbuch steht als `words/basic/basic.json` im Repo; lokal kann
  man zusätzlich `words/additional/*.json` ablegen (git-ignoriert) — Format
  siehe [words/additional/README.md](words/additional/README.md).

## Entwicklung

```bash
docker compose up -d postgres                        # DB auf :5432
cd backend && cp .env.example .env                   # DB_*-Variablen füllen
cd backend && uv run uvicorn app.main:app --reload   # API auf :8000
cd frontend && npm start                             # UI auf :4200 (Proxy → :8000)
cd backend && uv run pytest                          # Tests (starten selbst ein Postgres)
```

## Deployment

Backend und Frontend werden von GitHub Actions als getrennte Images nach GHCR
gebaut (`ghcr.io/tkober/katakana-reading-backend` bzw. `…-frontend`). Sie
verbinden sich mit zwei Rollen gegen eine bestehende Postgres-Instanz:
`katakana_owner` (nur beim Start, für DDL + Vokabular) und `katakana_app` (alle
Requests). Das einmalige Anlegen von Datenbank und Rollen erledigen
[dbeaver/create_users_and_db.sql](dbeaver/create_users_and_db.sql) und
[dbeaver/grant_privileges.sql](dbeaver/grant_privileges.sql).

Mehr Details für (Coding-)Agenten und Menschen: [CLAUDE.md](CLAUDE.md).
