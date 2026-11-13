# neuverdrahtet-api (Cloudflare Worker)

Eine offene, per API-Schlüssel gesicherte REST-Schnittstelle, über die
externe Systeme (Zapier, Make, eigene Skripte) Werkora-Daten lesen und
schreiben können: **Kunden**, **Projekte**, **Termine** (volles CRUD),
**Ausgaben** (lesen + anlegen), **Rechnungen** (nur lesen, GoBD-Sperre),
**Angebote** (nur Entwürfe änderbar) und **Katalog/Artikel**
(freigabepflichtig, siehe unten).

Ein eigener, dedizierter Worker - getrennt vom internen Admin-Worker
(`cloudflare-worker/`, per `X-App-Secret` + Origin-Allowlist nur für die
Browser-App gedacht) und vom öffentlichen Kostenschätzer-Worker
(`cloudflare-worker-kostenschaetzer/`, ganz ohne Auth). Dieser hier ist für
Server-zu-Server-Aufrufe gedacht (z.B. von Zapier), aber **nicht öffentlich**
- jeder Aufruf braucht den API-Schlüssel im `Authorization`-Header.

## Einmaliges Setup

1. **API-Schlüssel erzeugen**: ein langes, zufälliges Passwort ausdenken
   (z.B. mit einem Passwort-Generator, mind. 32 Zeichen) - das ist der
   Schlüssel, den später Zapier/Make benutzt.
2. **Firebase-Service-Account** (falls noch nicht für einen der anderen
   Worker vorhanden): Firebase-Konsole → Projekteinstellungen → Dienstkonten
   → "Neuen privaten Schlüssel generieren".
3. **Deployen** (per Dashboard: neuen Worker anlegen, Code aus `worker.js`
   einfügen; oder per CLI: `cd cloudflare-worker-api && npx wrangler deploy`).
4. **Secrets setzen** (Cloudflare Dashboard → Worker → Settings → Variables,
   oder `npx wrangler secret put <NAME>`):
   - `API_KEY` = der oben erzeugte Schlüssel (voller Lese-/Schreibzugriff)
   - `API_KEY_READONLY` (optional) = ein ZWEITER, unabhängiger Schlüssel nur
     für Integrationen, die ausschließlich lesen sollen (z.B. ein Reporting-
     Zap) - damit per GET alles sichtbar ist, POST/PATCH damit aber 403
     liefern. Ohne dieses Secret verhält sich der Worker wie bisher.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = kompletter Inhalt der Firebase-
     Service-Account-JSON-Datei
5. **Rate-Limiter-Binding einrichten** (P0-Sicherheitskorrektur, Oktober
   2026): im Cloudflare-Dashboard unter Worker → Settings → Bindings einen
   "Rate Limiting"-Binding mit Namen `RATE_LIMITER` hinzufügen (bei Deploy
   per `wrangler deploy` passiert das automatisch über `wrangler.toml`).
   **Ohne dieses Binding sperrt sich der Worker ab sofort selbst (fail-closed,
   503) statt ungebremst durchzulassen** - ist also keine optionale
   Komfort-Verbesserung, sondern Voraussetzung für den normalen Betrieb.

## Nutzung

Jeder Aufruf braucht den Header `Authorization: Bearer <API_KEY>`.

```
GET    https://<worker-url>/kunden           Liste aller Kunden
GET    https://<worker-url>/kunden/{id}      Ein Kunde
POST   https://<worker-url>/kunden           Neuen Kunden anlegen (JSON-Body)
PATCH  https://<worker-url>/kunden/{id}      Kunde teilweise aktualisieren (JSON-Body)
```

Genauso unter `/projekte` und `/termine` (volles CRUD).

**Eingeschränkte Bereiche** (13.11.2026 ergänzt, "Werkora-Vereinfachung"):

```
GET /ausgaben, GET /ausgaben/{id}, POST /ausgaben        - lesen + anlegen, KEIN PATCH
GET /rechnungen, GET /rechnungen/{id}                    - NUR lesen (GoBD-Sperre), POST/PATCH -> 405
GET /angebote, GET /angebote/{id}, POST /angebote, PATCH /angebote/{id}
```

Bei `/angebote` erzwingt `POST` serverseitig `status: "entwurf"` (wird nie
automatisch versendet, egal was im Body steht). `PATCH` funktioniert nur,
solange das Angebot noch im Status "entwurf" ist (409 sonst) - und "status"
selbst lässt sich über `PATCH` nicht ändern. Versand/Freigabe eines Angebots
bleibt Werkora selbst vorbehalten - genau wie bei `werkora_update_quote` im
KI-Bürokraft-MCP-Server.

**Katalog/Artikel - freigabepflichtig:**

