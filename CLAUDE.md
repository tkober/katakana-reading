# Katakana Reading Practice

Adaptive Web-App zum Üben des Katakana-Lesens: Es wird ein Wort in Katakana
angezeigt, der (einzige, globale) User tippt die Romaji-Lesung. Die App wertet
pro Kana aus, was richtig gelesen wurde, trackt Konfidenz je Kana, Lesetempo
und ein Elo-basiertes Level, und wählt die nächsten Wörter adaptiv danach aus.

## Architektur

```
frontend/   Angular 20 (standalone components, signals, Router)
            + Dockerfile (Node-Build → nginx) + nginx.conf
backend/    FastAPI + PostgreSQL (SQLAlchemy async/asyncpg), verwaltet mit uv
            + Dockerfile (uv-Image, uvicorn)
words/      Basis-Vokabular als JSON: basic/ (in git) + additional/ (gitignored)
dbeaver/    Einmaliges DB-Bootstrap (Rollen, Datenbank, Default-Privileges)
dev/initdb/ Dieselben Rollen für den lokalen Postgres-Container
compose.yaml  Lokaler Stack: Postgres + Backend + Frontend auf :8080
```

**Zwei Container plus Datenbank.** nginx liefert die SPA aus und proxyt `/api/`
intern ans Backend (`API_UPSTREAM`, Default `katakana-reading-backend:8000`) —
dadurch ruft das Frontend die API immer *same-origin* auf, egal über welche
Adresse man die App erreicht, und CORS spielt keine Rolle. Der Backend-Port
muss nicht veröffentlicht werden.

**Zwei DB-Rollen** (Muster aus `tkober/trip-planner`): `katakana_owner` läuft
nur beim Start (DDL + Vokabular-Seeding), `katakana_app` bedient alle Requests
und darf kein DDL. Die Rechte des App-Users kommen aus serverseitigem
`ALTER DEFAULT PRIVILEGES` — der Code vergibt selbst **kein** GRANT.
`DB_URL` trägt nur host/port/database, Credentials kommen je Rolle dazu.

### Backend-Module (`backend/app/`)

- `kana.py` — Herzstück. Tokenizer (Katakana → Tokens inkl. Digraphen キャ,
  erweiterte Kana ファ/ティ/ウェ…, Sokuon ッ, Chōon ー, kontextabhängiges ン)
  und Auswertung: Segment-Level-Edit-Distance-DP richtet die User-Eingabe an
  den Tokens aus → pro Token korrekt/falsch, auch bei insgesamt falscher
  Antwort. Akzeptiert Hepburn- und Kunrei-Varianten (shi/si, matchi/macchi,
  shanpuu/shampuu, Makronen, `-` für ー). Tie-Breaker: bei gleichem
  Edit-Abstand gewinnt die Zuordnung mit mehr exakt getroffenen Voll-Kana.
- `config.py` — Env-Konfiguration (`DB_URL`, `DB_USER`/`DB_PASSWORD`,
  `DB_OWNER_USER`/`DB_OWNER_PASSWORD`, `CORS_ORIGINS`). Die URLs werden als
  **Funktionen** exponiert, nicht als Modulkonstanten: die Tests biegen die
  DB um, nachdem die Module längst importiert sind.
- `words.py` — Laden **und Validieren** des Vokabulars, für beide Quellen:
  JSON-Dateien unter `words/` (env `WORDS_DIR`, im Container `/app/words`) und
  hochgeladene Wörterbücher aus der DB. `validate_entries()` ist die einzige
  Instanz, die entscheidet, was ein gültiger Eintrag ist (Keys, Level 1–5,
  und **Tokenisierbarkeit** via `to_romaji`) — sie liefert gültige Einträge +
  Fehlermeldungen, ohne zu werfen. `parse_entries()` ist die strenge Variante
  für Dateien (fail fast). Ladereihenfolge deterministisch (basic zuerst,
  Rest nach Pfad sortiert); bei doppeltem Katakana gewinnt die spätere Datei,
  Uploads gewinnen über alle Dateien. Eintragsformat:
  `{"katakana": …, "meaning": …, "level": 1-5}`. Jedes Wort bekommt ein
  `source`-Label für die Coverage-Statistik: "basic" bzw. Dateiname ohne
  Endung (sap.json → "sap") bzw. der Upload-Name. Bedeutungen auf Englisch
  (Wunsch des Users: Lernmaterialien sind englisch, Lehnwörter stammen meist
  aus dem Englischen); UI-Sprache ist ebenfalls Englisch. **Romaji wird
  NICHT gepflegt** — es wird beim Seeden aus dem Tokenizer generiert
  (`to_romaji`), damit Wörterbuch und Auswertung nie auseinanderlaufen.
  Der Roundtrip-Test validiert jedes geladene Wort automatisch.
