#!/usr/bin/env bash
# JARVIS mit Hermes Agent – Installer für macOS und Linux (auch WSL2).
# Aufruf:  bash <(curl -fsSL https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/claude/jarvis-hermes-setup-2nsqrk/jarvis/install.sh)
# Das Skript kann gefahrlos mehrfach laufen; vorhandene Einstellungen werden wiederverwendet.
set -euo pipefail

BRANCH="${JARVIS_BRANCH:-claude/jarvis-hermes-setup-2nsqrk}"
RAW="https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/${BRANCH}/jarvis"
JARVIS_HOME="${JARVIS_HOME:-$HOME/.jarvis}"
APP="$JARVIS_HOME/app"
ENVF="$JARVIS_HOME/jarvis.env"
PORT="${JARVIS_PORT:-8787}"
export PATH="$HOME/.local/bin:$PATH"

gold=$'\e[38;5;214m'; ok=$'\e[32m'; bad=$'\e[31m'; dim=$'\e[2m'; off=$'\e[0m'
step() { printf '\n%s━━ %s ━━%s\n' "$gold" "$1" "$off"; }
info() { printf '  %s\n' "$1"; }
good() { printf '  %s✔%s %s\n' "$ok" "$off" "$1"; }
fail() { printf '  %s✘ %s%s\n' "$bad" "$1" "$off"; exit 1; }
ask()  { local r; read -r -p "  $1 " r </dev/tty; printf '%s' "$r"; }
asks() { local r; read -r -s -p "  $1 " r </dev/tty; echo >/dev/tty; printf '%s' "$r"; }
envget() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- || true; }
envset() {
  touch "$ENVF"; chmod 600 "$ENVF"
  local tmp; tmp="$(mktemp)"; grep -vE "^$1=" "$ENVF" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"; mv "$tmp" "$ENVF"; chmod 600 "$ENVF"
}

OS="$(uname -s)"; WSL=0
grep -qi microsoft /proc/version 2>/dev/null && WSL=1
case "$OS" in Darwin|Linux) ;; *) fail "Nicht unterstütztes System: $OS (Windows bitte über WSL2)";; esac
mkdir -p "$APP/public"; chmod 700 "$JARVIS_HOME"

# ---------------------------------------------------------------- 1. Hermes
step "1/7 Hermes Agent installieren"
if command -v hermes >/dev/null 2>&1; then
  good "Hermes ist bereits installiert: $(hermes --version 2>/dev/null | head -1)"
else
  info "Starte den offiziellen Installer von Nous Research …"
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  command -v hermes >/dev/null 2>&1 || fail "hermes nicht gefunden. Neues Terminal öffnen und Skript erneut starten."
  good "Hermes installiert."
fi

# ---------------------------------------------------------------- 2. Modell
step "2/7 ChatGPT-Abo verbinden (OAuth) und Modell wählen"
provider="$(hermes config get model.provider --raw 2>/dev/null || true)"
if [ "$provider" = "openai-codex" ] && [ "${JARVIS_RELOGIN:-0}" != "1" ]; then
  good "ChatGPT-Abo ist bereits verbunden (Anbieter openai-codex)."
else
  cat <<EOF
  Gleich öffnet sich der Hermes-Modellassistent. Dort:
    1. ${gold}ChatGPT or Codex Subscription${off} auswählen
    2. Den angezeigten Link im Browser öffnen, mit deinem OpenAI-Konto anmelden
       und den angezeigten Code eingeben
    3. In der Modellliste ein ${gold}gpt-6-…${off}-Modell wählen (z. B. gpt-6-sol), falls
       es für dein Abo angeboten wird. Die Liste kommt live von OpenAI – was dort
       nicht steht, ist für dein Abo nicht freigeschaltet.
EOF
  ask "Enter drücken, um zu starten …" >/dev/null
  hermes model </dev/tty
