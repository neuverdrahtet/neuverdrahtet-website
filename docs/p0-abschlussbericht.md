# JARVIS/Werkora – Phase P0: Abschlussbericht (29.10.2026)

Dieser Bericht fasst die gesamte P0-Sicherheits- und Datenintegritätsarbeit zusammen, die
auf dem Master-Audit vom 28.10.2026 aufbaut (siehe `docs/p0-security-baseline.md` für den
Ausgangszustand). Alle Arbeiten liefen auf dem eigenständigen Branch
`jarvis-werkora-p0-security` (abgezweigt von `claude/business-management-software-m31yf8`
@ `9432559`) - **kein Merge auf `main`, kein produktives Deployment, keine echten
Kunden-/Rechnungsdaten verändert, keine E-Mails/WhatsApp-Nachrichten versendet, keine
kostenpflichtigen Dienste aktiviert.** Alles wartet auf deine ausdrückliche Freigabe.

## A. Zusammenfassung je Phase

| Phase | Was | Commit | Status |
|---|---|---|---|
| 0 | Ausgangsdokumentation, Git-Zustand geprüft | `25af613` | abgeschlossen |
| 1 | GoBD-Aufbewahrungsfristen statt pauschaler 30-Tage-Löschung | `1d4361f` | abgeschlossen |
| 2 | Rechnungen serverseitig vor Manipulation geschützt (Firestore Rules) | `6da8006` | abgeschlossen |
| 3 | Rechnungsnummern-Vergabe transaktionssicher (Firestore Transaction) | `0a4b454` | abgeschlossen |
| 4 | Freigabe-Engine für finanzwirksame KI-Aktionen (ki-buerokraft) | `e792746` | abgeschlossen |
| 5 | Automatische Tests vor jedem Deployment (alle 10 Worker + Regeln) | `fb107c2` | abgeschlossen |
| 6 | Rate-Limiting + Rollentrennung für die drei offensten Worker-APIs | `31e9d5e` | abgeschlossen |
| 7 | Firebase Storage Rules nach Pfad-Präfix eingeschränkt | `71012f3` | abgeschlossen |

Alle 8 im Master-Audit als P0 benannten Punkte (Phasen 1-7 der Auftragsvorgabe) sind
umgesetzt, real getestet und committet.

## B. Was konkret behoben wurde (Risiko → Lösung)

1. **GoBD-Löschfristen (Bericht 03, kritisch).** `verwaltung/js/db.js` löschte bisher ALLE
   Papierkorb-Einträge pauschal nach 30 Tagen - auch Rechnungen/Gutschriften/Ausgaben, die
   gesetzlich 10 Jahre aufbewahrt werden müssen (§147 AO). Jetzt: pro Collection passende
   Frist (`trashTageFuer()`), versendete Rechnungen sind zusätzlich NIE hart löschbar,
   unabhängig vom Papierkorb-Status.
2. **Rechnungsmanipulation (Bericht 03, kritisch).** Eine versendete Rechnung ließ sich
   bisher inhaltlich beliebig verändern (Betrag, Positionen, Kunde). Jetzt verhindert
   `firestore.rules` das serverseitig: Inhaltsfelder sind nach Versand gesperrt, nur
   Status-/Zahlungs-/Storno-Felder bleiben änderbar.
3. **Rechnungsnummern-Kollision (Bericht 03, hoch).** Die alte Lies-Erhöhe-Schreibe-Logik
   konnte bei zwei fast gleichzeitigen Speichervorgängen dieselbe Nummer zweimal vergeben.
   Jetzt: echte Firestore-Transaction, mit einem echten 100-paralleler-Aufrufe-Test
   nachgewiesen kollisionsfrei.
4. **KI kann Finanzen ohne Freigabe verändern (Bericht 03/05, kritisch).** Der
   ki-buerokraft-Worker konnte Rechnungen sofort anlegen/bezahlt markieren/stornieren und
   Mahnungen erzeugen - ohne jede Zwischenprüfung. Jetzt: zweistufige Freigabe-Engine
   (`werkora_approve_action`/`werkora_reject_action`), erst nach expliziter Freigabe wird
   die Aktion wirklich ausgeführt.
