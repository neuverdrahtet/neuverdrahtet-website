# Werkora Selfhost-Server

Lässt die komplette Werkora-App (verwaltung/, techniker/, portal/ + die
öffentliche Website) auf EINEM einzigen Server laufen - ohne Firebase, ohne
externe Datenbank, ohne separaten Storage-Dienst. Alles (Datenbank, Dateien,
Sessions) liegt in einem einzigen Datenordner.

Google Workspace (Gmail/Kalender, für Postfach und Termin-Sync) bleibt davon
unberührt und funktioniert weiterhin wie bisher über die normale
Google-Anmeldung in den Einstellungen - das ist eine bewusst getrennte
Entscheidung, keine Firebase-Abhängigkeit.

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
- **Datenübernahme aus dem bestehenden Firebase-Projekt**: noch kein
  automatisches Migrationsskript vorhanden - nötig, bevor auf den Selfhost-
  Server umgestiegen werden kann, ohne die bisherigen Daten zu verlieren.

## Backup

Ein Backup ist eine einzige Datei plus ein Ordner: `data/werkora.db`
(Datenbank) und `data/files/` (Fotos/Dokumente). Beides regelmäßig sichern.
