# 02 – SEO, GEO, Keywords und KI-Optimierung

> Grundsatz: Eine bestimmte Platzierung in Google, Google Maps oder in KI-Antworten (ChatGPT, Gemini, Google AI Overviews, Perplexity) kann nicht garantiert werden. Ziel ist, die Voraussetzungen zu schaffen, dass Suchmaschinen und KI-Systeme die Leistungen korrekt verstehen, für relevant halten und zitieren können.

## 1. Keyword-Strategie

### Methode
1. **Cluster je Suchintention:** ein Haupt-Keyword (Cluster-Kopf) pro Seite, Neben-Keywords und Fragen als Abschnitte bzw. FAQ derselben Seite. Keine zwei Seiten konkurrieren um denselben Kopf.
2. **Intention:** transaktional („… buchen“, „… lassen“), kommerziell („… Kosten“, „… Firma“), informational (Fragen → FAQ/Abschnitte, Futter für KI-Antworten), lokal („… Essen“, „… in der Nähe“).
3. **Lokalisierung:** Hauptstadt Essen im Title/H1; Nachbarstädte über Ortsseiten und Google Business Profile – keine Stadt×Leistung-Seiten.
4. **Volumen:** Werden nach Go-live mit Google Keyword Planner und Search Console erhoben. Die Matrix enthält bewusst keine geschätzten Suchvolumina.

Die vollständige, automatisch aus den Seitendaten erzeugte Matrix (35 Leistungen) steht in [`generiert/keyword-matrix.md`](generiert/keyword-matrix.md).

### Kern-Cluster (Auszug)

| Cluster | Zielseite | Haupt-Keyword | Wichtige Varianten / Fragen |
|---|---|---|---|
| Elektriker | elektro-reparatur-stoerung, elektrotechnik | elektriker essen | elektriker in der nähe, sicherung fliegt raus, fi schalter löst aus |
| DGUV V3 | dguv-v3-pruefung | dguv v3 prüfung essen | dguv v3 kosten, wie oft prüfen, wer darf prüfen, prüfung ortsveränderlicher geräte |
| E-Check | e-check | e-check essen | e-check vermieter pflicht, elektroprüfung wohnung |
| Wärmepumpe | waermepumpenwartung | wärmepumpenwartung essen | wartung luft-wasser-wärmepumpe, wie oft warten, pflicht? |
| Badsanierung | badsanierung | badsanierung essen | bad renovieren, badsanierung kosten, barrierefreies bad |
| Bodenleger | bodenlegearbeiten + 4 Unterseiten | bodenleger essen | vinylboden verlegen lassen, laminat verlegen lassen, designboden, vinyl oder laminat, vinyl auf fliesen |
| Hausmeister | hausmeisterservice | hausmeisterservice essen | hausmeister mehrfamilienhaus, objektbetreuung, umlagefähig? |
| Gebäudereinigung | gebaeudereinigung, treppenhausreinigung | gebäudereinigung essen / treppenhausreinigung essen | büroreinigung, unterhaltsreinigung, treppenhausreinigung kosten |
| Entrümpelung | entruempelung | entrümpelung essen | wohnungsentrümpelung, keller entrümpeln, kosten pro m³ |
| Haushaltsauflösung | haushaltsaufloesung | haushaltsauflösung essen | wohnungsauflösung, nach todesfall, wer zahlt |

### Bodenlegearbeiten als eigener Schwerpunkt
- Hub `bodenlegearbeiten.html` bedient den generischen Kopf „Bodenleger Essen“ und enthält alle geforderten Unterthemen (Vinyl, Laminat, Designboden, PVC, Teppich, Parkett, Entfernung alter Beläge, Untergrundvorbereitung, Spachtel-/Ausgleichsarbeiten, Sockelleisten, Bodenrenovierung) mit Ankern, Vergleichstabelle und 6 FAQ.
- Unterseiten für Belagsarten mit eigener Suchintention: Vinyl & Designboden, Laminat, Teppich & PVC, Parkett (mit handwerksrechtlichem Hinweis).
- Asbest-Hinweis für Altbeläge (Floor-Flex) – fachlich wichtig und ein Vertrauenssignal.

## 2. Technisches SEO (umgesetzt ✅)

- Eindeutige Title (≤ 70 Zeichen), Meta-Descriptions (70–160 Zeichen), genau eine H1 – automatisch getestet.
- Canonical absolut, Sitemap nur mit indexierbaren Seiten, robots.txt an Go-live-Schalter gekoppelt.
- Strukturierte Daten (JSON-LD, ein `@graph` je Seite):
  - `HomeAndConstructionBusiness` (Unternehmen) mit `areaServed` als `GeoCircle` (50 km) + 48 `City`-Einträge, `knowsAbout`, Öffnungszeiten. **Adresse/Telefon werden nur ausgegeben, wenn sie konfiguriert sind** (keine Platzhalter in strukturierten Daten).
  - `Service` je Leistungsseite mit `provider`, `areaServed`, `potentialAction` (`ReserveAction` → Buchung).
  - `FAQPage`, `BreadcrumbList`, `OfferCatalog` (Bereichsseiten), `WebSite`, `AboutPage`, `ContactPage`.
  - Hinweis: Google zeigt FAQ-Rich-Results seit 2023 nur noch für ausgewählte Websites. Das Markup bleibt sinnvoll, weil es Inhalte für Suchmaschinen und KI-Systeme eindeutig strukturiert.
