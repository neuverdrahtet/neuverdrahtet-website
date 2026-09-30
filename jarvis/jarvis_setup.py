#!/usr/bin/env python3
"""JARVIS-Einrichtung (Windows, macOS, Linux).

Wird von install.ps1 / install.sh aufgerufen, nachdem Hermes installiert und das ChatGPT-Abo
verbunden ist. Läuft mit dem Python von Hermes. Nur Standardbibliothek.

Umgebungsvariablen vom Startskript:
  HERMES_BIN   Pfad zur hermes-Programmdatei
  HERMES_HOME  Hermes-Datenordner (~/.hermes bzw. %LOCALAPPDATA%\\hermes)
  JARVIS_RAW   Basis-URL der JARVIS-Dateien (raw.githubusercontent.com/…/jarvis)
"""

import getpass
import http.cookiejar
import importlib.util
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

WINDOWS = os.name == "nt"
MAC = sys.platform == "darwin"
HOME = Path.home()
HERMES = os.environ.get("HERMES_BIN") or shutil.which("hermes") or "hermes"
HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (
    Path(os.environ["LOCALAPPDATA"]) / "hermes" if WINDOWS else HOME / ".hermes"))
RAW = os.environ.get("JARVIS_RAW", "").rstrip("/")
JARVIS_HOME = Path(os.environ.get("JARVIS_HOME") or HOME / ".jarvis")
APP = JARVIS_HOME / "app"
ENVF = JARVIS_HOME / "jarvis.env"
PORT = int(os.environ.get("JARVIS_PORT", "8787"))
BASE = f"http://127.0.0.1:{PORT}"
PY = Path(sys.executable)

if WINDOWS:
    os.system("")  # ANSI-Farben in der Windows-Konsole aktivieren
GOLD, OK, BAD, DIM, OFF = "\033[38;5;214m", "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def step(t): print(f"\n{GOLD}━━ {t} ━━{OFF}")
def info(t): print(f"  {t}")
def good(t): print(f"  {OK}✔{OFF} {t}")
def warn(t): print(f"  {BAD}!{OFF} {t}")


def fail(t):
    print(f"  {BAD}✘ {t}{OFF}")
    print("  Bitte die komplette Ausgabe dieses Fensters an Claude schicken.")
    sys.exit(1)


def ask(q, default=""):
    suffix = f" [{default}]" if default else ""
    r = input(f"  {q}{suffix} ").strip().strip('"').strip("'")
    return r or default


def yes(q):
    return ask(q + " [j/N]").lower().startswith(("j", "y"))


def secret(q):
    return getpass.getpass(f"  {q} ").strip()


def hermes(*args, check=True, capture=True):
    r = subprocess.run([HERMES, *args], text=True, encoding="utf-8", errors="replace",
                       capture_output=capture)
    if check and r.returncode != 0:
        fail(f"hermes {' '.join(args[:3])} fehlgeschlagen:\n{(r.stdout or '')[-800:]}{(r.stderr or '')[-800:]}")
    return (r.stdout or "").strip()


# ---------------------------------------------------------------- Zugangsdaten-Datei
def env_read():
    env = {}
    if ENVF.exists():
        for line in ENVF.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def lock_down(path):
    if WINDOWS:
        user = os.environ.get("USERNAME", "")
        subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
                       capture_output=True)
    else:
        os.chmod(path, 0o600)


def env_set(**values):
    env = env_read()
    env.update({k: str(v) for k, v in values.items()})
    JARVIS_HOME.mkdir(parents=True, exist_ok=True)
    ENVF.write_text("".join(f"{k}={v}\n" for k, v in env.items()), encoding="utf-8")
    lock_down(ENVF)


