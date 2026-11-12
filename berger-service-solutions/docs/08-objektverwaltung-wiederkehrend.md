# 08 – Objektverwaltung und wiederkehrende Serviceleistungen (📝 Konzept)

## Objektakte (`objekte`)

```json
{
  "nummer": "O-2026-00017",
  "kundeId": "…",
  "bezeichnung": "MFH Musterstraße 12",
  "adresse": { "strasse": "Musterstraße", "hausnummer": "12", "plz": "45127", "ort": "Essen" },
  "adressSchluessel": "<sha256 plz|strasse|nr>",
  "geo": { "lat": 51.45, "lon": 7.01 }, "zone": "A",
  "objektart": "mehrfamilienhaus | gewerbe | efh | wohnung",
  "einheiten": 8, "baujahr": 1964,
  "flaechen": { "treppenhausEtagen": 4, "gruenM2": 300, "gehwegM": 40 },
  "zugang": { "schluesselNr": "S-12", "hinweis": "Schlüsseltresor", "codeVerschluesselt": "…" },
  "ansprechpartner": [{ "rolle": "Hausverwaltung", "name": "…", "telefon": "…" }],
  "anlagen": [
    { "typ": "waermepumpe", "hersteller": "…", "modell": "…", "kaeltemittel": "R290", "fuellmengeKg": 1.2, "naechsteWartung": "2027-09-01" },
    { "typ": "zaehlerschrank", "zaehler": 9, "letztePruefung": "2026-03-10", "naechstePruefung": "2030-03-10" }
  ],
  "regeln": { "winterdienstSatzung": "Essen", "muellabfuhr": "Di Rest, Fr Papier" },
  "vertragIds": ["V-2026-0009"]
}
```

Zugangscodes werden feldverschlüsselt gespeichert; lesbar nur für Inhaber/Büro und für zugewiesene Mitarbeiter am Einsatztag.

## Dauerverträge (`vertraege`)

- Leistungsplan als Liste von Regeln (iCalendar-RRULE), z. B. `FREQ=WEEKLY;BYDAY=TU` (Treppenhaus), `FREQ=MONTHLY;BYMONTHDAY=1` (Technikbegehung), saisonal mit `BYMONTH=4,5,6,7,8,9,10`.
- Je Regel: Leistung, Dauer, Checkliste, Qualifikation, Preis bzw. Pauschale, umlagefähig ja/nein.
- Laufzeit, Kündigungsfrist, Preisanpassungsklausel, Abrechnungsrhythmus.

## Einsatzgenerator (Worker-Cron, täglich)

1. Für jeden aktiven Vertrag Einsätze für die nächsten 8 Wochen erzeugen (idempotent über Schlüssel `vertragId|regelId|datum`).
2. Feiertage NRW → Verschiebung auf nächsten Werktag (Logik existiert bereits in `einsatzgebiet-logik.mjs`).
3. Mitarbeiter vorschlagen (Qualifikation, Tour/Zone, Auslastung, Abwesenheit).
4. Konflikte (Überbuchung, fehlende Qualifikation) → Aufgabe für Büro.
5. Fristen aus `anlagen[].naechste*` → Wartungs-/Prüfaufträge 8 Wochen vorher als Lead „intern“ anlegen und Kunden erinnern.

Hinweis: Das bestehende Cloudflare-Konto ist bei der Anzahl der Cron-Trigger ausgeschöpft (siehe `docs/backup-restore.md`); der Generator muss im bestehenden täglichen Cron mitlaufen.

## Leistungsnachweis und Abrechnung

- Mitarbeiter erledigt Checkliste (App oder 📱 WhatsApp-Buttons), Pflichtfotos, Zeitstempel → Leistungsnachweis unveränderbar (nachträgliche Korrektur nur als neues Ereignis).
- Monatsende: Turnusrechnung je Vertrag; Anhang PDF mit allen Nachweisen; Mehrleistungen (Reparaturen) nur nach Freigabe des Kunden und als eigene Positionen.
- Ausfall (z. B. Winterdienst ohne Schnee) wird als „nicht erforderlich“ mit Witterungsangabe dokumentiert.

## Kundensicht (📝 später)

Portal für Hausverwaltungen (Rolle `kunde`, existiert bereits in den Firestore-Regeln): Objekte, kommende Einsätze, Nachweise, Mängel, Rechnungen – nur Lesezugriff auf eigene Objekte.
