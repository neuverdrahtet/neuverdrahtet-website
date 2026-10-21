# JARVIS Phase 10 – Isolierte Staging-Umgebung (Konfigurationsvorlage)

**Status: Vorlage/Anleitung. Es wurde noch KEIN echtes Cloudflare-, Firebase-, Google- oder Anthropic-Konto/Ressource angelegt oder verändert.** Diese Entwicklungsumgebung hat keinen Zugriff auf solche Konten (kein Cloudflare-/Google-/Firebase-Login, kein Anthropic-API-Schlüssel für den JARVIS-Worker). Jeder der folgenden Schritte, der eine echte Ressource erzeugen oder verändern würde, ist ausdrücklich als **"⏸ Wartet auf Danny"** gekennzeichnet.

## Grundprinzip der Isolation

Staging bekommt **für jede einzelne Komponente eine eigene, von der Produktion komplett unabhängige Instanz** – nicht nur eigene Zugangsdaten für dieselbe Instanz:

| Komponente | Produktion | Staging |
|---|---|---|
| Firebase-Projekt | `neuverdrahtet` (Name als Beispiel) | **eigenes** Projekt, z.B. `neuverdrahtet-staging` |
| Firestore-Datenbank | zum Produktions-Projekt gehörend | zum Staging-Projekt gehörend – **strukturell eine andere Datenbank**, kein gemeinsamer Namespace |
| Cloudflare Worker (3×: Haupt-Worker, Google-Büro, KI-Bürokraft) | `neuverdrahtet-ki-angebote` usw. | `neuverdrahtet-ki-angebote-staging` usw. (Vorlage bereits in den drei `wrangler.toml` als `[env.staging]` hinterlegt, siehe unten) |
| Secrets (APP_SECRET, ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, Google-OAuth) | Produktions-Secrets im Cloudflare-Dashboard | **eigene** Secrets, separat per `wrangler secret put --env staging` gesetzt |
| Gmail/Google Kalender | echtes Geschäftskonto | **dediziertes Test-/Dummy-Google-Konto** |
| Anthropic API | Produktions-API-Key | **eigener** API-Key mit niedrigem Budget-Limit |

**Warum das "keine Schreibzugriffe auf produktive Systeme" sicherstellt:** Ein Firebase-Service-Account ist kryptografisch an genau EIN Firebase-Projekt gebunden – der Staging-Service-Account kann technisch nicht gegen die Produktions-Firestore-API authentifizieren, selbst bei einem Programmierfehler. Ein Cloudflare Worker mit einem anderen `name` ist ein komplett eigenständiger Worker mit eigenen Bindings/Secrets – es gibt keine Konfiguration, die "versehentlich" beide verbindet. Dieselbe `firestore.rules`-Datei wird für beide Projekte verwendet (identische Regeln), aber jeweils nur gegen die zugehörige Projekt-Datenbank deployt.

---

## Schritt 1: Separates Firebase-Staging-Projekt ⏸ Wartet auf Danny

