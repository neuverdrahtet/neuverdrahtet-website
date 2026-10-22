# JARVIS Phase 10/11 – Isolierte Staging-Umgebung (Konfigurationsvorlage)

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

**Keine produktiven Daten in Staging, in keiner Richtung:** niemals echte Kunden, Belege, Kalendereinträge oder E-Mails in die Staging-Umgebung importieren/kopieren (auch nicht "nur zum Testen") – ausschließlich die synthetischen Testdaten aus Schritt 5 verwenden. Das dedizierte Test-Google-Konto (Schritt 3) darf niemals mit dem echten Geschäfts-Gmail/-Kalender verknüpft oder synchronisiert werden.

**Warum das "keine Schreibzugriffe auf produktive Systeme" sicherstellt:** Ein Firebase-Service-Account ist kryptografisch an genau EIN Firebase-Projekt gebunden – der Staging-Service-Account kann technisch nicht gegen die Produktions-Firestore-API authentifizieren, selbst bei einem Programmierfehler. Ein Cloudflare Worker mit einem anderen `name` ist ein komplett eigenständiger Worker mit eigenen Bindings/Secrets – es gibt keine Konfiguration, die "versehentlich" beide verbindet. Dieselbe `firestore.rules`-Datei wird für beide Projekte verwendet (identische Regeln), aber jeweils nur gegen die zugehörige Projekt-Datenbank deployt.

---

## Schritt 1: Separates Firebase-Staging-Projekt ⏸ Wartet auf Danny

