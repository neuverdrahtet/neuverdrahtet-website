"""JARVIS-Guard: ausgehende Aktionen brauchen eine Freigabe im Dashboard.

Ablauf:
1. Der Agent ruft ein Werkzeug auf, das etwas nach außen sendet (Gmail senden/antworten,
   Kalendereinladung mit Gästen, Termin löschen, send_message, SMTP …).
2. Dieser pre_tool_call-Hook blockiert den Aufruf und legt eine Anfrage unter
   ~/.jarvis/approvals/pending/<id>.json ab.
3. Das Dashboard zeigt die Anfrage mit Empfänger und Inhalt. Tippt der Nutzer auf
   „Freigeben“, legt es ~/.jarvis/approvals/ok/<id> an.
4. Der Agent wiederholt exakt denselben Aufruf; der Hook findet die Freigabe
   (einmalig, 15 Minuten gültig) und lässt ihn durch.
"""

import hashlib
import json
import os
import re
import time
from pathlib import Path

JARVIS_HOME = Path(os.environ.get("JARVIS_HOME") or Path.home() / ".jarvis")
PENDING = JARVIS_HOME / "approvals" / "pending"
APPROVED = JARVIS_HOME / "approvals" / "ok"
TTL = 15 * 60

ALWAYS = {"send_message"}
READ_ONLY = {"read_file", "search_files", "web_search", "web_extract", "vision_analyze", "memory", "todo", "skill_view", "skills_list"}

OUTBOUND = [
    re.compile(r"google_api\.py\S*\s+gmail\s+(send|reply|forward)\b", re.I),
    re.compile(r"google_api\.py\S*\s+calendar\s+delete\b", re.I),
    re.compile(r"\bgws\b.*\b(send|insert|delete|patch|update|import|share)\b", re.I),
    re.compile(r"googleapis\.com/\S*(messages/send|drafts/send|/events)", re.I),
    re.compile(r"\bhimalaya\b.*\b(send|reply|forward)\b", re.I),
    re.compile(r"\bsmtplib\b|\bsendmail\b|\.send_message\(", re.I),
]
INVITE = re.compile(r"google_api\.py\S*\s+calendar\s+create\b", re.I)


def _norm(args):
    return re.sub(r"\s+", " ", json.dumps(args, sort_keys=True, ensure_ascii=False)).strip()


def _fingerprint(tool_name, args):
    return hashlib.sha256(f"{tool_name}\n{_norm(args)}".encode()).hexdigest()[:12]


def needs_approval(tool_name, args):
    if tool_name in ALWAYS:
        return True
    if tool_name in READ_ONLY:
        return False
    blob = json.dumps(args, ensure_ascii=False).replace("\\n", "\n").replace('\\"', '"')
    if any(p.search(blob) for p in OUTBOUND):
        return True
    return bool(INVITE.search(blob) and "--attendees" in blob and not re.search(r"--attendees[= ]+(\"\"|''|\s|$)", blob))


def _preview(args):
    for key in ("command", "code", "message", "content", "text"):
        if isinstance(args.get(key), str):
            return args[key][:4000]
    return json.dumps(args, ensure_ascii=False, indent=2)[:4000]


def check(tool_name, args=None, task_id="", **kwargs):
    args = args or {}
    if not needs_approval(tool_name, args):
        return None
    fp = _fingerprint(tool_name, args)
    ok = APPROVED / fp
    if ok.exists():
        fresh = time.time() - ok.stat().st_mtime < TTL
        ok.unlink(missing_ok=True)
        (PENDING / f"{fp}.json").unlink(missing_ok=True)
        if fresh:
            return None
    PENDING.mkdir(parents=True, exist_ok=True)
    (PENDING / f"{fp}.json").write_text(json.dumps({
        "id": fp,
        "tool": tool_name,
        "preview": _preview(args),
        "args": args,
        "created": time.time(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "action": "block",
        "message": (
            f"FREIGABE ERFORDERLICH (ID {fp}). Diese Aktion geht nach außen und wurde angehalten. "
            "Nenne dem Nutzer kurz Empfänger/Kanal und Inhalt und bitte ihn, im JARVIS-Dashboard auf "
            "„Freigeben“ zu tippen. Sobald er „freigegeben“ meldet, führe EXAKT denselben "
            "Werkzeugaufruf mit identischen Argumenten erneut aus – nichts daran ändern, sonst ist "
            "eine neue Freigabe nötig."
        ),
    }


def register(ctx):
    ctx.register_hook("pre_tool_call", check)
