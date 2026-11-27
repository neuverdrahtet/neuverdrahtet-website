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
node selfhost-server/server.js
```

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

## Bekannte Lücken (bewusst noch nicht portiert)

- **Zwei-Faktor-Login (TOTP)** und **"Passwort vergessen"-E-Mail** aus der
  bisherigen Firebase-Auth sind noch nicht nachgebaut. Login per
  E-Mail+Passwort sowie Einladungs-basierte Registrierung (Mitarbeiter/Kunden)
  funktionieren.
- **Push-Benachrichtigungen**: noch nicht fertig nachgebaut (siehe
  `verwaltung/js/push.js` - müsste auf Standard-Web-Push/VAPID umgestellt
  werden statt Firebase Cloud Messaging).
- **Mehrgeräte-Live-Updates** (z.B. sofortiges Erscheinen neuer
  Beleg-Vorschläge auf einem anderen Gerät ohne Neuladen) laufen aktuell per
  einfachem Nachladen statt Firestores Echtzeit-Listenern - im Alltag eines
  Solo-Betriebs meist kein spürbarer Unterschied.
- **Feingranulare Rollen-Rechte** (z.B. dass normale Mitarbeiter keine
  Einkaufspreise im Katalog sehen): aktuell kann jeder angemeldete Nutzer auf
  alle Collections zugreifen - die generische API prüft nur "angemeldet
  ja/nein", nicht die Rolle. Vor einem Einsatz mit mehreren Mitarbeiter-
  Rollen und wirklich sensiblen Daten sollte das nachgerüstet werden.

## Backup

Ein Backup ist eine einzige Datei plus ein Ordner: `data/werkora.db`
(Datenbank) und `data/files/` (Fotos/Dokumente). Beides regelmäßig sichern.