- `game.py` — Elo mit asymmetrischem K (User: Gewinn K=20, Verlust K=36 —
  langsamer Aufstieg, hartes Bestrafen; Wort K=16, Start 1000). Level 1–20,
  75 Elo pro Level ab 750. Wortauswahl: Pool ±160 Elo um den User, gewichtet
  nach Kana-Schwächen (EWMA), 15 % „Probe“-Wörter oberhalb (+120…+400) und
  12 % „Review“-Wörter deutlich unterhalb (−250…−600; Versagen kostet dank
  Elo-Erwartung + K=36 ~30 Punkte), keine Wiederholung der letzten 8 Wörter.
  Score: richtig & schnell = 1.0, richtig aber langsam = 0.85, falsch =
  0.35 × Kana-Quote. Zeitziel: 1500 ms + 700 ms pro Kana.
- `db.py` — ORM-Modelle, Engines und Seeding. Die App-Engine wird **lazy**
  erzeugt (`get_engine()`/`get_sessionmaker()`, `reset_engines()` für Tests
  und Shutdown), `get_session()` ist die FastAPI-Dependency. `init_db()`
  öffnet eine kurzlebige **Owner**-Engine, legt das Schema an
  (`Base.metadata.create_all`) und seedet in derselben Session.
  `desired_words()` merged Datei-Dicts + Uploads (Uploads gewinnen) und
  **re-validiert gespeicherte Uploads**, wobei kaputte Einträge nur geloggt
  und übersprungen werden — ein schlechter Eintrag darf den Start nie
  blockieren. `seed_words()` macht daraus einen Multi-Row-Upsert
  (Meaning/Level/Source werden aktualisiert; ändert sich das base_rating —
  z. B. durch Rebalancing der Formel — wird das dynamische Rating um dieselbe
  Differenz verschoben, die gelernte Kalibrierung bleibt erhalten),
  gefolgt von `prune_words` (entfernt Wörter, die in keinem Wörterbuch mehr
  stehen, sofern sie noch nie beantwortet wurden — sonst würde die
  Antwort-Historie mit gelöscht). Dazu `save_dictionary`/`delete_dictionary`
  (beide seeden direkt nach) und `reset_all` (Uploads bleiben — sie sind
  Vokabular, kein Fortschritt).
  Basis-Rating: 750 + (Level−1)·250 ± Längen-Nudge (max ±80) → ~690–1810.
- `main.py` — App-Setup, Lifespan (`init_db` beim Start, Engine-Dispose beim
  Stop) und CORS aus der Env. **Keine Statics mehr** — die SPA liefert nginx.
- `api.py` — Routen: `GET /api/profile` (schlanker Header-State),
  `GET /api/word/next`, `POST /api/answer` (Antwort enthält u. a. `source`,
  wird bei der Auflösung angezeigt),
  `GET /api/stats`, `GET /api/dictionaries` (Zusammensetzung je Source:
  Level-Mix, Ø/Min/Max Kana pro Wort, Rating-Spanne, geübt/Erfolgsquote,
  `origin` file|upload + `uploaded_at`),
  `POST /api/dictionaries` (Upload: Name wird auf `[a-z0-9_-]` normalisiert,
  Datei-Sources sind reserviert → 409, ungültige Einträge → 400 mit
  Fehlerliste; gleicher Name ersetzt),
  `DELETE /api/dictionaries/{name}`, `GET /api/dictionaries/template`
  (Beispiel-JSON als Download), `GET /api/dictionaries/{name}/export`
  (jedes Wörterbuch als Upload-JSON, auch die eingebauten → Backup-Pfad),
  `GET /api/words` (filter- und seitenweise Wortliste: `source`, `level`,
  `q` über katakana/romaji/meaning, `sort`, `limit`≤500, `offset`),
  `POST /api/reset` (verlangt `{"confirm": "RESET"}`), `GET /api/health`.

