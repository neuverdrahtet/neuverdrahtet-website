# Werkora-API für die KI-Bürokraft

Dieser Worker setzt deine Vorgabe "Technische Vorgabe: Werkora-API für KI-Bürokraft" um –
und zwar genau den Teil, den du selbst als "Priorität für erste funktionsfähige Version"
(Abschnitt 39 deiner Vorgabe) benannt hast:

1. Kunde suchen
2. Kunde anlegen
3. Lead anlegen
4. Lead aktualisieren
5. Projekte abrufen
6. Aufgabe erstellen
7. Aufgaben abrufen
8. Termine abrufen und erstellen
9. Angebote abrufen
10. Angebotsentwurf erstellen
11. Rechnungen abrufen
12. offene Rechnungen erkennen
13. Dashboard-Daten abrufen
14. KI-Aktionen protokollieren

Alles Weitere aus deiner Vorgabe (Arbeitsberichte, Dokumentation, Zahlungen, Mahnungen,
Artikel/Leistungen, Mitarbeiter, Aufträge, Webhooks, MCP-Server, ein eigenes
Freigabe-Center in der Werkora-Oberfläche) ist bewusst **noch nicht** gebaut – das sind
laut deiner eigenen Phaseneinteilung Phase 2–4. Sag Bescheid, wenn's weitergehen soll.

## Wichtige Abweichungen von deiner Vorgabe (und warum)

- **"Leads" sind in Werkora keine eigene Tabelle.** Ein Lead ist bei euch technisch ein
  Kunde mit einem Status-Feld (die "Lead-Pipeline"-Ansicht in Werkora). Die
  `/leads`-Endpunkte sind deshalb ein Filter über `/customers`, keine eigene Datenbank.
  Die Status-Werte aus deiner Vorgabe (`new`, `contacted`, `qualification`, …) gibt es bei
  euch nicht 1:1 – eure echten Status-Spalten heißen `lead`, `interessent`, `kunde`,
  `verloren` (unter "Lead-Pipeline → ⚙️ Status verwalten" änderbar). Schickt die KI einen
  unbekannten Status, wird er **nicht verworfen**, sondern als Notiz am Kunden vermerkt und
  die Antwort enthält ein `lead_note`-Feld mit einem Hinweis.
- **Rechnungen legt die KI (noch) nicht an.** Sobald in Werkora eine Rechnung angelegt
  wird, bekommt sie eine fortlaufende Tagesnummer und wird GoBD-mäßig gesperrt (nur noch
  Storno, kein Löschen/Bearbeiten). Ein KI-Versuch, der schiefgeht, würde eine echte Nummer
  "verbrennen". Deshalb: `POST /invoices` ist blockiert (Antwort erklärt warum),
  `GET /invoices` (inkl. `?status=overdue`) funktioniert normal. Angebote sind dagegen
  unkritisch (Status "Entwurf", beliebig änderbar) – `POST /quotes` funktioniert.
- **Versand/Freigabe ist immer blockiert** (Angebot versenden, Rechnung versenden/freigeben,
  Auftrags-Umwandlung) – exakt wie in deiner Vorgabe unter "Standardmäßig nicht erlaubt"
  gefordert. Diese Endpunkte antworten mit HTTP 403 und werden trotzdem protokolliert.
- **Löschen ist komplett gesperrt** (jede `DELETE`-Anfrage, egal auf welchem Endpunkt) –
  wie in deiner Vorgabe unter "Sicherheitsregeln" gefordert.
- **Keine eigene Rollen-Verwaltungsoberfläche.** Statt eines UI zum Einstellen von
  Rechten ist die Erlaubnisliste aus deiner Vorgabe (Abschnitt 5) fest im Code hinterlegt.
  Das lässt sich später zu einem echten "KI-Freigaben"-Bereich in Werkora ausbauen
  (Abschnitt 30 deiner Vorgabe, Phase 4) – bislang aber nur die feste Sperre.

## Endpunkte

Alle Antworten im Format `{ "success": true, "data": {...}, "message": null }` bzw.
`{ "success": false, "error": { "code": "...", "message": "..." } }` – genau wie in
deiner Vorgabe (Abschnitt 3).

