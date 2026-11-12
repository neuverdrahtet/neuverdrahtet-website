# 05 – Werkora: Datenmodell und Schnittstellen

Werkora ist in diesem Repository bereits in Teilen vorhanden (Verwaltungs-App `verwaltung/`, Firestore, Cloudflare-Worker). Dieses Konzept **erweitert** das Bestehende, statt es zu ersetzen.

## Bestand (geprüft im Code)

| Bereich | Heute in Werkora | Fundstelle |
|---|---|---|
| Kunden / Leads | Collection `kunden` mit `status: 'lead' \| 'kunde'`, Kundennummer | `cloudflare-worker-kostenschaetzer/worker.js` (`legeLeadAn`) |
| Projekte / Lead-Pipeline | `projekte` mit `status: 'neue-anfrage'`, `bereich`, `kategorieId`, `gewerk` | dto. |
| Termine, Angebote, Rechnungen | `termine`, `angebote`, `rechnungen` | `firestore.rules` |
| Serviceaufträge, Prüfprotokolle | `serviceauftraege`, `pruefnormenGrenzwerte` | `firestore.rules` |
| Rollen | `admin`, `buero`, `mitarbeiter`, `techniker`, `kunde` | `firestore.rules` (`hasRole`) |
| Externe API | REST für Kunden/Projekte/Termine mit API-Key | `cloudflare-worker-api/` |
| Lead-Eingang Website | öffentlicher Worker, Honeypot/Ausfüllzeit, optionale WhatsApp-Benachrichtigung (Twilio) | `cloudflare-worker-kostenschaetzer/` |

**Einschränkung des Bestands:** Der bestehende Lead-Eingang legt bei jeder Anfrage einen neuen Kunden an (keine Dublettenprüfung), kennt kein Objekt (Einsatzadresse ≠ Kundenadresse) und ist auf die Gewerke von neuverdrahtet zugeschnitten (`gewerk: 'elektro'`).

## Zielmodell

```
Kunde 1─n Objekt 1─n Auftrag 1─n Einsatz (Termin) 1─n Leistungsnachweis
  │          │          │                               └─ Fotos, Checkliste, Zeiten, Material
  │          │          ├─ Angebot(e) ─ Positionen
  │          │          ├─ Rechnung(en) (Abschlag/Schluss)
  │          │          └─ Dokumente (Prüfprotokoll, Entsorgungsnachweis, Abnahme)
  │          └─ Vertrag (Dauerauftrag) ─ Leistungsplan ─ erzeugt Einsätze
  └─ Lead(s) ─ wird zu Auftrag
Mitarbeiter ─ Rolle, Qualifikationen ─ Einsatzzuweisung, Zeiterfassung
Kommunikation (E-Mail, WhatsApp, Telefonnotiz) ─ verknüpft mit Kunde/Auftrag
Ereignisprotokoll (jede Statusänderung, jede Aktion)
```

### Entitäten und Kennungen

Jede Entität erhält eine **technische ID** (zufällige Firestore-ID, nie wiederverwendet) und eine **sprechende Nummer** (fortlaufend, transaktional vergeben wie die bestehende Rechnungsnummer).

| Entität | Collection | Nummer | Wichtige Felder |
|---|---|---|---|
| Kunde | `kunden` (bestehend, erweitert) | `K-2026-00042` | typ (privat/vermieter/hausverwaltung/gewerbe), firma, name, kontakte[], rechnungsadresse, emailNorm, telefonNorm, dublettenSchluessel{}, einwilligungen{}, status |
| Objekt | `objekte` (neu) | `O-2026-00017` | kundeId, adresse, adressSchluessel, geo{lat,lon}, zone, objektart, einheiten, zugang (Schlüssel, Codes – verschlüsselt), ansprechpartner vor Ort, anlagen[] (WP, Klima, PV, Zählerschrank …), prueffristen[] |
| Lead | `leads` (neu; heute Projekt mit Status `neue-anfrage`) | `L-2026-00310` = Vorgangsnummer für Kunden | rohdaten (Payload bss-lead/1), quelle, leistung, status, kundeId?, objektId?, dublettenErgebnis |
| Auftrag | `projekte` (bestehend, erweitert) | `A-2026-00128` | kundeId, objektId, prozess (wartung/service/handwerk/objekt/rueckbau), leistung, status, verantwortlich, angebotIds[], rechnungIds[] |
| Einsatz | `termine` (bestehend, erweitert) | `E-2026-01022` | auftragId, objektId, start/ende, mitarbeiterIds[], status, checklisteId, fahrt{zone,km} |
| Leistungsnachweis | `leistungsnachweise` (neu) | – | einsatzId, checkliste[{punkt, erledigt, bemerkung}], fotos[], zeiten[], material[], unterschrift?, zeitstempel |
| Prüfprotokoll | `pruefprotokolle` (neu bzw. Ausbau `serviceauftraege`) | `P-2026-00077` | objektId, anlage/geraet, norm, messwerte[], ergebnis, naechstePruefung |
| Vertrag | `vertraege` (neu) | `V-2026-0009` | kundeId, objektIds[], leistungsplan[{leistung, intervall (RRULE), dauer, checkliste}], laufzeit, kuendigung, abrechnung (monatlich/quartal/je Einsatz), preise |
| Angebot / Rechnung | `angebote` / `rechnungen` (bestehend) | bestehend | + auftragId, objektId, art (abschlag/schluss/turnus) |
| Mitarbeiter | `users` (bestehend) + `mitarbeiter` | – | rolle, qualifikationen[] (EFK, befähigte Person TRBS 1203, F-Gase Kat. I, TRGS 519 …), whatsappNummer (verifiziert) |
| Ereignis | `ereignisse` (neu) | – | entitaet, id, alt→neu, akteur (user/system/whatsapp/website), zeitpunkt, grund |

