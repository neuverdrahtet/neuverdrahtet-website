# Werkora Google-Büro-API (Gmail + Kalender) für die KI-Bürokraft

Dieser Worker setzt deine Vorgabe "Auftrag an Claude: Gmail + Google Kalender für Werkora
KI-Bürokraft" um. Er ist **komplett getrennt** vom bestehenden, bereits laufenden Worker
`cloudflare-worker-ki-buerokraft/` (Kunden/Projekte/Aufgaben/Angebote/Rechnungen usw.) -
dieser hier wurde **nicht verändert** und läuft unverändert weiter.

**Version 1** (die 11 Operationen aus deiner Vorgabe, Abschnitt 15):

```
Gmail:    searchEmails, getEmail, getEmailThread, createEmailDraft,
          markEmailRead, addEmailLabel
Kalender: searchCalendarEvents, getCalendarEvent, getCalendarAvailability,
          createCalendarEvent, updateCalendarEvent
```

## Sicherheitsregeln (wie in deiner Vorgabe gefordert, fest im Code)

- **Kein `sendEmail`.** Die KI kann nur Entwürfe anlegen (`createEmailDraft`) - versendet
  wird immer von Danny selbst, entweder in Gmail direkt oder in ChatGPT nach Prüfung.
- **Kein Löschen.** Weder E-Mails noch Kalendertermine können über diese API gelöscht
  werden. Jede `DELETE`-Anfrage wird pauschal mit HTTP 403 abgelehnt, egal auf welchem Pfad.
- **Kein Schreibzugriff auf Werkora-Daten.** Dieser Worker kennt nur Gmail- und
  Kalender-Daten, plus eine eigene kleine Verknüpfungstabelle (`google_calendar_links`), die
  verhindert, dass für denselben Werkora-Termin zweimal ein Google-Kalendereintrag entsteht.
- **Minimale Google-Berechtigungen:**
  - Gmail-Scope `gmail.modify` (lesen, einordnen, Entwürfe) - der Scope `gmail.send` wird
    **nie** angefragt, das Versenden ist also strukturell unmöglich, nicht nur durch
    Anwendungslogik verhindert.
  - Kalender-Scope `calendar.events` (lesen, anlegen, ändern). Google bietet keinen
    "nie löschen"-Scope an - das Löschen wird deshalb rein auf Anwendungsebene verhindert
    (es gibt schlicht keinen DELETE-Endpunkt im Code).
  - Zusätzlich Kalender-Scope `calendar.freebusy` (nur "Verfügbarkeit ansehen", keine
    Termindetails) - **NEU**, siehe "Bugfix: getCalendarAvailability" unten.
- **Kein Secret/Token im Quellcode oder in der OpenAPI-Datei.** Alle Zugangsdaten liegen
  ausschließlich als Cloudflare-Secrets bzw. werden erst in ChatGPT selbst eingetragen (siehe
  unten) - genau wie beim ersten Worker.

## 1) Benötigte Secrets/Variablen

Im Cloudflare Dashboard unter **Worker → Einstellungen → Variablen und Geheimnisse**:

| Name | Typ | Woher |
|---|---|---|
| `API_KEY` | Secret | frei wählen (langer Zufallsschlüssel), nur für ChatGPT bestimmt |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Secret | derselbe Wert wie beim bestehenden Worker `neuverdrahtet-ki-buerokraft` |
| `GOOGLE_OAUTH_CLIENT_ID` | Secret | aus der Google-Cloud-Konsole (siehe Schritt 2 unten) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret | aus der Google-Cloud-Konsole (siehe Schritt 2 unten) |
| `OAUTH_SETUP_SECRET` | Secret | frei wählen, schützt die einmalige Google-Anmeldung davor, dass jemand anderes sie kapert |
| `GOOGLE_CALENDAR_ID` | Variable (kein Geheimnis, optional) | Standard `primary` - nur setzen, falls ihr einen anderen als den Hauptkalender des Firmenkontos anbinden wollt |

