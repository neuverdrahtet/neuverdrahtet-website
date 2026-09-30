#!/usr/bin/env python3
"""JARVIS-Dashboard: kleiner Webserver vor Hermes Agent.

- liefert das Dashboard aus (nur nach Anmeldung)
- leitet Chat-Anfragen gestreamt an den Hermes-API-Server weiter (Schlüssel bleibt serverseitig)
- leitet Sprachausgabe an ElevenLabs weiter (Schlüssel bleibt serverseitig)

Nur Python-Standardbibliothek. Konfiguration: ~/.jarvis/jarvis.env (chmod 600).
"""

import base64
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import secrets
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = APP_DIR / "public"
JARVIS_HOME = Path(os.environ.get("JARVIS_HOME", Path.home() / ".jarvis"))
ENV_FILE = JARVIS_HOME / "jarvis.env"
PENDING_DIR = JARVIS_HOME / "approvals" / "pending"
APPROVED_DIR = JARVIS_HOME / "approvals" / "ok"

SESSION_COOKIE = "jarvis_session"
SESSION_DAYS = 30
MAX_BODY = 256 * 1024
LOGIN_WINDOW = 15 * 60
LOGIN_MAX_FAILS = 5

SPOKEN_STYLE = (
    "Du bist JARVIS, der persönliche Assistent des Nutzers. Antworte auf Deutsch, "
    "knapp und natürlich sprechbar: kurze Sätze, keine Tabellen, keine Markdown-Formatierung, "
    "keine Emojis. Sende, veröffentliche oder lösche niemals etwas nach außen (Nachrichten, "
    "E-Mails, Termine mit Gästen, Posts), ohne vorher den genauen Inhalt und Empfänger zu nennen "
    "und eine ausdrückliche Freigabe des Nutzers zu erhalten."
)


def load_env(path):
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


CFG = load_env(ENV_FILE)
PORT = int(CFG.get("JARVIS_PORT", "8787"))
HOST = CFG.get("JARVIS_HOST", "127.0.0.1")
PASSWORD_HASH = CFG.get("JARVIS_PASSWORD_HASH", "")
SESSION_SECRET = CFG.get("JARVIS_SESSION_SECRET", "").encode() or secrets.token_bytes(32)
HERMES_URL = urllib.parse.urlparse(CFG.get("HERMES_API_URL", "http://127.0.0.1:8642"))
HERMES_KEY = CFG.get("HERMES_API_KEY", "")
MODEL_LABEL = CFG.get("JARVIS_MODEL_LABEL", "")
EL_KEY = CFG.get("ELEVENLABS_API_KEY", "")
EL_VOICE = CFG.get("ELEVENLABS_VOICE_ID", "")
EL_MODEL = CFG.get("ELEVENLABS_MODEL", "eleven_flash_v2_5")

_fails = {}
_fails_lock = threading.Lock()


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def check_password(password):
    try:
        _, salt_b64, _ = PASSWORD_HASH.split("$")
    except ValueError:
        return False
    candidate = hash_password(password, base64.b64decode(salt_b64))
    return hmac.compare_digest(candidate, PASSWORD_HASH)


def make_session():
    exp = str(int(time.time()) + SESSION_DAYS * 86400)
    sig = hmac.new(SESSION_SECRET, exp.encode(), hashlib.sha256).hexdigest()
    return exp + "." + sig


def valid_session(token):
    try:
        exp, sig = token.split(".", 1)
    except (AttributeError, ValueError):
        return False
    good = hmac.new(SESSION_SECRET, exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good) and exp.isdigit() and int(exp) > time.time()


def too_many_fails(ip):
    now = time.time()
    with _fails_lock:
        recent = [t for t in _fails.get(ip, []) if now - t < LOGIN_WINDOW]
        _fails[ip] = recent
        return len(recent) >= LOGIN_MAX_FAILS


def record_fail(ip):
    with _fails_lock:
        _fails.setdefault(ip, []).append(time.time())


def upstream(parsed, timeout):
    if parsed.scheme == "https":
        return http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=timeout)
    return http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=timeout)