1. In der [Firebase Console](https://console.firebase.google.com) ein **neues** Projekt anlegen, z.B. `neuverdrahtet-staging`.
2. Authentication aktivieren (E-Mail/Passwort, wie in Produktion).
3. Firestore (Native-Modus) aktivieren.
4. Die bestehende `firestore.rules` aus diesem Repo gegen das Staging-Projekt deployen: `firebase deploy --only firestore:rules --project neuverdrahtet-staging`.
5. Einen Service-Account-Schlüssel für dieses Projekt erzeugen (Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren) – wird später als `FIREBASE_SERVICE_ACCOUNT_JSON`-Secret gebraucht.
6. Einen eigenen Web-API-Key für `verwaltung/js/firebase-config.js` (nur für eine separate Staging-Instanz der Verwaltungs-Software, falls diese ebenfalls separat gehostet werden soll – optional, siehe Hinweis unten).

## Schritt 2: Cloudflare-Staging-Worker ⏸ Wartet auf Danny

Die Vorlage ist bereits in den drei betroffenen `wrangler.toml`-Dateien als `[env.staging]`-Block hinterlegt (`cloudflare-worker/`, `cloudflare-worker-google-buero/`, `cloudflare-worker-ki-buerokraft/`) – inert, bis explizit mit `--env staging` deployt wird.

1. `<PLATZHALTER>` in `cloudflare-worker/wrangler.toml` (`ALLOWED_ORIGINS`) durch die tatsächliche Staging-Vorschau-Domain ersetzen.
2. Für jeden der drei Worker: `wrangler deploy --env staging`.
3. Secrets setzen (**eigene** Werte, siehe Schritt 4/5): `wrangler secret put ANTHROPIC_API_KEY --env staging`, `wrangler secret put APP_SECRET --env staging`, `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env staging` (Inhalt der in Schritt 1.5 erzeugten Datei) usw. für die beiden anderen Worker entsprechend ihrer eigenen Secret-Liste.
4. Das `RATE_LIMITER`-Binding für `--env staging` wird von Cloudflare beim ersten `wrangler deploy --env staging` automatisch angelegt (wie in Produktion) – **Pflicht**, da die Routen seit der Phase-10-Sicherheitskorrektur sonst fail-closed sperren.

## Schritt 3: Dedizierte Gmail-/Google-Kalender-Testkonten ⏸ Wartet auf Danny

1. Ein **neues**, dediziertes Google-Konto anlegen (kein Alias des echten Geschäftskontos) – z.B. `neuverdrahtet.staging.test@gmail.com`.
2. In der [Google Cloud Console](https://console.cloud.google.com) ein **eigenes** OAuth-Client-Projekt für Staging anlegen (Gmail-API + Calendar-API aktivieren).
3. `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`/`OAUTH_SETUP_SECRET` als Staging-Secrets setzen (siehe Schritt 2.3).
4. Die Google-Verbindung einmalig über `/oauth/authorize?setup_key=<OAUTH_SETUP_SECRET>` auf dem **Staging**-Worker herstellen (mit dem Test-Google-Konto einloggen, NICHT mit dem echten Geschäftskonto).

## Schritt 4: Anthropic-API mit begrenztem Testbudget ⏸ Wartet auf Danny

1. In der [Anthropic Console](https://console.anthropic.com) einen **separaten** API-Key für Staging erzeugen (eigener Name, z.B. "neuverdrahtet-staging").
2. Ein niedriges Ausgabenlimit für diesen Key setzen (Anthropic Console → Billing/Limits) – unabhängig vom Produktions-Budget.
3. Als `ANTHROPIC_API_KEY`-Secret auf dem Staging-Worker setzen (siehe Schritt 2.3). Empfehlung: `MODEL_ID = "claude-haiku-4-5"` für Staging-Tests (günstiger, bereits in der Vorlage voreingestellt).
4. `JARVIS_MONATSLIMIT_USD` niedrig setzen (z.B. 5 USD) als zusätzliche automatische Bremse.

## Schritt 5: Synthetische Testdaten

Das Skript `staging/seed-synthetic-data.mjs` (in diesem Repo, siehe Datei) legt ausschließlich klar als Test gekennzeichnete, fiktive Kunden/Anlagen/Angebote/Rechnungen an. Es tut nichts von selbst – Ausführung:

```bash
npm install firebase-admin
GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/staging-service-account.json \
  node staging/seed-synthetic-data.mjs --project neuverdrahtet-staging --confirm-staging
```

⏸ **Wartet auf Danny** – nur er hat den in Schritt 1.5 erzeugten Staging-Service-Account-Schlüssel und sollte diesen Befehl selbst (oder mit seiner ausdrücklichen Freigabe) ausführen.

## Schritt 6: Verwaltungs-Software gegen Staging zeigen lassen

Für echte Browser-/Login-Integrationstests (siehe Phase-10-Bericht, Abschnitt "Echte Integrationstests") muss die Verwaltungs-Software (`verwaltung/`) vorübergehend gegen das Staging-Firebase-Projekt und den Staging-Worker zeigen:
- `verwaltung/js/firebase-config.js`: Staging-Projekt-Werte (Web-API-Key, Projekt-ID usw. aus Schritt 1.6).
- In den App-Einstellungen: `aiWorkerUrl` auf die Staging-Worker-URL, `aiAppSecret` auf das in Schritt 2.3 gesetzte Staging-`APP_SECRET`.

Empfehlung: dafür einen eigenen Lesezweig/eine eigene Vorschau-Bereitstellung nutzen (z.B. GitHub Pages Preview, Cloudflare Pages Preview-Deployment), NICHT die echte `neuverdrahtet.com`-Domain – siehe `ALLOWED_ORIGINS` in Schritt 2.1.

---

## Nach Abschluss von Schritt 1–6

Erst wenn alle sechs Schritte durchgeführt und von Danny als abgeschlossen bestätigt wurden, können die in Abschnitt 3 des Phase-10-Berichts aufgelisteten echten Integrationstests tatsächlich ausgeführt werden. Bis dahin bleiben sie offen – siehe dort.
