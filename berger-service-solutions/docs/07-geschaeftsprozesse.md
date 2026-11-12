# 07 – Die vier Geschäftsprozesse

Die Prozessschritte sind in `src/daten/bereiche.mjs → PROZESSE` hinterlegt und werden auf jeder Leistungsseite und auf `ablauf.html` angezeigt (✅). Die Automatisierung in Werkora ist 📝 geplant. Zusätzlich gibt es die Variante **Service/Reparatur** (Elektro-Störung) als verkürzte Form des Wartungsprozesses.

Legende: 🤖 automatisch · 👤 Mensch entscheidet · 📱 auch per WhatsApp

## A. Wartung und Prüfung

| # | Schritt | Werkora | Ergebnis/Dokument |
|---|---|---|---|
| 1 | Online-Buchung | 🤖 Lead + vorläufiger Termin, Dublettenprüfung | Lead L-…, Einsatz (vorläufig) |
| 2 | Terminplanung | 🤖 Verfügbarkeit/Zone prüfen → 👤 bestätigen (später auto bei Regeln) → 🤖 Bestätigung E-Mail/📱 | Einsatz bestätigt |
| 3 | Durchführung | 📱 Status unterwegs/vor Ort; Checkliste je Leistung (z. B. DGUV: Sichtprüfung, R_PE, R_ISO, I_PE/I_B, Funktion) | Messwerte |
| 4 | Dokumentation | Messwerte gegen Grenzwerte (`pruefnormenGrenzwerte` vorhanden) 🤖 bewerten; Fotos | Prüfprotokoll P-…, Geräteverzeichnis |
| 5 | Prüfbericht | 🤖 PDF erzeugen, 👤 freigeben, an Kunden | Prüfbericht |
| 6 | Rechnung | 🤖 Entwurf aus Leistungsnachweis (Geräteanzahl × Satz + Zone) → 👤 freigeben | Rechnung |
| 7 | Wiederholungstermin | 🤖 Fälligkeit aus Prüffrist am Objekt/Gerät; Erinnerung 8 und 4 Wochen vorher | Folgeauftrag |

## B. Handwerk und Sanierung (inkl. Bodenlegearbeiten)

| # | Schritt | Werkora | Ergebnis |
|---|---|---|---|
| 1 | Kundenanfrage | 🤖 Lead mit Fotos, Fläche, Objekt | Lead |
| 2 | Besichtigung | 👤 Termin, 📱 Erinnerung | Einsatz „Besichtigung“ |
| 3 | Aufmaß | Raumbuch: Räume, Flächen, Untergrund (Boden: Feuchte, Ebenheit, Altbelag, Asbestverdacht ja/nein) | Aufmaß-Dokument |
| 4 | Kalkulation | Positionen aus Leistungsverzeichnis (Lohn, Material, Entsorgung, Fremdgewerk) | Kalkulation |
| 5 | Angebot | 🤖 Entwurf → 👤 Prüfung/Freigabe (kritisch) → Versand | Angebot (bestehende Collection) |
| 6 | Auftragsfreigabe | Kunde nimmt an (Portal/Unterschrift/E-Mail) → 🤖 Auftrag „beauftragt“ | Auftragsbestätigung |
| 7 | Materialplanung | Materialliste aus Angebot → Bestellung, Liefertermin am Bauzeitenplan | Bestellungen |
| 8 | Durchführung & Dokumentation | 📱 Fotos je Tag/Raum, Zeiten, Material | Bautagebuch |
| 9 | Abnahme | Protokoll mit Mängelliste, Unterschrift | Abnahmeprotokoll |
| 10 | Rechnung | Abschläge nach Baufortschritt (vertraglich), 🤖 Schlussrechnung abzüglich Abschläge → 👤 Freigabe | Abschlags-/Schlussrechnung |

## C. Hausmeister- und Objektservice

| Element | Umsetzung |
|---|---|
| Einzelauftrag | wie Wartung (Buchung/Anfrage → Einsatz → Nachweis → Rechnung) |
| Objektakte | Stammdaten, Zugänge, Anlagen, Flächen, Ansprechpartner, Hausordnung, Müllabfuhrkalender, Ortssatzung Winterdienst |
| Dauervertrag | Leistungsplan mit Intervallen (RRULE, z. B. „Treppenhaus wöchentlich Di“, „Grünpflege 14-tägig Apr–Okt“, „Winterdienst Bereitschaft Nov–Mär“) |
| Wiederkehrende Einsatzplanung | 🤖 Einsätze 8 Wochen rollierend erzeugen; Feiertage verschieben; Konflikte melden |
| Mitarbeiterzuweisung | 🤖 Vorschlag nach Qualifikation, Zone/Tour, Auslastung → 👤 bestätigen |
| Checklisten | je Objekt und Leistung, Pflichtpunkte mit Foto |
| Leistungsnachweise | 🤖 aus erledigter Checkliste mit Zeitstempel/Foto; Monatsübersicht an Verwaltung |
| Abrechnung | 🤖 Turnusrechnung (monatlich/quartalsweise) mit Anhang Leistungsnachweise; umlagefähige und nicht umlagefähige Positionen getrennt; Zusatzleistungen (Reparaturen) separat nach Freigabe |
| Winterdienst | Einsatzprotokoll mit Uhrzeit, Witterung, Streumittel (Haftungsnachweis) |

## D. Rückbau und Entrümpelung

| # | Schritt | Werkora | Ergebnis |
|---|---|---|---|
| 1 | Anfrage | Lead mit Fotos aller Räume, Etage, Aufzug, Parksituation | Lead |
| 2 | Fotos | 🤖 Erinnerung, falls keine Fotos | – |
| 3 | Besichtigung | bei > 1 Raum oder unklarer Menge | Einsatz |
| 4 | Mengenermittlung | Volumen m³ je Fraktion (Sperrmüll, Holz A1–A3, Metall, E-Schrott, Bauschutt, Restmüll), Schadstoffverdacht | Mengenliste |
| 5 | Entsorgungskalkulation | Fraktion × Annahmepreis + Container/Transport + Personal; Wertanrechnung separat | Kalkulation |
| 6 | Angebot | 👤 Freigabe | Angebot |
| 7 | Durchführung | Container-/Fahrzeugplanung, 📱 Fotos vorher/nachher | – |
| 8 | Entsorgungsnachweise | Wiegescheine/Annahmebelege je Fraktion dem Auftrag zuordnen; 🤖 Abschluss erst, wenn alle Fraktionen belegt | Nachweise |
| 9 | Dokumentierte Übergabe | Fotoprotokoll „besenrein“, Schlüsselübergabe, Unterschrift | Übergabeprotokoll |

## Prozessübergreifend

- Jeder Vorgang hat eine Nummer und eine Ereignishistorie (siehe 05).
- Fristen/SLAs: Erstreaktion auf Leads (Ziel festlegen, z. B. 1 Werktag), Angebotsversand nach Besichtigung, Rechnungsstellung nach Abnahme – 🤖 Erinnerungen bei Überschreitung.
- Nach Abschluss: 🤖 Bitte um Google-Bewertung (nur bei Einwilligung, keine Anreize).
