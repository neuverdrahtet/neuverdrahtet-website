# 09 – Mitarbeiterverwaltung, Rollen und Automatisierung (📝 Konzept)

## Skalierung

- **Phase 1 – Einzelunternehmer:** eine Person mit Rolle Inhaber. Alle Freigaben sind Selbstfreigaben (werden trotzdem protokolliert), automatische Zuweisung entfällt. Das System funktioniert ohne Mitarbeiterstammdaten.
- **Phase 2 – erste Mitarbeiter:** Rollen Techniker/Servicemitarbeiter, Zuweisung durch Inhaber, Zeiterfassung.
- **Phase 3 – Teams:** Büro, Projektleitung, Teams je Bereich, Tourenplanung, Vertretungen.

## Rollen (Abbildung auf bestehende Werkora-Rollen)

| Neue Rolle | Bestehende Rolle | Beschreibung |
|---|---|---|
| Inhaber | `admin` | alles, einschließlich Finanzen, Rechte, Löschungen |
| Büro | `buero` | Leads, Kunden, Termine, Angebote/Rechnungen erstellen (Versand Rechnung nach Regel), keine Rechteverwaltung |
| Projektleitung | 📝 neu `projektleitung` | Aufträge des eigenen Bereichs, Disposition, Aufmaß, Angebotsentwürfe, Abnahmen |
| Techniker | `techniker` | zugewiesene Einsätze, Prüfprotokolle, Messwerte, Fotos, Zeiten, Material |
| Servicemitarbeiter | `mitarbeiter` | zugewiesene Objektservice-/Entrümpelungseinsätze, Checklisten, Fotos, Zeiten |
| Kunde | `kunde` | eigenes Portal (lesend) |

## Rechtematrix

| Aktion | Inhaber | Büro | Projektl. | Techniker | Service | Kunde |
|---|---|---|---|---|---|---|
| Leads sehen/bearbeiten | ✔ | ✔ | eigener Bereich | – | – | – |
| Kundenakte lesen | ✔ | ✔ | ✔ | nur zugewiesen, minimal | nur zugewiesen, minimal | eigene |
| Objektzugangscodes lesen | ✔ | ✔ | ✔ | am Einsatztag | am Einsatztag | – |
| Einsatz zuweisen/verschieben | ✔ | ✔ | eigener Bereich | – | – | Anfrage |
| Status/Checkliste/Fotos | ✔ | ✔ | ✔ | eigene Einsätze | eigene Einsätze | – |
| Zeiten/Material melden | ✔ | ✔ | ✔ | eigene | eigene | – |
| Angebot erstellen | ✔ | ✔ | Entwurf | – | – | – |
| Angebot/Rechnung versenden | ✔ | mit Freigabe* | – | – | – | – |
| Rabatte, Storno, Gutschrift | ✔ | – | – | – | – | – |
| Mitarbeiter/Rechte verwalten | ✔ | – | – | – | – | – |
| Daten löschen/exportieren (DSGVO) | ✔ | Antrag | – | – | – | Antrag |

\* Freigabe = Bestätigung des Inhabers in der App (bestehendes Freigabe-Muster `mcpFinanzFreigaben`).

Umsetzung: Firestore-Regeln (`hasRole`) für Lese-/Schreibrechte je Collection + serverseitige Prüfung in den Workern für Aktionen (gleiche Matrix als JSON, eine Quelle für App, API und WhatsApp-Gateway). Tests mit dem Firestore-Emulator (Muster `firestore-tests/rules.test.mjs` existiert).

## Qualifikationen

Mitarbeiter haben Qualifikationen mit Gültigkeitsdatum, z. B. Elektrofachkraft, befähigte Person (TRBS 1203), F-Gase Kategorie I, TRGS-519-Sachkunde, Führerschein C1, Ersthelfer. Einsätze verlangen Qualifikationen; die Zuweisung prüft das (🤖 Warnung bei Ablauf 30 Tage vorher).

## Mobile Oberfläche

- Bestehende Techniker-Oberfläche `verwaltung/techniker/` (PWA) als Basis: Tagesliste, Navigation zur Adresse, Checkliste, Fotos, Messwerte, Zeiten, Material, Unterschrift.
- Offline-fähig (Service Worker existiert), Synchronisation bei Netz.
- Alternativ/ergänzend WhatsApp (siehe 06) für schnelle Meldungen.

## Arbeitszeiterfassung

- Start/Ende je Einsatz und Fahrzeit; Pausen; Tagesabschluss mit Bestätigung durch Mitarbeiter.
- Rechtlicher Rahmen: Pflicht zur Arbeitszeiterfassung (BAG, Beschluss vom 13.09.2022); Aufbewahrung; Mitarbeiter haben Einsicht. Keine GPS-Dauerortung – nur Zeitstempel bei Statuswechseln.

## Automatisierungen (Auswahl)

| Auslöser | Aktion | Mensch? |
|---|---|---|
| neuer Lead | Benachrichtigung, Dublettenprüfung, Eingangsbestätigung | – |
| Direktbuchung in Zone A/B, Slot frei | Termin automatisch bestätigen (Regel konfigurierbar) | optional |
| Einsatz morgen | Erinnerung Kunde + Mitarbeiter | – |
| Einsatz erledigt | Leistungsnachweis, Rechnungsentwurf | Freigabe |
| Prüffrist in 8 Wochen | Wartungsauftrag + Kundeninfo | – |
| Angebot 7 Tage unbeantwortet | Nachfass-Aufgabe | ✔ |
| Rechnung überfällig | Mahnentwurf (bestehendes Muster `jarvisMahnEntwuerfe`) | Freigabe |
| Qualifikation läuft ab | Hinweis Inhaber | – |

Grundsatz: Automationen erzeugen Entwürfe und Aufgaben; finanzielle und rechtlich wirksame Schritte werden von Menschen freigegeben.