## 2) Google-Cloud-Konsole: OAuth-Zugang einrichten

Das ist der einzige wirklich neue Teil gegenüber dem ersten Worker - dort reichte der
bestehende Firebase-Service-Account. Hier braucht es zusätzlich einen **OAuth-Client**, weil
Gmail/Kalender im Namen des echten neuverdrahtet-Google-Kontos (nicht eines Service-Accounts)
angesprochen werden.

1. [console.cloud.google.com](https://console.cloud.google.com) öffnen, **mit dem
   neuverdrahtet-Google-Konto eingeloggt sein**, dasselbe Projekt wählen, das auch für
   Firebase/Firestore genutzt wird (oben in der Projekt-Auswahl zu sehen).
2. Menü → **APIs & Dienste → Bibliothek**. Nacheinander suchen und **aktivieren**:
   - **Gmail API**
   - **Google Calendar API**
3. Menü → **APIs & Dienste → OAuth-Zustimmungsbildschirm**:
   - Falls noch nicht vorhanden: Nutzertyp **Extern** wählen (oder **Intern**, falls ihr eine
     Google Workspace-Organisation habt), App-Name z.B. "Werkora Google-Büro", eigene
     E-Mail-Adresse als Support- und Entwickler-Kontakt eintragen, speichern.
   - Unter **Testnutzer** die neuverdrahtet-Google-Kontoadresse selbst eintragen (solange die
     App im Status "Testing" ist, dürfen nur eingetragene Testnutzer sich verbinden - das ist
     für den internen Gebrauch hier genau richtig, es muss nicht veröffentlicht werden).
4. Menü → **APIs & Dienste → Anmeldedaten → + Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp: **Webanwendung**
   - Name: z.B. "Werkora Google-Büro Worker"
   - **Autorisierte Weiterleitungs-URIs**: `https://<deine-worker-url>/oauth/callback`
     (die genaue Worker-URL bekommst du erst nach dem Deployment in Schritt 3 - diesen Schritt
     hier also **nach** dem ersten Deploy noch einmal öffnen und die URL nachtragen).
   - Erstellen → **Client-ID** und **Client-Secret** werden angezeigt. Beide brauchst du
     gleich für die Cloudflare-Secrets oben.

## 3) Deployment (Cloudflare Dashboard, wie beim ersten Worker)

1. Cloudflare Dashboard → **Workers & Pages** → **Anwendung erstellen** → **Worker
   bereitstellen** (Hello World), Name z.B. `neuverdrahtet-google-buero`.
2. **Code bearbeiten** öffnen, kompletten Inhalt von `worker.js` hineinkopieren (alles
   markieren, löschen, einfügen), **Bereitstellen**.
3. Die angezeigte Worker-URL notieren (endet auf `.workers.dev`) - das ist die Basis-URL,
   die du gleich für die Weiterleitungs-URI (Schritt 2) und für ChatGPT brauchst.
4. Zurück zur Google-Cloud-Konsole (Schritt 2, Anmeldedaten) und die **echte**
   Weiterleitungs-URI `https://<worker-url>/oauth/callback` eintragen und speichern.
5. Im Worker unter **Einstellungen → Variablen und Geheimnisse** alle sechs Werte aus der
   Tabelle oben eintragen (fünf Secrets + optional die eine Variable).

## 4) Google-Konto einmalig verbinden

Nachdem alle Secrets gesetzt sind:

1. Im Browser aufrufen: `https://<worker-url>/oauth/authorize?setup_key=<OAUTH_SETUP_SECRET>`
   (den Wert, den du für `OAUTH_SETUP_SECRET` vergeben hast, genau so einsetzen).
2. Google leitet zur Anmeldung weiter - **mit dem neuverdrahtet-Google-Konto einloggen** und
   den angeforderten Zugriff (Gmail lesen/einordnen, Kalender lesen/schreiben) bestätigen.
3. Du landest zurück auf einer schlichten Textseite "Google-Konto erfolgreich mit Werkora
   verbunden." - das Fenster kann geschlossen werden.
4. Ab jetzt braucht ihr das nie wieder zu tun, solange die Verbindung nicht in den
   Google-Kontoeinstellungen ("Apps mit Kontozugriff") manuell entfernt wird.

**Fehlerfall "Google hat keinen Refresh-Token geliefert":** passiert, wenn das Konto diesem
Worker schon einmal Zugriff erlaubt hatte. Beim neuverdrahtet-Google-Konto unter
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) den Eintrag für
diese App entfernen und Schritt 1-3 hier erneut durchführen.

