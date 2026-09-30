# JARVIS mit Hermes Agent

Persönlicher Sprachassistent: [Hermes Agent](https://github.com/NousResearch/hermes-agent) als Gehirn
(über dein ChatGPT-Abo per OAuth), ein eigenes Dashboard mit orange-goldenem Kern, deutsche
Spracheingabe über das Browser-Mikrofon und Sprachausgabe über ElevenLabs.

> Dieser Ordner liegt nur auf dem Branch `claude/jarvis-hermes-setup-2nsqrk` und gehört nicht zur
> Firmenwebsite. Bitte **nicht** in `main` mergen, sonst würde er mit der Website veröffentlicht.

## Installation

**Windows 10/11:** Startmenü → „PowerShell“ öffnen (keine Adminrechte nötig) und einfügen:

```powershell
irm https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/claude/jarvis-hermes-setup-2nsqrk/jarvis/install.ps1 | iex
```

**macOS / Linux:** Terminal öffnen und einfügen:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/claude/jarvis-hermes-setup-2nsqrk/jarvis/install.sh)
```

Das Skript führt dich durch 8 Schritte: Hermes installieren → ChatGPT-Anmeldung (Link + Code) →
Persona, lokale API & Freigabe-Sperre → Notizordner (Obsidian) → Gmail + Google Kalender →
Dashboard, Passwort & ElevenLabs (optional) → Autostart → HTTPS & Test echter Abläufe.
Es kann jederzeit erneut laufen. Mit `JARVIS_NEW_PASSWORD=1`, `JARVIS_NEW_VOICE=1` oder
`JARVIS_RELOGIN=1` davor setzt du einzelne Schritte neu.

## Aufbau

```
Browser (Mikrofon, Lautsprecher)
   │  HTTPS (Tailscale) oder http://localhost
   ▼
JARVIS-Dashboard  ~/.jarvis/app/server.py   Port 8787, Passwort-Anmeldung
   ├─► Hermes API-Server  127.0.0.1:8642  ─►  ChatGPT-Abo (openai-codex)
   │      ├─ Skill google-workspace  → Gmail, Google Kalender
   │      ├─ Skill obsidian          → Notizordner (Markdown)
   │      └─ Plugin jarvis-guard     → hält ausgehende Aktionen bis zur Freigabe an
   └─► ElevenLabs Text-to-Speech (Key bleibt auf dem Server)
```

Unter Windows liegen die Hermes-Daten in `%LOCALAPPDATA%\hermes`, JARVIS in `%USERPROFILE%\.jarvis`.

### Freigabe ausgehender Aktionen

Das Plugin `jarvis-guard` (`hermes-plugin/jarvis-guard`) prüft jeden Werkzeugaufruf. Mails senden
oder beantworten, Kalendereinladungen an Gäste, Termine löschen und `send_message` werden
blockiert und im Dashboard als Karte **„Freigabe nötig“** mit Empfänger und Text angezeigt.
Erst nach **Freigeben** darf JARVIS genau diesen Aufruf einmal ausführen (15 Minuten gültig);
jede Änderung am Text braucht eine neue Freigabe. Lesen, Suchen, Entwürfe und eigene Termine
ohne Gäste gehen ohne Rückfrage.

Zugangsdaten liegen in `~/.jarvis/jarvis.env` und `~/.hermes/.env` (beide `chmod 600`); das
Passwort wird nur als scrypt-Hash gespeichert. Der Hermes-API-Server lauscht nur lokal.

## Bedienung

- **Gespräch beginnen** (unten mittig) – Mikrofon erlauben, dann einfach sprechen. Nach einer
  kurzen Sprechpause schickt JARVIS die Frage automatisch ab.
- **Unterbrechen** – einfach dazwischenreden, auf den Kern tippen oder `Esc` drücken.
- **Chat rechts** – tippen statt sprechen; auf dem Handy über den Knopf **Chat** einblenden.
- **Ton an/aus** – Sprachausgabe stummschalten, Antworten erscheinen weiter im Chat.
- **Gespräch beenden** – Mikrofon aus.
- Ausgehende Nachrichten (E-Mail, Einladungen …) erscheinen als Karte im Chat – erst dein Tipp
  auf **Freigeben** schickt sie ab.
- Beispiele: „Was steht heute in meinem Kalender?“, „Fasse meine ungelesenen Mails zusammen“,
  „Notiere: Kunde Müller will Angebot für Wallbox“, „Entwirf eine Antwort an …“.

Spracheingabe nutzt die Spracherkennung des Browsers: Chrome, Edge und Safari funktionieren,
Firefox nicht. Mit Kopfhörern klappt das Unterbrechen am zuverlässigsten.

## Wartung

| Aufgabe | Befehl |
|---|---|
| Status | `hermes status` · `hermes gateway status` |
| Modell wechseln | `hermes model` |
| Dashboard-Log (macOS) | `tail -f ~/.jarvis/logs/dashboard.log` |
| Dashboard neu starten (macOS) | `launchctl kickstart -k gui/$(id -u)/de.jarvis.dashboard` |
| Dashboard neu starten (Linux) | `systemctl --user restart jarvis-dashboard` |
| Hermes aktualisieren | `hermes update` (danach Installer erneut starten) |
| Dashboard neu starten (Windows) | Abmelden/Anmelden oder Installer erneut starten |
| Google trennen | `python …\google-workspace\scripts\setup.py --revoke` |
