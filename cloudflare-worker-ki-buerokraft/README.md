# Werkora-API für die KI-Bürokraft

Dieser Worker setzt deine Vorgabe "Technische Vorgabe: Werkora-API für KI-Bürokraft" um.

**Phase 1** (die von dir selbst benannte "Priorität für erste funktionsfähige Version",
Abschnitt 39 deiner Vorgabe): Kunde suchen/anlegen, Lead anlegen/aktualisieren, Projekte
abrufen, Aufgabe erstellen/abrufen, Termine abrufen/erstellen, Angebote abrufen/Entwurf
erstellen, Rechnungen abrufen inkl. überfällige erkennen, Dashboard, KI-Aktionsprotokoll.

**Phase 2/3** (zusätzlich gebaut): Aufträge (lesen), Arbeitsberichte, Projekt-Dokumente,
Zahlungen (lesen), Mahnungen, Artikel/Leistungen/Preisliste (lesen), Mitarbeiter (lesen,
eingeschränkte Felder), Webhooks, ein täglicher Cron-Job für überfällige
Rechnungen/Aufgaben, sowie ein "KI-Freigaben"-Bereich in Werkora (Ansicht `ki-freigaben.js`)
und eine "KI-Aktivität"-Ansicht (`ki-aktivitaet.js`) für das Protokoll.

**Zusätzlich gebaut** (auf deinen Wunsch): Lagerbestand lesen (`GET /articles/{id}`,
`low_stock`-Filter) und Materialentnahmen/Wareneingänge direkt buchen (`POST
/articles/{id}/stock-movements`, siehe Endpunkt-Liste unten) - anders als die meisten
anderen Schreibaktionen bewusst als sofort wirksame Buchung, nicht über die
KI-Freigaben-Warteschlange, weil du das explizit so gewählt hast.

**Google-Kalender-/Gmail-Anbindung ist mittlerweile gebaut** - als eigener, separater
Worker (`cloudflare-worker-google-buero/`, eigene README dort), weil Werkora sich bei
Google bisher nur über einen Browser-Login anmeldet und dieser Worker eine eigene,
dauerhafte Google-Anmeldung braucht. Dieser Worker hier (`cloudflare-worker-ki-buerokraft`)
bleibt davon unberührt.

**Zusätzlich gebaut**: der "Automatische Büroablauf" - drei tägliche Cron-Checkpoints
(Mo-Fr, ca. 08/12/16 Uhr), die offene Aufgaben/Termine/Baustellen/Dokumentation/
Zeiterfassung prüfen und daraus eine Werkora-Aufgabe + Push-Benachrichtigung erzeugen
(siehe eigener Abschnitt unten). **Achtung:** deckt bisher nur Werkora-eigene Daten ab,
noch NICHT Gmail/Google-Kalender aus dem oben genannten `cloudflare-worker-google-buero/` -
das wäre eine naheliegende Erweiterung (der Worker existiert ja schon), aber noch nicht
verdrahtet.

**Noch nicht gebaut**: MCP-Server (siehe unten). Sag Bescheid, wenn's damit weitergehen soll.

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
- **"KI-Freigaben" informiert nur, führt nichts automatisch aus.** Wenn die KI eine
  gesperrte Aktion versucht (z.B. Angebot versenden), landet zusätzlich zum 403-Fehler ein
  Eintrag in der neuen Werkora-Ansicht "KI-Freigaben". "Freigeben" dort markiert den Eintrag
  nur als erledigt/zur Kenntnis genommen – **es löst die eigentliche Aktion nicht aus**. Du
  versendest das Angebot/die Rechnung weiterhin ganz normal selbst in der jeweiligen
  Werkora-Ansicht. Eine echte "Freigeben löst aus"-Automatik wäre ein größerer, eigener
  Schritt (müsste für jede Aktion einzeln sicher nachgebaut werden) - sag Bescheid, falls
  gewünscht.
- **Arbeitsberichte sind ein neues, einfaches Objekt**, nicht an das bestehende
  Berichte-Baukasten-System (mit PDF-Vorlagen, Foto-Abschnitten usw.) angebunden. Die KI
  legt schnelle Basis-Berichte an (Kunde/Projekt/Mitarbeiter/Zeiten/Text) - für die
  ausführliche PDF-Dokumentation nutzt ihr weiterhin die bestehende Berichte-Funktion in
  Werkora selbst.
