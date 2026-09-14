# neuverdrahtet-ki-check (Cloudflare Worker)

Backend für den öffentlichen **"KI-Check Unterverteilung"** auf der Website
(`ki-check-unterverteilung.html`): nimmt ein hochgeladenes Foto einer
Unterverteilung/eines Zählerschranks entgegen und liefert über die
Claude-Vision-API eine laienverständliche, unverbindliche Ersteinschätzung
zurück (Zustand, Auffälligkeiten, Alterseindruck, Empfehlung) - **keine**
Prüfung nach DIN VDE 0100-600 und **kein** Ersatz für eine Begutachtung durch
eine Elektrofachkraft vor Ort. Der Prompt (siehe `SYSTEM_PROMPT` in
`worker.js`) ist bewusst zurückhaltend formuliert und macht das in jeder
Antwort deutlich.

Ein eigener, dedizierter Worker - **getrennt** vom internen Admin-Worker
(`cloudflare-worker/`, X-App-Secret-gesichert, eigener Anthropic-Schlüssel
für die interne Verwaltungs-Software) und auch getrennt vom Lead-Worker
(`cloudflare-worker-kostenschaetzer/`, kein Anthropic-Zugriff, nur
Firestore). Dieser hier ist absichtlich öffentlich ohne Secret erreichbar
und hat seinen **eigenen** `ANTHROPIC_API_KEY`, damit ein Missbrauchsfall
hier weder das interne KI-Budget noch andere Bereiche belastet.

## Einmaliges Setup

1. **Anthropic-API-Key** (falls noch nicht vorhanden): [console.anthropic.com](https://console.anthropic.com)
   → API Keys → neuen Key erstellen. Aus Sicherheits-/Budgetgründen
   empfiehlt sich ein **eigener** Key nur für diesen Worker (nicht derselbe
   wie beim internen Admin-Worker), damit sich ein Ausgabenlimit separat
   setzen lässt.

2. **Deployen**:
   ```bash
   cd cloudflare-worker-ki-check
   npx wrangler deploy
   ```
   Beim ersten Deploy einmalig das Secret setzen:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   # -> den Anthropic-API-Key einfügen, wenn danach gefragt wird
   ```

3. **Die entstandene Worker-URL notieren** (z.B.
   `https://neuverdrahtet-ki-check.<dein-account>.workers.dev`) und an
   **zwei Stellen** im Repo eintragen (beide müssen exakt übereinstimmen):
   - `assets/ki-check.js` → Konstante `KI_CHECK_WORKER_URL` ganz oben.
   - `ki-check-unterverteilung.html` → CSP-Meta-Tag im `<head>`, im
     `connect-src`-Teil (aktuell steht dort ein Platzhalter mit demselben
     Muster, der ersetzt werden muss).

   Falls stattdessen eine eigene Domain/Route für den Worker eingerichtet
   wird, dann dort statt der `*.workers.dev`-URL diese Adresse eintragen.

## Danach einmal live testen

- Den KI-Check auf der Live-Seite mit einem echten Foto einer
  Unterverteilung/eines Zählerschranks durchklicken.
- Prüfen, ob eine plausible, zurückhaltende Einschätzung erscheint (nicht:
  "geprüft/zertifiziert", sondern erkennbar als unverbindliche
  Ersteinschätzung mit Empfehlung zur Vor-Ort-Prüfung).
- Optional die "Vor-Ort-Termin anfragen"-Anfrage absenden und prüfen, ob in
  Werkora unter **Lead-Pipeline** ein neuer Lead erscheint (läuft über den
  bereits bestehenden `data-werkora-lead="true"`-Mechanismus in
  `assets/script.js`, **nicht** über diesen Worker hier - dieser Worker
  macht ausschließlich die Bildanalyse).
- Bei einem Fehler zeigt die Seite eine Fehlermeldung; die genaue
  Fehlerursache steht im Cloudflare-Worker-Log (`npx wrangler tail`).

## Kosten & Missbrauchsschutz

- Jede Anfrage ist ein echter Claude-Vision-API-Call (kostet Anthropic-API-
  Guthaben). Das Frontend verkleinert Fotos vor dem Absenden client-seitig;
  der Worker deckelt die Bildgröße zusätzlich serverseitig
  (`MAX_IMAGE_DATA_URL_LENGTH`).
- Schutz vor Spam/Missbrauch bisher nur Honeypot + Mindestzeit (wie beim
  Kostenschätzer) - **kein** CAPTCHA, **kein** Rate-Limit pro IP. Falls das
  zum Problem wird: Cloudflare Turnstile vorschalten oder ein Tageslimit
  über eine KV-Namespace-Zählung ergänzen (beides nicht Teil dieser ersten
  Version).
- Ein monatliches Ausgabenlimit für den `ANTHROPIC_API_KEY` dieses Workers
  in der Anthropic-Konsole wird empfohlen.
