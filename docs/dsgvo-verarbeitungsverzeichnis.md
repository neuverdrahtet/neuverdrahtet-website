# DSGVO: Verarbeitungsverzeichnis + Auftragsverarbeiter (Maßnahme 9)

Stand: 03.11.2026. Diese Datei dokumentiert die technischen FAKTEN (welche
personenbezogenen Daten werden wo verarbeitet, welche Drittanbieter sind
beteiligt) als Grundlage für ein Verarbeitungsverzeichnis nach Art. 30
DSGVO. Sie ist **kein Rechtstext** und **ersetzt keine Rechtsberatung** -
die rechtliche Bewertung (Rechtsgrundlagen, ob/welche AVV mit welchem
Anbieter nötig sind, Formulierung gegenüber Kunden/Mitarbeitern) muss Danny
mit einem Anwalt/Steuerberater klären. Was technisch bereits umgesetzt ist
(Auskunft/Löschung je Kunde), siehe unten Abschnitt 4.

## 1. Verantwortlicher

neuverdrahtet UG (haftungsbeschränkt), Essen (siehe `impressum.html` für
die vollständigen Angaben).

## 2. Verarbeitungstätigkeiten

### 2.1 Öffentliche Website (neuverdrahtet.com)

| Verarbeitung | Daten | Zweck | Rechtsgrundlage (vorläufig, von Anwalt zu prüfen) |
|---|---|---|---|
| Kontaktformular | Name, E-Mail, Telefon, Nachricht | Anfragenbearbeitung | Vertragsanbahnung (Art. 6 Abs. 1 b) |
| Kosten-Konfiguratoren (Wallbox, E-Check, ...) | Eingaben zur Kostenschätzung, optional Kontaktdaten | Angebotserstellung | Vertragsanbahnung |
| Google Analytics (nur nach Cookie-Einwilligung) | Nutzungsdaten, pseudonymisiert | Reichweitenmessung | Einwilligung (Art. 6 Abs. 1 a) |
| KI-Check Unterverteilung (Foto-Ersteinschätzung) | Hochgeladenes Foto | automatisierte Ersteinschätzung | Einwilligung/Vertragsanbahnung |
| KI-Chat-Assistent (Website-Widget) | Chateingaben | Beantwortung von Anfragen | berechtigtes Interesse/Einwilligung |
| KI-Assistent per WhatsApp | WhatsApp-Nachrichten | Terminvereinbarung/Anfragenbearbeitung | Einwilligung |

Details und genaue Formulierung bereits in `datenschutz.html` (Abschnitte
1-10) - diese Datei wiederholt das nicht, sondern ergänzt die interne,
noch fehlende Sicht auf Werkora/die Verwaltungssoftware (Abschnitt 2.2).

### 2.2 Werkora (interne Verwaltungssoftware, `verwaltung/`)

| Verarbeitung | Betroffene | Daten | Zweck |
|---|---|---|---|
| Kundenstammdaten (`kunden`) | Kunden (Firmen- und Privatkunden) | Firma/Name, Ansprechpartner, Anschrift, Telefon, E-Mail, Notizen | Auftragsabwicklung |
| Angebote/Aufträge/Rechnungen/Gutschriften/Mahnungen | Kunden | wie oben + Leistungs-/Zahlungsdaten | Vertragserfüllung, Buchhaltung (GoBD-Aufbewahrungspflicht) |
| Serviceaufträge/Wartungsdokumentation | Kunden | Anlagendaten, Standort, Prüfprotokolle | Vertragserfüllung, gesetzl. Prüfpflichten (DGUV V3 etc.) |
| Mitarbeiterverwaltung (`mitarbeiter`), Zeiterfassung, Reisekosten, Benefits | Mitarbeiter | Name, Kontaktdaten, Arbeitszeiten, Gehaltsrelevantes | Personalverwaltung, Lohnabrechnung |
| Bewerbungen/Subunternehmer (`subunternehmer`) | Subunternehmer | Firmendaten, Kontaktdaten | Auftragsvergabe |
| E-Mail-Synchronisation (Gmail, `emails`) | Kunden (Absender/Empfänger) | E-Mail-Inhalt, Metadaten | Kommunikationsnachweis, Kundenakte |
| Kundenportal (optional) | Kunden mit Portal-Zugang | Login (E-Mail), Einsicht eigener Angebote/Rechnungen/Termine | Selbstbedienung |
| JARVIS (KI-Automatisierung, mehrere Worker) | Kunden, Mitarbeiter | je nach Funktion: E-Mail-Inhalte, Rechnungsdaten, Termindaten | automatisierte Entwurfserstellung, Freigabe-Workflow (siehe `docs/p0-security-baseline.md`) |
| Zwei-Faktor-Authentifizierung (`docs/mfa-setup.md`) | Mitarbeiter mit Werkora-Zugang | TOTP-Faktor (kein Klartext-Geheimnis in Werkora selbst, liegt bei Firebase Auth) | Kontosicherheit |

