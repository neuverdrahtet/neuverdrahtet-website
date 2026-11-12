# 04 – Online-Buchung und Kundenerfassung

Seite: `public/buchen.html` · Oberfläche: `assets/js/buchung.mjs` · Kernlogik: `assets/js/buchung-kern.mjs` · Schema: `docs/schemas/lead.schema.json`

## Buchungsarten

| Art | Leistungen | Termin | Ergebnis |
|---|---|---|---|
| **Direktbuchung** (`vorgangsart: buchung`) | DGUV-V3-Prüfung, E-Check, Wärmepumpenwartung, Klimaanlagenwartung, Elektroreparatur/Störung | vorläufiger Slot (Mo–Fr, ohne NRW-Feiertage, 2 Werktage Vorlauf, 4 Wochen Horizont) | Termin wird nach Kalenderabgleich bestätigt |
| **Anfrage** (`vorgangsart: anfrage`) | alle Projekte (Sanierung, Boden, Installation, Objektservice, Entrümpelung …) | optionaler Wunschtermin für Besichtigung + Zeitfenster | Besichtigung → Angebot |

Welche Leistung direkt buchbar ist, steht im Feld `buchung` der Leistungsdaten. Test: Direktbuchung nur für Prozesse `wartung`/`service`. ✅

## Ablauf (5 Schritte)

1. **Leistung** – Bereich → Leistung; Hinweis auf Buchungsart. Vorbelegung über `?leistung=`, `?bereich=`, `?ort=`, `?plz=`.
2. **Einsatzort** – Straße, Hausnummer, PLZ, Ort, Zusatz. Sofortige Einsatzgebietsprüfung (Zone, km, Fahrzeit, Hinweis bei PLZ/Ort-Widerspruch). Optional abweichende Rechnungsadresse.
3. **Details & Termin** – Beschreibung (mind. 15 Zeichen, Hilfetext je Prozess), leistungsabhängige Zusatzfelder (Geräteanzahl, Anlage/Modell, Fläche), Slot oder Wunschtermin, Fotos/Dokumente (max. 6 × 10 MB, JPG/PNG/WEBP/HEIC/PDF).
4. **Kontakt** – Kundentyp (privat, Vermieter, Hausverwaltung, Gewerbe), Firma, Vor-/Nachname, Telefon, E-Mail, bevorzugter Kontaktweg.
5. **Prüfen** – vollständige Zusammenfassung mit „ändern“-Links je Block, Datenschutz-Einwilligung (Pflicht), WhatsApp-Einwilligung (nur wenn WhatsApp gewählt, freiwillig).

## Prüfungen

| Prüfung | Wo | Status |
|---|---|---|
| Pflichtfelder, E-Mail-, Telefon-, PLZ-, Hausnummernformat | Browser (Kern) | ✅ getestet |
| Adressvalidierung (formal + PLZ↔Ort-Abgleich) | Browser | ✅ |
| Adressvalidierung gegen Straßenverzeichnis | Server | 📝 (z. B. Geocoding beim Lead-Eingang; Abweichungen markieren, nicht ablehnen) |
| Einsatzgebiet und Zone | Browser, lokal | ✅ |
| Kalenderabgleich | Server (Werkora-Termine) | 📝 Slots sind vorläufig |
| Fahrtkostenberechnung | Browser (Zone) / Server (Route) | 🟡 Zone ✅, Betrag erst nach Preisfreigabe |
| Dateityp, -größe, -anzahl | Browser; Server muss erneut prüfen (MIME-Sniffing, Virenscan) | ✅ Browser / 📝 Server |
| Dubletten | Browser: SHA-256-Schlüssel + Sitzungsschutz gegen Doppelklick; Server: Abgleich in Werkora | ✅ Browser / 📝 Server |
| Spam | Honeypot + Ausfüllzeit (wie im bestehenden Kostenschätzer-Worker) | 🟡 Felder werden gesendet, Auswertung serverseitig 📝 |
| Idempotenz | `Idempotency-Key`-Header = UUID je Formularsitzung | ✅ Browser / 📝 Server |
| Barrierefreiheit | Labels, `aria-invalid`, `aria-describedby`, Fokus auf Schritttitel, Fehlerfokus | ✅ |

## Übertragung

- `config.mjs → buchung.endpunkt = null` ⇒ **Demo-Modus**: Durchlauf vollständig, Vorgangsnummer `DEMO-JJJJMMTT-XXXX`, deutlicher Hinweis „nicht übertragen“, Payload in der Browser-Konsole. 🟡
- Mit Endpunkt: `POST multipart/form-data` (Teil `lead` = JSON, Teile `dateien`), Header `Idempotency-Key`. Erwartete Antwort `200 { vorgangsnummer, status }`. Bei Fehlern bleibt das Formular erhalten, erneutes Absenden verwendet denselben Idempotenzschlüssel. 📝 Endpunkt siehe 05.
- Bestätigung: Bildschirm mit Vorgangsnummer und klarer Aussage, dass der Termin erst nach Bestätigung verbindlich ist. E-Mail-/WhatsApp-Bestätigung durch Werkora. 📝

## Tests

- `tests/logik.test.mjs` – 26 Unit-Tests (Zonen, Feiertage, Slots, Validierung, Dubletten, Payload vs. Schema) ✅
- `tests/browser/buchung-e2e.test.mjs` – Chromium: Direktbuchung DGUV V3 und Anfrage Badsanierung komplett inkl. Fehlerfällen, Rechnungsadresse, Ändern aus Zusammenfassung, Mobilansicht ✅
