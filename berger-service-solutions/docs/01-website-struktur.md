# 01 – Website-Struktur und Navigation

Statuslegende (gilt für alle Dokumente):
✅ implementiert und automatisiert getestet · 🟡 implementiert, aber nur im Demo-Modus bzw. ohne Live-Test · 📝 geplant / Konzept

## Grundentscheidungen

| Entscheidung | Begründung | Status |
|---|---|---|
| Eigenständige Website im Ordner `berger-service-solutions/`, getrennt von neuverdrahtet.com | Die Live-Seite neuverdrahtet.com bleibt unberührt. Eigene Domain, eigenes Deployment. | ✅ |
| Statische Seiten, erzeugt aus Daten (`src/daten/*.mjs`) durch `src/build.mjs` | Schnell (Core Web Vitals), sicher (kein CMS-Angriffsfläche), skalierbar: neue Leistung = ein Datensatz | ✅ |
| Flache URLs (`/bodenlegearbeiten.html`) | Einfach zu hosten (GitHub Pages, Cloudflare Pages, Firebase Hosting), stabile Canonicals | ✅ |
| Keine externen Skripte, Schriften, Karten oder Tracker | DSGVO ohne Cookie-Banner, schnelle Ladezeit | ✅ |
| Go-live-Schalter `website.indexierbar` | Verhindert, dass ein Prototyp mit Platzhaltern indexiert wird | ✅ |

## Seitenbaum (65 Seiten)

```
Startseite (index.html)
├── Leistungen (leistungen.html)
│   ├── Elektrotechnik, Prüfung & Wartung (elektrotechnik.html)
│   │   ├── Elektroinstallation · Elektrosanierung · Elektroreparatur & Störung
│   │   ├── Zählerschrank & Unterverteilung · DGUV-V3-Prüfung · E-Check & DIN-VDE-Prüfung
│   │   ├── Wärmepumpenwartung · Klimaanlagenwartung · Photovoltaik & Speicher
│   │   └── Wallbox · Smart Home · Beleuchtung · Netzwerk · Sprechanlagen          (14)
│   ├── Handwerk, Renovierung & Sanierung (handwerk-sanierung.html)
│   │   ├── Komplettsanierung · Wohnungssanierung · Badsanierung · Fliesen
│   │   ├── Maler & Tapezieren · Trockenbau & Innenausbau · Renovierung Mieterwechsel (7)
│   │   └── Bodenlegearbeiten (Hub, bodenlegearbeiten.html)
│   │       └── Vinyl & Designboden · Laminat · Teppich & PVC · Parkett             (1+4)
│   ├── Hausmeister- & Objektservice (hausmeisterservice-objektservice.html)
│   │   └── Hausmeisterservice · Gebäudereinigung · Treppenhausreinigung
│   │       Gartenpflege · Winterdienst · Wohnungsübergaben                          (6)
│   └── Entrümpelung & Rückbau (entruempelung-rueckbau.html)
│       └── Entrümpelung · Haushaltsauflösung · Rückbau & Entkernung               (3)
├── Einsatzgebiet (einsatzgebiet.html – 48 Orte, Zonen, PLZ-Prüfer)
│   └── 13 Ortsseiten (einsatzgebiet-essen.html … einsatzgebiet-hattingen.html)
├── Online buchen (buchen.html)
├── Für Hausverwaltungen · Für Gewerbekunden
├── So arbeiten wir (ablauf.html) · Über uns · Häufige Fragen · Kontakt
└── Impressum · Datenschutz · 404   (noindex)
```

Technische Dateien: `sitemap.xml`, `robots.txt`, `llms.txt` (Zusammenfassung für KI-Systeme).

## Navigation

- **Kopfzeile (Desktop ≥ 1080 px):** Leistungen (Megamenü mit 4 Spalten = 4 Bereiche), Einsatzgebiet, Hausverwaltungen, So arbeiten wir, Über uns, Kontakt, CTA „Online buchen“.
- **Mobil:** Menü-Schalter, Megamenü als aufklappbare Liste, Escape schließt. Feste Leiste unten: Anrufen (sobald Telefonnummer konfiguriert, sonst Kontakt) · WhatsApp (sobald konfiguriert) · Online buchen.
- **Brotkrumen** auf allen Unterseiten (sichtbar + `BreadcrumbList`).
- **Fußzeile:** Bereiche, alle Ortsseiten, Unternehmen, Rechtliches.
- **Interne Verlinkung:** jede Leistungsseite verlinkt 2–4 verwandte Leistungen, den Bereich, die Ortsseiten mit diesem Schwerpunkt und die Buchung mit vorausgewählter Leistung (`buchen.html?leistung=…`). Ortsseiten verlinken auf ihre Schwerpunktleistungen und die 4 nächstgelegenen Ortsseiten. Der Qualitätstest prüft, dass keine indexierbare Seite unverlinkt ist.

## Aufbau einer Leistungsseite

1. Seitenkopf: Bereich, H1, Einleitung, CTA (Direktbuchung oder Angebot) und Kasten „Auf einen Blick“
2. Leistungsumfang (Liste) – beim Boden-Hub zusätzlich die Unterseiten
3. Fachabschnitte (z. B. Belagstabelle, Prüffristen, Anmeldepflichten)
4. Für wen? / Wovon der Preis abhängt (keine erfundenen Preise)
5. Ablauf (aus dem passenden Geschäftsprozess)
6. Qualifikation und Sicherheit (handwerksrechtlicher Hinweis)
7. FAQ (sichtbar + `FAQPage`)
8. Passende Leistungen und Orte, CTA-Band

## Gestaltung

- Farben: Marine `#0f2233` (Vertrauen, Technik), Bernstein `#f2a516` (Handwerk, Aufmerksamkeit für CTAs). Jeder Bereich hat eine Kennfarbe (Elektro Bernstein, Handwerk Petrol, Objekt Blau, Rückbau Rost).
- Schrift: Inter, selbst gehostet (keine Google-Fonts-Verbindung).
- Logo: Wortmarke „BERGER / SERVICE SOLUTIONS“ mit B-Signet (SVG). **Platzhalter-Logo** – ein final gestaltetes Logo kann ohne Codeänderung unter `public/assets/img/` ersetzt werden.
- Bilder: bewusst keine Stockfotos. Echte Projektfotos (mit Zustimmung) sind der wirksamste nächste Schritt für Vertrauen und lokale Relevanz.
