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
//   PUSH_CONTACT_EMAIL E-Mail-Adresse für den VAPID-"mailto:"-Kontakt bei
//                      Push-Benachrichtigungen (Standard: ADMIN_EMAIL bzw.
//                      admin@werkora.local) - wird nur Push-Diensten
//                      gegenüber angegeben, falls sie Rückfragen haben.
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
import { getOrCreateVapidKeys, createPusher } from './lib/push.js';
import { pruefeCollectionZugriff, filtereZeilenFuerRolle, istZeileErlaubt } from './lib/access.js';
import { createLoginLimiter } from './lib/rateLimit.js';
import { createResetToken, consumeResetToken } from './lib/passwordReset.js';
import { createMailer } from './lib/mailer.js';

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
const vapidKeys = getOrCreateVapidKeys(DATA_DIR, process.env.PUSH_CONTACT_EMAIL || process.env.ADMIN_EMAIL || 'admin@werkora.local');
const pusher = createPusher(vapidKeys);
const loginLimiter = createLoginLimiter();
// Eigenes Limit fürs Anfordern von Reset-Mails (lockert nicht das Login-
// Limit oben, soll aber genauso verhindern, dass jemand eine fremde Adresse
// mit E-Mails zuspammt).
const forgotPasswordLimiter = createLoginLimiter({ maxVersuche: 3, sperrdauerMs: 10 * 60 * 1000, fensterMs: 10 * 60 * 1000 });
const mailer = createMailer();
const MINDEST_PASSWORT_LAENGE = 8;

if (!mailer) {
  console.log('Hinweis: SMTP_HOST ist nicht gesetzt - "Passwort vergessen"-Links werden statt per E-Mail in dieser Konsolenausgabe angezeigt.');
}

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

