# 11 – Technischer Umsetzungsplan und Qualitätssicherung

## Stand dieses Arbeitspakets

| # | Arbeitspaket (aus der Anweisung) | Ergebnis | Status |
|---|---|---|---|
| 1 | Website-Struktur und Navigation | 65 Seiten, Megamenü, mobile Leiste, Brotkrumen | ✅ |
| 2 | Leistungsseiten und Texte | 4 Bereichs- + 35 Leistungsseiten (inkl. Boden-Hub + 4 Unterseiten), Zielgruppen-, Ablauf-, FAQ-, Kontaktseiten | ✅ Texte, ⚖️ Fachprüfung |
| 3 | SEO/GEO/Keywords/KI | Keyword-Matrix, JSON-LD, llms.txt, Sitemap, Qualitätstests | ✅ technisch, 📝 GBP/GSC/Bing nach Go-live |
| 4 | Regionale Sichtbarkeit | 48 Orte, Zonen, 13 Ortsseiten, PLZ-Prüfer | ✅, 📝 PLZ-Abgleich amtlich |
| 5 | Online-Buchung | 5-Schritt-Formular, Validierung, Einsatzgebiet, Slots, Uploads, Prüfschritt, Dublettenschlüssel, Lead-Schema | 🟡 Demo-Modus (keine Übertragung) |
| 6 | Werkora-Datenmodell/Schnittstellen | Zielmodell, Status, IDs, Dublettenlogik, API-Spezifikation | 📝 Konzept |
| 7 | WhatsApp Business | Architektur, Funktionen, Sicherheit | 📝 Konzept |
| 8 | Objektverwaltung, wiederkehrende Leistungen | Objektakte, Verträge, Einsatzgenerator | 📝 Konzept |
| 9 | Mitarbeiter, Rollen, Automatisierung | Rollen/Rechtematrix, Phasen, Automationen | 📝 Konzept |
| 10 | Website-Prototyp | lauffähig, mobil geprüft | ✅ |
| 11 | Umsetzungsplan, QS | dieses Dokument, Tests | ✅ |

## Tests (alle grün beim letzten Lauf)

| Test | Inhalt | Befehl |
|---|---|---|
| Logik | 26 Tests: Einsatzgebiet, Zonen, PLZ-Überschneidung, Feiertage, Slots, Validierung, Dubletten, Lead vs. Schema | `node berger-service-solutions/tests/logik.test.mjs` |
| Seitenqualität | 22 Tests: Titel/Descriptions/H1 eindeutig und in Länge, Canonical, robots, JSON-LD, Links, Anker, Waisenseiten, Sitemap, llms.txt, Duplikat-Ähnlichkeit Ortsseiten, Mindestumfang, verbotene Werbeaussagen, Labels | `node berger-service-solutions/tests/site-qualitaet.test.mjs` |
| Browser E2E | 6 Tests (Chromium): zwei komplette Buchungen inkl. Fehlerfälle, PLZ-Prüfer, Mobilmenü, kein horizontales Scrollen auf allen 65 Seiten, keine JS-Fehler | `node berger-service-solutions/tests/browser/buchung-e2e.test.mjs` |

Logik- und Qualitätstests sind im zentralen Testlauf `npm run test:unit` (`scripts/run-all-tests.mjs`) eingebunden. Der Browser-Test braucht Chromium und läuft separat (`npm run test:bss-browser`).

Während der Entwicklung durch Tests gefundene und behobene Fehler: Navigationsknöpfe des Formulars mobil alle gleichzeitig sichtbar (`hidden` von CSS überschrieben); Layoutsprung durch verzögerte Einsatzgebietsbox ließ Klicks ins Leere gehen; abgeschnittene Meta-Descriptions der Ortsseiten; 25 zu lange Descriptions.

## Umsetzungsplan (Reihenfolge)

### Phase 0 – Go-live-Voraussetzungen (Inhaber, ca. 1–2 Wochen)
1. Domain festlegen → `config.mjs website.url`.
2. Kontaktdaten, Inhaber, Rechtsform, Eintragungen → `config.mjs`.
3. ⚖️ Handwerksrechtliche Prüfung je Leistung (Liste `generiert/rechtliche-pruefpunkte.md`) → ggf. Leistungen umformulieren oder Partnerbetriebe benennen.
4. ⚖️ Impressum, Datenschutz, AGB/Widerrufsbelehrung fertigstellen.
5. Anfahrtspauschalen je Zone festlegen (oder bewusst nicht anzeigen).
6. Logo/Bildmaterial (echte Fotos) bereitstellen.

### Phase 1 – Website live (ca. 1 Woche)
1. Hosting (z. B. Cloudflare Pages oder Firebase Hosting, Region EU), HTTPS, Weiterleitung www/non-www, Security-Header (CSP, HSTS).
2. `indexierbar: true`, Build, Deployment per GitHub Action (Muster vorhanden).
3. Lead-Übertragung zunächst per bestehendem Kostenschätzer-Worker-Muster **oder** E-Mail-Fallback, damit keine Anfrage verloren geht.
4. Google Business Profile, Search Console, Bing Webmaster Tools; Lighthouse-Messung.

### Phase 2 – Lead-Eingang in Werkora (ca. 2–3 Wochen)
1. Worker `POST /v1/leads` (Schema-Validierung, Dateien, Dubletten, Idempotenz, Rate-Limit).
2. Collections `leads`, `objekte`, `ereignisse` + Firestore-Regeln + Emulator-Tests.
3. Lead-Ansicht in der Verwaltungs-App, Zusammenführen-Dialog.
4. Eingangsbestätigung per E-Mail. **Test:** End-to-End gegen Staging-Projekt.

### Phase 3 – Kalender und Direktbuchung (ca. 2 Wochen)
`GET /v1/verfuegbarkeit`, vorläufige Reservierung, Bestätigungsregeln, Erinnerungen.

### Phase 4 – WhatsApp (ca. 3–4 Wochen)
Gateway-Worker, Templates genehmigen lassen, Mitarbeiter-Verknüpfung, Status-/Foto-Funktionen, Freigaben.

### Phase 5 – Objektservice-Verträge und Einsatzgenerator (ca. 3 Wochen)
### Phase 6 – Rollen Projektleitung/Service, Zeiterfassung, Kundenportal

Zeitangaben sind grobe Schätzungen für eine Person und hängen von Freigaben (Meta, Behörden) ab.

## Offene Entscheidungen

1. **Domain** und ob BERGER SERVICE SOLUTIONS ein eigenes Unternehmen oder eine Marke des bestehenden Betriebs ist (wirkt auf Impressum, Werkora-Mandant, Datenschutz).
2. **Ein Werkora für beide Marken** (Mandantenfeld `markeId` existiert bereits in Projekten) oder getrenntes Firebase-Projekt?
3. WhatsApp über **Twilio (bestehend)** oder direkt **Meta Cloud API**?
4. Welche Gewerke werden selbst ausgeführt, welche über Partnerbetriebe?
5. Anfahrtspauschalen veröffentlichen ja/nein.
6. Automatische Terminbestätigung erlauben (Regeln) oder immer manuell?

## Bauen und lokal ansehen

```bash
node berger-service-solutions/src/build.mjs          # Seiten neu erzeugen
node berger-service-solutions/tests/hilfen/server.mjs       # http://127.0.0.1:4173
```
