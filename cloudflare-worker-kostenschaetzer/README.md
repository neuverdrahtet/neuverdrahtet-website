# neuverdrahtet-kostenschaetzer (Cloudflare Worker)

Nimmt abgeschlossene Anfragen aus dem öffentlichen Wallbox-Kostenschätzer
(`wallbox-kostenschaetzer.html`) entgegen und legt daraus automatisch einen
Kunden (Status "Lead") + ein Projekt in der Werkora-Lead-Pipeline an
(dieselbe Firebase-Datenbank wie die Verwaltungs-Software).

Ein eigener, dedizierter Worker - **getrennt** vom bestehenden
`cloudflare-worker/` (der für die interne Admin-Software mit `X-App-Secret`
gesichert ist). Dieser hier ist absichtlich öffentlich ohne Secret
erreichbar, da er direkt von unauthentifizierten Website-Besuchern
aufgerufen wird.

## Einmaliges Setup

1. **Firebase-Service-Account** (falls noch nicht für den anderen Worker
   vorhanden): Firebase-Konsole → Projekteinstellungen → Dienstkonten →
   "Neuen privaten Schlüssel generieren". Die heruntergeladene JSON-Datei
   als **einzeiligen String** bereithalten (z.B. mit `jq -c . datei.json`).

2. **Deployen**:
   ```bash
   cd cloudflare-worker-kostenschaetzer
   npx wrangler deploy
   ```
   Beim ersten Deploy einmalig das Secret setzen:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
   # -> den einzeiligen JSON-String einfügen, wenn danach gefragt wird
   ```

3. **Die entstandene Worker-URL notieren** (z.B.
   `https://neuverdrahtet-kostenschaetzer.<dein-account>.workers.dev`) und an
   **zwei Stellen** im Repo eintragen (beide müssen exakt übereinstimmen):
   - `assets/kostenschaetzer.js` → Konstante `KS_WORKER_URL` ganz oben.
   - `wallbox-kostenschaetzer.html` → CSP-Meta-Tag im `<head>`, im
     `connect-src`-Teil (aktuell steht dort ein Platzhalter mit demselben
     Muster, der ersetzt werden muss).

   Falls stattdessen eine eigene Domain/Route für den Worker eingerichtet
   wird (z.B. `kostenschaetzer-api.neuverdrahtet.com`), dann dort statt der
   `*.workers.dev`-URL diese Adresse eintragen.

## Danach einmal live testen

- Den Kostenschätzer auf der Live-Seite einmal komplett durchklicken und
  eine Test-Anfrage absenden.
- In Werkora unter **Lead-Pipeline** prüfen, ob ein neuer Lead mit der
  Test-E-Mail-Adresse erscheint, und in **Projekte** das dazugehörige
  Projekt "Wallbox-Anfrage (Website)" mit der ausformulierten
  Zusammenfassung in der Beschreibung.
- Bei einem Fehler zeigt die Kostenschätzer-Seite eine Fehlermeldung mit
  Ausweich-Hinweis auf E-Mail/Telefon; die genaue Fehlerursache steht im
  Cloudflare-Worker-Log (`npx wrangler tail`).

## Spätere Ausbaustufen (nicht Teil dieser ersten Version)

- Echtes CAPTCHA (z.B. Cloudflare Turnstile) statt nur Honeypot +
  Mindestzeit, falls Spam trotzdem zum Problem wird.
- Foto-Upload (z.B. Zählerschrank-Foto) - aktuell bewusst nicht enthalten,
  da es weder ein öffentliches Firebase-Storage-Schreibrecht noch eine
  fertige Upload-UI auf der Website gibt.
- Weitere Module aus dem Gesamtkonzept (Elektrosanierung, Photovoltaik,
  Zählerschrank, ...) nach demselben Muster wie dieses Wallbox-Modul.