1. In der [Firebase Console](https://console.firebase.google.com) ein **neues** Projekt anlegen, z.B. `neuverdrahtet-staging`.
2. Authentication aktivieren (E-Mail/Passwort, wie in Produktion).
3. Firestore (Native-Modus) aktivieren.
4. Die bestehenden `firestore.rules` UND `storage.rules` aus diesem Repo gegen das Staging-Projekt deployen: `firebase deploy --only firestore:rules,storage --project neuverdrahtet-staging` (ohne `storage.rules` würde ein frisches Firebase-Projekt Storage-Zugriffe aus dem Browser standardmäßig komplett sperren statt wie in Produktion zu regeln - sicher, aber die echten Integrationstests in Abschnitt "Echte Integrationstests" würden daran scheitern).
5. Einen Service-Account-Schlüssel für dieses Projekt erzeugen (Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren) – wird später als `FIREBASE_SERVICE_ACCOUNT_JSON`-Secret gebraucht.
   **Phase 11 – tatsächlich benötigte Rechte (geprüft, siehe unten "Benötigte Rechte"):** der von Firebase automatisch erzeugte Standard-Service-Account ("firebase-adminsdk-...") bekommt per Voreinstellung die Rolle **Editor** auf dem gesamten GCP-Projekt – deutlich mehr, als dieser Code tatsächlich braucht. Für Staging empfohlen (muss nicht, kann aber in der [Google Cloud Console](https://console.cloud.google.com) → IAM gemacht werden): die Editor-Rolle entfernen und statt dessen nur die drei unten gelisteten, konkret benötigten Rollen zuweisen.
6. Einen eigenen Web-API-Key für `verwaltung/js/firebase-config.js` (nur für eine separate Staging-Instanz der Verwaltungs-Software, falls diese ebenfalls separat gehostet werden soll – optional, siehe Hinweis unten).

### Benötigte Rechte (Phase 11, tatsächlich im Code geprüft – nicht angenommen)

Jeder Aufruf, der eine Google-Zugriffsberechtigung (OAuth-Scope) anfordert, wurde im gesamten Code der drei Cloudflare-Worker nachgeschlagen (`getGoogleAccessToken(...)`-Aufrufe). Der Firebase-Service-Account braucht dafür in der Google Cloud Console (IAM → den Service-Account auswählen → Rolle hinzufügen) **ausschließlich** diese drei vordefinierten Rollen – keine einzige Stelle im Code braucht mehr:

| Scope im Code | Wofür | Benötigte IAM-Rolle |
|---|---|---|
| `datastore` | Firestore lesen/schreiben (alle drei Worker) | `roles/datastore.user` (Cloud Datastore User) |
| `firebase.messaging` | Push-Benachrichtigungen (Haupt-Worker, KI-Bürokraft) | `roles/firebasecloudmessaging.admin` (Firebase Cloud Messaging API Admin) |
| `devstorage.read_write` | Datei-Upload (`/kunde-upload`, Haupt-Worker) | `roles/storage.objectAdmin` (idealerweise nur auf den konkreten Storage-Bucket beschränkt, nicht projektweit) |

**Nicht benötigt, obwohl man es vermuten könnte:** keine Admin-SDK-Rolle für Authentication (`roles/firebaseauth.admin`) – die ID-Token-Prüfung läuft über eine eigene, manuelle JWKS-Signaturprüfung (`verifyFirebaseIdToken` in `cloudflare-worker/worker.js`), nicht über die Firebase Admin SDK. Keine Rolle für Cloud Functions, Compute, IAM-Verwaltung oder sonstige GCP-Dienste.

**Cloudflare Service Bindings (GOOGLE_BUERO/KI_BUEROKRAFT) haben KEINE eigene Rechteverwaltung:** ein Service Binding gewährt dem aufrufenden Worker vollen Zugriff auf JEDE Route des gebundenen Ziel-Workers (es gibt keine Möglichkeit, ein Binding auf bestimmte Pfade/Methoden einzuschränken). Die Isolation zwischen Produktion und Staging kommt deshalb ausschließlich daher, dass Staging auf komplett eigenständige, separat deployte Ziel-Worker (`-staging`-Suffix) bindet – nicht aus einer Einschränkung des Bindings selbst. Das wurde in Phase 10.1 bereits strukturell geprüft (eigener `name` je Worker, keine Vererbung von Produktions-Bindings in `[env.staging]`) und bleibt unverändert gültig.

## Schritt 2: Cloudflare-Staging-Worker ⏸ Wartet auf Danny

Die Vorlage ist bereits in den drei betroffenen `wrangler.toml`-Dateien als `[env.staging]`-Block hinterlegt (`cloudflare-worker/`, `cloudflare-worker-google-buero/`, `cloudflare-worker-ki-buerokraft/`) – inert, bis explizit mit `--env staging` deployt wird.

1. `<PLATZHALTER>` in `cloudflare-worker/wrangler.toml` (`ALLOWED_ORIGINS`) durch die tatsächliche Staging-Vorschau-Domain ersetzen.
2. Für jeden der drei Worker: `wrangler deploy --env staging`.
3. Secrets setzen (**eigene** Werte, siehe Schritt 4/5): `wrangler secret put ANTHROPIC_API_KEY --env staging`, `wrangler secret put APP_SECRET --env staging`, `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env staging` (Inhalt der in Schritt 1.5 erzeugten Datei) usw. für die beiden anderen Worker entsprechend ihrer eigenen Secret-Liste.
4. Das `RATE_LIMITER`-Binding für `--env staging` wird von Cloudflare beim ersten `wrangler deploy --env staging` automatisch angelegt (wie in Produktion) – **Pflicht**, da die Routen seit der Phase-10-Sicherheitskorrektur sonst fail-closed sperren.
5. **Phase 11.1:** `AI_WORKER_ORIGIN` in `cloudflare-worker-ki-buerokraft/wrangler.toml` (`[env.staging.vars]`) auf genau denselben Wert wie `ALLOWED_ORIGINS` im Haupt-Worker setzen (die Staging-Vorschau-Domain aus Schritt 2.1) – ohne diese Übereinstimmung scheitert jeder Beleg-Scan (bulkFixReceipts) in Staging mit „Origin nicht erlaubt" (403).

## Schritt 3: Dedizierte Gmail-/Google-Kalender-Testkonten ⏸ Wartet auf Danny

1. Ein **neues**, dediziertes Google-Konto anlegen (kein Alias des echten Geschäftskontos) – z.B. `neuverdrahtet.staging.test@gmail.com`.
2. In der [Google Cloud Console](https://console.cloud.google.com) ein **eigenes** OAuth-Client-Projekt für Staging anlegen (Gmail-API + Calendar-API aktivieren).
3. `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`/`OAUTH_SETUP_SECRET` als Staging-Secrets setzen (siehe Schritt 2.3).
4. Die Google-Verbindung einmalig über `/oauth/authorize?setup_key=<OAUTH_SETUP_SECRET>` auf dem **Staging**-Worker herstellen (mit dem Test-Google-Konto einloggen, NICHT mit dem echten Geschäftskonto).
5. **Phase 11.1 Punkt 4 – Dreiteilung bei Google Kalender (geprüft, siehe `cloudflare-worker/jarvis-tests/test_jarvis_phase11_1_kalender.mjs`):**
   JARVIS unterscheidet strikt drei Kategorien, und nur die letzte ist ein echter, bindender Schreibvorgang:
   1. **Verfügbarkeitsabfrage/Terminabfrage** – `searchCalendarEvents` (direkte, eigene Google-Anbindung des Haupt-Workers, `callGoogleTool`) und `/calendar/availability` über `callGoogleBuero` (für Wartungstermin-Vorschläge) sind reines Lesen (nur GET-Aufrufe gegen die Calendar-API).
   2. **Terminvorschlag** – autonome Wartungstermin-Vorschläge landen ausschließlich in der Firestore-Collection `jarvisTerminVorschlaege` und erzeugen NIEMALS automatisch einen echten Kalendereintrag; ein Mensch prüft und bucht ggf. manuell.
   3. **Tatsächliche Terminbuchung** – das Werkzeug `createAppointment` ist menschlich ausgelöst (Chat) und legt ausschließlich einen internen Werkora-Termin an (`POST /appointments` auf dem KI-Bürokraft-Worker, kein Google-Kalender-Zugriff). Der separate Worker `cloudflare-worker-google-buero` besitzt zwar echte, bindende `createCalendarEvent`/`updateCalendarEvent`-Endpunkte – diese sind aber für eine ANDERE ChatGPT-Action gedacht und über JARVIS' Werkzeugliste (`KI_BUEROKRAFT_TOOLS`) nicht erreichbar; dort existiert kein einziges Kalender-Schreibwerkzeug.
   Alle externen Schreibaktionen (echte Kalenderbuchung, E-Mail-Versand) bleiben damit bis zu ihrer gesonderten Freigabe gesperrt – lokal durch die genannte Testdatei nachgewiesen, nicht nur dokumentiert.

## Schritt 4: Anthropic-API mit begrenztem Testbudget ⏸ Wartet auf Danny

1. In der [Anthropic Console](https://console.anthropic.com) einen **separaten** API-Key für Staging erzeugen (eigener Name, z.B. "neuverdrahtet-staging").
2. Ein niedriges Ausgabenlimit für diesen Key setzen (Anthropic Console → Billing/Limits) – unabhängig vom Produktions-Budget.
3. Als `ANTHROPIC_API_KEY`-Secret auf dem Staging-Worker setzen (siehe Schritt 2.3). Empfehlung: `MODEL_ID = "claude-haiku-4-5"` für Staging-Tests (günstiger, bereits in der Vorlage voreingestellt).
4. `JARVIS_MONATSLIMIT_USD` niedrig setzen (z.B. 5 USD) als zusätzliche automatische Bremse.

## Schritt 5: Synthetische Testdaten

Das Skript `staging/seed-synthetic-data.mjs` (in diesem Repo, siehe Datei) legt ausschließlich klar als Test gekennzeichnete, fiktive Kunden/Anlagen/Angebote/Rechnungen an. Es tut nichts von selbst und verlangt seit Phase 10.1/11 FÜNF unabhängige Bestätigungen, bevor irgendetwas geschrieben wird (Details im Kopfkommentar der Datei) – ein Projektname mit „staging" im Namen allein reicht nicht als Sicherheitsnachweis:

1. `--project <id>` + `--confirm-staging` als CLI-Flags.
2. **(Phase 11, läuft als Erstes)** Sperrliste bekannter PRODUKTIVER Firebase-Projekt-IDs (`PRODUKTIVE_PROJEKT_IDS` im Skript, inkl. der echten, aus `firebase-config.js` importierten Produktions-ID) – ein Treffer bricht sofort ab, unabhängig von allen anderen Flags/Freigaben.
3. Die Projekt-ID in der tatsächlichen `GOOGLE_APPLICATION_CREDENTIALS`-Datei muss exakt mit `--project` übereinstimmen (verhindert eine Verwechslung der Credentials selbst).
4. **Einmalig von Danny im Zielprojekt anzulegen:** das Dokument `_stagingFreigabe/freigabe` muss existieren, z.B. direkt in der Firebase Console unter Firestore, mit den Feldern `{ freigegeben: true, projektId: "neuverdrahtet-staging", freigegebenAm: "<ISO-Datum>", freigegebenVon: "Danny Berger" }`. Das verlagert die eigentliche „ist das wirklich Staging"-Entscheidung in eine bewusste, im Zielsystem selbst hinterlegte Bestätigung statt in einen Kommandozeilen-Text.
5. Automatische Heuristik: existieren in `kunden` bereits Dokumente ohne `istTestdatensatz:true`, bricht das Skript ab (sieht nach echten Daten aus, z.B. ein versehentlich geklontes Projekt).

Getestet gegen den tatsächlichen Skriptprozess (nicht nur gegen die Logik isoliert): `staging/tests/test_seed_guards.mjs` (`node staging/tests/test_seed_guards.mjs`).

Ausführung (NACH Anlegen des Freigabe-Dokuments aus Punkt 3):

```bash
npm install firebase-admin
GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/staging-service-account.json \
  node staging/seed-synthetic-data.mjs --project neuverdrahtet-staging --confirm-staging
```

⏸ **Wartet auf Danny** – nur er hat den in Schritt 1.5 erzeugten Staging-Service-Account-Schlüssel, muss zuvor das Freigabe-Dokument anlegen und sollte diesen Befehl selbst (oder mit seiner ausdrücklichen Freigabe) ausführen.

## Schritt 6: Verwaltungs-Software gegen Staging zeigen lassen

Für echte Browser-/Login-Integrationstests (siehe Phase-10-Bericht, Abschnitt "Echte Integrationstests") muss die Verwaltungs-Software (`verwaltung/`) vorübergehend gegen das Staging-Firebase-Projekt und den Staging-Worker zeigen:
- `verwaltung/js/firebase-config.js`: Staging-Projekt-Werte (Web-API-Key, Projekt-ID usw. aus Schritt 1.6).
- In den App-Einstellungen: `aiWorkerUrl` auf die Staging-Worker-URL, `aiAppSecret` auf das in Schritt 2.3 gesetzte Staging-`APP_SECRET`.

Empfehlung: dafür einen eigenen Lesezweig/eine eigene Vorschau-Bereitstellung nutzen (z.B. GitHub Pages Preview, Cloudflare Pages Preview-Deployment), NICHT die echte `neuverdrahtet.com`-Domain – siehe `ALLOWED_ORIGINS` in Schritt 2.1.

---

## Nach Abschluss von Schritt 1–6

Erst wenn alle sechs Schritte durchgeführt und von Danny als abgeschlossen bestätigt wurden, können die in Abschnitt 3 des Phase-10-Berichts aufgelisteten echten Integrationstests tatsächlich ausgeführt werden. Bis dahin bleiben sie offen – siehe dort.

---

## Was ist lokal geprüft, was erst nach echtem Staging? (Phase 11.1)

Explizite Trennung, damit nicht der Eindruck entsteht, hier wäre mehr geprüft worden, als in dieser Sandbox (kein Cloudflare-/Firebase-/Google-/Anthropic-Zugang) tatsächlich möglich ist:

| Prüfung | Lokal möglich? | Wie/wo |
|---|---|---|
| Firestore-Regeln (Rollen, belegVorschlaege-Härtung, Versionskontrolle) | ✅ Ja | `firestore-tests/rules.test.mjs` + `belegvorschlaege.test.mjs` gegen echten Firestore-Emulator |
| Worker-Logik (Tagescheck-Claim, bulkFixReceipts-Vorschläge, Siri, Uploads) | ✅ Ja | `cloudflare-worker*/jarvis-tests/`, `tests/` - Mock-HTTP gegen den echten Worker-Code |
| Browser-UI (Login-Screen, Mobile-Viewport) | ✅ Ja (eingeschränkt) | `verwaltung/tests/browser-smoke.test.mjs`, echtes Chromium, ohne echtes Backend |
| `wrangler.toml`/`firebase.json`-Syntax | ✅ Ja | `tomllib`/`firebase emulators:exec` validieren Syntax, nicht das reale Deployment |
| Tatsächliche IAM-Rollen eines echten Service-Accounts | ❌ Nein | nur die SOLL-Rollen sind dokumentiert (Abschnitt "Benötigte Rechte") - ob sie in der Google Cloud Console korrekt vergeben wurden, kann nur Danny nach der Einrichtung prüfen |
| Cloudflare Service Bindings zwischen echten `-staging`-Workern | ❌ Nein | Bindings existieren erst nach echtem Deploy aller drei Worker |
| Echte Gmail-/Kalender-OAuth-Verbindung | ❌ Nein | braucht das dedizierte Test-Google-Konto + echten OAuth-Flow |
| Tatsächliches Cron-Verhalten (Cloudflare Scheduled Trigger) | ❌ Nein | der Cron-Trigger selbst existiert erst nach Deploy; lokal nur die aufgerufene Funktion (`runTagescheck`) testbar, nicht der Trigger-Mechanismus |
| Tatsächliche Netzwerk-Isolation (kann Staging wirklich NICHT auf Produktion zugreifen?) | ⚠️ Nur strukturell/durch Code-Review | belegt durch getrennte Projekt-IDs/Worker-Namen (siehe oben), aber nicht durch einen echten Verbindungsversuch - das lässt sich erst mit zwei echten, parallel existierenden Umgebungen wirklich "beweisen" |

Alles in der linken Spalte mit ✅ ist in dieser Sitzung tatsächlich ausgeführt und grün (siehe Abschlussbericht). Alles mit ❌/⚠️ bleibt offen, bis die echte Staging-Umgebung gemäß Schritt 1–6 eingerichtet ist.
