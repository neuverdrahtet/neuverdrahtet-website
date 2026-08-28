# neuverdrahtet-ki-assistent (Cloudflare Worker)

Backend für den Chat-Assistenten auf der öffentlichen Website (das
Chat-Widget unten rechts, `assets/ki-assistent.js`). Beantwortet Fragen von
Besuchern zu den Leistungen von neuverdrahtet per Claude (Anthropic) und legt
- nach ausdrücklicher Zustimmung des Besuchers - automatisch einen Lead
(Kunde + Projekt) in der Werkora-Lead-Pipeline an (dieselbe Firebase-
Datenbank wie die Verwaltungs-Software und der Wallbox-Kostenschätzer).

Ein eigener, dedizierter Worker - **getrennt** vom internen Admin-Worker
(`cloudflare-worker/`, per `X-App-Secret` gesichert) und von der KI-Bürokraft
(`cloudflare-worker-ki-buerokraft/`, nur für die interne Verwaltung gedacht).
Dieser hier ist absichtlich öffentlich ohne Secret erreichbar, da er direkt
vom Browser unauthentifizierter Website-Besucher aufgerufen wird - wie der
Kostenschätzer-Worker.

## Einmaliges Setup

1. **Anthropic-API-Schlüssel** besorgen: [console.anthropic.com](https://console.anthropic.com)
   → API Keys → neuen Schlüssel erstellen. Getrennte Abrechnung von einem
   eventuellen ChatGPT-Abo - für diesen Worker fallen nutzungsabhängige
   Kosten pro Anfrage bei Anthropic an (Größenordnung: einige Cent pro 100
   Gespräche bei `claude-haiku-4-5`, siehe [anthropic.com/pricing](https://anthropic.com/pricing)).
2. **Firebase-Service-Account** (falls schon für Kostenschätzer/Verwaltung
   vorhanden, kann derselbe wiederverwendet werden): Firebase-Konsole →
   Projekteinstellungen → Dienstkonten → "Neuen privaten Schlüssel
   generieren". Die heruntergeladene JSON-Datei als **einzeiligen String**
   bereithalten (z.B. mit `jq -c . datei.json`).
3. **Deployen** (Cloudflare Dashboard → Workers & Pages → Anwendung
   erstellen → Worker bereitstellen, dann **Code bearbeiten** → kompletten
   Inhalt von `worker.js` einfügen → **Bereitstellen**; oder per CLI:
   ```bash
   cd cloudflare-worker-ki-assistent
   npx wrangler deploy
   ```
4. **Secrets setzen** (Cloudflare Dashboard → Worker → Einstellungen →
   Variablen und Geheimnisse, jeweils als **Secret**):
   - `ANTHROPIC_API_KEY` = der oben erzeugte Schlüssel
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = der einzeilige JSON-String
5. **Die entstandene Worker-URL notieren** (z.B.
   `https://neuverdrahtet-ki-assistent.<dein-konto>.workers.dev`) und im
   Repo an folgenden Stellen eintragen (beide müssen exakt übereinstimmen):
   - `assets/ki-assistent.js` → Konstante `KI_ASSISTENT_WORKER_URL` ganz oben.
   - Alle öffentlichen HTML-Seiten → CSP-Meta-Tag im `<head>`, im
     `connect-src`-Teil. Da die Widget-URL auf ~35 Seiten eingebunden ist,
     lohnt sich eine einmalige Ersetzung per Kommandozeile statt von Hand:
     ```bash
     find . -maxdepth 1 -name "*.html" -exec sed -i \
       's#PLATZHALTER-KI-ASSISTENT-WORKER-URL#https://neuverdrahtet-ki-assistent.<dein-konto>.workers.dev#g' {} +
     ```
     (ersetze `<dein-konto>` durch deinen tatsächlichen Cloudflare-Workers-Kontonamen).

## Danach einmal live testen

- Auf einer beliebigen Seite der Live-Website den Chat-Button unten rechts
  öffnen, eine Frage zu einer Leistung stellen (z.B. "Was kostet eine
  Wallbox ungefähr?") und prüfen, ob eine sinnvolle Antwort kommt.
- Ein Test-Anliegen mit Namen + Telefonnummer/E-Mail durchspielen und der
  Zustimmung zusagen ("Ja, Sie dürfen mich kontaktieren") - danach in
  Werkora unter **Lead-Pipeline** prüfen, ob ein neuer Lead mit dem
  Test-Namen erscheint.
- Bei einem Fehler zeigt das Widget eine Fehlermeldung mit Ausweich-Hinweis
  auf E-Mail/Telefon; die genaue Fehlerursache steht im
  Cloudflare-Worker-Log (`npx wrangler tail`).

## Wichtige Design-Entscheidungen

- **Kein serverseitiger Gesprächsverlauf.** Der Browser schickt bei jeder
  Anfrage den kompletten bisherigen Verlauf mit; der Worker selbst
  speichert nichts dauerhaft außer dem Lead-Datensatz (der ja ohnehin in
  Werkora landet). Schließt der Besucher den Tab, ist das Gespräch weg -
  bewusst datensparsam.
- **Lead wird nur mit Zustimmung angelegt.** Der System-Prompt weist Claude
  an, das `lead_anlegen`-Tool erst nach ausdrücklicher Zustimmung des
  Besuchers UND vorhandenem Namen + Telefonnummer/E-Mail aufzurufen. Das ist
  eine Anweisung an das Sprachmodell, keine harte serverseitige Schranke -
  im Regelfall zuverlässig, aber kein Ersatz für eine echte
  Double-Opt-In-Prüfung, falls das rechtlich strenger sein muss.
- **Keine verbindlichen Preise.** Der Assistent verweist für eine grobe
  Kosteneinschätzung auf die vorhandenen Kosten-Konfiguratoren der
  jeweiligen Leistungsseiten, statt selbst Zahlen zu nennen.

## Spätere Ausbaustufen (nicht Teil dieser ersten Version)

- Echtes CAPTCHA (z.B. Cloudflare Turnstile) statt der einfachen
  Nachrichtenlängen-/Anzahl-Begrenzung, falls Spam/Missbrauch zum Problem wird.
- Rate-Limiting pro IP-Adresse über Cloudflare KV oder Durable Objects (aktuell
  gibt es nur die feste Obergrenze `MAX_MESSAGES` pro Gespräch, kein
  Tracking über mehrere Gespräche/IP-Adressen hinweg).
- Freigabe echter, dynamischer Termin-/Kapazitätsdaten an den Assistenten
  (aktuell kennt er nur die statischen Leistungsbeschreibungen aus dem
  System-Prompt, keine echte Kalenderverfügbarkeit).
