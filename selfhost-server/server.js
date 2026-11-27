#!/usr/bin/env node
// Werkora Selfhost-Server: EIN Prozess, der alles bereitstellt, was bisher auf
// Firebase (Firestore/Auth/Storage) lief - ohne externe Abhängigkeiten
// (nur Node-Bordmittel), damit "ein Befehl, ohne viel einstellen" stimmt.
//
// Start:  node server.js
// Docker: siehe Dockerfile im selben Verzeichnis.
//
// Konfiguration (alles optional, über Umgebungsvariablen):
//   PORT              Standard: 8080
//   DATA_DIR          Standard: ./data (enthält werkora.db, Dateien, Session-Secret)
//   ADMIN_EMAIL       Nur beim allerersten Start relevant (siehe unten)
//   ADMIN_PASSWORD    Nur beim allerersten Start relevant (siehe unten)
//
// Beim allerersten Start (noch keine Nutzer in der Datenbank) wird automatisch
// ein Admin-Konto angelegt - mit ADMIN_EMAIL/ADMIN_PASSWORD falls gesetzt,
// sonst mit admin@werkora.local und einem zufällig erzeugten Passwort, das
// EINMALIG in der Konsole ausgegeben wird. So ist kein manueller
// Einrichtungsschritt nötig, aber man kommt trotzdem rein.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { openStore } from './lib/store.js';
import { createFileStore } from './lib/files.js';
import { hashPassword, verifyPassword, createAuth, parseCookies, randomUUID } from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'werkora.db');
const SECRET_PATH = path.join(DATA_DIR, 'session-secret.key');

await mkdir(DATA_DIR, { recursive: true });
await mkdir(FILES_DIR, { recursive: true });

