# KI-Wartungsdisposition MVP Phase 1 – Abschlussbericht (13.11.2026)

Dieser Bericht fasst das "KI-Wartungsdisposition"-Feature zusammen: den Import von
Partner-Wartungsaufträgen per Screenshot (WR-Gruppe) plus die darauf aufbauende
Serviceauftragsverwaltung. Es ist der **erste als Datei festgehaltene Abschlussbericht**
für diesen Arbeitsstrang – weder die vorausgehende Bestandsaufnahme (Task #86) noch der
Abschlussbericht des vorherigen, verwandten Strangs "Service-/Techniker-/
Personalverwaltung" (Tasks #71–85) wurden bisher als Datei abgelegt, nur als Chat-Text
geliefert. Es gibt also keine bestehende Datei, die dieser Bericht doppelt.

## A. Zusammenfassung je Baustein

| # | Was | Commit | Status |
|---|---|---|---|
| MVP | Screenshot-Import von Partner-Wartungsaufträgen (WR-Gruppe) | `a6d11c6` | abgeschlossen |
| #88 | Serviceempfänger erfassen + feste Kundenzuordnung "TLS Eco Plus Service" | `a6c2988` | abgeschlossen |
| #89 | Datenvollständigkeits-Check für laufende Serviceaufträge | `6b90df9` | abgeschlossen |
| #90 | Dubletten-Zusammenführung statt doppelter Einträge | `2aa3588` | abgeschlossen |
| #91 | Klick-Filter "nur überfällige" auf der KPI-Karte | `db1902b` | abgeschlossen |
| #92 | Alle KPI-Karten klickbar + Erkennung gekürzter Auftragsnummern | `d8702d5` | abgeschlossen |
| #93 | Mehrfachauswahl + Löschen über `bulkselect.js` | `5f4a364` | abgeschlossen |
| – | JARVIS SmartDispatch (Techniker-Einsatzvorschläge) | `5e11b38` | abgeschlossen, aktuell ungenutzt (siehe C) |
| – | Google-Kalender-Integration für Serviceaufträge | `e0744cf` | abgeschlossen, aktuell ungenutzt (siehe C) |
| – | Mobile Techniker-Oberfläche | (eigene Mini-App `verwaltung/techniker/`) | abgeschlossen, aktuell ungenutzt (siehe C) |

Alle Bausteine sind umgesetzt, getestet und committet. Was davon **heute tatsächlich in
Benutzung** ist, unterscheidet sich davon – siehe Abschnitt C.

## B. Was konkret gebaut wurde

1. **Screenshot-Import (`verwaltung/js/views/partnerimport.js`, nur Admin).** Löst das
   Problem, dass die WR-Gruppe (Partner-Vertriebsportal) keinen API-Zugang gewährt –
   Wartungsaufträge kommen nur als Screenshot. Die vorhandene Claude-Vision-Anbindung
   (wie bei JARVIS TECH) liest die Screenshots aus; **die Bilder selbst werden nie
   gespeichert**, nur der extrahierte Text landet in der serverseitig geschützten
   Entwurfs-Collection `jarvisPartnerImportEntwuerfe` (`write:false`, nur Admin liest).
   Mehrere Screenshots zum selben Auftrag werden über die Auftragsnummer zusammengeführt;
   Widersprüche zwischen Screenshots werden **markiert, nicht automatisch aufgelöst**.
   Ein erneuter Import überschreibt nie ein bereits befülltes Feld eines bestehenden
   Auftrags und lässt laufende Aufträge (Techniker/Status/Checkliste) unangetastet. Die
   Übernahme in einen echten Serviceauftrag passiert **ausschließlich** nach manueller
   Prüfung und explizitem Klick pro Zeile – nichts wird automatisch übernommen.
2. **Serviceempfänger + feste Kundenzuordnung (#88).** Die WR-Gruppe ist nur Vermittler;
   Vertragspartner ist "TLS Eco Plus Service". Der auf dem Screenshot sichtbare
   Serviceempfänger (die Anlage vor Ort) wird getrennt vom Rechnungskunden erfasst, die
   Kundenzuordnung läuft über eine feste, nicht geratene 1:1-Zuordnung pro Partnerquelle.
3. **Serviceauftragsverwaltung (`verwaltung/js/views/serviceauftraege.js`, 729 Zeilen,
   Admin/Büro).** Eigene Collection statt Wiederverwendung von "Projekte", weil externe
   Auftragsnummer/Hersteller/Anlagentyp/Dublettenprüfung dazukommen. Features: klickbare
   KPI-Karten (u.a. "nur überfällige", Dubletten-Übersicht), Erkennung gekürzter
   Auftragsnummern, Datenvollständigkeits-Check für laufende Aufträge,
   Dubletten-Zusammenführung (führt zusammen statt zu löschen, überschreibt nie ein
   bereits befülltes Feld), Mehrfachauswahl+Löschen, Materialliste pro Auftrag,
   Dokumente-Bereich – jeweils über die gemeinsamen Module `bulkselect.js`,
   `materialliste.js`, `dokumente.js`.
4. **Firestore-Berechtigungen.** Techniker dürfen einen ihnen zugewiesenen
   Serviceauftrag nur aktualisieren, wenn der bisherige Status `zugewiesen` oder
   `in_bearbeitung` ist, der neue Status nur `in_bearbeitung`/`abgeschlossen` sein darf,
   und nur ein festes Feld-Set (Status, Technikernotizen, Checkliste, Mängel,
   Materialliste, Berichtsentwurf) – nie Kunden-/Finanzfelder, nie die
   Techniker-Zuweisung selbst.
5. **JARVIS SmartDispatch.** Schlägt für offene Serviceaufträge Techniker vor (ohne
   Termin-/Krankheitskonflikt, nach aktueller Auslastung sortiert) – bewusst **ohne**
   erfundene Geo-/Entfernungsberechnung, da Werkora keine Koordinatendaten hat. Die
   Freigabe markiert nur den Vorschlag innerhalb von JARVIS; die tatsächliche
   Techniker-Zuweisung bleibt ein manueller Schritt im Serviceauftrag selbst.
6. **Google-Kalender-Integration.** Bewusst keine eigene Google-Calendar-API-Anbindung –
   ein Serviceauftrag-Termin ist ein normaler `termine`-Eintrag (neuer Typ "service") und
   läuft über den bereits bestehenden, menschlich ausgelösten Kalender-Sync. Erkennt
   Doppelbuchungen von Technikern (warnt, blockiert nicht) und verlangt bei bereits
   kundenbestätigten Terminen eine erneute Bestätigung vor jeder Verschiebung.
7. **Mobile Techniker-Oberfläche (`verwaltung/techniker/`).** Eigene, von der
   Haupt-Verwaltungs-App getrennte Mini-App (wie das Kundenportal) – Techniker sehen nie
   die interne Admin-Navigation. Absicherung läuft über Firestore-Regeln, nicht über
   UI-Logik.
8. **Tests.** 44 Tests in `verwaltung/tests/serviceauftraege.test.mjs` (Dublettenprüfung,
   Normalisierung, Merge-Logik, KPI-Filter u.a.), dazu Firestore-Regel-Tests für die
   Techniker-Rechte – aktuell alle grün (siehe `npm run test:all`, 513 Tests gesamt
   zuletzt am 13.11.2026 geprüft, 0 fehlgeschlagen).

## C. Wichtig: was davon heute tatsächlich genutzt wird

Mit der späteren "Solo-Betrieb-Vereinfachung" (Commits `b30e33e`, `151d788`) hat Danny
bewusst einen großen Teil der für mehrere Mitarbeiter gebauten Oberflächen
ausgeblendet, weil er aktuell allein arbeitet – das ist **keine Lücke, sondern Dannys
eigene, dokumentierte Entscheidung** (`ROUTE_ROLLEN` in `verwaltung/js/db.js`, jeweils
mit Kommentar "Solo-Betrieb: ..."):

- **Weiterhin aktiv genutzt:** Serviceauftragsverwaltung (`serviceauftraege`) und
  Partner-Import (`partnerimport`) – das Kernstück dieses MVP.
- **Gebaut, getestet, aber aktuell ohne eigene Route/unsichtbar:** die JARVIS-Zentrale
  (und damit die SmartDispatch-Vorschläge), Reisekosten-Simulation, Performance/Bonus,
  Mitarbeiter-Benefits, Urlaubsanträge, Geräte/Flotten, Teams, die Mitarbeiter-
  Verwaltungsseite (Dannys eigener Datensatz für die Zeiterfassung bleibt bestehen) und
  damit faktisch auch die mobile Techniker-Oberfläche (es gibt derzeit keine weiteren
  Mitarbeiter-/Techniker-Konten, die sie nutzen könnten).
- Die Daten/Collections existieren weiter in Firestore und sind mit einem Klick
  reaktivierbar (`ROUTE_ROLLEN`-Eintrag wieder auf die passenden Rollen setzen), falls
  Danny einmal einen Mitarbeiter/Techniker einstellt.

## D. Bewusste Einschränkungen (Phase 1, kein Bug)

- Nur eine Partnerquelle freigegeben (`PARTNER_QUELLEN = ['wr-gruppe']`) – weitere
  Partner sind ein bewusster künftiger Schritt, keine automatische Erkennung.
- Keine automatische Kunden-/Anlagen-Zuordnung über Namensraten hinaus, kein
  automatischer Kundenkontakt, keine automatische Terminbuchung, kein Schreibzugriff
  auf das Salesforce-Partnerportal selbst.
- Kein "⏸ Wartet auf Danny"-Schritt wie bei Staging/MFA – dieser Arbeitsstrang braucht
  keine zusätzlichen externen Zugangsdaten, um zu laufen.

## E. Empfehlung für den nächsten Schritt

Aus Code-Sicht ist dieser MVP-Strang fertig und stabil. Offen ist nur eine
geschäftliche Entscheidung: ob/wann ein zweiter Partner (außer WR-Gruppe) oder ein
weiterer Mitarbeiter/Techniker dazukommt – erst dann lohnt sich das Wieder-Einschalten
der aktuell ausgeblendeten Bereiche (Abschnitt C).