```
GET  /katalog, GET /katalog/{id}            - normales, ungegatetes Lesen
POST /katalog, PATCH /katalog/{id}          - schreiben NICHT direkt, sondern
                                               legen nur eine Freigabe-Anfrage an (202)
GET  /freigaben                             - Liste aller offenen Freigaben
GET  /freigaben/{id}                        - eine Freigabe-Anfrage
POST /freigaben/{id}/freigeben              - führt die Anlage/Änderung jetzt aus
POST /freigaben/{id}/ablehnen               - lehnt ab (optional {"grund":"..."})
```

Katalogpreise wirken sich auf jede künftige Angebots-/Rechnungskalkulation
aus - deshalb dieselbe Vorsicht wie beim KI-Bürokraft-MCP-Server
(`werkora_create_article`/`werkora_update_article`). Ein `POST /katalog`
liefert sofort `{"ok":true,"freigabe_erforderlich":true,"freigabe":{"id":"...",
"freigeben_url":"/freigaben/.../freigeben","ablehnen_url":"/freigaben/.../ablehnen"}}`
- erst der Aufruf von `freigeben_url` legt den Artikel wirklich an bzw.
ändert ihn. Freigabe-Anfragen landen in derselben Firestore-Collection
(`mcpFinanzFreigaben`) wie die des KI-Bürokraft-Workers - ein gemeinsamer
Freigabe-Pool, kein zweites, getrenntes Konzept für dieselbe Art
Entscheidung. Die Ausführung ist atomar (Firestore-Nebenläufigkeitskontrolle)
- zwei gleichzeitige `freigeben`-Aufrufe für dieselbe Freigabe führen sie
garantiert nur einmal aus.

Beispiel (curl):

```bash
curl https://<worker-url>/kunden \
  -H "Authorization: Bearer <API_KEY>"

curl -X POST https://<worker-url>/kunden \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"firma":"Neuer Kunde GmbH","status":"lead","email":"info@beispiel.de"}'
```

In Zapier/Make: als "Webhook"-Aktion mit der jeweiligen URL, Methode und
einem "Authorization"-Header vom Typ `Bearer <API_KEY>` einrichten (bzw.
"API Key Auth", falls die Integration das anbietet).

## Wichtig: welche Felder erwartet werden

Die Felder entsprechen 1:1 den Datensätzen aus der Verwaltungs-Software
(siehe `verwaltung/js/db.js`). Für Kunden z.B. `firma`, `ansprechpartner`,
`telefon`, `email`, `status`, `strasse`, `plz`, `ort`, `notizen`. Beim
Anlegen per `POST` reicht es, nur die tatsächlich bekannten Felder zu
schicken - der Worker füllt keine Standardwerte für nicht mitgeschickte
Felder auf (anders als beim Anlegen über die Verwaltungs-Oberfläche selbst).
Bei Unsicherheit: einen Testdatensatz per `GET` abrufen und sich am
zurückgegebenen Feld-Set orientieren.

## Sicherheitshinweis

Der volle `API_KEY` gewährt **vollen Lese-/Schreibzugriff** auf Kunden,
Projekte und Termine. Seit der P0-Sicherheitskorrektur (Oktober 2026) gibt es
optional einen zweiten, nur-lesenden `API_KEY_READONLY` für Integrationen,
die keinen Schreibzugriff brauchen sollten (siehe oben) - eine echte,
feingranulare Rollenverwaltung pro Integration ist das trotzdem nicht
(beide Schlüssel sind weiterhin statisch und geteilt, kein Login pro
Integration). Jeden Schlüssel daher wie ein Passwort behandeln - nicht in
öffentlichen Repos, Screenshots o.ä. teilen. Bei Verdacht auf Kompromittierung:
im Cloudflare Dashboard einfach einen neuen Wert setzen, der alte wird damit
sofort ungültig. Zusätzlich begrenzt ein `RATE_LIMITER`-Binding jeden Aufruf
auf 30 Anfragen je IP und Minute (siehe Setup oben) - bei einem geleakten
Schlüssel begrenzt das zumindest, wie schnell er ausgenutzt werden kann.

## Spätere Ausbaustufen (nicht Teil dieser ersten Version)

- Weitere Collections nach Bedarf ergänzen - einfach in `COLLECTION_MODUS`
  in `worker.js` eintragen (Modus `'full'`, `'lesen-anlegen'`, `'nur-lesen'`,
  `'entwurf'` oder `'freigabe'`, je nachdem wie sensibel/folgenreich die
  Collection ist).
- Echte feingranulare Rechte pro Integration (eigene Schlüssel mit eigener
  Identität/eigenem Audit-Log statt nur "voll" vs. "nur lesend") falls
  mehrere Drittsysteme gleichzeitig angebunden werden.
- Webhook-Push (Werkora meldet sich bei Änderungen selbst bei Zapier) statt
  nur Abrufen auf Anfrage - aktuell muss die Gegenseite (Zapier "Polling"-
  Trigger) selbst regelmäßig nachfragen.
