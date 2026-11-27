# Werkora Selfhost-Server

Lässt die komplette Werkora-App (verwaltung/, techniker/, portal/ + die
öffentliche Website) auf EINEM einzigen Server laufen - ohne Firebase, ohne
externe Datenbank, ohne separaten Storage-Dienst. Alles (Datenbank, Dateien,
Sessions) liegt in einem einzigen Datenordner.

Google Workspace (Gmail/Kalender, für Postfach und Termin-Sync) bleibt davon
unberührt und funktioniert weiterhin wie bisher über die normale
Google-Anmeldung in den Einstellungen - das ist eine bewusst getrennte
Entscheidung, keine Firebase-Abhängigkeit.

## Aktivieren

Die App selbst muss wissen, dass sie mit diesem Server statt mit Firebase
sprechen soll: in `verwaltung/js/selfhost-config.js` `enabled` auf `true`
setzen. Standardmäßig steht das auf `false`, damit die bisherige Firebase/
GitHub-Pages-Variante unverändert weiterläuft, bis hier bewusst umgeschaltet
wird.

## Starten

### Mit Docker (empfohlen - ein Befehl, keine weitere Einrichtung)

Aus dem Repo-Root (nicht aus diesem Ordner):

```
docker build -t werkora -f selfhost-server/Dockerfile .
docker run -d -p 8080:8080 -v werkora-data:/data --name werkora werkora
```

Danach ist die App unter `http://<server-ip>:8080/verwaltung/` erreichbar.
Alle Daten liegen dauerhaft im Docker-Volume `werkora-data` - ein Neustart des
Containers (`docker restart werkora`) verliert nichts.

### Ohne Docker (Node 22+ muss installiert sein)

```
cd selfhost-server && npm install && node server.js
```

(`npm install` wird nur für Push-Benachrichtigungen gebraucht - die einzige
externe Abhängigkeit des ganzen Servers, siehe `package.json`.)

## Erstes Login

Beim allerersten Start wird automatisch ein Admin-Konto angelegt. Die
Zugangsdaten erscheinen EINMALIG in der Konsolenausgabe (`docker logs werkora`
bzw. die Terminal-Ausgabe beim direkten Start) - bitte sofort notieren. Danach
in der App ganz normal unter E-Mail+Passwort anmelden.

Wer eigene Zugangsdaten statt der zufällig erzeugten will, setzt vor dem
allerersten Start `ADMIN_EMAIL` und `ADMIN_PASSWORD` als Umgebungsvariablen
(z.B. `docker run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... ...`).

## Bestehende Firebase-Daten übernehmen

Wer schon länger mit der Firebase-Variante arbeitet, muss die Daten einmalig
herüberholen, bevor umgeschaltet wird (siehe "Aktivieren" oben):

1. In der Firebase Console: Projekteinstellungen -> Dienstkonten -> "Neuen
   privaten Schlüssel generieren" - lädt eine JSON-Datei herunter. Diese
   Datei NIE ins Repo einchecken oder sonst wo veröffentlichen, nur lokal
   verwenden und danach löschen.
