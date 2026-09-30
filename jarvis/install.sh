#!/usr/bin/env bash
# JARVIS mit Hermes Agent – Installer für macOS und Linux (Windows: install.ps1).
# Aufruf:  bash <(curl -fsSL https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/claude/jarvis-hermes-setup-2nsqrk/jarvis/install.sh)
# Kann gefahrlos mehrfach laufen.
set -euo pipefail

BRANCH="${JARVIS_BRANCH:-claude/jarvis-hermes-setup-2nsqrk}"
RAW="https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/${BRANCH}/jarvis"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
JARVIS_HOME="${JARVIS_HOME:-$HOME/.jarvis}"
export PATH="$HOME/.local/bin:$PATH"

gold=$'\e[38;5;214m'; ok=$'\e[32m'; bad=$'\e[31m'; off=$'\e[0m'
step() { printf '\n%s━━ %s ━━%s\n' "$gold" "$1" "$off"; }
info() { printf '  %s\n' "$1"; }
good() { printf '  %s✔%s %s\n' "$ok" "$off" "$1"; }
fail() { printf '  %s✘ %s%s\n' "$bad" "$1" "$off"; exit 1; }

step "1/8 Hermes Agent installieren"
if ! command -v hermes >/dev/null 2>&1; then
  info "Starte den offiziellen Installer von Nous Research …"
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  command -v hermes >/dev/null 2>&1 || fail "hermes nicht gefunden. Neues Terminal öffnen und erneut starten."
fi
good "Hermes: $(hermes --version 2>/dev/null | head -1)"

step "2/8 ChatGPT-Abo verbinden (OAuth) und Modell wählen"
if [ "$(hermes config get model.provider --raw 2>/dev/null || true)" = "openai-codex" ] && [ "${JARVIS_RELOGIN:-0}" != 1 ]; then
  good "ChatGPT-Abo ist bereits verbunden (openai-codex)."
else
  info "Gleich startet der Hermes-Modellassistent. Dort:"
  info "  1. ${gold}ChatGPT or Codex Subscription${off} auswählen"
  info "  2. Den Link im Browser öffnen, mit dem OpenAI-Konto anmelden, Code eingeben"
  info "  3. Ein gpt-6-…-Modell wählen (z. B. gpt-6-sol), falls angeboten – die Liste"
  info "     kommt live von OpenAI; was fehlt, ist für dein Abo nicht freigeschaltet."
  read -r -p "  Enter drücken, um zu starten … " _ </dev/tty
  hermes model </dev/tty
fi
info "Eingestelltes Modell: $(hermes config get model.default --raw 2>/dev/null || true)"
answer="$(hermes -z 'Antworte exakt mit diesem Satz und sonst nichts: JARVIS ist online.' 2>&1 || true)"
info "Antwort: $answer"
case "$answer" in *online*) good "Modellzugriff funktioniert.";; *) fail "Keine gültige Antwort. 'hermes model' erneut ausführen.";; esac

PY=""
if [ -f "$HERMES_HOME/hermes-agent/activate" ]; then
  # shellcheck disable=SC1091
  set +u; . "$HERMES_HOME/hermes-agent/activate" >/dev/null; set -u
  PY="$(command -v python3 || command -v python || true)"
fi
[ -n "$PY" ] || PY="$(command -v python3 || true)"
[ -n "$PY" ] || fail "Python von Hermes nicht gefunden – 'hermes doctor' ausführen."

mkdir -p "$JARVIS_HOME"
curl -fsSL "$RAW/jarvis_setup.py" -o "$JARVIS_HOME/jarvis_setup.py"
HERMES_BIN="$(command -v hermes)" HERMES_HOME="$HERMES_HOME" JARVIS_RAW="$RAW" "$PY" "$JARVIS_HOME/jarvis_setup.py" </dev/tty