- **Projekt-Dokumente sind Metadaten-Einträge, keine Datei-Uploads.** `POST
  /projects/{id}/documents` legt einen Eintrag mit Typ/Titel/Notiz an, aber ohne
  Bilddatei/PDF - ein echter Datei-Upload über die API bräuchte eine Anbindung an Firebase
  Storage (aufwändiger, separater Schritt).
- **Google-Kalender-/Gmail-Anbindung wurde bewusst NICHT gebaut.** Werkora meldet sich bei
  Google aktuell nur über einen Browser-Login an (kurzlebiges Zugriffstoken, keine
  dauerhafte Berechtigung, die dieser Worker im Hintergrund mitbenutzen könnte). Damit die
  KI eigenständig auf Kalender/Gmail zugreifen kann, bräuchte es eine eigene,
  serverseitige Google-Anmeldung mit dauerhafter Berechtigung (Google-Cloud-Konsole,
  eigener Consent-Bildschirm, sicher gespeichertes Berechtigungs-Token) - ein eigenständiges
  Projekt, kein Nebenprodukt dieses Workers. Sag Bescheid, wenn das gewünscht ist.
- **MCP-Server nicht gebaut** - deine Vorgabe nennt ihn selbst als späteren, optionalen
  Zusatz ("kann Werkora später einen MCP-Server erhalten"), der laut Vorgabe ausschließlich
  auf diese REST-API zugreifen soll. Kann jederzeit separat ergänzt werden, ohne diesen
  Worker zu ändern.

## Endpunkte

Alle Antworten im Format `{ "success": true, "data": {...}, "message": null }` bzw.
`{ "success": false, "error": { "code": "...", "message": "..." } }` – genau wie in
deiner Vorgabe (Abschnitt 3).

**Wichtig - ChatGPT erlaubt pro Custom-GPT-Action maximal 30 Endpunkte** (Fehlermeldung im
GPT-Editor: "Bei OpenAPI Spec sind maximal 30 Vorgänge möglich"). Der Worker selbst
(`worker.js`) unterstützt alle unten aufgeführten Endpunkte weiterhin vollständig - für
direkte API-Aufrufe (curl, ein anderes Tool, ein zweiter Worker) sind sie alle nutzbar.
`chatgpt-actions-schema.json` enthält aber bewusst nur eine Auswahl von exakt 30
Endpunkten für die ChatGPT-Action, priorisiert nach deiner ursprünglichen Vorgabe
(Abschnitt 39, "erste funktionsfähige Version"): Kunden, Leads, Projekte (lesen), Aufgaben,
Termine, Angebote, Rechnungen (lesen), Aufträge (lesen), Ausgaben/Belege, Preisliste,
Lagerbewegungen je Artikel, Mitarbeiter (lesen) und das Dashboard. **Nicht** im
ChatGPT-Schema enthalten (aber per direktem API-Aufruf weiter erreichbar): einzelne
Artikel-/Leistungs-Detailabfragen (`/articles`, `/services`, `/articles/{id}` - dafür gibt
es `/price-list`, das beides kombiniert liefert), `/employees/{id}` (Einzelabruf - die
Liste über `/employees` reicht meist), der globale `/stock-movements`-Endpunkt (die
artikelbezogene Variante bleibt erhalten), `/payments`, `/reminders`,
`/projects/{id}/documents` und `/work-reports`. Falls du eine davon lieber im
ChatGPT-Zugriff hättest als etwas anderes, sag Bescheid - dann tauschen wir etwas aus
(muss wegen des 30er-Limits immer 1:1 sein).

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
GET   /projects/{id}/documents
POST  /projects/{id}/documents     ({ type, title, note } - type siehe Vorgabe Abschnitt 19)

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
POST  /invoices                    -> 403 (gesperrt, GoBD - siehe oben)
POST  /invoices/{id}/send          -> 403 (gesperrt)
POST  /invoices/{id}/approve       -> 403 (gesperrt)

GET   /orders?customer_id=&project_id=&status=     (Auftragsbestätigungen, nur lesen)
GET   /orders/{id}

GET   /work-reports?customer_id=&project_id=&employee_id=
GET   /work-reports/{id}
POST  /work-reports
PATCH /work-reports/{id}

GET   /payments                    (Bankbuchungen/Kontoauszug-Abgleich, nur lesen)

GET   /reminders?invoice_id=
POST  /reminders                   ({ invoice_id, level, new_due_date?, fee?, text? })