2. Vorschau (schreibt noch nichts, zeigt nur Anzahlen je Collection):
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/service-account.json \
     node selfhost-server/migrate-from-firebase.mjs --project neuverdrahtet-verwaltung --dry-run
   ```
3. Wenn die Vorschau plausibel aussieht, denselben Befehl ohne `--dry-run`
   ausführen - überträgt alle Collections in `data/werkora.db`.

`--project` muss exakt mit der `project_id` in der Service-Account-Datei
übereinstimmen (Schutz gegen ein vertipptes/verwechseltes Projekt). Das
Skript liest nur aus Firestore, schreibt/löscht dort nichts.

Mitarbeiter-/Kundenportal-Konten lassen sich dabei NICHT mit Passwort
übernehmen (Firebase gibt Passwort-Hashes grundsätzlich nicht heraus) -
jede betroffene Person bekommt stattdessen automatisch eine neue Einladung
und registriert sich einmalig neu. Das Skript listet am Ende alle
betroffenen E-Mail-Adressen auf.

## Konfiguration (alles optional)

| Variable         | Standard              | Bedeutung                                   |
|------------------|------------------------|---------------------------------------------|
| `PORT`           | `8080`                | Port, auf dem der Server lauscht            |
| `DATA_DIR`       | `./data`              | Ordner für Datenbank, Dateien, Session-Key  |
| `ADMIN_EMAIL`    | `admin@werkora.local` | Nur beim allerersten Start relevant         |
| `ADMIN_PASSWORD` | zufällig erzeugt      | Nur beim allerersten Start relevant         |
| `PUSH_CONTACT_EMAIL` | `ADMIN_EMAIL`     | Kontaktadresse für Push-Dienste (VAPID "mailto:") |

Die VAPID-Schlüssel für Push-Benachrichtigungen werden beim allerersten
Start automatisch erzeugt und in `data/vapid-keys.json` abgelegt - kein
manueller Schritt nötig.

## Push-Benachrichtigungen (Web-Push statt Firebase Cloud Messaging)

Funktioniert mit jedem Browser, der die Standard-Push-API unterstützt (kein
Google/Firebase-Konto nötig). Server-seitig verifiziert (VAPID-Schlüssel
erzeugen/laden, Senden inkl. Entfernen abgelaufener Geräte bei einer
410-Antwort des Push-Dienstes). Der eigentliche Browser-Teil
(`pushManager.subscribe()`) folgt dem etablierten Standardmuster, ließ sich
in der Entwicklungsumgebung dieses Projekts aber nicht vollständig
ausprobieren (abgeschottete Netzwerkumgebung ohne Zugriff auf echte
Push-Dienste) - bitte nach dem ersten Einsatz einmal mit einem echten
Gerät/Browser unter Einstellungen -> Benachrichtigungen prüfen.

## Sicherheit

Nach einer gezielten Review folgender Fixes umgesetzt (siehe
`selfhost-server/lib/access.js`, `lib/rateLimit.js`, `lib/auth.js`,
`server.js`):

- **Rollenbasierte Zugriffskontrolle** für die generische Collection-API
  (`lib/access.js`): Kundenportal-Konten (Rolle "kunde") können nur lesen,
  nur aus einer festen Liste relevanter Collections (Angebote/Rechnungen/
  Aufträge/Termine/...) und darin nur eigene Datensätze - weder Listen- noch
  Einzelabruf lässt fremde Daten durch. Mitarbeiter/Techniker kommen nicht an
  Personaldaten, Einkaufspreise oder Finanzbuchhaltung heran. **Das ist eine
  bewusst unvollständige Übergangslösung**, keine vollständige Nachbildung
  der früheren, feingranularen firestore.rules - Rollen "büro"/"mitarbeiter"/
  "techniker" haben hier spürbar mehr Zugriff, als ihnen die Firestore-Regeln
  einräumen würden (z.B. sehen sie auch Kundendaten/Projekte anderer
  Kollegen, nicht nur die eigenen Aufgaben/Serviceaufträge).
- **Brute-Force-Schutz beim Login** (`lib/rateLimit.js`): nach 5
  Fehlversuchen zu einer E-Mail-Adresse 5 Minuten Sperre.
- **Mindestlänge für Passwörter** (8 Zeichen) wird jetzt auch serverseitig
  geprüft, nicht nur im Browser-Formular.
- **Obergrenze für jede Anfrage** (30 MB) - verhindert, dass ein direkter
  API-Aufruf (am UI vorbei) den Server mit einer riesigen Anfrage in die
  Knie zwingt.
- Session-Cookie-Signatur wird jetzt zeitkonstant verglichen (wie der
  Passwort-Hash), nicht mehr mit einem normalen String-Vergleich.

## Bekannte Lücken (bewusst noch nicht portiert)

- **Zwei-Faktor-Login (TOTP)** und **"Passwort vergessen"-E-Mail** aus der
  bisherigen Firebase-Auth sind noch nicht nachgebaut. Login per
  E-Mail+Passwort sowie Einladungs-basierte Registrierung (Mitarbeiter/Kunden)
  funktionieren.
- **Mehrgeräte-Live-Updates** (z.B. sofortiges Erscheinen neuer
  Beleg-Vorschläge auf einem anderen Gerät ohne Neuladen) laufen aktuell per
  einfachem Nachladen statt Firestores Echtzeit-Listenern - im Alltag eines
  Solo-Betriebs meist kein spürbarer Unterschied.
- **Feingranulare Rollen-Rechte darüber hinaus**: siehe "Sicherheit" oben -
  der grobe Blockzugriff für Mitarbeiter/Techniker/Kundenportal ist
  nachgerüstet, eine vollständige 1:1-Entsprechung der bisherigen
  firestore.rules (inkl. feld-/einzelfallgenauer Regeln je Rolle) nicht.

## Backup

Ein Backup ist eine einzige Datei plus ein Ordner: `data/werkora.db`
(Datenbank) und `data/files/` (Fotos/Dokumente). Beides regelmäßig sichern.