### Statusmodelle (nachvollziehbar, nur definierte Übergänge)

```
Lead:      neu → in-pruefung → qualifiziert → umgewandelt (Auftrag)
                            └→ abgelehnt (Grund) | dublette (→ zusammengeführt mit Lead/Kunde)
Auftrag (handwerk):  anfrage → besichtigung-geplant → aufmass-erfolgt → angebot-erstellt → angebot-versendet
                     → beauftragt → material-geplant → in-ausfuehrung → abnahme → abgerechnet → abgeschlossen
                     (jederzeit → storniert mit Grund)
Auftrag (wartung):   gebucht → bestaetigt → durchgefuehrt → dokumentiert → abgerechnet → folgetermin-geplant
Auftrag (objekt):    einzelauftrag wie wartung; vertrag: aktiv → pausiert → gekuendigt → beendet
Auftrag (rueckbau):  anfrage → besichtigung → mengen-ermittelt → angebot → beauftragt → in-durchfuehrung
                     → entsorgungsnachweise-vollstaendig → uebergeben → abgerechnet
Einsatz:   geplant → bestaetigt → unterwegs → vor-ort → erledigt | verschoben | abgesagt
```

Jeder Übergang schreibt ein `ereignisse`-Dokument. Ungültige Übergänge lehnt die Schreiblogik (Worker) ab; Firestore-Regeln verhindern direkte Statusänderungen durch Clients ohne passende Rolle.

## Dublettenvermeidung

1. Website sendet normalisierte Hash-Schlüssel (E-Mail, Telefon E.164, Adresse) – ✅ implementiert.
2. Lead-Worker sucht in `kunden` nach `emailNorm` **oder** `telefonNorm` (Klartext, indexiert) und in `objekte` nach `adressSchluessel`. 📝
3. Ergebnis:
   - eindeutiger Treffer Kunde **und** Objekt → Lead wird verknüpft, kein neuer Datensatz;
   - Treffer nur Kunde → neues Objekt beim bestehenden Kunden;
   - widersprüchliche Treffer (z. B. E-Mail gehört Kunde A, Telefon Kunde B) → Lead `in-pruefung`, Büro entscheidet (Zusammenführen-Dialog). Nie automatisch zusammenführen bei Widerspruch.
4. Idempotenz: `idempotenzSchluessel` wird 24 h gespeichert; gleicher Schlüssel → gleiche Antwort, kein zweiter Lead.

## Schnittstelle Website → Werkora (📝 zu entwickeln)

Neuer Worker `cloudflare-worker-lead-eingang` (oder Erweiterung des bestehenden Kostenschätzer-Workers um `schemaVersion: bss-lead/1`):

```
POST /v1/leads                multipart: lead (JSON bss-lead/1), dateien[]
  Header: Idempotency-Key, Origin (Allowlist)
  → 200 { vorgangsnummer: "L-2026-00310", status: "neu" | "dublette-zugeordnet" }
  → 400 { fehler: { feld: meldung } }   → 429 Rate-Limit   → 503 fail-closed ohne Rate-Limiter
GET  /v1/verfuegbarkeit?leistung=…&plz=…&von=…&bis=…
  → 200 { slots: [{ start, ende }] }   (aus termine + Mitarbeiterkalender + Fahrzone)
```

Verarbeitung im Worker:
1. Rate-Limit (bestehendes Muster `RATE_LIMITER`), Origin-Prüfung, Honeypot/Ausfüllzeit.
2. JSON gegen `lead.schema.json` validieren; Dateien: MIME per Magic Bytes prüfen, Größe, Anzahl; Ablage in Firebase Storage unter `leads/{leadId}/` (bestehendes Muster `/kunde-upload`).
3. Dublettenprüfung (s. o.), Lead + ggf. Kunde/Objekt in einer Firestore-Transaktion anlegen, Vorgangsnummer vergeben.
4. Ereignis `lead.neu` schreiben → löst Benachrichtigung aus (Push an Büro, WhatsApp an Inhaber, E-Mail-Eingangsbestätigung an Kunden).
5. Bei Direktbuchung: Slot als `termine`-Dokument mit Status `vorlaeufig` reservieren (Sperre 30 Min. gegen Doppelbuchung), Bestätigung durch Büro oder automatisch, wenn Regeln erfüllt (Zone A/B, Slot frei, Leistung „auto-bestätigbar“).

## Weitere Schnittstellen

| Schnittstelle | Zweck | Status |
|---|---|---|
| REST-API (`cloudflare-worker-api`) | Kunden/Projekte/Termine für Zapier/Make | ✅ besteht, 📝 erweitern um Objekte/Leads/Verträge |
| WhatsApp Business Platform | siehe 06 | 📝 |
| Kalender (Google) | bestehender Google-Büro-Worker | ✅ besteht, 📝 Verfügbarkeitsabfrage |
| Buchhaltung (Qonto-Sync) | bestehend | ✅ besteht |
| Geocoding/Routing | exakte Fahrzeit, Tourenplanung | 📝 |

## Funktionen, die noch zu entwickeln bzw. zu testen sind

Alle mit 📝 markierten Punkte. Die Übersicht mit Reihenfolge steht in [11-umsetzungsplan-qualitaetssicherung.md](11-umsetzungsplan-qualitaetssicherung.md).