```
GET   /customers?email=&phone=&name=&postal_code=&city=
GET   /customers/{id}
POST  /customers
PATCH /customers/{id}

GET   /leads?status=
POST  /leads
PATCH /leads/{id}

GET   /projects?customer_id=&status=
GET   /projects/{id}

GET   /tasks?status=&priority=&due_date=&customer_id=&project_id=&assigned_to=
GET   /tasks/{id}
POST  /tasks
PATCH /tasks/{id}                  (u.a. { "status": "completed" })

GET   /appointments?customer_id=&project_id=&date_from=&date_to=
GET   /appointments/{id}
POST  /appointments

GET   /quotes?customer_id=&project_id=&status=&date_from=&date_to=
GET   /quotes/{id}
POST  /quotes                      (immer status "draft")
POST  /quotes/{id}/send            -> 403 (gesperrt)
POST  /quotes/{id}/approve         -> 403 (gesperrt)
POST  /quotes/{id}/convert-to-order -> 403 (noch nicht gebaut)

GET   /invoices?status=&customer_id=&project_id=&date_from=&date_to=
      (status "overdue" wird serverseitig aus offen/teilbezahlt + überschrittenem
       Fälligkeitsdatum berechnet, ist kein echtes Feld in Werkora)
GET   /invoices/{id}
POST  /invoices                    -> 403 (gesperrt, siehe oben)
POST  /invoices/{id}/send          -> 403 (gesperrt)
POST  /invoices/{id}/approve       -> 403 (gesperrt)

GET   /assistant/dashboard

DELETE (auf jedem Endpunkt)        -> 403 (gesperrt)
```

## KI-Aktionsprotokoll

Jeder Aufruf – egal ob erfolgreich, blockiert oder fehlerhaft – wird als Dokument in die
neue Firestore-Collection `ai_action_log` geschrieben (Felder wie in deiner Vorgabe,
Abschnitt 29: `timestamp`, `action`, `entity_type`, `entity_id`, `status`,
`approval_required`, …). Es gibt aktuell noch keine eigene Werkora-Ansicht dafür – die
Einträge liegen in Firestore und lassen sich z.B. über die Firebase-Konsole einsehen. Eine
echte Ansicht in Werkora ("KI-Aktivität") kann ich bei Bedarf als nächsten Schritt bauen.

## Deployment (Cloudflare Dashboard, wie bei den anderen Workern)

1. Cloudflare Dashboard öffnen → **Workers & Pages** → **Anwendung erstellen** →
   **Worker bereitstellen** (Hello World).
2. Nach dem Erstellen: **Code bearbeiten** öffnen, kompletten Inhalt von `worker.js`
   hineinkopieren (alles markieren, löschen, einfügen), **Bereitstellen**.
3. Zurück zur Worker-Übersicht → **Einstellungen** → **Variablen und Geheimnisse**:
   - `API_KEY` als **Secret** anlegen – ein langer, zufälliger Schlüssel (z.B. mit einem
     Passwort-Generator erzeugen, mind. 32 Zeichen). Diesen Schlüssel bekommt später nur
     die KI-Bürokraft zu sehen.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` als **Secret** anlegen – derselbe Wert, den ihr schon
     beim Kostenschätzer-Worker und beim offenen-REST-API-Worker verwendet habt (einmal
     erzeugte Firebase-Service-Account-JSON-Datei, kompletter Inhalt als ein Secret).
4. Die im Dashboard angezeigte Worker-URL (endet auf `.workers.dev`) ist die Basis-URL für
   die KI-Bürokraft, z.B. `https://neuverdrahtet-ki-buerokraft.<dein-konto>.workers.dev`.

## Test von Hand (z.B. mit curl oder Postman)

```bash
curl -H "Authorization: Bearer <API_KEY>" "https://<worker-url>/customers?name=Müller"
curl -H "Authorization: Bearer <API_KEY>" "https://<worker-url>/assistant/dashboard"
```

## API-Schlüssel widerrufen

Im Cloudflare Dashboard bei den Variablen einfach `API_KEY` mit einem neuen Wert
überschreiben und erneut bereitstellen – der alte Schlüssel funktioniert danach sofort
nicht mehr.