function getOrCreateSecret() {
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFile(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

const store = openStore(DB_PATH);
const files = createFileStore(FILES_DIR);
const auth = createAuth(getOrCreateSecret());

// --- Erstes Admin-Konto beim allerersten Start ---------------------------
function bootstrapAdminIfNeeded() {
  const vorhandeneNutzer = store.getAll('users');
  if (vorhandeneNutzer.length > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@werkora.local';
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  store.put('users', {
    id: randomUUID(), email, passwordHash: hashPassword(password), role: 'admin',
    mitarbeiterId: null, kundeId: null, name: 'Admin', createdAt: new Date().toISOString(),
  });
  console.log('');
  console.log('=== Erstes Admin-Konto angelegt ===');
  console.log(`  E-Mail:    ${email}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`  Passwort:  ${password}  (jetzt notieren - wird nicht erneut angezeigt)`);
  else console.log('  Passwort:  (aus ADMIN_PASSWORD übernommen)');
  console.log('====================================');
  console.log('');
}
bootstrapAdminIfNeeded();

// --- Hilfsfunktionen -------------------------------------------------------
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return auth.readSessionCookie(cookies.nv_session);
}

function setSessionCookie(res, session) {
  const value = auth.createSessionCookie(session);
  res.setHeader('Set-Cookie', `nv_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'nv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

// --- API-Routing ------------------------------------------------------------
async function handleApi(req, res, url) {
  // decodeURIComponent: URL.pathname lässt Prozent-Kodierungen unangetastet
  // (z.B. "@" in einer Einladungs-E-Mail als Dokument-Id bleibt "%40") - ohne
  // das Dekodieren hier würde dieselbe Id beim Schreiben und beim späteren
  // Suchen unterschiedlich aussehen und nie wieder gefunden werden.
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean).map(decodeURIComponent);

  if (req.method === 'POST' && parts[0] === 'login') {
    const { email, password } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const user = store.getAll('users').find((u) => u.email === email);
    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      return sendJson(res, 401, { error: 'E-Mail oder Passwort ist falsch.' });
    }
    const session = { uid: user.id, role: user.role, mitarbeiterId: user.mitarbeiterId, kundeId: user.kundeId, name: user.name };
    setSessionCookie(res, session);
    return sendJson(res, 200, session);
  }

  if (req.method === 'POST' && parts[0] === 'register') {
    const { email, password } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const invite = store.get('invites', email);
    if (!invite) return sendJson(res, 404, { error: 'Keine Einladung für diese E-Mail-Adresse gefunden.' });
    if (store.getAll('users').some((u) => u.email === email)) return sendJson(res, 409, { error: 'Für diese E-Mail existiert bereits ein Konto.' });
    const user = store.put('users', {
      id: randomUUID(), email, passwordHash: hashPassword(password || ''), role: invite.role || 'mitarbeiter',
      mitarbeiterId: invite.mitarbeiterId || null, kundeId: invite.kundeId || null, name: invite.name || email,
      createdAt: new Date().toISOString(),
    });
    store.remove('invites', email);
    const session = { uid: user.id, role: user.role, mitarbeiterId: user.mitarbeiterId, kundeId: user.kundeId, name: user.name };
    setSessionCookie(res, session);
    return sendJson(res, 200, session);
  }

  if (req.method === 'POST' && parts[0] === 'logout') {
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && parts[0] === 'session') {
    const session = sessionFromRequest(req);
    return session ? sendJson(res, 200, session) : sendJson(res, 401, { error: 'Nicht angemeldet.' });
  }

  // Alles ab hier erfordert eine gültige Session.
  const session = sessionFromRequest(req);
  if (!session) return sendJson(res, 401, { error: 'Nicht angemeldet.' });

  if (parts[0] === 'files' && parts.length > 1) {
    const relPath = parts.slice(1).join('/');
    if (req.method === 'PUT') {
      const buffer = await readBody(req);
      const meta = await files.save(relPath, buffer);
      return sendJson(res, 200, { url: `/files/${relPath}`, path: relPath, mime: req.headers['content-type'] || '', size: meta.size });
    }
    if (req.method === 'DELETE') {
      await files.remove(relPath);
      return sendJson(res, 200, { ok: true });
    }
  }

  // Generische Collection-API: /api/:collection[/:id]
  const [collection, id] = parts;
  if (!collection) return sendJson(res, 404, { error: 'Unbekannte Route.' });

  // Passwort-Hash NIE über die generische API ausliefern - sonst könnte jede
  // angemeldete Person (unabhängig von ihrer Rolle) die Hashes aller Konten
  // mitlesen. Eine echte, rollenbasierte Zugriffskontrolle wie in den
  // bisherigen firestore.rules (siehe README "Bekannte Lücken") gibt es hier
  // noch nicht - das ist der einzige Collection-spezifische Sonderfall, der
  // unabhängig davon in jedem Fall gilt.
  function redact(row) {
    if (collection !== 'users' || !row) return row;
    const { passwordHash, ...rest } = row;
    return rest;
  }

  if (req.method === 'GET' && !id) {
    const filter = Object.fromEntries(url.searchParams.entries());
    return sendJson(res, 200, store.getAll(collection, Object.keys(filter).length ? filter : undefined).map(redact));
  }
  if (req.method === 'GET' && id) {
    const row = store.get(collection, id);
    return row ? sendJson(res, 200, redact(row)) : sendJson(res, 404, { error: 'Nicht gefunden.' });
  }
  if (req.method === 'PUT' && id) {
    const value = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const stamped = { ...value, id, geaendertVon: session.uid, geaendertAm: new Date().toISOString(), erstelltVon: value.erstelltVon || session.uid };
    return sendJson(res, 200, store.put(collection, stamped));
  }
  if (req.method === 'DELETE' && id) {
    store.remove(collection, id);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && !id) {
    // Komplette Collection leeren - für den CSV-"Ersetzen statt ergänzen"-
    // Import (siehe clearStore() in db.js), kein Soft-Delete/Papierkorb.
    store.clear(collection);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Unbekannte Route.' });
}

// --- Statisches Ausliefern der App (GitHub-Pages-Inhalt desselben Repos) ---
async function handleStatic(req, res, url) {
  let relPath = decodeURIComponent(url.pathname);
  if (relPath.endsWith('/')) relPath += 'index.html';
  const target = path.normalize(path.join(REPO_ROOT, relPath));
  if (!target.startsWith(REPO_ROOT)) {
    res.writeHead(403);
    res.end('Verboten');
    return;
  }
  try {
    const data = await readFile(target);
    const ext = path.extname(target);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}

async function serveFileUpload(req, res, url) {
  const relPath = decodeURIComponent(url.pathname.replace(/^\/files\//, ''));
  // Existenz vorab prüfen statt erst beim Streamen zu scheitern - sonst wären
  // die 200-Header schon gesendet, bevor der Stream seinen 'error' feuert,
  // und der Versuch, dann noch 404 zu schreiben, würde den ganzen Prozess
  // mit ERR_HTTP_HEADERS_SENT abstürzen lassen (unhandled Rejection im
  // Stream-Event, außerhalb des try/catch im Haupt-Request-Handler).
  if (!(await files.exists(relPath))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
    return;
  }
  const ext = path.extname(relPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  const stream = files.streamFor(relPath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/files/')) return await serveFileUpload(req, res, url);
    return await handleStatic(req, res, url);
  } catch (err) {
    console.error('Serverfehler:', err);
    sendJson(res, 500, { error: err.message || 'Interner Serverfehler' });
  }
});

server.listen(PORT, () => {
  console.log(`Werkora Selfhost-Server läuft auf http://localhost:${PORT}`);
  console.log(`Daten liegen unter: ${DATA_DIR}`);
});

// Sicherheitsnetz: ein einzelner fehlerhafter Request darf nie den ganzen
// Server mitreißen (z.B. ein Fehler in einem asynchronen Stream-Callback
// außerhalb des try/catch im Haupt-Request-Handler oben) - das wäre bei
// einem Ein-Server-Betrieb ohne Prozess-Manager sonst ein kompletter Ausfall.
process.on('uncaughtException', (err) => console.error('Unerwarteter Fehler (Server läuft weiter):', err));
process.on('unhandledRejection', (err) => console.error('Unerwarteter Fehler (Server läuft weiter):', err));