GET   /expenses?customer_id=&project_id=&category=&supplier=&date_from=&date_to=&status=
      (Belege - inkl. Beleg-URL/-Dateityp, falls in Werkora bereits ein Beleg hochgeladen wurde)
GET   /expenses/{id}
POST  /expenses                    ({ date, category, description?, supplier?, amount_net oder
                                       amount_gross, vat_rate?, paid_with?, customer_id?, project_id? } -
                                       neue Belege selbst werden weiterhin nur in Werkora hochgeladen/gescannt)
PATCH /expenses/{id}                (u.a. Kategorie nachträglich zuordnen)

GET   /articles?trade=&low_stock=  (Katalog-Artikel, nur lesen; low_stock=true filtert auf Bestand <= Mindestbestand)
GET   /articles/{id}               (Preise/Stammdaten nur lesen, inkl. aktuellem Lagerbestand)
GET   /services?trade=             (Katalog-Leistungen, nur lesen)
GET   /price-list?trade=           (Artikel+Leistungen zusammen, nur lesen)

GET   /articles/{id}/stock-movements   (Lagerbewegungs-Historie, nur lesen)
POST  /articles/{id}/stock-movements   ({ delta, reason? } - bucht Zugang/Entnahme, ändert den Bestand sofort;
                                         409, wenn für den Artikel keine Bestandsführung aktiviert ist)

GET   /employees                   (eingeschränkte Felder, keine Gehaltsdaten)
GET   /employees/{id}

GET   /assistant/dashboard