5. **Deployments ohne Tests (Bericht 03, mittel-hoch).** Keiner der zehn Worker wurde vor
   dem automatischen Deploy getestet - ein kaputter Commit wäre ungebremst live gegangen.
   Jetzt: jeder Deploy-Workflow hängt von einem Test-Job ab, der die komplette Testsuite
   ausführt.
6. **Kein Rate-Limiting bei drei offenen API-Schlüsseln (Bericht 03, mittel-hoch).**
   `cloudflare-worker-api`, `cloudflare-worker-ki-buerokraft` und
   `cloudflare-worker-google-buero` hatten je einen einzigen, statischen API-Schlüssel ohne
   jede Begrenzung - bei einem Leak unbegrenzter Missbrauch möglich. Jetzt: FAIL-CLOSED
   Rate-Limiting (30 Anfragen/Minute/IP) plus zeitkonstanter Schlüsselvergleich bei allen
   drei. Zusätzlich für `cloudflare-worker-api`: optionaler nur-lesender Zweitschlüssel.
7. **Storage ohne jede Einschränkung (Bericht 03, mittel).** Jeder eingeloggte Nutzer
   konnte jede Datei in Firebase Storage lesen/schreiben, unabhängig vom Pfad. Jetzt: nur
   noch die tatsächlich von der App verwendeten Pfad-Präfixe sind erlaubt, mit zum Inhalt
   passenden Dateityp- und Größengrenzen.

## C. Testabdeckung (alles real gegen Code/Emulator, keine Attrappen)

```
npm run test:all
→ test:unit:            28 Testdateien, 411 Tests
→ test:rules:            56 Tests (Firestore Security Rules, echter Emulator)
→ test:storage-rules:    11 Tests (Firebase Storage Rules, echter Emulator)
→ test:rechnungsnummer-concurrency: 1 Test (100 parallele Aufrufe, echter Emulator)
= 479 Einzel-Assertions, 0 fehlgeschlagen (zuletzt verifiziert am 29.10.2026)
```

Neu hinzugekommene Testdateien dieser Phase: `verwaltung/tests/aufbewahrungsfristen.test.mjs`,
`firestore-tests/rechnungsnummer-concurrency.test.mjs`,
`cloudflare-worker-ki-buerokraft/tests/test_finanz_freigabe.mjs`,
`cloudflare-worker-api/tests/test_api_security.mjs`,
`cloudflare-worker-google-buero/tests/test_api_security.mjs`,
`firestore-tests/storage-rules.test.mjs`. Dabei auch zwei schon vorher im Repo liegende,
aber bislang von keinem Testlauf erfasste Dateien gefunden und eingebunden
(`cloudflare-worker-ki-buerokraft/tests/test_bulk_fix_receipts.mjs`,
`cloudflare-worker-google-buero/tests/test_draft_update.mjs`) - beide liefen zuvor nie
automatisch mit.

Ein echter Bug wurde beim Testen selbst gefunden und sofort korrigiert: die Freigabe von
`reminders.create` (REST-Pfad) wäre über `POST /approvals/{id}/approve` immer mit 500
fehlgeschlagen, weil die zugehörige Ausführungsfunktion eine andere Antwortform zurückgab
als alle anderen Aktionen im selben Freigabe-Dispatch (siehe Phase-4-Commit).

## D. Bewusst nicht behobene, dokumentierte Einschränkungen

Diese Punkte wurden geprüft, aber bewusst NICHT im Rahmen dieses P0-Umfangs umgesetzt -
jeweils mit Begründung direkt im betroffenen Code/README dokumentiert:

- **Kein echtes Mehrbenutzer-/Rollenmodell für `cloudflare-worker-ki-buerokraft`.** Ein
  einziger geteilter API-Schlüssel ohne Benutzeridentität - für ein Einzelunternehmen aktuell
  tragbar, aber relevant, sobald mehr als eine Person einen eigenen KI-Zugang bekommt. Die
  neue Freigabe-Engine (Phase 4) schützt vor versehentlichen/fehlerhaften KI-Aktionen, nicht
  vor jemandem, der den vollen Schlüssel bereits besitzt.