### Datenmodell (PostgreSQL)

- `user_profile` (id=1, CHECK) — elo, current_streak, best_streak
- `words` — katakana, romaji (generiert), meaning, level, source,
  rating (dynamisch), base_rating, times_served/correct
- `attempts` — Antwort-Historie inkl. time_ms, kana_correct/total, elo
  before/after, `correct` als **boolean**, `created_at` als timestamptz
- `kana_stats` — pro Token-Key (`キ`, `キャ`, `ッ`, `ー`, …): attempts, correct,
  EWMA-Konfidenz (α=0.2)
- `dictionaries` — hochgeladene Wortlisten: name (PK), entries (JSONB, das
  validierte Original), uploaded_at. Datei-Wörterbücher haben hier **keine**
  Zeile — genau diese Abwesenheit unterscheidet „built-in" von „uploaded".

### Frontend (`frontend/src/app/`)

- `app.component.ts` — Shell: Router-Outlet + Tab-Links (routerLinkActive)
  und Header mit Level/Elo/Streak-Chips (geteiltes Signal in
  `api.service.ts`, beim Start über `/api/profile` befüllt, damit die Chips
  auch bei einem Deep-Link auf `/dictionaries` stimmen).
- `routes.ts` — Routen + Seitentitel.
- `practice.component.ts` — Übungsansicht mit explizitem Session-Lebenszyklus
  (`idle` → `active` → `ended`): Die Session startet **nicht** automatisch,
  der Timer läuft erst ab dem ersten Wort. „End session" zeigt eine
  Zusammenfassung (Wörter, Trefferquote, Ø-Zeit, Elo-Delta). Wort-Karte,
  Timer, Romaji-Input, Feedback pro Kana-Token (✓/✕), Enter-Flow
  (prüfen → weiter), Herkunfts-Dictionary als Chip bei der Auflösung.
- `stats.component.ts` — KPI-Kacheln, Elo-Sparkline (SVG), schwächste Kana,
  Vocabulary-Coverage (gesehen/gesamt + Success-Rate, je Level und je
  Source-Dictionary), Recent-Tabelle.
- `dictionaries.component.ts` — Tab „Dictionaries": pro Wörterbuch eine Karte
  (Level-Verteilung als gestapelter Balken mit 2px-Lücken + Zahlen darunter,
  Wortlänge, Rating-Spanne, geübt, Erfolgsquote, Herkunfts-Chip
  built-in/uploaded, Export-Link, bei Uploads zweistufiges Löschen)
  + Upload-Panel (Datei wählen → JSON wird im Browser geparst, Name aus dem
  Dateinamen vorbelegt, Fehler des Backends werden pro Eintrag angezeigt;
  Template-Download als normaler `<a download>`) + filterbarer Wort-Browser
  (Dictionary/Level/Suche/Sortierung, 50 pro Seite, Suche entprellt).
- `heatmap.component.ts` — Gojūon-Grid + Chips für Kombinationen (キャ, ファ, ッ,
  ー …), nutzt die geteilte Skala aus `ramp.ts`.
- `ramp.ts` — sequenzielle Ein-Farb-Skala (blau, hell→dunkel = mehr; dark mode:
  Ramp umgekehrt, damit „mehr“ immer vom Hintergrund wegläuft). Jede Stufe
  bringt ihre Label-Tinte mit (≥ 5:1 auf der Füllung). Genutzt von der
  Kana-Heatmap **und** den Success-Rate-Kacheln der Vocabulary-Coverage —
  gleiche Bedeutung, gleiche Farbsprache. Zusätzlich `LEVEL_COLORS` /
  `levelColor()`: **ordinale** 5-Stufen-Skala für die Level 1–5 (eigene
  Stufen, weil ordinal ≥2:1 zur Surface halten muss — ein dünnes Segment im
  Stapelbalken darf nicht im Hintergrund verschwinden). Farben stammen aus
  der validierten Referenzpalette des dataviz-Skills — dort validieren.
- Light + Dark Mode über CSS Custom Properties in `styles.css`.