class Handler(BaseHTTPRequestHandler):
    server_version = "JARVIS"
    sys_version = ""

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- helpers ----------
    def client_ip(self):
        # Tailscale Serve / Reverse-Proxy auf demselben Rechner setzen X-Forwarded-For
        fwd = self.headers.get("X-Forwarded-For")
        if fwd and self.client_address[0] in ("127.0.0.1", "::1"):
            return fwd.split(",")[0].strip()
        return self.client_address[0]

    def is_local_host(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("localhost", "127.0.0.1", "[::1]")

    def authed(self):
        cookie = self.headers.get("Cookie") or ""
        for part in cookie.split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE:
                return valid_session(value)
        return False

    def same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return urllib.parse.urlparse(origin).netloc == self.headers.get("Host")

    def security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "microphone=(self), camera=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; media-src 'self' blob:; img-src 'self' data:; "
            "style-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )
        if not self.is_local_host():
            self.send_header("Strict-Transport-Security", "max-age=31536000")

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        data = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.security_headers()
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, location, cookie=None):
        self.send_response(303)
        self.send_header("Location", location)
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.security_headers()
        self.end_headers()

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("zu groß")
        return self.rfile.read(length) if length else b""

    def cookie(self, value, max_age):
        secure = "" if self.is_local_host() else "; Secure"
        return f"{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"

    # ---------- routes ----------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/healthz":
            return self.send_json(200, {"ok": True})
        if path == "/login":
            return self.send_file(PUBLIC_DIR / "login.html")
        if path in ("/login.css", "/login.js", "/favicon.svg"):
            return self.send_file(PUBLIC_DIR / path.lstrip("/"))
        if not self.authed():
            if path.startswith("/api/"):
                return self.send_json(401, {"error": "nicht angemeldet"})
            return self.redirect("/login")
        if path == "/api/status":
            return self.status()
        if path == "/api/approvals":
            return self.approvals()
        if path == "/":
            return self.send_file(PUBLIC_DIR / "index.html")
        target = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if target.is_file() and PUBLIC_DIR in target.parents:
            return self.send_file(target)
        self.send_json(404, {"error": "nicht gefunden"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.same_origin():
            return self.send_json(403, {"error": "fremde Herkunft"})
        if path == "/login":
            return self.login()
        if path == "/logout":
            return self.redirect("/login", self.cookie("", 0))
        if not self.authed():
            return self.send_json(401, {"error": "nicht angemeldet"})
        if self.headers.get("X-Jarvis") != "1":
            return self.send_json(403, {"error": "Header fehlt"})
        if path == "/api/chat":
            return self.chat()
        if path == "/api/tts":
            return self.tts()
        if path.startswith("/api/approvals/"):
            return self.decide(path)
        self.send_json(404, {"error": "nicht gefunden"})

    def login(self):
        ip = self.client_ip()
        if too_many_fails(ip):
            return self.redirect("/login?e=gesperrt")
        try:
            form = urllib.parse.parse_qs(self.read_body().decode())
        except ValueError:
            return self.redirect("/login?e=1")
        password = (form.get("password") or [""])[0]
        if PASSWORD_HASH and check_password(password):
            return self.redirect("/", self.cookie(make_session(), SESSION_DAYS * 86400))
        record_fail(ip)
        time.sleep(1)
        self.redirect("/login?e=1")

    def status(self):
        hermes_ok = False
        try:
            conn = upstream(HERMES_URL, 3)
            conn.request("GET", "/v1/models", headers={"Authorization": f"Bearer {HERMES_KEY}"})
            hermes_ok = conn.getresponse().status == 200
            conn.close()
        except OSError:
            pass
        self.send_json(200, {
            "hermes": hermes_ok,
            "model": MODEL_LABEL,
            "voice": "elevenlabs" if EL_KEY and EL_VOICE else "browser",
        })

    def approvals(self):
        items = []
        for f in sorted(PENDING_DIR.glob("*.json")) if PENDING_DIR.exists() else []:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if time.time() - data.get("created", 0) > 3600:
                f.unlink(missing_ok=True)
                continue
            items.append({k: data.get(k) for k in ("id", "tool", "preview", "created")})
        self.send_json(200, {"items": items})

    def decide(self, path):
        parts = path.split("/")  # ['', 'api', 'approvals', '<id>', '<approve|reject>']
        if len(parts) != 5 or not parts[3].isalnum() or parts[4] not in ("approve", "reject"):
            return self.send_json(400, {"error": "ungültig"})
        pending = PENDING_DIR / f"{parts[3]}.json"
        if not pending.exists():
            return self.send_json(404, {"error": "Anfrage nicht gefunden oder abgelaufen"})
        if parts[4] == "approve":
            APPROVED_DIR.mkdir(parents=True, exist_ok=True)
            (APPROVED_DIR / parts[3]).touch()
        else:
            pending.unlink(missing_ok=True)
        self.send_json(200, {"ok": True})

    def chat(self):
        try:
            payload = json.loads(self.read_body() or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "ungültige Anfrage"})
        messages = [
            {"role": m.get("role"), "content": str(m.get("content", ""))[:8000]}
            for m in payload.get("messages", [])[-24:]
            if m.get("role") in ("user", "assistant")
        ]
        if not messages:
            return self.send_json(400, {"error": "keine Nachricht"})
        body = json.dumps({
            "model": "hermes-agent",
            "stream": True,
            "messages": [{"role": "system", "content": SPOKEN_STYLE}] + messages,
        })
        try:
            conn = upstream(HERMES_URL, 600)
            conn.request("POST", "/v1/chat/completions", body=body, headers={
                "Authorization": f"Bearer {HERMES_KEY}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "X-Hermes-Session-Id": "jarvis-dashboard",
            })
            resp = conn.getresponse()
        except OSError as exc:
            return self.send_json(502, {"error": f"Hermes nicht erreichbar: {exc}"})
        if resp.status != 200:
            detail = resp.read(2000).decode(errors="replace")
            conn.close()
            return self.send_json(502, {"error": f"Hermes-Fehler {resp.status}", "detail": detail})
        self.pipe(resp, conn, "text/event-stream; charset=utf-8")

    def tts(self):
        if not (EL_KEY and EL_VOICE):
            return self.send_json(404, {"error": "ElevenLabs nicht eingerichtet"})
        try:
            text = str(json.loads(self.read_body() or b"{}").get("text", "")).strip()[:1200]
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "ungültige Anfrage"})
        if not text:
            return self.send_json(400, {"error": "kein Text"})
        body = json.dumps({
            "text": text,
            "model_id": EL_MODEL,
            "language_code": "de",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "speed": 1.0},
        })
        voice = urllib.parse.quote(EL_VOICE, safe="")
        try:
            conn = http.client.HTTPSConnection("api.elevenlabs.io", timeout=60)
            conn.request(
                "POST",
                f"/v1/text-to-speech/{voice}/stream?output_format=mp3_44100_128",
                body=body,
                headers={"xi-api-key": EL_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            )
            resp = conn.getresponse()
        except OSError as exc:
            return self.send_json(502, {"error": f"ElevenLabs nicht erreichbar: {exc}"})
        if resp.status != 200:
            detail = resp.read(2000).decode(errors="replace")
            conn.close()
            return self.send_json(502, {"error": f"ElevenLabs-Fehler {resp.status}", "detail": detail})
        self.pipe(resp, conn, "audio/mpeg")

    def pipe(self, resp, conn, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.security_headers()
        self.end_headers()
        self.close_connection = True
        try:
            while True:
                chunk = resp.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browser hat abgebrochen (Unterbrechung) -> Upstream schließen
        finally:
            conn.close()


def main():
    if sys.stderr is None or sys.stdout is None:  # pythonw (Windows-Autostart) hat keine Konsole
        (JARVIS_HOME / "logs").mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(JARVIS_HOME / "logs" / "dashboard.log", "a", buffering=1, encoding="utf-8")
    if len(sys.argv) > 1 and sys.argv[1] == "hash-password":
        print(hash_password(sys.stdin.readline().rstrip("\n")))
        return
    if not PASSWORD_HASH:
        sys.exit(f"JARVIS_PASSWORD_HASH fehlt in {ENV_FILE} - bitte install.sh ausführen.")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    print(f"JARVIS-Dashboard läuft auf http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