// Obergrenze für jeden Request-Body (Datei-Uploads eingeschlossen) - ohne
// das würde jede Anfrage unbegrenzt im Arbeitsspeicher gepuffert; das
// 25-MB-Limit in blobstore.js gilt nur clientseitig und schützt nicht vor
// einem direkten API-Aufruf oder einem Client-Bug. Etwas großzügiger als
// die client-seitigen 25 MB, um Kodierungs-Overhead abzudecken.
const MAX_BODY_BYTES = 30 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let zuGross = false;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        // Socket NICHT hier schon zerstören: req/res teilen sich bei
        // HTTP/1.1-Keep-Alive dieselbe Verbindung - ein req.destroy() mitten
        // im Datenstrom würde auch das spätere Senden der 413-Antwort
        // verhindern. Stattdessen nur nicht mehr puffern und nach dem
        // regulären 'end' ablehnen; die Verbindung wird erst NACH der
        // Antwort geschlossen (siehe unten, err.status === 413).
        zuGross = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (zuGross) reject(Object.assign(new Error('Anfrage zu groß.'), { status: 413 }));
      else resolve(Buffer.concat(chunks));
    });
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
    const gesperrtFuer = loginLimiter.pruefeSperre(email);
    if (gesperrtFuer) {
      return sendJson(res, 429, { error: `Zu viele Fehlversuche - bitte in ${gesperrtFuer} Sekunden erneut versuchen.` });
    }
    const user = store.getAll('users').find((u) => u.email === email);
    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      loginLimiter.vermerkeFehlschlag(email);
      return sendJson(res, 401, { error: 'E-Mail oder Passwort ist falsch.' });
    }
    loginLimiter.vermerkeErfolg(email);
    const session = { uid: user.id, role: user.role, mitarbeiterId: user.mitarbeiterId, kundeId: user.kundeId, name: user.name };
    setSessionCookie(res, session);
    return sendJson(res, 200, session);
  }

  if (req.method === 'POST' && parts[0] === 'register') {
    const { email, password } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!password || password.length < MINDEST_PASSWORT_LAENGE) {
      return sendJson(res, 400, { error: `Das Passwort muss mindestens ${MINDEST_PASSWORT_LAENGE} Zeichen lang sein.` });
    }
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

  if (req.method === 'POST' && parts[0] === 'forgot-password') {
    const { email } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const gesperrtFuer = forgotPasswordLimiter.pruefeSperre(email);
    // Absichtlich IMMER dieselbe generische Antwort, egal ob die Adresse
    // existiert, gesperrt ist oder gerade eine Mail bekommt - sonst liesse
    // sich über die Antwort ausprobieren, welche E-Mail-Adressen als Konto
    // angelegt sind (Enumeration), siehe auch auth.js' Firebase-Variante.
    const antwort = { message: 'Falls zu dieser E-Mail-Adresse ein Konto existiert, wurde gerade eine E-Mail zum Zurücksetzen versendet.' };
    if (gesperrtFuer) return sendJson(res, 200, antwort);
    forgotPasswordLimiter.vermerkeFehlschlag(email);
    const user = store.getAll('users').find((u) => u.email === email);
    if (user) {
      const token = createResetToken(store, email);
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const resetUrl = `${origin}/reset-password.html?token=${token}`;
      if (mailer) {
        mailer.sendResetMail(email, resetUrl).catch((err) => console.error('Reset-Mail konnte nicht versendet werden:', err.message));
      } else {
        console.log(`Passwort-Reset-Link für ${email} (1 Stunde gültig): ${resetUrl}`);
      }
    }
    return sendJson(res, 200, antwort);
  }

  if (req.method === 'POST' && parts[0] === 'reset-password') {
    const { token, password } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!password || password.length < MINDEST_PASSWORT_LAENGE) {
      return sendJson(res, 400, { error: `Das Passwort muss mindestens ${MINDEST_PASSWORT_LAENGE} Zeichen lang sein.` });
    }
    const email = consumeResetToken(store, token || '');
    if (!email) return sendJson(res, 400, { error: 'Der Link ist ungültig oder abgelaufen. Bitte erneut "Passwort vergessen" anfordern.' });
    const user = store.getAll('users').find((u) => u.email === email);
    if (!user) return sendJson(res, 400, { error: 'Der Link ist ungültig oder abgelaufen. Bitte erneut "Passwort vergessen" anfordern.' });
    store.put('users', { ...user, passwordHash: hashPassword(password) });
    return sendJson(res, 200, { ok: true });
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

  if (req.method === 'GET' && parts[0] === 'push' && parts[1] === 'vapid-public-key') {
    return sendJson(res, 200, { publicKey: vapidKeys.publicKey });
  }

  if (req.method === 'POST' && parts[0] === 'push' && parts[1] === 'notify') {
    // Kein Kundenportal-Konto darf beliebigen Titel/Text/Link an interne
    // Geräte (z.B. alle "admin"-Rollen) schicken - das wäre ein direkter
    // Phishing-Weg über eine eigentlich harmlose Benachrichtigung.
    if (session.role === 'kunde') return sendJson(res, 403, { error: 'Keine Berechtigung.' });
    const { roles, title, body, url } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const alle = store.getAll('pushSubscriptions');
    const ziel = alle.filter((s) => (roles || []).includes(s.role) && s.userId !== session.uid);
    const ergebnisse = await pusher.sendToAll(ziel, { title, body, url });
    for (const r of ergebnisse) {
      if (!r.ok && r.abgelaufen) store.remove('pushSubscriptions', r.id);
    }
    return sendJson(res, 200, { gesendet: ergebnisse.filter((r) => r.ok).length, insgesamt: ziel.length });
  }

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

  // Rollenbasierte Zugriffskontrolle (siehe lib/access.js - bewusst
  // unvollständige Übergangslösung, keine vollständige Nachbildung der
  // bisherigen firestore.rules, deckt aber die eindeutigsten Fälle ab:
  // Kundenportal nur lesend/nur eigene Daten, Mitarbeiter/Techniker ohne
  // Personal-/Preis-/Finanzdaten).
  const zugriff = pruefeCollectionZugriff(session, collection, req.method);
  if (!zugriff.ok) return sendJson(res, zugriff.status, { error: zugriff.error });

  // Passwort-Hash NIE über die generische API ausliefern - sonst könnte jede
  // angemeldete Person (unabhängig von ihrer Rolle) die Hashes aller Konten
  // mitlesen.
  function redact(row) {
    if (collection !== 'users' || !row) return row;
    const { passwordHash, ...rest } = row;
    return rest;
  }

  if (req.method === 'GET' && !id) {
    const filter = Object.fromEntries(url.searchParams.entries());
    const rows = store.getAll(collection, Object.keys(filter).length ? filter : undefined);
    return sendJson(res, 200, filtereZeilenFuerRolle(session, collection, rows).map(redact));
  }
  if (req.method === 'GET' && id) {
    const row = store.get(collection, id);
    if (!row || !istZeileErlaubt(session, collection, row)) return sendJson(res, 404, { error: 'Nicht gefunden.' });
    return sendJson(res, 200, redact(row));
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
    if (err.status !== 413) console.error('Serverfehler:', err);
    sendJson(res, err.status || 500, { error: err.message || 'Interner Serverfehler' });
    // Verbindung nach einer zu großen Anfrage hart schließen statt für
    // Keep-Alive wiederzuverwenden - der Rest des (verworfenen) Bodys ist
    // bereits durchgelaufen, ein Wiederverwenden derselben Verbindung für
    // die nächste Anfrage wäre sonst nicht mehr sauber synchronisiert.
    if (err.status === 413) res.socket?.destroy();
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
