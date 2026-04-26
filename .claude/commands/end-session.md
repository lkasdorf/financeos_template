---
description: Session sauber abschließen — Memories aktualisieren, syncen, committen, pushen
---

Schließe die aktuelle Session in dieser Reihenfolge ab. Arbeite die Schritte verbindlich ab, kurze Statusmeldungen pro Schritt reichen.

## 1. Memories & Learnings aktualisieren

Reflektiere die aktuelle Session:
- Gab es neue User-Fakten, Präferenzen, Feedback (Korrekturen ODER bestätigte Ansätze)?
- Neue Projekt-Fakten (Entscheidungen, Deadlines, Motivationen hinter Änderungen)?
- Neue Referenzen auf externe Systeme?
- Veraltete Memories, die korrigiert/entfernt gehören?

Aktualisiere entsprechend die Dateien unter `~/.claude/projects/C--Users-LeonKasdorf-Documents-DRIVE-SynologyDrive-01-Personal-10-Finances-05-FinanceOS/memory/` und halte `MEMORY.md` dort als schlanken Index aktuell. Keine Duplikate — vorhandene Memory zuerst prüfen und updaten statt neu anlegen.

Wenn in dieser Session nichts memory-würdiges passiert ist: kurz sagen "Keine Memory-Updates nötig" und weiter zu Schritt 2.

## 2. CHANGELOG.md aktualisieren

`CHANGELOG.md` im Repo-Root pflegen, Format [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Versionsschema `vYYYY-MM-DD.NN` — identisch zum Footer (`dashboard/index.html`, Zeile mit `FinanceOS v...`).

Ablauf:
1. Aktuelle Footer-Version aus `dashboard/index.html` lesen (z. B. `v2026-04-17.9`).
2. Wenn sich die Footer-Version **in dieser Session geändert** hat (Logik-Bump):
   - Neue Release-Section `## [vYYYY-MM-DD.NN] - YYYY-MM-DD` direkt unter `## [Unreleased]` anlegen.
   - Alle Einträge aus `[Unreleased]` in die neue Release-Section verschieben.
   - `[Unreleased]` leer zurücklassen (mit den sechs Standard-Subsections: Added, Changed, Deprecated, Removed, Fixed, Security).
3. Wenn die Footer-Version **unverändert** ist (reine TX, keine Logik-Änderung):
   - Keine neue Release-Section. Relevante Session-Änderungen unter `[Unreleased]` in die passende Subsection eintragen (Added/Changed/Fixed/…).
4. Nur **nutzerrelevante** Änderungen dokumentieren (Features, UX, Bugfixes, Schema-Migrationen). Interne Refactors ohne Außenwirkung, reine Daten-Batches (`batch: ...`) und Memory-Syncs **nicht** listen.
5. Einträge auf Deutsch, knapp, aktiv formuliert. Struktur: **Fett-Name:** Kurzbeschreibung.

Wenn in dieser Session nichts CHANGELOG-würdiges passiert ist: kurz melden "Keine CHANGELOG-Updates nötig" und weiter zu Schritt 3.

## 3. FAQ (`docs/faq.md`) aktualisieren

`docs/faq.md` ist die lebendige Feature-Referenz, die im Dashboard unter `#faq` gerendert wird. Sie muss synchron mit dem CHANGELOG bleiben, damit neue Features auch dokumentiert sind.

Ablauf:
1. Alle in Schritt 2 ergänzten `Added`/`Changed`-Einträge durchgehen.
2. Pro Eintrag prüfen: Ist das Feature/die Änderung bereits in `docs/faq.md` beschrieben?
3. Wenn **nein**:
   - In die passende Themen-Section (H2) eintragen — neue H3-Subsection anlegen oder bestehende erweitern.
   - Stil: knapp, aktiv, deutsch; Tabellen für Listen; Code-Blöcke für Befehle/Syntax.
   - Bei grundlegend neuem Themenbereich: neue H2-Section am logischen Ort einfügen (nicht einfach ans Ende).
4. Wenn **ja**: prüfen ob der existierende Text noch aktuell ist (Werte, Screenshot-freie Beschreibungen, verweisende Dateinamen).
5. Bei `Removed`/`Deprecated`: Einträge in der FAQ entsprechend entfernen oder als "entfernt ab vX" markieren.

Wenn in dieser Session nichts FAQ-würdiges passiert ist (reine Daten-Batches, Memory-Syncs): kurz melden "Keine FAQ-Updates nötig" und weiter zu Schritt 4.

## 4. MEMORY SYNC

Führe den `MEMORY SYNC` Flow aus CLAUDE.md aus:
1. Alle `*.md` aus `~/.claude/projects/.../memory/` nach `memory/` im Repo kopieren (überschreibend)
2. `git add memory/` — falls keine Diffs, diesen Schritt überspringen und kurz melden

## 5. Commit & Push

- `git status` prüfen — gibt es noch weitere uncommitted Changes aus der Session?
- Wenn ja: passend gruppiert committen (nicht alles in einen Commit werfen, wenn es inhaltlich getrennt ist). Bei reinen Daten-Batches die etablierte Convention nutzen (`batch: ...`, `feat: ...`, `fix: ...`, `chore: Memory-Sync <YYYY-MM-DD>`).
- `git push origin main`
- Commit-Hashes und Push-Ergebnis kurz melden

## 6. Session-Zusammenfassung

Gib zum Abschluss eine sehr kurze Bilanz aus (max. 5 Bullet Points):
- Was wurde in dieser Session erledigt (funktional)
- Welche CHANGELOG-Einträge wurden ergänzt (unter welcher Version)
- Welche Memories wurden aktualisiert/neu angelegt
- Welche Commits gingen raus
- Offene Punkte, die für die nächste Session notiert werden sollten

## 7. Session beenden

Claude Code kann sich nicht selbst schließen. Sag dem User stattdessen:
> Session ist sauber abgeschlossen. Du kannst jetzt mit `/exit` oder `Ctrl+D` beenden.

## Harte Regeln

- **Kein Force-Push, kein `--no-verify`, kein Amend** bestehender Commits.
- Bei Merge-Konflikten oder Push-Fehlern: Abbrechen und User fragen, nicht destruktiv auflösen.
- Wenn `git status` secrets-verdächtige Dateien zeigt (`.env`, Keys): warnen, nicht blind committen.
