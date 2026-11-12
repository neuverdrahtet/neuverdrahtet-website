# BERGER SERVICE SOLUTIONS – Website-Prototyp und Plattformkonzept

**Handwerk. Service. Lösungen.** – Website für Elektrotechnik (Prüfung, Wartung), Handwerk und Sanierung inklusive Bodenlegearbeiten, Hausmeister- und Objektservice sowie Entrümpelung und Rückbau in Essen und rund 50 km Umkreis. Vorbereitet für die Anbindung an Werkora und WhatsApp Business.

> Eigenständig neben der bestehenden Website neuverdrahtet.com – an deren Dateien wurde nichts geändert.
> Prototyp: Alle Seiten tragen `noindex`, bis `website.indexierbar` in `src/config.mjs` auf `true` gesetzt wird.

## Schnellstart

```bash
npm run build:bss         # Seiten aus src/daten erzeugen → public/
npm run start:bss         # lokal ansehen: http://127.0.0.1:4173
npm run test:bss          # Logik- und Seitenqualitätstests
npm run test:bss-browser  # End-to-End-Test der Online-Buchung (Chromium)
```

## Aufbau

```
src/config.mjs               Firmendaten, Domain, Einsatzgebiet, Zonen, Buchung – offene Punkte = null
src/daten/                   Bereiche + Prozesse, 35 Leistungen, 13 Ortsseiten (eine Quelle für alles)
src/build.mjs, bausteine.mjs Generator: HTML, JSON-LD, Sitemap, robots.txt, llms.txt, docs/generiert/
public/                      fertige Website (statisch, ohne externe Abhängigkeiten)
  assets/js/einsatzgebiet-logik.mjs  48 Orte, PLZ, Zonen, Feiertage NRW, Slots, Validierung, Dubletten
  assets/js/buchung-kern.mjs         Schrittprüfung, Lead-Payload (bss-lead/1)
  assets/js/buchung.mjs              Oberfläche Online-Buchung
docs/01 … 11                 Konzepte (Struktur, SEO/GEO, Region, Buchung, Werkora, WhatsApp,
                             Prozesse, Objektverwaltung, Rollen, Datenschutz/Recht, Umsetzungsplan)
docs/schemas/lead.schema.json  Schnittstellenvertrag Website → Werkora
docs/generiert/              Keyword-Matrix und rechtliche Prüfpunkte (aus den Daten erzeugt)
tests/                       Logik, Seitenqualität, Browser-E2E
```

Eine neue Leistung = ein Datensatz in `src/daten/` + `npm run build:bss`. Navigation, Bereichsseite, Sitemap, Buchungskatalog, llms.txt und Keyword-Matrix werden automatisch ergänzt; die Tests prüfen Titel, Descriptions, Links und Inhaltsumfang.

## Status

| | |
|---|---|
| ✅ implementiert und getestet | Website (65 Seiten), SEO-Technik, Einsatzgebiet/Zonen, Online-Buchung im Demo-Modus |
| 🟡 implementiert, nicht live | Lead-Übertragung (kein Endpunkt konfiguriert → Demo-Modus) |
| 📝 geplant (Konzept in docs/) | Werkora-Lead-Endpunkt, Verfügbarkeit, WhatsApp, Objektverträge, Rollen-Erweiterung |

Offene Entscheidungen und Go-live-Checkliste: [docs/11-umsetzungsplan-qualitaetssicherung.md](docs/11-umsetzungsplan-qualitaetssicherung.md).