fi
MODEL="$(hermes config get model.default --raw 2>/dev/null || true)"
info "Eingestelltes Modell: ${MODEL:-unbekannt}"
info "Teste eine echte Antwort …"
answer="$(hermes -z 'Antworte exakt mit diesem Satz und sonst nichts: JARVIS ist online.' 2>&1 || true)"
printf '  %sAntwort:%s %s\n' "$dim" "$off" "$answer"
case "$answer" in *[Oo]nline*) good "Modellzugriff funktioniert.";; *) fail "Keine gültige Antwort. Bitte 'hermes model' erneut ausführen und die Ausgabe an Claude schicken.";; esac
envset JARVIS_MODEL_LABEL "$MODEL"

# ---------------------------------------------------------------- 3. Persona + API
step "3/7 JARVIS-Persönlichkeit und lokale API einrichten"
HH="${HERMES_HOME:-$HOME/.hermes}"
if ! grep -q "JARVIS-PERSONA" "$HH/SOUL.md" 2>/dev/null; then
  curl -fsSL "$RAW/SOUL.md" >> "$HH/SOUL.md"
  good "Persona in $HH/SOUL.md ergänzt."
else good "Persona bereits vorhanden."; fi

API_KEY="$(envget HERMES_API_KEY)"
[ -n "$API_KEY" ] || API_KEY="$(openssl rand -hex 32)"
hermes config set API_SERVER_ENABLED true >/dev/null
hermes config set API_SERVER_HOST 127.0.0.1 >/dev/null
hermes config set API_SERVER_KEY "$API_KEY" >/dev/null
# Webhook/API-Sitzungen dürfen gefährliche Befehle nie ohne Mensch ausführen
hermes config set approvals.unattended_mode deny >/dev/null
envset HERMES_API_KEY "$API_KEY"
envset HERMES_API_URL "http://127.0.0.1:8642"
chmod 600 "$HH/.env" 2>/dev/null || true
good "API-Server nur lokal (127.0.0.1:8642), Schlüssel geschützt gespeichert."

if [ "$WSL" = 1 ]; then
  info "WSL erkannt: Hermes-Gateway läuft in tmux statt als Dienst."
  tmux has-session -t hermes 2>/dev/null || tmux new -d -s hermes 'hermes gateway run'
else
  hermes gateway install >/dev/null 2>&1 || true
  hermes gateway restart >/dev/null 2>&1 || hermes gateway start
fi
for _ in $(seq 1 30); do curl -fsS -o /dev/null -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8642/v1/models && break; sleep 1; done
curl -fsS -o /dev/null -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8642/v1/models \
  && good "Hermes-Gateway läuft mit Autostart." || fail "Hermes-API antwortet nicht. 'hermes gateway status' ausführen und Ausgabe an Claude schicken."

# ---------------------------------------------------------------- 4. Dashboard
step "4/7 Dashboard herunterladen"
for f in server.py public/index.html public/style.css public/app.js public/login.html public/login.css public/login.js public/favicon.svg; do
  curl -fsSL "$RAW/app/$f" -o "$APP/$f"
done
PY=""
for c in python3 "$HH/hermes-agent/venv/bin/python" "$HH/hermes-agent/.venv/bin/python"; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || fail "Kein Python ≥ 3.9 gefunden (macOS: 'xcode-select --install')."
good "Dashboard-Dateien in $APP (Python: $PY)"

if [ -z "$(envget JARVIS_PASSWORD_HASH)" ] || [ "${JARVIS_NEW_PASSWORD:-0}" = 1 ]; then
  while :; do
    p1="$(asks 'Dashboard-Passwort festlegen (mind. 10 Zeichen):')"
    p2="$(asks 'Passwort wiederholen:')"
    [ "$p1" = "$p2" ] && [ "${#p1}" -ge 10 ] && break
    info "Stimmt nicht überein oder zu kurz – nochmal."
  done
  envset JARVIS_PASSWORD_HASH "$(printf '%s\n' "$p1" | "$PY" "$APP/server.py" hash-password)"
  envset JARVIS_SESSION_SECRET "$(openssl rand -hex 32)"
  good "Passwort gespeichert (nur als scrypt-Hash)."