## Bugfix: "Berechtigungsfehler" bei getCalendarAvailability

`getCalendarAvailability` (`GET /calendar/availability`) schlug bisher als einziger
Kalender-Endpunkt mit einem Berechtigungsfehler fehl, obwohl `searchCalendarEvents` und die
übrigen Kalender-Endpunkte problemlos funktionierten. Ursache (gegen die offizielle
Google-Dokumentation geprüft): dieser Endpunkt ruft intern Googles `freeBusy`-API auf, die
laut Google einen **eigenen** Scope braucht (`calendar.freebusy`, `calendar.readonly` oder
`calendar`) - der bisher angefragte Scope `calendar.events` deckt zwar Termine lesen/anlegen/
ändern ab, aber NICHT die reine Verfügbarkeits-Abfrage. Behoben durch den zusätzlichen,
schmalstmöglichen Scope `calendar.freebusy` (siehe oben).

**Wichtig: dieser Fix braucht eine einmalige Neu-Verbindung**, weil OAuth-Berechtigungen fest
an den beim letzten Login erteilten Zugriff gebunden sind - eine reine Codeänderung reicht
nicht. Nach dem Deployen der aktualisierten `worker.js`:

1. Schritt 1-3 aus "4) Google-Konto einmalig verbinden" oben **erneut durchführen**
   (`/oauth/authorize?setup_key=...` im Browser aufrufen, Google zeigt jetzt einen
   Consent-Bildschirm mit der zusätzlichen Berechtigung "Verfügbarkeit ansehen").
2. Der neue Refresh-Token überschreibt automatisch den alten (`google_oauth_tokens/
   neuverdrahtet` in Firestore) - kein manuelles Aufräumen nötig.
3. Danach `getCalendarAvailability` einmal testen (siehe Abschnitt 5 unten).

## 5) Test von Hand (curl oder der Cloudflare-Dashboard "HTTP"-Tester)

### Gmail-Test

```bash
curl -H "Authorization: Bearer <API_KEY>" "https://<worker-url>/emails?unread=true"
```

Erwartet: `{"success":true,"data":[...]}` mit den ungelesenen E-Mails aus dem Postfach.
Eine einzelne Nachricht lesen:

```bash
curl -H "Authorization: Bearer <API_KEY>" "https://<worker-url>/emails/<message_id>"
```

(`<message_id>` aus der Liste oben, Feld `message_id`). Einen Test-Entwurf anlegen (landet
in Gmail unter "Entwürfe", wird **nicht** versendet):

```bash
curl -X POST -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"to":"deine-eigene-adresse@example.de","body_text":"Testentwurf von Werkora."}' \
  "https://<worker-url>/emails/<message_id>/draft"
```

Danach in Gmail unter "Entwürfe" nachschauen, ob der Entwurf angekommen ist.

### Kalender-Test

```bash
curl -H "Authorization: Bearer <API_KEY>" \
  "https://<worker-url>/calendar/events?date_from=2026-08-01&date_to=2026-08-31"
```

Erwartet: bestehende Termine im Zeitraum. Freie Zeitfenster prüfen:

```bash
curl -H "Authorization: Bearer <API_KEY>" \
  "https://<worker-url>/calendar/availability?date_from=2026-08-17&date_to=2026-08-17"
```

Testtermin anlegen (erscheint im echten Google-Kalender des Firmenkontos):