## 3. Eingesetzte Auftragsverarbeiter / Drittanbieter (Stand der Code-Analyse)

Diese Liste nennt nur, WELCHE Dienste tatsächlich Zugriff auf welche Art
von Daten haben (aus dem Code ermittelt) - NICHT, ob/welcher AVV bereits
vorliegt. Das muss Danny pro Zeile prüfen und abhaken.

| Anbieter | Rolle | Welche Daten | AVV vorhanden? |
|---|---|---|---|
| Google / Firebase (Auth, Firestore, Storage, Cloud Functions) | Hosting der gesamten Werkora-Datenbank + Login | alle oben genannten Werkora-Daten | ☐ zu prüfen |
| Cloudflare (Workers, u.a. `cloudflare-worker*`) | Ausführt JARVIS-Automatisierungen, KI-Check, Kostenschätzer, Social-Publish, Qonto-Sync | je Worker unterschiedlich, siehe 2.2 | ☐ zu prüfen |
| Anthropic (Claude-API, `api.anthropic.com`) | KI-Textgenerierung für Angebote/Mails/Chat-Assistent | von JARVIS übergebene Anfrage-/Kundendaten (Textform) | ☐ zu prüfen |
| Google Workspace (Gmail/Calendar-API) | E-Mail-Sync, Kalenderintegration | E-Mail-Inhalte, Termindaten | ☐ zu prüfen (ggf. durch Google-Workspace-eigenen AVV abgedeckt) |
| lexoffice (Haufe-Lexware) | Buchhaltungsabgleich (Kontakte/Rechnungen) | Kunden-/Rechnungsdaten | ☐ zu prüfen |
| Qonto | Bankabgleich (`cloudflare-worker-qonto-sync`) | Zahlungstransaktionen (i.d.R. ohne weitere Kundendaten über das nötige Maß hinaus) | ☐ zu prüfen |
| Google Analytics | Reichweitenmessung (nur öffentliche Website, nach Einwilligung) | pseudonymisierte Nutzungsdaten | bereits in `datenschutz.html` benannt |
| Formspree | Kontaktformular-Zustellung (öffentliche Website) | Formulareingaben | ☐ zu prüfen |
| WhatsApp (`wa.me`-Links) | Öffnet nur die WhatsApp-App des Nutzers mit vorausgefülltem Text - Werkora selbst sendet nichts über eine WhatsApp-API | keine serverseitige Datenübertragung durch Werkora | entfällt (kein Auftragsverarbeiter) |

## 4. Bereits technisch umgesetzt (kein Rechtstext nötig)

- **Art. 15 (Auskunft) + Art. 17 (Löschung auf Antrag) je Kunde**: in
  Werkora unter Kunden → Kundenakte öffnen → "🔐 Datenschutz". Erzeugt
  eine vollständige JSON-Auskunft über alle zu diesem Kunden gespeicherten
  Daten, bzw. löscht/anonymisiert die Stammdaten. Respektiert dabei die
  GoBD-Aufbewahrungspflicht: solange eine versendete Rechnung/Gutschrift
  existiert, bleiben Firma/Anschrift bestehen (sonst wäre der historische
  Rechnungsinhalt nicht mehr nachvollziehbar) - Kontaktdaten (Telefon,
  E-Mail, Notizen, Portal-Zugang) werden davon unabhängig immer gelöscht.
  Siehe `verwaltung/js/dsgvo.js`.
- **Speicherbegrenzung**: automatische endgültige Löschung nach Ablauf der
  jeweiligen GoBD-Aufbewahrungsfrist (siehe `docs/backup-restore.md` und
  `verwaltung/js/db.js`, `trashTageFuer`).
- **Datensicherheit**: MFA (`docs/mfa-setup.md`), Audit-Log für sensible
  Änderungen (Maßnahme 6), serverseitige Rollenbeschränkung (Firestore
  Rules), wöchentliches Backup (`docs/backup-restore.md`).

## 5. Offene Punkte für Danny (keine davon ist Code)

1. Pro Zeile in Abschnitt 3: prüfen/abschließen, ob ein
   Auftragsverarbeitungsvertrag (AVV) vorliegt oder nötig ist.
2. Rechtsgrundlagen in Abschnitt 2 von einem Anwalt/Steuerberater bestätigen
   lassen (hier nur als Arbeitshypothese markiert).
3. Entscheiden, ob/wie Mitarbeiter über die MFA-/Datenschutz-Prozesse
   informiert werden müssen (Informationspflicht ggü. Beschäftigten).
4. Entscheiden, ob für Werkora selbst (nicht nur die öffentliche Website)
   eine eigene interne Datenschutzerklärung/Mitarbeiterinformation nötig
   ist.
