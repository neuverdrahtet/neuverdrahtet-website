# JARVIS/Werkora – Phase P0: Ausgangsdokumentation (28.10.2026)

Diese Datei ist der Ausgangspunkt für die P0-Sicherheits- und Datenintegritätsarbeiten,
die auf dem Master-Audit vom 28.10.2026 aufbauen. Sie wird **nicht** nachträglich
umgeschrieben – Korrekturen/Ergänzungen kommen als neue Commits/Abschnitte hinzu, damit
der Ausgangszustand nachvollziehbar bleibt.

## Git-Ausgangszustand

- `main` @ `329a6b5` ("Fix: RATE_LIMITER-Binding entstand bei keinem bisherigen Deploy")
- `claude/business-management-software-m31yf8` @ `9432559` – main + 3 bereits vor dem
  Master-Audit gefundene und gefixte Bugs dieser Sitzung (Status-Manager-"geschlossen"-
  Checkbox, Dashboard-Aufgaben-Widget, Urlaubstermine-Konflikterkennung). Diese drei Fixes
  sind **nicht** Teil der P0-Sicherheitsarbeit, sondern eigenständige, bereits vorher
  behobene Bugs aus dem allgemeinen Fehleraudit.
- `feature/service-techniker-personal` und `feature/wr-import-mvp1` (identisch, beide auf
  `a6d11c6`): **bereits vollständig in `main` enthalten** (`a6d11c6` ist Ancestor von
  `main`). Der Diff gegen `main` zeigt ausschließlich Löschungen, keine Ergänzungen – beide
  Branches sind veraltete Zwischenstände ohne eigenständigen, noch nicht übernommenen
  Inhalt. Sie wurden für diese P0-Arbeit **nicht** herangezogen.
- **Bestätigt:** Während des Master-Audits (nach dem "Phase 0 – keine Codeänderungen"-Hinweis)
  wurde kein einziger Commit erzeugt. Der letzte Commit vor dem Audit-Prompt war `9432559`
  (28.10.2026, 11:35 UTC). Die 7 parallelen Audit-Durchgänge plus die Kostenvergleich-
  Recherche liefen ausschließlich lesend bzw. per Web-Suche; das Ergebnis wurde als separates
  Claude-Docs-Dokument veröffentlicht, nicht als Repo-Commit.
- Dieser P0-Branch (`jarvis-werkora-p0-security`) zweigt von `claude/business-management-software-m31yf8`
  @ `9432559` ab.

## Geltungsbereich dieser Phase

Ausschließlich die in der Master-Audit-Vorgabe als P0 benannten Sicherheits-, Rechnungs- und
Datenintegritätsthemen (siehe Phasen 1–7 der Auftragsvorgabe vom 28.10.2026):

1. GoBD-Löschfristen/Datenaufbewahrung
2. Serverseitiger Manipulationsschutz für versendete Rechnungen
3. Transaktionssichere Rechnungsnummern
4. Freigabe-Engine für finanzielle KI-Aktionen (ki-buerokraft-Worker)
5. CI-Tests vor Worker-Deployments
6. API-Sicherheit (Rate-Limiting, Rollen) für die drei schreibstärksten Nebenworker
7. Firebase-Storage-Rollentrennung

Ausdrücklich **nicht** Teil dieser Phase (laut Auftrag): neue Funktionen, Merge auf `main`,
produktive Deployments, Änderungen an echten Kunden-/Rechnungsdaten, Versand von
E-Mails/WhatsApp-Nachrichten, Aktivierung kostenpflichtiger Dienste.

## Referenz

Vollständige Befunde, Belege und Risikoeinstufungen: Master-Audit-Dokument
("Master-Audit JARVIS/Werkora", 28.10.2026), Berichte 02 (Funktionsmatrix) und 03
(Sicherheitsbericht).
