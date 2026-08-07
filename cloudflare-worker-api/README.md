# neuverdrahtet-api (Cloudflare Worker)

Eine offene, per API-Schlüssel gesicherte REST-Schnittstelle, über die
externe Systeme (Zapier, Make, eigene Skripte) **Kunden**, **Projekte** und
**Termine** aus Werkora lesen und schreiben können.

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
   - `API_KEY` = der oben erzeugte Schlüssel
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = kompletter Inhalt der Firebase-
     Service-Account-JSON-Datei

## Nutzung

Jeder Aufruf braucht den Header `Authorization: Bearer <API_KEY>`.

```
GET    https://<worker-url>/kunden           Liste aller Kunden
GET    https://<worker-url>/kunden/{id}      Ein Kunde
POST   https://<worker-url>/kunden           Neuen Kunden anlegen (JSON-Body)
PATCH  https://<worker-url>/kunden/{id}      Kunde teilweise aktualisieren (JSON-Body)
```

Genauso unter `/projekte` und `/termine`.

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

Der API-Schlüssel gewährt **vollen Lese-/Schreibzugriff** auf Kunden,
Projekte und Termine, ohne Rollen-Einschränkung (anders als die Login-Rollen
in der Verwaltungs-Software). Den Schlüssel daher wie ein Passwort behandeln
- nicht in öffentlichen Repos, Screenshots o.ä. teilen. Bei Verdacht auf
Kompromittierung: im Cloudflare Dashboard einfach einen neuen `API_KEY`-Wert
setzen, der alte wird damit sofort ungültig.

## Spätere Ausbaustufen (nicht Teil dieser ersten Version)

- Weitere Collections (z.B. Angebote, Rechnungen) nach Bedarf ergänzen -
  einfach in `ERLAUBTE_COLLECTIONS` in `worker.js` eintragen.
- Feingranularere Rechte (z.B. eigene Schlüssel pro Integration, nur-Lesen-
  Schlüssel) falls mehrere Drittsysteme gleichzeitig angebunden werden.
- Webhook-Push (Werkora meldet sich bei Änderungen selbst bei Zapier) statt
  nur Abrufen auf Anfrage - aktuell muss die Gegenseite (Zapier "Polling"-
  Trigger) selbst regelmäßig nachfragen.
