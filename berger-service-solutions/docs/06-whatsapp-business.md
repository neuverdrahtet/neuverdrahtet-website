# 06 – WhatsApp-Business-Integration (📝 Konzept)

## Plattformwahl

- **WhatsApp Business Platform (Cloud API) von Meta**, angebunden direkt oder über einen offiziellen Business Solution Provider (BSP). Die WhatsApp-Business-App (Smartphone) ist für Automatisierung ungeeignet; inoffizielle Bibliotheken (WhatsApp-Web-Automatisierung) verstoßen gegen die Nutzungsbedingungen und führen zur Sperrung der Nummer.
- Im Repository existiert bereits eine Twilio-Anbindung (Benachrichtigung bei neuem Lead, `cloudflare-worker-kostenschaetzer`) und ein WhatsApp-KI-Assistent-Worker. Twilio ist ein offizieller BSP; der Weiterbetrieb über Twilio ist möglich. Entscheidung: **Twilio weiter nutzen oder direkt Meta Cloud API** – siehe offene Entscheidungen.
- Voraussetzungen: Meta-Business-Verifizierung, eigene Telefonnummer für die Plattform (die Nummer kann dann nicht parallel in der WhatsApp-App genutzt werden), Anzeigename „BERGER SERVICE SOLUTIONS“.

## Plattformregeln, die das Design bestimmen

- Freie Nachrichten nur innerhalb von **24 Stunden** nach der letzten Nachricht des Empfängers; außerhalb nur mit **vorab genehmigten Vorlagen** (Templates, kostenpflichtig je Konversation/Nachricht).
- Kunden erhalten Nachrichten nur nach **Opt-in** (Einwilligung im Buchungsformular, protokolliert mit Zeitstempel und Textversion) – ✅ Feld im Formular vorhanden.
- Eingehende Nachrichten kommen per **Webhook** (Signaturprüfung `X-Hub-Signature-256`).

## Architektur

```
WhatsApp ⇄ Meta Cloud API / BSP ⇄ Worker "whatsapp-gateway" ⇄ Werkora (Firestore, Ereignisse)
                                        │
                                        ├─ Identifikation: Absendernummer → users (Mitarbeiter) oder kunden
                                        ├─ Absichtserkennung: Befehle/Buttons zuerst, KI nur als Vorschlag
                                        ├─ Rollen-/Rechteprüfung
                                        └─ Freigabe-Workflow für kritische Aktionen
```

## Funktionen

### Für Mitarbeiter (interne Nummern, verifiziert)

| Funktion | Beispiel | Berechtigung | Kritisch? |
|---|---|---|---|
| Neue Leads empfangen | Push „Neuer Lead L-2026-00310: Badsanierung, Gelsenkirchen, Zone B“ + Buttons [Übernehmen] [Anrufen] | Inhaber, Büro | nein |
| Kunden-/Auftragsinfos abrufen | „Auftrag A-2026-00128“ → Kurzinfo, Adresse, Ansprechpartner | nur zugewiesene Aufträge (Techniker) bzw. alle (Büro) | nein (lesend, minimal) |
| Termine bestätigen/verschieben | Buttons in Einsatzerinnerung | Büro, Projektleitung; Techniker nur „verspäte mich“ | mittel |
| Auftragsstatus aktualisieren | [Unterwegs] [Vor Ort] [Erledigt] | zugewiesener Mitarbeiter | nein |
| Disposition | „Einsatz E-… an Max“ | Büro, Projektleitung | mittel |
| Fotos/Dokumente zuordnen | Foto senden → Auswahl des aktiven Einsatzes → Ablage in Leistungsnachweis | zugewiesener Mitarbeiter | nein |
| Mängel erfassen | Foto + Text → Mangel mit Objekt, Dringlichkeit | alle Mitarbeiter | nein |
| Arbeitszeit/Material melden | „Start“/„Ende“, „Material: 3× NYM 3×1,5 10 m“ → Bestätigung mit Zusammenfassung | eigener Datensatz | nein |
| Finanzielle Aktionen | Angebot versenden, Rechnung erstellen, Rabatt | Inhaber (Büro mit Freigabe) | **ja → Freigabe** |

### Für Kunden (nach Opt-in)

- Eingangsbestätigung mit Vorgangsnummer (Template), Terminbestätigung, Erinnerung 24 h vorher, „Techniker unterwegs“, Bitte um Bewertung nach Abschluss.
- Kunde kann antworten („Termin verschieben“) → landet als Nachricht in der Kundenakte und als Aufgabe im Büro. Keine automatische Terminänderung durch Kunden ohne Prüfung (Phase 1).
- Jede Nachricht (ein-/ausgehend) wird mit Kunde und Auftrag verknüpft (`kommunikation`-Collection).

## Sicherheit

- **Identifikation**: Absendernummer allein ist kein starkes Merkmal (SIM-Tausch). Daher: Mitarbeiternummern werden einmalig mit Code aus der Werkora-App verknüpft; kritische Aktionen erfordern zusätzlich eine **Bestätigung in der Werkora-App** (Push mit Freigabe) oder eine PIN. Im Repo existiert bereits ein Freigabe-Muster (`mcpFinanzFreigaben`, `werkora_approve_action`) – wiederverwenden.
- **Rollenbasierte Rechte** identisch zur App (siehe 09); der Gateway-Worker prüft jede Aktion gegen dieselbe Rechtematrix.
- **Datenminimierung**: Keine vollständigen Kundendaten, Zugangscodes oder Rechnungsbeträge an Nummern ohne Berechtigung; Techniker sehen nur zugewiesene Aufträge und nur bis 24 h nach Einsatzende.
- **Protokoll**: jede über WhatsApp ausgelöste Aktion als Ereignis mit `akteur: whatsapp:<userId>`.
- **KI-Absichtserkennung** darf nur Vorschläge erzeugen, die per Button bestätigt werden; sie löst nie selbst schreibende Aktionen aus.
- Webhook-Signaturprüfung, Rate-Limit, Replay-Schutz (Nachrichten-ID speichern).

## Datenschutz

Meta verarbeitet Metadaten, Drittlandübermittlung möglich → Einwilligung der Kunden, Auftragsverarbeitungsvertrag/Business-Terms, Datenschutzhinweise (Entwurf Abschnitt 6 vorhanden). Mitarbeiter: dienstliche Nummern bzw. Betriebsvereinbarung/Einwilligung für private Geräte.

## Ausbaustufen

1. Benachrichtigungen an Inhaber bei neuem Lead (heute schon über Twilio möglich) → auf neues Lead-Format umstellen.
2. Kunden-Templates (Eingang, Bestätigung, Erinnerung, Bewertung).
3. Mitarbeiter: Status-Buttons, Fotos, Zeiten, Material.
4. Disposition und Terminverschiebung mit Freigabe.
5. Finanzielle Aktionen nur mit App-Freigabe.