else
  good "Passwort bereits gesetzt (neu setzen: JARVIS_NEW_PASSWORD=1)."
fi
envset JARVIS_PORT "$PORT"

# ---------------------------------------------------------------- 5. Stimme
step "5/7 Deutsche Stimme mit ElevenLabs (optional)"
if [ -n "$(envget ELEVENLABS_API_KEY)" ] && [ "${JARVIS_NEW_VOICE:-0}" != 1 ]; then
  good "ElevenLabs bereits verbunden (neu: JARVIS_NEW_VOICE=1)."
else
  cat <<EOF
  ${gold}Kosten vorab:${off} ElevenLabs rechnet nach Zeichen der Sprachausgabe ab.
  Der Gratis-Plan reicht zum Testen, erlaubt aber kein Stimmenklonen; Instant
  Voice Cloning braucht mindestens den Starter-Plan. Aktuelle Preise:
  https://elevenlabs.io/pricing – JARVIS nutzt das günstige Modell
  eleven_flash_v2_5. Ohne ElevenLabs spricht JARVIS mit der kostenlosen
  Browser-Stimme.

  So kommst du an die Daten:
    1. elevenlabs.io → Voices → eine Stimme aus der Voice Library wählen
       (Filter: Deutsch, z. B. „britisch, ruhig, Butler“) ODER eigene Stimme
       per Instant Voice Clone anlegen – nur mit Aufnahmen, für die du die
       Rechte bzw. die Einwilligung der sprechenden Person hast.
    2. Bei der Stimme auf „ID kopieren“ → das ist die Voice ID.
    3. Profil → API Keys → neuen Schlüssel erstellen (Berechtigung
       „Text to Speech“ genügt).
EOF
  use="$(ask 'ElevenLabs jetzt verbinden? [j/N]')"
  if [[ "$use" =~ ^[jJyY] ]]; then
    k="$(asks 'ElevenLabs API-Key (Eingabe unsichtbar):')"
    v="$(ask 'Voice ID:')"
    code="$(curl -s -o /dev/null -w '%{http_code}' -H "xi-api-key: $k" "https://api.elevenlabs.io/v1/voices/$v")"
    if [ "$code" = 200 ]; then
      envset ELEVENLABS_API_KEY "$k"; envset ELEVENLABS_VOICE_ID "$v"; envset ELEVENLABS_MODEL eleven_flash_v2_5
      good "Stimme gefunden und verbunden."
    else
      info "${bad}ElevenLabs antwortet mit HTTP $code – Key oder Voice ID prüfen. Weiter mit Browser-Stimme.${off}"
    fi
  else info "Übersprungen – Browser-Stimme aktiv."; fi
fi

# ---------------------------------------------------------------- 6. Autostart
step "6/7 Autostart einrichten"
if [ "$OS" = Darwin ]; then
  PL="$HOME/Library/LaunchAgents/de.jarvis.dashboard.plist"
  mkdir -p "$(dirname "$PL")" "$JARVIS_HOME/logs"
  cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>de.jarvis.dashboard</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$APP/server.py</string></array>
  <key>EnvironmentVariables</key><dict><key>JARVIS_HOME</key><string>$JARVIS_HOME</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$JARVIS_HOME/logs/dashboard.log</string>
  <key>StandardErrorPath</key><string>$JARVIS_HOME/logs/dashboard.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/de.jarvis.dashboard" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PL"
elif [ "$WSL" = 1 ]; then
  tmux kill-session -t jarvis 2>/dev/null || true
  tmux new -d -s jarvis "JARVIS_HOME=$JARVIS_HOME $PY $APP/server.py"
  info "WSL: nach einem Neustart 'bash ~/.jarvis/start-wsl.sh' ausführen."
  printf '#!/bin/sh\ntmux has-session -t hermes 2>/dev/null || tmux new -d -s hermes "hermes gateway run"\ntmux has-session -t jarvis 2>/dev/null || tmux new -d -s jarvis "JARVIS_HOME=%s %s %s/server.py"\n' "$JARVIS_HOME" "$PY" "$APP" > "$JARVIS_HOME/start-wsl.sh"