- Semantisches HTML, Tabellen mit `th scope`, Formulare mit Labels, Sprungmarke – getestet.
- Performance: keine Frameworks, ein CSS (~20 KB), Schrift vorgeladen, Skripte `defer`/`module`, keine Bilder über dem Falz → sehr gute LCP/CLS-Werte zu erwarten. **📝 Messung mit Lighthouse/PageSpeed nach Deployment auf echter Domain.**

## 3. GEO – Generative Engine Optimization

KI-Suchsysteme zitieren Quellen, die eine Frage präzise, überprüfbar und gut strukturiert beantworten.

| Maßnahme | Umsetzung | Status |
|---|---|---|
| Fragen direkt beantworten | FAQ je Leistung mit kurzen, sachlichen Antworten im ersten Satz | ✅ |
| Fakten statt Werbesprache | Prüffristen, Anmeldepflichten (NAV, 12 kVA), Schnittzeiten (§ 39 BNatSchG), Asbest (TRGS 519), Handwerksrecht | ✅ |
| Eindeutige Entitäten | Unternehmen mit `@id`, Leistungen als `Service`, Orte als `City`/`GeoCircle` | ✅ |
| `llms.txt` | Kompakte Zusammenfassung mit allen Leistungs- und Ortsseiten | ✅ |
| Konsistente NAP-Daten | Name, Adresse, Telefon identisch auf Website, Google Business Profile, Bing Places, Branchenverzeichnissen | 📝 nach Festlegung der Kontaktdaten |
| Externe Belege | echte Bewertungen (Google), Erwähnungen in Innungs-/HWK-Verzeichnissen, lokale Presse | 📝 |
| Aktualität | `lastmod` in Sitemap, sichtbares Aktualisierungsdatum bei Ratgeberinhalten | 🟡 Sitemap ✅, Ratgeber 📝 |
| KI-Crawler | robots.txt erlaubt nach Go-live alle Crawler; Ausschluss einzelner Bots (z. B. GPTBot) wäre kontraproduktiv für das Ziel | 📝 Entscheidung beim Go-live |

## 4. Google Business Profile, Search Console, Bing (📝 Go-live-Checkliste)

1. **Google Business Profile**: Kategorie primär „Elektriker“, sekundär „Bodenleger“, „Hausmeisterdienst“, „Gebäudereinigungsdienst“, „Entrümpelungsdienst“, „Renovierungsunternehmen“. Einzugsgebiet: die 13 Ortsseiten-Städte plus weitere Orte (max. 20). Leistungen exakt wie auf der Website benennen und jeweils auf die Leistungsseite verlinken. Wenn kein Kundenverkehr am Standort: Adresse ausblenden (Service-Area-Business).
2. **Bewertungen**: nach jedem abgeschlossenen Auftrag automatisch Bewertungslink senden (über Werkora, siehe 07). Keine Anreize, keine gekauften Bewertungen.
3. **Google Search Console + Bing Webmaster Tools**: Domain-Property verifizieren (DNS-TXT), Sitemap einreichen, Bing-Import aus GSC nutzen (versorgt auch Copilot/ChatGPT-Suche, die Bing-Index nutzen).
4. **IndexNow** (Bing/Yandex) beim Deployment anstoßen – 📝 optionaler Build-Schritt.

## 5. Conversion-Optimierung und Messung

- CTA auf jeder Seite oberhalb des Falzes und am Seitenende, mobile Schnellleiste.
- Buchung mit vorausgewählter Leistung/Ort (Deep Links), 5 Schritte mit Fortschrittsanzeige, Prüfschritt vor dem Absenden.
- **Messung (datensparsam):** Die Buchung löst das Browser-Ereignis `bss:lead` aus (Leistung, Art, Zone – keine personenbezogenen Daten). 📝 Anbindung an eine cookielose Statistik (z. B. selbst gehostetes Matomo ohne Cookies oder Plausible) nach Datenschutzprüfung.
- **Lead-Messung in Werkora:** Quelle (`quelle.kanal`, UTM-Parameter in `quelle.kampagne`), Leistung, Zone, Status-Verlauf bis Auftrag → echte Konversionsrate je Leistung und Stadt. 📝 Dashboard.
- KPIs: Anfragen je Leistung/Monat, Anteil Direktbuchungen, Anfrage→Angebot→Auftrag, Zeit bis Erstreaktion, Leads je Stadt, organische Klicks (GSC) je Seite.

## 6. Was bewusst NICHT gemacht wird

- Keine Stadt×Leistung-Seiten (z. B. „Badsanierung Bottrop“, „Badsanierung Gladbeck“ …) – das wären Doorway-Pages mit hohem Abstrafungsrisiko.
- Kein Keyword-Stuffing; der Qualitätstest prüft die Ähnlichkeit der Ortsseiten (derzeit max. 0,36 Jaccard).
- Keine erfundenen Referenzen, Bewertungen, Jahreszahlen, „Nr. 1“-Aussagen – automatisch geprüft.
- Keine Preise ohne Freigabe.

## 7. Nächste Inhaltsschritte (priorisiert)

1. Echte Projektberichte mit Fotos (Freigabe des Kunden) je Stadt → stärkster lokaler Relevanzfaktor; werden in `orte-seiten.mjs` ergänzt.
2. Ratgeber mit Fragen-Fokus: „Vinyl oder Laminat?“, „Wann muss der Zählerschrank erneuert werden?“, „Prüffristen DGUV V3“, „Was kostet eine Entrümpelung?“ (mit nachvollziehbarer Kostenlogik, wenn Preise freigegeben sind).
3. Teamseite mit echten Qualifikationen (Meisterbrief, Zertifikate) – E-E-A-T.
