# 10 – Datenschutz, Sicherheit, Recht und Qualität

> Kein Ersatz für Rechtsberatung. Alle mit ⚖️ markierten Punkte vor Go-live durch Fachleute (Rechtsanwalt, Handwerkskammer, Datenschutzbeauftragte/r) prüfen lassen.

## Website (umgesetzt ✅)

- Keine Cookies, keine Tracker, keine externen Schriften/Karten/Videos → kein Cookie-Banner nötig.
- Einsatzgebietsprüfung lokal im Browser, keine Übermittlung an Kartendienste.
- Formular: Datenschutz-Einwilligung mit Zeitstempel und Textversion; WhatsApp-Einwilligung getrennt und freiwillig.
- Dublettenschlüssel als SHA-256-Hash.
- Impressum und Datenschutz als **Entwurf** mit markierten Platzhaltern, `noindex` bis zur Fertigstellung. ⚖️

## Rechtstexte – offene Punkte ⚖️

- Impressum nach § 5 DDG: Inhaber, Rechtsform, Anschrift, Kontakt, USt-IdNr., **Handwerksrolleneintragung + zuständige Kammer + Berufsbezeichnung** (Angaben nach DL-InfoV bei reglementierten Berufen).
- Datenschutzhinweise: Hosting-Anbieter, Werkora-Hosting (Google Firebase, Region), Cloudflare, E-Mail-Anbieter, WhatsApp/BSP, Speicherfristen.
- Verzeichnis von Verarbeitungstätigkeiten: im Repo existiert `docs/dsgvo-verarbeitungsverzeichnis.md` für neuverdrahtet – für BERGER SERVICE SOLUTIONS (eigener Verantwortlicher?) anpassen.
- Auftragsverarbeitungsverträge (Google/Firebase, Cloudflare, Twilio/Meta, Hosting).
- AGB/Vertragsbedingungen für Online-Buchung, **Widerrufsbelehrung** für Verbraucher bei Fernabsatz (Online-Buchung = Fernabsatzvertrag; Hinweis auf vorzeitigen Beginn auf Verlangen, § 356 Abs. 4 BGB).
- Barrierefreiheitsstärkungsgesetz: gilt für bestimmte Dienstleistungen gegenüber Verbrauchern; Kleinstunternehmen (< 10 Beschäftigte und ≤ 2 Mio. € Umsatz) sind bei Dienstleistungen ausgenommen. Die Website erfüllt unabhängig davon grundlegende Barrierefreiheitsanforderungen (getestet: Labels, Fokus, Struktur).

## Handwerks- und Fachrecht ⚖️

Die vollständige, aus den Leistungsdaten generierte Liste steht in [`generiert/rechtliche-pruefpunkte.md`](generiert/rechtliche-pruefpunkte.md). Kernpunkte:

| Thema | Prüfpunkt |
|---|---|
| Elektrotechnik | Eintragung Elektrotechniker-Handwerk (Anlage A HwO); Eintrag im Installateurverzeichnis der Netzbetreiber im Einsatzgebiet (Westnetz u. a. – je Netzgebiet prüfen) |
| E-CHECK | Marke nur für Innungsbetriebe |
| Kältetechnik | Zertifikat nach Chemikalien-Klimaschutzverordnung / F-Gase-VO für Kältekreisarbeiten; sonst Partnerbetrieb |
| Fliesen, Parkett, Maler, Sanitär, Raumausstatter | zulassungspflichtig (Anlage A; Fliesen, Parkett, Raumausstatter seit 14.02.2020) – nur mit Eintragung/Ausnahmebewilligung oder Partnerbetrieb |
| Bodenleger, Gebäudereiniger | zulassungsfreie Handwerke (Anlage B1) – Eintragung ins Verzeichnis erforderlich |
| Trockenbau | Abgrenzung zum Stuckateur-Handwerk mit HWK klären |
| Entsorgung | Anzeige als Sammler/Beförderer (§ 53 KrWG), Erlaubnis für gefährliche Abfälle (§ 54 KrWG), Gewerbeabfallverordnung, ElektroG |
| Asbest/KMF | keine Arbeiten ohne TRGS-519-Sachkunde und Anzeige; Leistungsseiten weisen darauf hin |
| Haushaltsauflösung | Ankauf/Anrechnung → Gewerbeanmeldung (Gebrauchtwarenhandel) prüfen |
| Winterdienst | Betriebshaftpflicht mit Deckung, Vertrag zur Übertragung der Verkehrssicherungspflicht |
| Gebäudereinigung | allgemeinverbindlicher Mindestlohn-Tarifvertrag bei Beschäftigten |
| Versicherung | Betriebshaftpflicht (inkl. Bearbeitungs-/Schlüsselschäden), ggf. Umwelthaftpflicht für Entsorgung |

## Werkora-Sicherheit (Bestand + Ergänzungen)

| Maßnahme | Status |
|---|---|
| TLS überall, Firebase Auth, MFA (`docs/mfa-setup.md`) | ✅ Bestand |
| Firestore-/Storage-Regeln mit Rollen, Emulator-Tests | ✅ Bestand, 📝 neue Collections ergänzen |
| Rate-Limits fail-closed in Workern | ✅ Bestand, 📝 für Lead-Endpunkt |
| Backups: PITR 7 Tage + wöchentlicher Export (Feature-Flag) | 🟡 Bestand laut `docs/backup-restore.md`, Aktivierung offen |
| Ereignisprotokoll für Statusänderungen und Zugriffe auf sensible Felder | 📝 |
| Feldverschlüsselung Zugangscodes | 📝 |
| Löschkonzept: Leads ohne Auftrag nach Frist löschen; Auftragsunterlagen nach § 147 AO / § 257 HGB (6/8/10 Jahre) | 📝 Cron |
| Datei-Uploads: Magic-Byte-Prüfung, Größenlimit, getrennter Bucket, keine öffentliche URL | 📝 |
| Staging getrennt von Produktion | ✅ Konzept im Repo (`staging/README.md`) |

## Qualitätssicherung

- Trennung **geplant / implementiert / getestet** in allen Dokumenten (Legende in 01).
- Automatische Tests (siehe 11) laufen lokal und sind in den Repo-Testlauf `npm run test:unit` eingebunden.
- Inhaltsregeln werden getestet: keine Garantien, keine „Nr. 1“, keine erfundenen Jahreszahlen/Bewertungen, keine internen Vermerke im Seitentext.