## Entwicklung

```bash
# Postgres für die lokale Entwicklung (legt via dev/initdb beide Rollen an)
docker compose up -d postgres

# Backend (Port 8000) — DB_* aus backend/.env, Vorlage: backend/.env.example
cd backend && uv run uvicorn app.main:app --reload

# Tests (49): starten selbst ein Postgres per testcontainers → Docker muss
# laufen. TEST_DB_URL=… zeigt stattdessen auf eine vorhandene DB.
cd backend && uv run pytest

# Frontend-Dev-Server (Port 4200, proxied /api → 8000)
cd frontend && npm start

# Kompletter Stack lokal (Port 8080, Volume katakana-db)
docker compose up --build -d
```

## Deployment

- Zwei GHCR-Images, gebaut von `.github/workflows/publish-{backend,frontend}.yml`
  (path-gefiltert, Tags `latest`/semver/`sha`, gha-Cache):
  `ghcr.io/tkober/katakana-reading-backend` und `…-frontend`.
  **Der Backend-Build-Context ist das Repo-Root**, weil `words/` außerhalb von
  `backend/` liegt (`file: ./backend/Dockerfile`).
- Der Stack liegt in `tkober/compose-stacks-unraid` unter `katakana_reading/`
  (Frontend auf Port 8083, Backend nur intern, beide am externen Netz
  `postgres-core-net`). Einmaliges DB-Bootstrap: die beiden SQL-Dateien aus
  `dbeaver/`.
- **Nur `basic` ist im Image.** `words/additional/*.json` ist gitignored,
  liegt im Actions-Checkout also nicht vor — private Wortlisten kommen über
  den Upload im Dictionaries-Tab in die Datenbank und überleben dort jedes
  Image-Update.

## Konventionen & Fallstricke

- Python 3.12+, SQLAlchemy 2.0 async (asyncpg). Alles unterhalb von `api.py`
  ist `async`; `game.py` bekommt die `AsyncSession` durchgereicht.
- **Postgres ≠ SQLite**, beim Portieren von Queries beachten: `LIKE` ist hier
  case-sensitiv (die Wortsuche nutzt deshalb `ilike`), `correct` ist ein
  `boolean` (Aggregate über `count().filter(...)`, nicht `SUM`), und
  `created_at` kommt als ISO-8601 mit Offset zurück (das Frontend braucht
  keine Nachbearbeitung mehr).
- Romaji-Kanonik: lange Vokale als Doppelvokal (`koohii`), ッ als
  Konsonantenverdopplung (`matchi` kanonisch, `macchi` akzeptiert).
- Kleine Kana (ャュョァィゥェォ) existieren nie als eigene Tokens — nur als Teil
  von Digraphen. Bei neuen Wörtern auf korrekte kleine Zeichen achten
  (ィ U+30A3 vs. イ U+30A4)!
- `kana_stats` ist pro **Token** gekeyt (キャ ≠ キ), die Heatmap zeigt
  Einzel-Kana im Grid und Kombinationen als Chips darunter.
- Seeding läuft bei jedem Start (Lifespan-Hook) **und nach jedem
  Upload/Löschen** eines Wörterbuchs, und es **pruned**: Wörter, die in keinem
  Wörterbuch mehr stehen, werden gelöscht — außer sie wurden schon beantwortet
  (FK auf attempts, Historie bleibt erhalten). Ein gelöschtes Upload-Dict kann
  also beantwortete Wörter zurücklassen; die UI sagt das dazu.
- Uploads sind **alles-oder-nichts** (ein kaputter Eintrag lehnt die Datei ab),
  gespeicherte Uploads werden beim Seeden dagegen **tolerant** gelesen. Grund:
  was einmal in der DB liegt, wird bei jedem Boot neu gelesen — ein Eintrag,
  der den Tokenizer wirft, würde den Container sonst in eine Crash-Schleife
  schicken.
- Angular: standalone components, neue Control-Flow-Syntax (`@if`/`@for`),
  inline templates/styles. Router mit echten Pfaden (`/practice`, `/stats`,
  `/dictionaries`, `/settings`) — **deshalb braucht nginx den SPA-Fallback**
  (`try_files … /index.html` in `frontend/nginx.conf`): ohne ihn liefert ein
  Reload auf `/stats` einen 404. Beim Ändern der Routen daran denken;
  `/api/*` geht an das Backend und behält dort bewusst seine 404.