else
  UD="$HOME/.config/systemd/user"; mkdir -p "$UD"
  cat > "$UD/jarvis-dashboard.service" <<EOF
[Unit]
Description=JARVIS Dashboard
After=network-online.target

[Service]
Environment=JARVIS_HOME=$JARVIS_HOME
ExecStart=$PY $APP/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now jarvis-dashboard.service
  systemctl --user restart jarvis-dashboard.service
  loginctl enable-linger "$USER" 2>/dev/null || info "Tipp: 'sudo loginctl enable-linger $USER' startet JARVIS auch ohne Anmeldung."
fi
for _ in $(seq 1 15); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz" && break; sleep 1; done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz" && good "Dashboard läuft und startet automatisch." \
  || fail "Dashboard startet nicht. Log: $JARVIS_HOME/logs/dashboard.log"

# ---------------------------------------------------------------- 7. HTTPS + Test
step "7/7 HTTPS fürs Handy und Abschlusstest"
URL="http://localhost:$PORT"
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null
  TS="$(tailscale status --json | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
  good "HTTPS über Tailscale aktiv (nur deine eigenen Geräte): https://$TS"
  URL="https://$TS"
else
  info "Für Zugriff vom Handy mit echtem HTTPS-Zertifikat: Tailscale installieren"
  info "(https://tailscale.com/download, kostenlos für Privatnutzung), auf Laptop und"
  info "Handy anmelden, in der Tailscale-Admin-Konsole unter DNS „HTTPS Certificates“"
  info "aktivieren und dieses Skript erneut ausführen. Am Laptop selbst reicht $URL"
  info "(localhost gilt im Browser als sicher, Mikrofon funktioniert)."
fi

CJ="$(mktemp)"; trap 'rm -f "$CJ"' EXIT
tp="$(asks 'Zum Abschlusstest einmal das Dashboard-Passwort eingeben:')"
curl -s -c "$CJ" -o /dev/null --data-urlencode "password=$tp" "http://127.0.0.1:$PORT/login"
grep -q jarvis_session "$CJ" && good "Anmeldung funktioniert." || fail "Anmeldung fehlgeschlagen."
st="$(curl -s -b "$CJ" "http://127.0.0.1:$PORT/api/status")"; info "Status: $st"
reply="$(curl -sN -b "$CJ" -H 'X-Jarvis: 1' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Sag in einem kurzen Satz Hallo."}]}' \
  "http://127.0.0.1:$PORT/api/chat" | grep -o '"content": *"[^"]*"' | head -20 | sed 's/.*: *"//; s/"$//' | tr -d '\n')"
[ -n "$reply" ] && good "Chat über das Dashboard: $reply" || fail "Chat-Test ohne Antwort."
if [ -n "$(envget ELEVENLABS_API_KEY)" ]; then
  n="$(curl -s -b "$CJ" -H 'X-Jarvis: 1' -H 'Content-Type: application/json' -d '{"text":"Systeme online."}' \
    "http://127.0.0.1:$PORT/api/tts" | wc -c | tr -d ' ')"
  [ "$n" -gt 2000 ] && good "ElevenLabs-Sprachausgabe liefert Audio ($n Bytes)." || info "${bad}ElevenLabs lieferte kein Audio – Kontingent/Key prüfen.${off}"
fi

cat <<EOF

${gold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${off}
  JARVIS ist bereit:  ${gold}$URL${off}
  Modell: ${MODEL:-?}   ·   Stimme: $( [ -n "$(envget ELEVENLABS_API_KEY)" ] && echo ElevenLabs || echo Browser )
  Zugangsdaten: $ENVF (nur für dich lesbar)
${gold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${off}
  Bitte kopiere die komplette Ausgabe dieses Fensters und schicke sie an Claude.
EOF