- **Keine echte Rollentrennung beim Lesen in Firebase Storage.** Jeder eingeloggte Nutzer
  kann weiterhin jeden der in Phase 7 gelisteten Pfade lesen, nicht nur admin/büro. Eine
  echte rollenbasierte Prüfung (wie in `firestore.rules`) ließe sich nicht gegen den lokalen
  Emulator verifizieren (siehe Phase-7-Commit, empirisch nachgewiesen) - nach Rücksprache mit
  dir bewusst nicht ungetestet deployt.
- **`einstellungen`-Firestore-Regel ist admin-only**, obwohl `büro` laut Rollenkonzept
  Rechnungen anlegen darf - eine bereits VOR dieser P0-Arbeit bestehende Einschränkung
  (nicht durch die Rechnungsnummer-Transaction verursacht), dokumentiert in Phase 3.
- **Mahnungen-Aufbewahrungsfrist rechtlich uneindeutig** (Geschäftsbrief = 6 Jahre vs.
  Buchungsbeleg-nah = 10 Jahre) - standardmäßig auf die längere, sicherere Frist gesetzt
  (siehe Phase 1).

## E. Vor dem produktiven Deployment zu erledigen (Checkliste für dich)

Diese Code-Änderungen setzen sich erst in der Cloudflare-/Firebase-Oberfläche durch, wenn
die folgenden, nicht automatisierbaren Schritte manuell nachgezogen werden:

- [ ] Für `cloudflare-worker-api`, `cloudflare-worker-ki-buerokraft` und
      `cloudflare-worker-google-buero` je ein **Rate-Limiting-Binding** `RATE_LIMITER` im
      Cloudflare-Dashboard anlegen (bei Deploy per `wrangler deploy`/GitHub Actions passiert
      das automatisch über die aktualisierten `wrangler.toml` - nur bei manuellem
      Dashboard-Deploy separat nötig). **Ohne dieses Binding sperren sich alle drei Worker
      jetzt selbst (fail-closed, 503)** - unbedingt VOR dem nächsten Deploy einrichten.
  - `cloudflare-worker-google-buero`: das betrifft auch die `/oauth/authorize`-Route - das
    Binding muss vor einer erneuten OAuth-Einrichtung existieren.
- [ ] Optional: für `cloudflare-worker-api` einen zweiten Secret-Wert `API_KEY_READONLY`
      setzen, falls eine nur-lesende Integration gewünscht ist (siehe README).
- [ ] `FIREBASE_SERVICE_ACCOUNT`-Repository-Secret für `deploy-firebase-rules.yml` prüfen
      (unverändert aus vorherigen Phasen, aber jetzt zusätzlich Voraussetzung für den
      automatischen `storage.rules`-Deploy in diesem selben Workflow).
- [ ] Die neuen GitHub-Actions-Testläufe einmal am echten CI beobachten (z.B. per
      `workflow_dispatch` manuell auslösen), bevor sich jemand auf das automatische
      Deploy-Gate verlässt - lokal lief alles grün, ein frischer GitHub-Actions-Runner kann
      sich in Details (z.B. Java-Verfügbarkeit für den Firestore-Emulator) unterscheiden.

## F. Empfehlung / nächste Schritte

Alle acht P0-Punkte sind umgesetzt, real getestet (479 Assertions, 0 fehlgeschlagen) und auf
`jarvis-werkora-p0-security` committet. **Nichts davon ist bisher gemerged oder deployt.**

Vorschlag für den nächsten Schritt: diesen Branch als Pull Request gegen
`claude/business-management-software-m31yf8` (oder direkt gegen `main`, je nachdem wie du
vorgehen möchtest) öffnen, selbst durchsehen, die Checkliste in Abschnitt E abarbeiten und
erst dann freigeben. Die im Master-Audit als P1-P4 eingestuften Punkte (siehe
Entwicklungsroadmap im Master-Audit-Dokument) sind bewusst nicht Teil dieses P0-Durchlaufs
und können als eigener, separater Auftrag angegangen werden, sobald du das möchtest.
