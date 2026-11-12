# 03 – Regionale Sichtbarkeit im 50-Kilometer-Radius

## Einsatzgebiet

- Zentrum: Essen (Innenstadt), Radius rund 50 km Luftlinie (`config.mjs → einsatzgebiet`).
- **48 Städte und Gemeinden** sind mit Koordinaten und PLZ-Bereichen hinterlegt (`public/assets/js/einsatzgebiet-logik.mjs`): alle 13 in der Anweisung genannten Städte sowie u. a. Herten, Marl, Dorsten, Datteln, Haltern am See, Dinslaken, Moers, Krefeld, Ratingen, Düsseldorf, Wuppertal, Witten, Dortmund, Lünen. Der Test stellt sicher, dass alle ≤ 50 km liegen und sich PLZ-Bereiche nicht überschneiden. ✅
- Die Website ist **nicht** auf diese Liste begrenzt: unbekannte PLZ werden nicht abgelehnt, sondern als „manuell prüfen“ angenommen.
- ⚠️ Die PLZ-Bereiche sind eine eigene Zusammenstellung. Vor Go-live gegen amtliche PLZ-Daten abgleichen (z. B. OpenGeoDB/Deutsche Post Datafactory). 📝

## Drei Sichtbarkeitsebenen

| Ebene | Inhalt | Status |
|---|---|---|
| 1. Einsatzgebiet-Übersicht | Tabelle aller 48 Orte mit Kreis, Entfernung, geschätzter Fahrzeit, Zone; PLZ-Prüfer | ✅ |
| 2. Ortsseiten (13) | eigene Einleitung, Stadtteile, berechnete Anfahrt, begründete Leistungsschwerpunkte, FAQ, Nachbarorte | ✅ |
| 3. Google Business Profile | Servicegebiet, Leistungen, Fotos, Bewertungen | 📝 |

### Eigenständiger Mehrwert der Ortsseiten
Jede Ortsseite enthält Informationen, die nur für diesen Ort gelten (Anfahrt/Zone, PLZ, Stadtteile, Lage zu Essen, passende Schwerpunkte, Nachbarorte). Der Test misst die Textähnlichkeit (Wort-Trigramme): höchster Wert derzeit 0,36 – deutlich unter der Grenze von 0,6.

**Regeln für die Erweiterung:**
- Neue Ortsseiten nur, wenn es echten ortsbezogenen Inhalt gibt (Projekte, regelmäßige Kunden, ortsspezifische Regelungen).
- Bestehende Ortsseiten mit freigegebenen Projektberichten anreichern statt neue Seiten anzulegen.
- Keine Stadt×Leistung-Seiten.

## Anfahrtszonen und Fahrtkosten

| Zone | Luftlinie | Beispiele |
|---|---|---|
| A | bis 10 km | Essen, Mülheim-Ost, Gelsenkirchen-Süd |
| B | bis 25 km | Oberhausen, Bottrop, Gladbeck, Bochum, Herne, Velbert, Hattingen, Duisburg |
| C | bis 40 km | Recklinghausen, Castrop-Rauxel, Dortmund, Düsseldorf, Wuppertal, Krefeld |
| D | bis 50 km | Haltern, Waltrop, Lünen (je nach Lage) |

- Straßenkilometer = Luftlinie × 1,3; Fahrzeit = Straßen-km / 38 km/h + 5 Min. (Schätzwerte, konfigurierbar).
- **Beträge je Zone sind eine Geschäftsentscheidung** und daher in `config.mjs` leer (`pauschaleEuro: null`, `preiseFreigegeben: false`). Bis zur Freigabe zeigt die Website nur die Zone an.
- 📝 Ausbaustufe: Werkora berechnet beim Lead-Eingang die exakte Route (z. B. OSRM selbst gehostet oder Google Routes API) und schlägt Tourentage vor (Einsätze in Zone C/D bündeln).