def download(rel, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{RAW}/{rel}", timeout=30) as r:
        dest.write_bytes(r.read())


# ---------------------------------------------------------------- Schritte
def setup_persona_and_api():
    step("3/8 JARVIS-Persönlichkeit, lokale API und Freigabe-Sperre")
    soul = HERMES_HOME / "SOUL.md"
    current = soul.read_text(encoding="utf-8") if soul.exists() else ""
    if "JARVIS-PERSONA" not in current:
        with urllib.request.urlopen(f"{RAW}/SOUL.md", timeout=30) as r:
            soul.write_text(current + r.read().decode("utf-8"), encoding="utf-8")
        good(f"Persona in {soul} ergänzt.")
    else:
        good("Persona bereits vorhanden.")

    key = env_read().get("HERMES_API_KEY") or secrets.token_hex(32)
    hermes("config", "set", "API_SERVER_ENABLED", "true")
    hermes("config", "set", "API_SERVER_HOST", "127.0.0.1")
    hermes("config", "set", "API_SERVER_KEY", key)
    hermes("config", "set", "approvals.unattended_mode", "deny")
    env_set(HERMES_API_KEY=key, HERMES_API_URL="http://127.0.0.1:8642")
    hermes_env = HERMES_HOME / ".env"
    if hermes_env.exists():
        lock_down(hermes_env)
    good("Hermes-API nur lokal (127.0.0.1:8642), Schlüssel geschützt gespeichert.")

    plugin = HERMES_HOME / "plugins" / "jarvis-guard"
    for f in ("plugin.yaml", "__init__.py"):
        download(f"hermes-plugin/jarvis-guard/{f}", plugin / f)
    hermes("plugins", "enable", "jarvis-guard")
    good("Freigabe-Sperre aktiv: E-Mails, Einladungen und Nachrichten gehen erst nach deinem Klick raus.")


def setup_notes():
    step("4/8 Notizen (Obsidian-Ordner)")
    current = hermes("config", "get", "OBSIDIAN_VAULT_PATH", "--raw", check=False)
    docs = HOME / "Documents"
    if WINDOWS and not docs.exists() and (HOME / "OneDrive" / "Dokumente").exists():
        docs = HOME / "OneDrive" / "Dokumente"
    default = current if current and Path(current).exists() else str(
        docs / "Obsidian Vault" if (docs / "Obsidian Vault").exists() else docs / "JARVIS-Notizen")
    info("Hier legt JARVIS Notizen als Markdown-Dateien ab. Mit Obsidian (obsidian.md, kostenlos)")
    info("kannst du den Ordner als Vault öffnen – nötig ist das aber nicht.")
    vault = Path(ask("Notizordner:", default)).expanduser()
    vault.mkdir(parents=True, exist_ok=True)
    hermes("config", "set", "OBSIDIAN_VAULT_PATH", str(vault))
    good(f"Notizen landen in {vault}")
    return vault


def find_google_setup():
    p = HERMES_HOME / "skills" / "productivity" / "google-workspace" / "scripts" / "setup.py"
    if p.exists():
        return p
    hits = list(HERMES_HOME.glob("**/google-workspace/scripts/setup.py"))
    return hits[0] if hits else None


def gsetup(script, *args):
    r = subprocess.run([str(PY), str(script), *args], text=True, encoding="utf-8",
                       errors="replace", capture_output=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def setup_google():
    step("5/8 Gmail und Google Kalender")
    script = find_google_setup()
    if not script:
        warn("Google-Workspace-Skill von Hermes nicht gefunden – 'hermes update' ausführen und Skript erneut starten.")
        return False
    code, out = gsetup(script, "--check")
    if code == 0 and "AUTHENTICATED" in out:
        good("Google ist bereits verbunden.")
        return True
    if "ModuleNotFoundError" in out or "ImportError" in out:
        info("Installiere Google-Bibliotheken für Hermes …")
        gsetup(script, "--install-deps")
    if not yes("Gmail + Google Kalender jetzt verbinden?"):
        info("Übersprungen.")
        return False
    print(f"""
  Google verlangt dafür einmalig einen eigenen „OAuth-Client“ (ca. 10 Minuten, kostenlos).
  Ich öffne dir die Seiten nacheinander im Browser:

    1. {GOLD}Projekt anlegen{OFF}: oben „Projekt auswählen“ → „Neues Projekt“ → Name „JARVIS“.
    2. {GOLD}APIs aktivieren{OFF}: „Gmail API“ und „Google Calendar API“ suchen → jeweils „Aktivieren“.
    3. {GOLD}Google Auth Platform{OFF} → „Jetzt starten“: App-Name „JARVIS“, deine E-Mail,
       Zielgruppe „Extern“ → erstellen. Danach unter „Zielgruppe“ → „Testnutzer“
       deine eigene Gmail-Adresse hinzufügen.
    4. {GOLD}Clients{OFF} → „Client erstellen“ → Anwendungstyp „Desktop-App“ → Erstellen →
       „JSON herunterladen“.
""")
    for url in ("https://console.cloud.google.com/projectcreate",
                "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
                "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
                "https://console.cloud.google.com/auth/overview",
                "https://console.cloud.google.com/auth/clients"):
        input(f"  Enter öffnet: {DIM}{url}{OFF} ")
        webbrowser.open(url)
    downloads = HOME / "Downloads"
    guess = sorted(downloads.glob("client_secret_*.json"), key=lambda p: p.stat().st_mtime)
    path = ask("Pfad zur heruntergeladenen JSON-Datei:", str(guess[-1]) if guess else "")
    code, out = gsetup(script, "--client-secret", str(Path(path).expanduser()))
    if code != 0:
        warn(f"JSON-Datei nicht akzeptiert:\n{out[-600:]}")
        return False
    code, out = gsetup(script, "--auth-url", "--services", "email,calendar", "--format", "json")
    try:
        auth_url = json.loads(out[out.index("{"):])["auth_url"]
    except (ValueError, KeyError):
        warn(f"Konnte keinen Anmeldelink erzeugen:\n{out[-600:]}")
        return False
    print(f"\n  Anmeldelink (öffnet sich gleich):\n  {GOLD}{auth_url}{OFF}\n")
    info("Mit deinem Google-Konto anmelden und alles erlauben. Warnung „Google hat diese App")
    info("nicht überprüft“ → „Weiter“ (es ist deine eigene App). Danach zeigt der Browser eine")
    info("Fehlerseite bei „localhost:1“ – das ist richtig so. Kopiere die KOMPLETTE Adresse aus")
    info("der Adresszeile.")
    webbrowser.open(auth_url)
    for _ in range(3):
        pasted = ask("Adresse aus der Adresszeile einfügen:")
        code, out = gsetup(script, "--auth-code", pasted, "--format", "json")
        if code == 0:
            break
        m = re.search(r'"fresh_auth_url"\s*:\s*"([^"]+)"', out)
        if m:
            warn("Code abgelaufen – neuer Link geöffnet, bitte nochmal.")
            webbrowser.open(m.group(1))
        else:
            warn(out[-400:])
    code, out = gsetup(script, "--check")
    if code == 0:
        good("Gmail + Google Kalender verbunden.")
        return True
    warn("Google-Verbindung nicht bestätigt – Ausgabe an Claude schicken.")
    return False


def restart_gateway():
    hermes("gateway", "install", check=False)
    hermes("gateway", "restart", check=False)
    if hermes_ok(timeout=40):
        good("Hermes-Gateway läuft (mit Autostart).")
    else:
        hermes("gateway", "start", check=False)
        if not hermes_ok(timeout=30):
            fail("Hermes-API antwortet nicht. Bitte 'hermes gateway status' ausführen.")


def hermes_ok(timeout):
    key = env_read().get("HERMES_API_KEY", "")
    end = time.time() + timeout
    while time.time() < end:
        try:
            req = urllib.request.Request("http://127.0.0.1:8642/v1/models",
                                         headers={"Authorization": f"Bearer {key}"})
            with urllib.request.urlopen(req, timeout=3) as r:
                if r.status == 200:
                    return True
        except OSError:
            pass
        time.sleep(1)
    return False


def setup_dashboard():
    step("6/8 Dashboard, Passwort und Stimme")
    for f in ("server.py", "public/index.html", "public/style.css", "public/app.js",
              "public/login.html", "public/login.css", "public/login.js", "public/favicon.svg"):
        download(f"app/{f}", APP / f)
    good(f"Dashboard-Dateien in {APP}")

    env = env_read()
    if not env.get("JARVIS_PASSWORD_HASH") or os.environ.get("JARVIS_NEW_PASSWORD") == "1":
        spec = importlib.util.spec_from_file_location("jarvis_server", APP / "server.py")
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        while True:
            p1 = secret("Dashboard-Passwort festlegen (mind. 10 Zeichen):")
            p2 = secret("Passwort wiederholen:")
            if p1 == p2 and len(p1) >= 10:
                break
            info("Stimmt nicht überein oder zu kurz – nochmal.")
        env_set(JARVIS_PASSWORD_HASH=server.hash_password(p1), JARVIS_SESSION_SECRET=secrets.token_hex(32))
        good("Passwort gespeichert (nur als scrypt-Hash).")
    else:
        good("Passwort bereits gesetzt (neu setzen: JARVIS_NEW_PASSWORD=1).")
    model = hermes("config", "get", "model.default", "--raw", check=False)
    env_set(JARVIS_PORT=PORT, JARVIS_MODEL_LABEL=model)

    if env_read().get("ELEVENLABS_API_KEY") and os.environ.get("JARVIS_NEW_VOICE") != "1":
        good("ElevenLabs bereits verbunden (neu: JARVIS_NEW_VOICE=1).")
        return
    print(f"""
  {GOLD}Stimme – Kosten vorab:{OFF} ElevenLabs rechnet nach Zeichen der Sprachausgabe ab. Der
  Gratis-Plan reicht zum Testen, erlaubt aber kein Stimmenklonen; Instant Voice Cloning
  braucht mindestens den Starter-Plan. Aktuelle Preise: https://elevenlabs.io/pricing
  JARVIS nutzt das günstige Modell eleven_flash_v2_5. Ohne ElevenLabs spricht JARVIS mit
  der kostenlosen Windows-/Browser-Stimme.

  So kommst du an die Daten:
    1. elevenlabs.io → Voices → Voice Library, Filter Deutsch (z. B. ruhige britische
       Butler-Stimme) → „Add to my voices“ – oder eine eigene Stimme per Instant Voice
       Clone, nur mit Aufnahmen, für die du die Rechte/Einwilligung hast.
    2. Bei der Stimme „ID kopieren“ → Voice ID.
    3. Profil → API Keys → neuer Schlüssel (Berechtigung „Text to Speech“ genügt).
""")
    if not yes("ElevenLabs jetzt verbinden?"):
        info("Übersprungen – Browser-Stimme aktiv.")
        return
    key = secret("ElevenLabs API-Key (Eingabe unsichtbar):")
    voice = ask("Voice ID:")
    try:
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/voices/{urllib.parse.quote(voice)}",
                                     headers={"xi-api-key": key})
        with urllib.request.urlopen(req, timeout=15) as r:
            name = json.loads(r.read()).get("name", voice)
        env_set(ELEVENLABS_API_KEY=key, ELEVENLABS_VOICE_ID=voice, ELEVENLABS_MODEL="eleven_flash_v2_5")
        good(f"Stimme „{name}“ verbunden.")
    except urllib.error.HTTPError as e:
        warn(f"ElevenLabs antwortet mit HTTP {e.code} – Key oder Voice ID prüfen. Weiter mit Browser-Stimme.")


def setup_autostart():
    step("7/8 Autostart")
    log = JARVIS_HOME / "logs"
    log.mkdir(parents=True, exist_ok=True)
    server = APP / "server.py"
    if WINDOWS:
        pyw = PY.with_name("pythonw.exe")
        pyw = pyw if pyw.exists() else PY
        cmd = f'"{pyw}" "{server}"'
        r = subprocess.run(["schtasks", "/Create", "/TN", "JARVIS_Dashboard", "/TR", cmd,
                            "/SC", "ONLOGON", "/RL", "LIMITED", "/F"], capture_output=True, text=True)
        startup = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup/JARVIS_Dashboard.vbs"
        if r.returncode == 0:
            startup.unlink(missing_ok=True)
            info("Aufgabenplanung: JARVIS_Dashboard startet bei der Anmeldung.")
        else:
            startup.write_text(f'CreateObject("WScript.Shell").Run """{pyw}"" ""{server}""", 0, False\n',
                               encoding="utf-8")
            info("Autostart über den Autostart-Ordner eingerichtet.")
        stop_running_dashboard()
        subprocess.Popen([str(pyw), str(server)], cwd=str(APP),
                         creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | NEW_PROCESS_GROUP
                         stdout=open(log / "dashboard.log", "a"), stderr=subprocess.STDOUT)
    elif MAC:
        plist = HOME / "Library/LaunchAgents/de.jarvis.dashboard.plist"
        plist.parent.mkdir(parents=True, exist_ok=True)
        plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>de.jarvis.dashboard</string>
  <key>ProgramArguments</key><array><string>{PY}</string><string>{server}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}/dashboard.log</string>
  <key>StandardErrorPath</key><string>{log}/dashboard.log</string>