DELETE (auf jedem Endpunkt)        -> 403 (gesperrt)
```

## KI-Aktionsprotokoll + KI-Freigaben (in Werkora sichtbar)

Jeder Aufruf – egal ob erfolgreich, blockiert oder fehlerhaft – wird als Dokument in die
Firestore-Collection `ai_action_log` geschrieben (Felder wie in deiner Vorgabe, Abschnitt
29). In Werkora unter **KI-Aktivität** (Admin-Rolle) einsehbar.

Jede blockierte/gesperrte Aktion (403) legt zusätzlich einen Eintrag in `ki_freigaben` an.
In Werkora unter **KI-Freigaben** (Admin-Rolle) einsehbar, mit den Aktionen "Freigeben",
"Bearbeiten" (Kommentar hinterlegen) und "Ablehnen" - wie in deiner Vorgabe (Abschnitt 30)
beschrieben. **Wichtig:** siehe Abweichungs-Hinweis oben - diese Aktionen informieren nur,
sie lösen die eigentliche Aktion (Versand usw.) nicht automatisch aus.

## Webhooks (Vorgabe Abschnitt 32)

Eine einzelne Webhook-URL kann in Werkora unter **Einstellungen → KI-Bürokraft** hinterlegt
werden (Feld `kiWebhookUrl`). Sobald gesetzt, sendet der Worker bei folgenden Ereignissen
einen `POST` mit `{ event, data, timestamp }` an diese URL:

```
customer.created
lead.created
lead.status_changed
appointment.created
quote.created
invoice.overdue    (nur per täglichem Cron-Job, siehe unten)
task.overdue        (nur per täglichem Cron-Job, siehe unten)
```

Die übrigen in deiner Vorgabe genannten Events (`quote.sent`, `quote.accepted`,
`order.created`, `project.completed`, `invoice.created`, `invoice.sent`, `invoice.paid`)
sind noch nicht verdrahtet, da die zugehörigen Aktionen (Versand, Auftrags-Anlage) aktuell
nur in Werkora selbst passieren, nicht über diese API.

### Täglicher Cron-Job für invoice.overdue/task.overdue

`worker.js` hat einen `scheduled()`-Handler, der täglich prüft, welche Rechnungen/Aufgaben
neu überfällig geworden sind, und dafür je einmal den passenden Webhook feuert (kein
täglich wiederholter Spam für dieselbe überfällige Rechnung).

- Bei Deploy über die Cloudflare-CLI (`wrangler deploy`) wird der Cron-Trigger automatisch
  aus `wrangler.toml` übernommen (`0 6 * * *`, täglich 06:00 UTC).
- Bei Deploy über das Dashboard (euer üblicher Weg, siehe unten): nach dem Bereitstellen
  unter **Worker → Einstellungen → Trigger-Ereignisse → Cron-Trigger hinzufügen** manuell
  `0 6 * * *` eintragen.

## Automatischer Büroablauf (Mo-Fr, 08/12/16 Uhr)

Derselbe `scheduled()`-Handler übernimmt zusätzlich drei weitere, unabhängige
Cron-Trigger für die tägliche Bürocheckliste - unterschieden anhand des jeweiligen
Cron-Ausdrucks (`event.cron`):

| Cron-Ausdruck (UTC) | Deutsche Zeit (ca.)  | Checkpoint                                      |
| -------------------- | --------------------- | ------------------------------------------------ |
| `0 6 * * 1-5`         | 08:00 (CEST) / 07:00 (CET) | Morgenroutine: Aufgaben, Termine, Baustellen |
| `0 10 * * 1-5`        | 12:00 (CEST) / 11:00 (CET) | Mittagscheck: Zwischenstand, Rückfragen      |
| `0 14 * * 1-5`        | 16:00 (CEST) / 15:00 (CET) | Tagesabschluss: Dokumentation, Zeiterfassung |

Die UTC-Zeiten sind bewusst fix (wie beim bestehenden `0 6 * * *`) - dadurch weicht die
deutsche Uhrzeit in der Winterzeit (CET) ca. 1 Stunde von der oben genannten ab.

**Was jeder Checkpoint macht:** liest Aufgaben/Termine/Baustellen/Angebote/Rechnungen/
Arbeitsberichte/Dokumente/Zeiterfassung aus Firestore (nur lesen), baut daraus eine
Checkliste, legt eine Werkora-Aufgabe mit dieser Checkliste als Beschreibung an (Titel je
nach Checkpoint z.B. "🌅 Morgenroutine: ...") und schickt eine Push-Benachrichtigung an
alle Geräte mit Rolle admin/buero (Firebase Cloud Messaging, dieselbe Technik, die bereits
für fällige Mahnungen genutzt wird - kein neues Secret nötig, läuft über dasselbe
`FIREBASE_SERVICE_ACCOUNT_JSON`).

**Wichtig, damit die Push-Benachrichtigung ankommt:** mindestens ein admin- oder
buero-Konto muss die Push-Berechtigung in Werkora einmal aktiviert haben (Einstellungen →
Benachrichtigungen → "Push-Benachrichtigungen aktivieren"). Ohne registriertes Gerät wird
die Aufgabe trotzdem angelegt, nur der Push bleibt aus.

**Dedupe:** jede Aufgabe bekommt eine feste ID (`bueroablauf-{checkpoint}-{datum}`) statt
einer zufälligen. Feuert derselbe Cron am selben Tag versehentlich zweimal, wird NICHT
dupliziert - und falls die Aufgabe zwischendurch schon bearbeitet/erledigt wurde, wird sie
bewusst nicht überschrieben (ein erneuter Lauf würde sonst einen bereits erledigten Status
zurücksetzen).

**Phase A (aktuell) vs. Phase B:** Alle vier Checks (Aufgaben, Termine/Baustellen,
Dokumentation, Zeiterfassung, Angebote zum Nachfassen, offene Rechnungen) laufen bereits
vollständig auf Werkora-eigenen Daten. "Neue Kundenanfragen aus Gmail", "offene Rückrufe"
und echte Google-Kalender-Termine (statt Werkora-eigener Termine) fehlen noch - **nicht**
weil dafür kein Gmail-/Kalender-Zugriff existiert (der `cloudflare-worker-google-buero/`
läuft ja bereits, siehe oben), sondern weil dieser Cron ihn bisher nicht aufruft. Phase B
wäre also: aus `runBueroCheck()` heraus `GET /emails` bzw. `GET /calendar/events` des
anderen Workers abfragen (Server-zu-Server, mit dessen `API_KEY` als weiterem Secret hier).
Jede Checkliste weist selbst darauf hin, solange das noch fehlt.

**Bei Deploy über das Dashboard** müssen dafür zusätzlich zum bestehenden `0 6 * * *` noch
drei weitere Cron-Trigger manuell eingetragen werden: `0 6 * * 1-5`, `0 10 * * 1-5`,
`0 14 * * 1-5` (siehe Tabelle oben).

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
4. Unter **Einstellungen → Trigger-Ereignisse → Cron-Trigger** folgende vier Trigger
   hinzufügen: `0 6 * * *` (überfällig-Webhooks, optional falls keine Webhooks genutzt
   werden), sowie für den automatischen Büroablauf `0 6 * * 1-5`, `0 10 * * 1-5` und
   `0 14 * * 1-5` (siehe eigener Abschnitt weiter unten).
5. Die im Dashboard angezeigte Worker-URL (endet auf `.workers.dev`) ist die Basis-URL für
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
