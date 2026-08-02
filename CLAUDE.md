# Katakana Reading Practice

Adaptive Web-App zum Üben des Katakana-Lesens: Es wird ein Wort in Katakana
angezeigt, der (einzige, globale) User tippt die Romaji-Lesung. Die App wertet
pro Kana aus, was richtig gelesen wurde, trackt Konfidenz je Kana, Lesetempo
und ein Elo-basiertes Level, und wählt die nächsten Wörter adaptiv danach aus.

## Architektur

```
frontend/   Angular 20 (standalone components, signals, Router)
backend/    FastAPI + SQLite (stdlib sqlite3), verwaltet mit uv
words/      Vokabular als JSON: basic/ (in git) + additional/ (*.json gitignored)
Dockerfile  Multi-Stage: Angular-Build → Python-Image; FastAPI served API + Statics
```

Ein einziger Container: FastAPI bedient `/api/*` und das gebaute Frontend als
statische Dateien. SQLite-File liegt auf dem Volume `/data` (env `DB_PATH`).

### Backend-Module (`backend/app/`)

- `kana.py` — Herzstück. Tokenizer (Katakana → Tokens inkl. Digraphen キャ,
  erweiterte Kana ファ/ティ/ウェ…, Sokuon ッ, Chōon ー, kontextabhängiges ン)
  und Auswertung: Segment-Level-Edit-Distance-DP richtet die User-Eingabe an
  den Tokens aus → pro Token korrekt/falsch, auch bei insgesamt falscher
  Antwort. Akzeptiert Hepburn- und Kunrei-Varianten (shi/si, matchi/macchi,
  shanpuu/shampuu, Makronen, `-` für ー). Tie-Breaker: bei gleichem
  Edit-Abstand gewinnt die Zuordnung mit mehr exakt getroffenen Voll-Kana.
- `words.py` — JSON-Loader für das Vokabular. Quelle ist `words/` im
  Repo-Root (env `WORDS_DIR`, im Container `/app/words`): `basic/basic.json`
  (343 Einträge, in git) + beliebige `additional/*.json` (gitignored, werden
  aber in das Docker-Image gebacken — Format siehe
  `words/additional/README.md`). Ladereihenfolge deterministisch (basic
  zuerst, Rest nach Pfad sortiert); bei doppeltem Katakana gewinnt die
  spätere Datei (additional kann basic überschreiben). Eintragsformat:
  `{"katakana": …, "meaning": …, "level": 1-5}`. Jedes Wort bekommt ein
  `source`-Label für die Coverage-Statistik: "basic" bzw. Dateiname ohne
  Endung (sap.json → "sap"). Bedeutungen auf Englisch
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
- `db.py` — Schema + Seeding (Upsert: Meaning/Level/Source werden
  aktualisiert; ändert sich das base_rating — z. B. durch Rebalancing der
  Formel — wird das dynamische Rating um dieselbe Differenz verschoben,
  die gelernte Kalibrierung bleibt erhalten) + `prune_words` (entfernt
  Wörter, die nicht mehr in den JSON-Files stehen, sofern sie noch nie
  beantwortet wurden — sonst würde die Antwort-Historie mit gelöscht;
  Key-Set läuft über eine Temp-Table wegen SQLite-Parameterlimit)
  + Mini-Migrationen (`_migrate`, z. B. source-Spalte) + `reset_all`.
  Basis-Rating: 750 + (Level−1)·250 ± Längen-Nudge (max ±80) → ~690–1810.
- `main.py` — App-Setup, Lifespan-Seeding und `SpaStaticFiles`: liefert für
  unbekannte Pfade `index.html` aus (damit Deep-Links/Reload auf
  Router-Pfaden funktionieren), lässt `/api/*` aber bei 404.
- `api.py` — Routen: `GET /api/profile` (schlanker Header-State),
  `GET /api/word/next`, `POST /api/answer` (Antwort enthält u. a. `source`,
  wird bei der Auflösung angezeigt),
  `GET /api/stats`, `GET /api/dictionaries` (Zusammensetzung je Source:
  Level-Mix, Ø/Min/Max Kana pro Wort, Rating-Spanne, geübt/Erfolgsquote),
  `GET /api/words` (filter- und seitenweise Wortliste: `source`, `level`,
  `q` über katakana/romaji/meaning, `sort`, `limit`≤500, `offset`),
  `POST /api/reset` (verlangt `{"confirm": "RESET"}`), `GET /api/health`.

### Datenmodell (SQLite)

- `user_profile` (id=1) — elo, current_streak, best_streak
- `words` — katakana, romaji (generiert), meaning, level, source,
  rating (dynamisch), base_rating, times_served/correct
- `attempts` — Antwort-Historie inkl. time_ms, kana_correct/total, elo before/after
- `kana_stats` — pro Token-Key (`キ`, `キャ`, `ッ`, `ー`, …): attempts, correct,
  EWMA-Konfidenz (α=0.2)

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
  Wortlänge, Rating-Spanne, geübt, Erfolgsquote) + filterbarer Wort-Browser
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
# Backend (Port 8000)
cd backend && uv run uvicorn app.main:app --reload

# Tests (38: Kana-Auswertung, Roundtrip, Loader, Game-Logik, DB/Seeding, API)
cd backend && uv run pytest

# Frontend-Dev-Server (Port 4200, proxied /api → 8000)
cd frontend && npm start

# Produktion / lokales Deployment (Port 8080, Volume katakana-data)
docker compose up --build -d
```

## Konventionen & Fallstricke

- Python 3.12+, keine ORM — bewusst stdlib `sqlite3`, Connection pro Request.
- Romaji-Kanonik: lange Vokale als Doppelvokal (`koohii`), ッ als
  Konsonantenverdopplung (`matchi` kanonisch, `macchi` akzeptiert).
- Kleine Kana (ャュョァィゥェォ) existieren nie als eigene Tokens — nur als Teil
  von Digraphen. Bei neuen Wörtern auf korrekte kleine Zeichen achten
  (ィ U+30A3 vs. イ U+30A4)!
- `kana_stats` ist pro **Token** gekeyt (キャ ≠ キ), die Heatmap zeigt
  Einzel-Kana im Grid und Kombinationen als Chips darunter.
- Seeding läuft bei jedem Start (Lifespan-Hook) und **pruned**: Wörter, die
  aus den JSON-Files verschwunden sind, werden gelöscht — außer sie wurden
  schon beantwortet (FK auf attempts, Historie bleibt erhalten).
- Angular: standalone components, neue Control-Flow-Syntax (`@if`/`@for`),
  inline templates/styles. Router mit echten Pfaden (`/practice`, `/stats`,
  `/dictionaries`, `/settings`) — **deshalb braucht FastAPI den SPA-Fallback
  in `main.py`**: ohne ihn liefert ein Reload auf `/stats` einen 404.
  Beim Ändern der Routen daran denken; `/api/*` behält bewusst seine 404.

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
- Export/Import des Fortschritts (SQLite-Download reicht evtl.)
- Einstellbare Session-Ziele (z. B. 20 Wörter/Tag) + Tages-Streak
- Mehr Wörter Level 4/5, ggf. seltene Kana (ヮ, ヶ) — Tokenizer erweitern