- `frontend/nginx.conf` ist ein **envsubst-Template**: `PORT` und
  `API_UPSTREAM` brauchen `ENV`-Defaults im Dockerfile (envsubst ersetzt nur
  *gesetzte* Variablen — eine ungesetzte bliebe wörtlich stehen und nginx
  startet nicht), und envsubst schreibt auch **Kommentare** um, weshalb die
  Datei die Variablennamen im Fließtext meidet.

## Stand (2026-08-02)

- v1 komplett: adaptives Üben, Kana-Tracking, Heatmap, Stats, Reset mit
  Mehrfach-Bestätigung, Docker-Deployment mit Volume-Persistenz. E2E im
  Container getestet (inkl. Persistenz über Neustart).
- UI und Wortbedeutungen von Deutsch auf Englisch umgestellt (Seeding
  aktualisiert Bedeutungen bestehender DB-Einträge beim Start automatisch).
- Vokabular von words.py nach `words/*.json` ausgelagert (basic in git,
  additional nur lokal/im Image). 617 basic + lokale sap/ai-Files.
- Rating-System v2: Spanne auf ~690–1810 gestreckt, Level 1–20 (75 Elo),
  asymmetrisches K (20/36), Review-Proben unterhalb der Komfortzone,
  Coverage-Statistik pro Level/Source (words.source-Spalte, migriert).
- Success-Rate der Coverage als Heatmap-Kachel (geteilte `ramp.ts`);
  Seeding pruned verschwundene Wörter. Lokale Dicts: sap.json (71),
  ai.json (45).
- Neuer Tab „Dictionaries": Zusammensetzung je Wörterbuch + Wort-Browser.
- Router eingeführt (bookmarkbare Sections, SPA-Fallback im Backend),
  Übungssession startet/endet explizit (kein Auto-Start beim Seitenaufruf),
  Herkunfts-Dictionary wird bei der Auflösung angezeigt.
- **SQLite → PostgreSQL** (SQLAlchemy async/asyncpg, Zwei-Rollen-Modell),
  Aufteilung in Backend- und Frontend-Image (nginx serviert die SPA und
  proxyt `/api`), GHCR-Workflows, Unraid-Stack. Der alte SQLite-Fortschritt
  wurde bewusst **nicht** migriert. E2E im Compose-Stack geprüft (Antworten,
  Stats, Upload/Export/Delete, Deep-Link-Reload, Persistenz über `down`/`up`,
  Tabellen gehören dem Owner, Requests laufen als App-Rolle).
- **Wörterbuch-Upload** im Dictionaries-Tab: private Wortlisten liegen jetzt
  in der DB statt im Image — der Auslöser war, dass die Images öffentlich in
  GitHub Actions gebaut werden und `sap.json`/`ai.json` dort nichts zu suchen
  haben.

#### Zur sap.json-Recherche (wichtig für Nachfolger)

SAP Japan schreibt **Produktnamen lateinisch** („Joule", „SAP BTP",
„S/4HANA"); Katakana erscheint nur als einmalige Aussprachehilfe in
Klammern (belegt: 「Joule（ジュール）」, 「SAP Datasphere（データスフィア）」).
Konstruierte Voll-Katakana-Formen wurden deshalb wieder entfernt (u. a.
ビジネスエーアイ, ライズウィズサップ, オートノマスエンタープライズ — SAP JP
nutzt 自律型エンタープライズ). Auch „AI" bleibt im Fließtext lateinisch
(エージェンティックAI, AIエージェント). Regel für neue Einträge: nur
aufnehmen, was **wörtlich als Katakana** in japanischen Quellen steht,
nicht was plausibel klingt.

### Ideen / offen

- Wort-Elo-Verlauf & Level-History-Chart
- Export/Import des **Fortschritts** (Wörterbücher lassen sich bereits
  exportieren; für Attempts/Elo gibt es noch nichts)
- Einstellbare Session-Ziele (z. B. 20 Wörter/Tag) + Tages-Streak
- Mehr Wörter Level 4/5, ggf. seltene Kana (ヮ, ヶ) — Tokenizer erweitern
