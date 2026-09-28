# JARVIS mit Hermes Agent

Persönlicher Sprachassistent: [Hermes Agent](https://github.com/NousResearch/hermes-agent) als Gehirn
(über dein ChatGPT-Abo per OAuth), ein eigenes Dashboard mit orange-goldenem Kern, deutsche
Spracheingabe über das Browser-Mikrofon und Sprachausgabe über ElevenLabs.

> Dieser Ordner liegt nur auf dem Branch `claude/jarvis-hermes-setup-2nsqrk` und gehört nicht zur
> Firmenwebsite. Bitte **nicht** in `main` mergen, sonst würde er mit der Website veröffentlicht.

## Installation (Laptop, macOS oder Linux)

Terminal öffnen und einfügen:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/claude/jarvis-hermes-setup-2nsqrk/jarvis/install.sh)
```

Das Skript führt dich durch 7 Schritte: Hermes installieren → ChatGPT-Anmeldung (Link + Code) →
Persona & lokale API → Dashboard + Passwort → ElevenLabs (optional) → Autostart → HTTPS & Test.
Es kann jederzeit erneut laufen. Mit `JARVIS_NEW_PASSWORD=1`, `JARVIS_NEW_VOICE=1` oder
`JARVIS_RELOGIN=1` davor setzt du einzelne Schritte neu.

## Aufbau

```
Browser (Mikrofon, Lautsprecher)
   │  HTTPS (Tailscale) oder http://localhost
   ▼
JARVIS-Dashboard  ~/.jarvis/app/server.py   Port 8787, Passwort-Anmeldung
   ├─► Hermes API-Server  127.0.0.1:8642  ─►  ChatGPT-Abo (openai-codex)
   └─► ElevenLabs Text-to-Speech (Key bleibt auf dem Server)
```

Zugangsdaten liegen in `~/.jarvis/jarvis.env` und `~/.hermes/.env` (beide `chmod 600`); das
Passwort wird nur als scrypt-Hash gespeichert. Der Hermes-API-Server lauscht nur lokal.

## Bedienung

- **Gespräch beginnen** (unten mittig) – Mikrofon erlauben, dann einfach sprechen. Nach einer
  kurzen Sprechpause schickt JARVIS die Frage automatisch ab.
- **Unterbrechen** – einfach dazwischenreden, auf den Kern tippen oder `Esc` drücken.
- **Chat rechts** – tippen statt sprechen; auf dem Handy über den Knopf **Chat** einblenden.
- **Ton an/aus** – Sprachausgabe stummschalten, Antworten erscheinen weiter im Chat.
- **Gespräch beenden** – Mikrofon aus.
- Ausgehende Nachrichten (E-Mail, Telegram, Einladungen …) sendet JARVIS nur nach deinem
  ausdrücklichen „Ja, senden“.

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
| Hermes aktualisieren | `hermes update` |