```bash
curl -X POST -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"title":"Werkora-Testtermin","start":"2026-08-20T09:00:00+02:00","end":"2026-08-20T10:00:00+02:00"}' \
  "https://<worker-url>/calendar/events"
```

Danach im Google-Kalender des Firmenkontos nachschauen, ob der Termin erschienen ist, dann
in Google Kalender selbst wieder löschen (Löschen geht bewusst nur dort, nicht über die API).

## 6) Endpunkte (vollständige Liste, V1)

```
GET   /emails?q=&unread=&from=&to=&subject=&after=&before=      searchEmails
GET   /emails/{message_id}                                       getEmail
GET   /threads/{thread_id}                                       getEmailThread
POST  /emails/{message_id}/draft   { to, subject?, body_text }   createEmailDraft
POST  /emails/{message_id}/read                                  markEmailRead
POST  /emails/{message_id}/labels  { label }                     addEmailLabel

GET   /calendar/events?date_from=&date_to=&q=                    searchCalendarEvents
GET   /calendar/events/{event_id}                                 getCalendarEvent
GET   /calendar/availability?date_from=&date_to=&duration_minutes= getCalendarAvailability
POST  /calendar/events  { title, start, end, description?,
                           location?, attendee_emails?,
                           werkora_appointment_id? }               createCalendarEvent
PATCH /calendar/events/{event_id}  { title?, start?, end?,
                                      description?, location? }    updateCalendarEvent

DELETE (auf jedem Endpunkt)                                       -> 403 (gesperrt)
```

`createCalendarEvent` verhindert Dubletten: wird `werkora_appointment_id` mitgeschickt und
existiert dafür schon ein Google-Kalendereintrag (aus einem früheren Aufruf), wird **kein**
zweiter Termin angelegt - stattdessen liefert die Antwort den bestehenden Termin mit
`"already_existed": true`.

## 7) KI-Aktionsprotokoll

Jeder erfolgreiche Aufruf wird als Dokument in die Firestore-Collection `google_action_log`
geschrieben (Felder: `id`, `timestamp`, `action`, `resource_type`, `resource_id`,
`google_account`, `status`, `error`) - eigenständig, unabhängig vom `ai_action_log` des
ersten Workers. Aktuell nur über die Firebase-Konsole einsehbar; eine eigene Werkora-Ansicht
dafür wäre ein separater, kleiner Folgeschritt, falls gewünscht.

## 8) In ChatGPT einbinden

Diese API kommt als **zweite, eigene Action** zur bestehenden "neuverdrahtet Bürokraft" GPT
dazu - die bestehende Werkora-Action bleibt unverändert bestehen.

1. Im Custom GPT-Editor → **Actions** → **Create new action**.
2. Schema aus `chatgpt-actions-schema.json` (in diesem Ordner) komplett hineinkopieren, dabei
   im Feld `servers[0].url` die echte Worker-URL eintragen (die Datei enthält bewusst nur
   einen Platzhalter, siehe Datei-Kommentar).
3. **Authentication** → **API Key** → **Auth Type: Bearer** → den `API_KEY`-Wert aus
   Cloudflare eintragen (**nicht** in die Schema-Datei schreiben - das ist hier, genau wie
   beim ersten Worker, der einzige Ort für den Schlüssel).
4. Speichern. Danny kann jetzt z.B. fragen: "Welche neuen E-Mails habe ich?", "Erstelle
   einen Antwortentwurf auf die Anfrage von Müller", "Wann habe ich am Donnerstag Zeit für
   einen Vor-Ort-Termin?", "Trag den Termin mit Familie Schmidt am Freitag 9 Uhr in den
   Kalender ein."

## 9) API-Schlüssel widerrufen

Im Cloudflare Dashboard bei den Variablen `API_KEY` mit einem neuen Wert überschreiben und
erneut bereitstellen. Die Google-Verbindung selbst (Refresh-Token in Firestore) bleibt davon
unberührt - nur der Zugriff der KI auf diesen Worker wird gesperrt.