</dict></plist>
""", encoding="utf-8")
        uid = os.getuid()
        subprocess.run(["launchctl", "bootout", f"gui/{uid}/de.jarvis.dashboard"], capture_output=True)
        subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(plist)], check=True)
    else:
        unit = HOME / ".config/systemd/user/jarvis-dashboard.service"
        unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text(f"""[Unit]
Description=JARVIS Dashboard
After=network-online.target

[Service]
ExecStart={PY} {server}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
""", encoding="utf-8")
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "--user", "enable", "jarvis-dashboard.service"], check=True)
        subprocess.run(["systemctl", "--user", "restart", "jarvis-dashboard.service"], check=True)
        subprocess.run(["loginctl", "enable-linger", os.environ.get("USER", "")], capture_output=True)
    for _ in range(20):
        try:
            with urllib.request.urlopen(f"{BASE}/healthz", timeout=2):
                good("Dashboard läuft und startet automatisch.")
                return
        except OSError:
            time.sleep(1)
    fail(f"Dashboard startet nicht. Log: {log / 'dashboard.log'}")


def stop_running_dashboard():
    """Windows: alten Dashboard-Prozess (Port belegt) beenden, damit die neue Version startet."""
    r = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True)
    for line in r.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(f":{PORT}") and parts[3] == "LISTENING":
            subprocess.run(["taskkill", "/F", "/PID", parts[4]], capture_output=True)
    time.sleep(1)


def setup_https():
    ts = shutil.which("tailscale") or (r"C:\Program Files\Tailscale\tailscale.exe"
                                       if WINDOWS and Path(r"C:\Program Files\Tailscale\tailscale.exe").exists() else None)
    if ts and subprocess.run([ts, "status"], capture_output=True).returncode == 0:
        subprocess.run([ts, "serve", "--bg", "--https=443", f"http://127.0.0.1:{PORT}"], capture_output=True)
        st = json.loads(subprocess.run([ts, "status", "--json"], capture_output=True, text=True).stdout)
        url = "https://" + st["Self"]["DNSName"].rstrip(".")
        good(f"HTTPS über Tailscale aktiv (nur deine eigenen Geräte): {url}")
        return url
    info("Fürs Handy mit echtem HTTPS: Tailscale installieren (https://tailscale.com/download,")
    info("kostenlos privat), auf Laptop und Handy anmelden, in der Admin-Konsole unter DNS")
    info("„HTTPS Certificates“ aktivieren und dieses Skript erneut starten.")
    info(f"Am Laptop selbst reicht {BASE.replace('127.0.0.1', 'localhost')} – dort funktioniert das Mikrofon.")
    return BASE.replace("127.0.0.1", "localhost")


# ---------------------------------------------------------------- Tests
class Dash:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def login(self, pw):
        data = urllib.parse.urlencode({"password": pw}).encode()
        self.op.open(urllib.request.Request(f"{BASE}/login", data=data), timeout=15)
        return any(c.name == "jarvis_session" for c in self.jar)

    def get(self, path):
        with self.op.open(f"{BASE}{path}", timeout=15) as r:
            return json.loads(r.read())

    def post(self, path, obj, timeout=300):
        req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(obj).encode(),
                                     headers={"Content-Type": "application/json", "X-Jarvis": "1"})
        return self.op.open(req, timeout=timeout)

    def chat(self, text):
        out = []
        with self.post("/api/chat", {"messages": [{"role": "user", "content": text}]}) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("data:") and line != "data: [DONE]":
                    try:
                        d = json.loads(line[5:])["choices"][0]["delta"].get("content")
                    except (ValueError, KeyError, IndexError):
                        continue
                    if d:
                        out.append(d)
        return "".join(out).strip()


def run_tests(url, google, vault):
    step("8/8 Echte Abläufe testen")
    d = Dash()
    if not d.login(secret("Zum Test einmal das Dashboard-Passwort eingeben:")):
        fail("Anmeldung am Dashboard fehlgeschlagen.")
    good("Anmeldung funktioniert.")
    st = d.get("/api/status")
    info(f"Status: Hermes {'online' if st['hermes'] else 'OFFLINE'} · Modell {st['model']} · Stimme {st['voice']}")
    reply = d.chat("Sag in einem kurzen Satz Hallo.")
    good(f"Chat: {reply}") if reply else fail("Chat ohne Antwort.")

    if env_read().get("ELEVENLABS_API_KEY"):
        with d.post("/api/tts", {"text": "Systeme online."}, timeout=60) as r:
            n = len(r.read())
        good(f"ElevenLabs liefert Audio ({n} Bytes).") if n > 2000 else warn("ElevenLabs lieferte kein Audio.")

    note = vault / "JARVIS-Test.md"
    note.unlink(missing_ok=True)
    reply = d.chat(f"Lege im Notizordner die Notiz 'JARVIS-Test' an mit dem Inhalt 'Einrichtung erfolgreich am {time.strftime('%d.%m.%Y')}'. Antworte nur kurz.")
    info(f"JARVIS: {reply}")
    hits = list(vault.glob("**/JARVIS-Test*.md"))
    good(f"Notiz angelegt: {hits[0]}") if hits else warn("Notiz nicht gefunden – bitte im Chat nochmal versuchen.")

    if google:
        reply = d.chat("Wie viele ungelesene E-Mails habe ich und was ist mein nächster Kalendertermin? Kurz.")
        good(f"Gmail/Kalender: {reply}")
        pending = JARVIS_HOME / "approvals" / "pending"
        before = set(pending.glob("*.json")) if pending.exists() else set()
        reply = d.chat("Schicke mir selbst eine Test-E-Mail mit Betreff 'JARVIS Test' und Text 'Freigabe-Test'.")
        info(f"JARVIS: {reply}")
        new = (set(pending.glob("*.json")) if pending.exists() else set()) - before
        if new:
            for f in new:
                f.unlink()
            good("Freigabe-Sperre greift: Die Test-Mail wurde angehalten und verworfen (nicht gesendet).")
        else:
            warn("Keine Freigabe-Anfrage entstanden – bitte Ausgabe an Claude schicken.")
    return url


def main():
    if not RAW:
        fail("JARVIS_RAW fehlt – bitte über install.ps1 / install.sh starten.")
    JARVIS_HOME.mkdir(parents=True, exist_ok=True)
    setup_persona_and_api()
    vault = setup_notes()
    google = setup_google()
    step("Hermes neu starten")
    restart_gateway()
    setup_dashboard()
    setup_autostart()
    url = setup_https()
    run_tests(url, google, vault)
    print(f"""
{GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{OFF}
  JARVIS ist bereit:  {GOLD}{url}{OFF}
  Zugangsdaten: {ENVF} (nur für dich lesbar)
{GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{OFF}
  Bitte die komplette Ausgabe dieses Fensters an Claude schicken.""")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Abgebrochen.")
