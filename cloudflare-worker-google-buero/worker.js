/**
 * neuverdrahtet Werkora – Google-Büro-API (Gmail + Kalender) für die KI-Bürokraft
 *
 * Zweiter, komplett eigenständiger Cloudflare Worker (getrennt von
 * cloudflare-worker-ki-buerokraft/, das nicht verändert wird). Verbindet
 * das Firmen-Google-Konto von neuverdrahtet per OAuth 2.0 mit Gmail und
 * Google Kalender, damit eine KI-Bürokraft (z.B. über eine zweite
 * ChatGPT-Action) E-Mails lesen/einordnen und Termine prüfen/anlegen kann.
 *
 * Setzt die Vorgabe "Auftrag an Claude: Gmail + Google Kalender für
 * Werkora KI-Bürokraft" um, Version 1 (Abschnitt 15 der Vorgabe):
 *   Gmail:    searchEmails, getEmail, getEmailThread, createEmailDraft,
 *             markEmailRead, addEmailLabel
 *   Kalender: searchCalendarEvents, getCalendarEvent,
 *             getCalendarAvailability, createCalendarEvent,
 *             updateCalendarEvent
 *
 * ABSICHTLICH NICHT VORHANDEN (Sicherheitsregeln der Vorgabe, Abschnitt 3+6+12):
 *   - kein sendEmail (die KI erstellt nur Entwürfe, Danny versendet selbst)
 *   - kein deleteCalendarEvent, kein endgültiges Löschen von E-Mails
 *   - kein Schreibzugriff auf die Werkora-Datenbank (diese Aktion kennt nur
 *     Gmail/Kalender-Daten plus eine eigene, kleine Verknüpfungstabelle für
 *     die Google-Kalender<->Werkora-Termin-ID-Zuordnung, siehe unten)
 *   - jede DELETE-Anfrage wird pauschal abgelehnt
 *
 * OAuth-Berechtigungen (bewusst minimal gehalten):
 *   https://www.googleapis.com/auth/gmail.modify
 *     -> volles Lesen/Einordnen/Entwürfe, aber KEIN Versenden (das ist ein
 *        eigener Scope "gmail.send", der hier absichtlich nie angefragt wird)
 *   https://www.googleapis.com/auth/calendar.events
 *     -> Termine lesen/anlegen/ändern. Ein "nur erstellen, nie löschen"-
 *        Scope gibt es bei Google nicht - das Löschen wird stattdessen
 *        auf Anwendungsebene verhindert (kein DELETE-Endpunkt implementiert).
 *
 * Funktionsweise der Anmeldung (einmalig von Danny im Browser zu erledigen,
 * danach läuft alles automatisch über den gespeicherten Refresh-Token):
 *   1. Danny ruft /oauth/authorize?setup_key=<OAUTH_SETUP_SECRET> im Browser
 *      auf, wird zu Google weitergeleitet und bestätigt den Zugriff für das
 *      neuverdrahtet-Google-Konto.
 *   2. Google leitet zurück zu /oauth/callback, der Worker tauscht den Code
 *      gegen ein Token-Paar und speichert NUR den Refresh-Token (langlebig)
 *      verschlüsselt-übertragen in Firestore (Collection google_oauth_tokens,
 *      Zugriff ausschließlich über den Firebase-Service-Account dieses
 *      Workers - genau wie bei den anderen Werkora-Workern).
 *   3. Bei jedem weiteren API-Aufruf tauscht der Worker den gespeicherten
 *      Refresh-Token live gegen ein kurzlebiges Zugriffstoken (nie im
 *      Klartext gespeichert).
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   API_KEY                       (Secret) - Bearer-Schlüssel für die KI/ChatGPT.
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret) - wie bei den anderen Werkora-Workern.
 *   GOOGLE_OAUTH_CLIENT_ID        (Secret) - aus der Google-Cloud-Konsole.
 *   GOOGLE_OAUTH_CLIENT_SECRET    (Secret) - aus der Google-Cloud-Konsole.
 *   OAUTH_SETUP_SECRET            (Secret) - frei gewählt, schützt /oauth/authorize
 *                                  davor, dass jemand anderes die Verbindung kapert.
 *   GOOGLE_CALENDAR_ID            (Variable, optional) - Standard: "primary".
 *
 * Antwortformat identisch zur bestehenden KI-Bürokraft-API:
 *   Erfolg: { "success": true,  "data": {...}, "message": null }
 *   Fehler: { "success": false, "error": { "code": "...", "message": "..." } }
 */

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const OAUTH_SCOPES = `${GMAIL_SCOPE} ${CALENDAR_SCOPE}`;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
  });
}
function okResponse(data, status = 200) { return jsonResponse({ success: true, data, message: null }, status); }
function errorResponse(code, message, status = 400, details) { return jsonResponse({ success: false, error: { code, message, ...(details ? { details } : {}) } }, status); }

// --- Firestore REST API: Wert-Encoder/-Decoder + CRUD-Helfer (1:1 aus cloudflare-worker-ki-buerokraft/worker.js) ---

function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function pemPrivateKeyToBinary(pem) {
  const base64 = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function getServiceAccountAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: serviceAccount.client_email, scope, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const cryptoKey = await crypto.subtle.importKey('pkcs8', pemPrivateKeyToBinary(serviceAccount.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google-Service-Account-OAuth-Fehler (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return (await res.json()).access_token;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) { if (val !== undefined) fields[k] = toFirestoreValue(val); }
  return fields;
}
function fromFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromFirestoreValue(v);
  return obj;
}
function docToPlain(doc) { const id = (doc.name || '').split('/').pop(); return { id, ...fromFirestoreFields(doc.fields) }; }
function firestoreBaseUrl(projectId, collection) { return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`; }

async function firestoreList({ accessToken, projectId, collection, pageSize = 300 }) {
  const res = await fetch(`${firestoreBaseUrl(projectId, collection)}?pageSize=${pageSize}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) beim Auflisten von ${collection}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return ((await res.json()).documents || []).map(docToPlain);
}
async function firestoreGet({ accessToken, projectId, collection, id }) {
  const res = await fetch(`${firestoreBaseUrl(projectId, collection)}/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) bei ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return docToPlain(await res.json());
}
async function firestoreSet({ accessToken, projectId, collection, id, data }) {
  const res = await fetch(`${firestoreBaseUrl(projectId, collection)}/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) beim Schreiben von ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return docToPlain(await res.json());
}

// --- Google-Nutzer-OAuth (Authorization-Code-Flow, für Gmail/Kalender im Namen des Firmenkontos) ---

function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: OAUTH_SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: state || '',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens({ clientId, clientSecret, redirectUri, code }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Google-OAuth-Code-Tausch fehlgeschlagen (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

async function refreshUserAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Google-Zugriffstoken-Erneuerung fehlgeschlagen (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}. Eventuell muss die Google-Verbindung erneut über /oauth/authorize hergestellt werden.`);
  return (await res.json()).access_token;
}

/** Lädt den gespeicherten Refresh-Token aus Firestore und tauscht ihn gegen ein frisches Zugriffstoken für Gmail/Kalender. */
async function getUserAccessToken(env, fsCtx) {
  const tokenDoc = await firestoreGet({ ...fsCtx, collection: 'google_oauth_tokens', id: 'neuverdrahtet' });
  if (!tokenDoc || !tokenDoc.refresh_token) {
    throw new Error('Google-Konto ist noch nicht verbunden. Danny muss einmalig /oauth/authorize im Browser aufrufen (siehe README.md).');
  }
  return refreshUserAccessToken({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, refreshToken: tokenDoc.refresh_token });
}

// --- Gmail-Helfer ---

function buildGmailQuery({ q, unread, from, to, subject, after, before }) {
  const parts = [];
  if (q) parts.push(q);
  if (unread) parts.push('is:unread');
  if (from) parts.push(`from:${from}`);
  if (to) parts.push(`to:${to}`);
  if (subject) parts.push(`subject:${subject}`);
  if (after) parts.push(`after:${after.replace(/-/g, '/')}`);
  if (before) parts.push(`before:${before.replace(/-/g, '/')}`);
  return parts.join(' ');
}

function getHeader(payload, name) {
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/** Läuft rekursiv durch die MIME-Teile einer Nachricht und liefert reinen Text plus Anhang-Metadaten. */
function extractGmailBodyAndAttachments(payload) {
  let text = '';
  let html = '';
  const attachments = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({ filename: part.filename, mime_type: part.mimeType || '', size: part.body.size || 0, attachment_id: part.body.attachmentId });
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      text += base64UrlDecodeToString(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html += base64UrlDecodeToString(part.body.data);
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  if (!text && html) text = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { text: text.trim(), attachments };
}

function gmailMessageToApi(msg) {
  const { text, attachments } = extractGmailBodyAndAttachments(msg.payload);
  return {
    message_id: msg.id, thread_id: msg.threadId,
    from: getHeader(msg.payload, 'From'), to: getHeader(msg.payload, 'To'), subject: getHeader(msg.payload, 'Subject'),
    date: getHeader(msg.payload, 'Date'), snippet: msg.snippet || '', body_text: text, attachments, labels: msg.labelIds || [],
  };
}

/** Baut eine RFC-2822-MIME-Rohnachricht für einen Gmail-Entwurf (reiner Text, keine Anhänge). */
function buildMimeMessage({ to, subject, bodyText, inReplyToMessageId, references }) {
  const headers = [`To: ${to}`, `Subject: ${subject || ''}`, 'Content-Type: text/plain; charset="UTF-8"', 'MIME-Version: 1.0'];
  if (inReplyToMessageId) headers.push(`In-Reply-To: ${inReplyToMessageId}`);
  if (references) headers.push(`References: ${references}`);
  return `${headers.join('\r\n')}\r\n\r\n${bodyText || ''}`;
}

async function gmailFetch(accessToken, path, opts = {}) {
  const res = await fetch(`${GMAIL_API}${path}`, { ...opts, headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Gmail-API-Fehler (${res.status}) bei ${path}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

async function gmailEnsureLabelId(accessToken, labelName) {
  const list = await gmailFetch(accessToken, '/labels');
  const existing = (list.labels || []).find((l) => l.name.toLowerCase() === labelName.toLowerCase());
  if (existing) return existing.id;
  const created = await gmailFetch(accessToken, '/labels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  return created.id;
}

// --- Kalender-Helfer ---

async function calendarFetch(accessToken, path, opts = {}) {
  const res = await fetch(`${CALENDAR_API}${path}`, { ...opts, headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Kalender-API-Fehler (${res.status}) bei ${path}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

function calendarEventToApi(ev) {
  return {
    id: ev.id, title: ev.summary || '', description: ev.description || '', location: ev.location || '',
    start: ev.start?.dateTime || ev.start?.date || '', end: ev.end?.dateTime || ev.end?.date || '',
    attendees: (ev.attendees || []).map((a) => a.email), status: ev.status || '', html_link: ev.htmlLink || '',
  };
}

/**
 * Berechnet freie Zeitfenster (Mo-Fr, 08:00-17:00 lokale Server-Zeit d.h.
 * UTC) im Zeitraum dateFrom..dateTo aus den von Google gelieferten
 * Beschäftigt-Intervallen (busy). Reine, für Unit-Tests geeignete Funktion.
 */
function computeFreeSlots({ dateFrom, dateTo, busy, workStartHour = 8, workEndHour = 17, slotMinutes = 60 }) {
  const free = [];
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  const busyIntervals = (busy || []).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const dayStr = day.toISOString().slice(0, 10);
    const dayStartMs = new Date(`${dayStr}T00:00:00Z`).getTime();
    const workStartMs = dayStartMs + workStartHour * 3600000;
    const workEndMs = dayStartMs + workEndHour * 3600000;
    for (let slotStartMs = workStartMs; slotStartMs + slotMinutes * 60000 <= workEndMs; slotStartMs += slotMinutes * 60000) {
      const slotStart = new Date(slotStartMs);
      const slotEnd = new Date(slotStartMs + slotMinutes * 60000);
      const overlaps = busyIntervals.some((b) => slotStart.getTime() < b.end && slotEnd.getTime() > b.start);
      if (!overlaps) free.push({ date: dayStr, start: slotStart.toISOString(), end: slotEnd.toISOString() });
    }
  }
  return free;
}

// --- KI-Aktionsprotokoll (eigene Collection, unabhängig vom bestehenden Worker) ---

async function logAction(fsCtx, { action, resourceType, resourceId, status, error }) {
  const entry = {
    id: crypto.randomUUID(), timestamp: new Date().toISOString(), action,
    resource_type: resourceType || '', resource_id: resourceId || '', google_account: 'neuverdrahtet',
    status, error: error || '',
  };
  try { await firestoreSet({ ...fsCtx, collection: 'google_action_log', id: entry.id, data: entry }); } catch { /* Protokoll darf echte Aufrufe nicht stören */ }
}

// Zusätzliche benannte Exporte rein für lokale Unit-Tests (reine Funktionen, kein Netzwerk).
export {
  toFirestoreValue, toFirestoreFields, fromFirestoreValue, fromFirestoreFields, docToPlain,
  buildAuthUrl, buildGmailQuery, getHeader, extractGmailBodyAndAttachments, gmailMessageToApi, buildMimeMessage,
  calendarEventToApi, computeFreeSlots, base64UrlEncode, base64UrlDecodeToString,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return jsonResponse(null, 204);
    const url = new URL(request.url);
    const teile = url.pathname.split('/').filter(Boolean);
    const q = url.searchParams;

    // --- OAuth-Einrichtung (kein Bearer-API_KEY, eigener Setup-Schlüssel als Schutz) ---
    if (teile[0] === 'oauth' && teile[1] === 'authorize') {
      if (!env.OAUTH_SETUP_SECRET || q.get('setup_key') !== env.OAUTH_SETUP_SECRET) {
        return errorResponse('FORBIDDEN', 'Ungültiger oder fehlender setup_key.', 403);
      }
      if (!env.GOOGLE_OAUTH_CLIENT_ID) return errorResponse('SERVER_MISCONFIGURED', 'GOOGLE_OAUTH_CLIENT_ID fehlt.', 500);
      const redirectUri = `${url.origin}/oauth/callback`;
      const authUrl = buildAuthUrl({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, redirectUri, state: env.OAUTH_SETUP_SECRET });
      return Response.redirect(authUrl, 302);
    }
    if (teile[0] === 'oauth' && teile[1] === 'callback') {
      const code = q.get('code');
      const state = q.get('state');
      if (!code || !env.OAUTH_SETUP_SECRET || state !== env.OAUTH_SETUP_SECRET) {
        return errorResponse('FORBIDDEN', 'Ungültige OAuth-Antwort (code/state fehlt oder falsch).', 403);
      }
      if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return errorResponse('SERVER_MISCONFIGURED', 'FIREBASE_SERVICE_ACCOUNT_JSON fehlt.', 500);
      try {
        const redirectUri = `${url.origin}/oauth/callback`;
        const tokens = await exchangeCodeForTokens({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri, code });
        if (!tokens.refresh_token) {
          return errorResponse('NO_REFRESH_TOKEN', 'Google hat keinen Refresh-Token geliefert. Bitte die Verbindung beim Google-Konto unter "Apps mit Kontozugriff" entfernen und /oauth/authorize erneut aufrufen.', 400);
        }
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
        const fsAccessToken = await getServiceAccountAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
        const fsCtx = { accessToken: fsAccessToken, projectId: serviceAccount.project_id };
        await firestoreSet({ ...fsCtx, collection: 'google_oauth_tokens', id: 'neuverdrahtet', data: { refresh_token: tokens.refresh_token, scope: tokens.scope || OAUTH_SCOPES, connected_at: new Date().toISOString() } });
        return new Response('Google-Konto erfolgreich mit Werkora verbunden. Dieses Fenster kann geschlossen werden.', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } catch (err) {
        return errorResponse('OAUTH_ERROR', err.message || 'Unbekannter Fehler beim Verbinden.', 500);
      }
    }

    // --- Ab hier: normale API, geschützt mit Bearer API_KEY ---
    if (!env.API_KEY) return errorResponse('SERVER_MISCONFIGURED', 'Worker ist nicht korrekt eingerichtet (API_KEY fehlt).', 500);
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.replace(/^Bearer\s+/i, '') !== env.API_KEY) {
      return errorResponse('UNAUTHORIZED', 'Ungültiger oder fehlender API-Schlüssel (Authorization: Bearer <Schlüssel>).', 401);
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return errorResponse('SERVER_MISCONFIGURED', 'FIREBASE_SERVICE_ACCOUNT_JSON fehlt.', 500);
    if (request.method === 'DELETE') return errorResponse('APPROVAL_REQUIRED', 'Löschen ist über diese API grundsätzlich nicht erlaubt.', 403);

    let fsCtx, accessToken;
    const calendarId = env.GOOGLE_CALENDAR_ID || 'primary';
    try {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const fsAccessToken = await getServiceAccountAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
      fsCtx = { accessToken: fsAccessToken, projectId: serviceAccount.project_id };
      accessToken = await getUserAccessToken(env, fsCtx);
    } catch (err) {
      return errorResponse('SERVER_ERROR', err.message || 'Unbekannter Fehler bei der Google-Authentifizierung.', 500);
    }

    try {
      // --- Gmail ---
      if (teile[0] === 'emails' && !teile[1] && request.method === 'GET') {
        const gq = buildGmailQuery({ q: q.get('q'), unread: q.get('unread') === 'true', from: q.get('from'), to: q.get('to'), subject: q.get('subject'), after: q.get('after'), before: q.get('before') });
        const list = await gmailFetch(accessToken, `/messages?maxResults=25${gq ? `&q=${encodeURIComponent(gq)}` : ''}`);
        const details = await Promise.all((list.messages || []).map((m) => gmailFetch(accessToken, `/messages/${m.id}?format=full`)));
        await logAction(fsCtx, { action: 'search_email', resourceType: 'email', status: 'success' });
        return okResponse(details.map(gmailMessageToApi));
      }
      if (teile[0] === 'emails' && teile[1] && teile[2] === 'draft' && request.method === 'POST') {
        let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
        if (!body.to) return errorResponse('VALIDATION_ERROR', 'Feld "to" ist erforderlich.', 400);
        const original = await gmailFetch(accessToken, `/messages/${teile[1]}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
        const originalMsgId = getHeader(original.payload, 'Message-ID');
        const raw = buildMimeMessage({ to: body.to, subject: body.subject || `Re: ${getHeader(original.payload, 'Subject')}`, bodyText: body.body_text, inReplyToMessageId: originalMsgId, references: originalMsgId });
        const draft = await gmailFetch(accessToken, '/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { threadId: original.threadId, raw: base64UrlEncode(raw) } }) });
        await logAction(fsCtx, { action: 'create_email_draft', resourceType: 'email', resourceId: teile[1], status: 'success' });
        return okResponse({ draft_id: draft.id, thread_id: original.threadId }, 201);
      }
      if (teile[0] === 'emails' && teile[1] && teile[2] === 'read' && request.method === 'POST') {
        await gmailFetch(accessToken, `/messages/${teile[1]}/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) });
        await logAction(fsCtx, { action: 'mark_email_read', resourceType: 'email', resourceId: teile[1], status: 'success' });
        return okResponse({ message_id: teile[1], read: true });
      }
      if (teile[0] === 'emails' && teile[1] && teile[2] === 'labels' && request.method === 'POST') {
        let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
        if (!body.label) return errorResponse('VALIDATION_ERROR', 'Feld "label" ist erforderlich.', 400);
        const labelId = await gmailEnsureLabelId(accessToken, body.label);
        await gmailFetch(accessToken, `/messages/${teile[1]}/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addLabelIds: [labelId] }) });
        await logAction(fsCtx, { action: 'add_label', resourceType: 'email', resourceId: teile[1], status: 'success' });
        return okResponse({ message_id: teile[1], label: body.label });
      }
      if (teile[0] === 'emails' && teile[1] && request.method === 'GET') {
        const msg = await gmailFetch(accessToken, `/messages/${teile[1]}?format=full`);
        await logAction(fsCtx, { action: 'read_email', resourceType: 'email', resourceId: teile[1], status: 'success' });
        return okResponse(gmailMessageToApi(msg));
      }
      if (teile[0] === 'threads' && teile[1] && request.method === 'GET') {
        const thread = await gmailFetch(accessToken, `/threads/${teile[1]}?format=full`);
        await logAction(fsCtx, { action: 'read_email', resourceType: 'thread', resourceId: teile[1], status: 'success' });
        return okResponse({ thread_id: thread.id, messages: (thread.messages || []).map(gmailMessageToApi) });
      }

      // --- Kalender ---
      if (teile[0] === 'calendar' && teile[1] === 'events' && !teile[2] && request.method === 'GET') {
        const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
        if (q.get('date_from')) params.set('timeMin', new Date(q.get('date_from')).toISOString());
        if (q.get('date_to')) params.set('timeMax', new Date(q.get('date_to')).toISOString());
        if (q.get('q')) params.set('q', q.get('q'));
        const list = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
        await logAction(fsCtx, { action: 'search_calendar', resourceType: 'event', status: 'success' });
        return okResponse((list.items || []).map(calendarEventToApi));
      }
      if (teile[0] === 'calendar' && teile[1] === 'availability' && request.method === 'GET') {
        const dateFrom = q.get('date_from'); const dateTo = q.get('date_to');
        if (!dateFrom || !dateTo) return errorResponse('VALIDATION_ERROR', 'date_from und date_to sind erforderlich (YYYY-MM-DD).', 400);
        const fb = await calendarFetch(accessToken, '/freeBusy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeMin: `${dateFrom}T00:00:00Z`, timeMax: `${dateTo}T23:59:59Z`, items: [{ id: calendarId }] }),
        });
        const busy = fb.calendars?.[calendarId]?.busy || [];
        const slotMinutes = Number(q.get('duration_minutes')) || 60;
        const free = computeFreeSlots({ dateFrom, dateTo, busy, slotMinutes });
        await logAction(fsCtx, { action: 'search_calendar', resourceType: 'availability', status: 'success' });
        return okResponse({ busy, free_slots: free });
      }
      if (teile[0] === 'calendar' && teile[1] === 'events' && teile[2] && request.method === 'GET') {
        const ev = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${teile[2]}`);
        await logAction(fsCtx, { action: 'read_calendar_event', resourceType: 'event', resourceId: teile[2], status: 'success' });
        return okResponse(calendarEventToApi(ev));
      }
      if (teile[0] === 'calendar' && teile[1] === 'events' && !teile[2] && request.method === 'POST') {
        let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
        if (!body.title || !body.start || !body.end) return errorResponse('VALIDATION_ERROR', 'Felder "title", "start" und "end" sind erforderlich.', 400);
        if (body.werkora_appointment_id) {
          const existingLink = await firestoreGet({ ...fsCtx, collection: 'google_calendar_links', id: body.werkora_appointment_id });
          if (existingLink) {
            const existingEvent = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${existingLink.google_calendar_event_id}`).catch(() => null);
            if (existingEvent) {
              await logAction(fsCtx, { action: 'create_calendar_event', resourceType: 'event', resourceId: existingEvent.id, status: 'skipped_duplicate' });
              return okResponse({ ...calendarEventToApi(existingEvent), werkora_appointment_id: body.werkora_appointment_id, already_existed: true });
            }
          }
        }
        const created = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: body.title, description: body.description || '', location: body.location || '', start: { dateTime: body.start }, end: { dateTime: body.end }, attendees: (body.attendee_emails || []).map((email) => ({ email })) }),
        });
        if (body.werkora_appointment_id) {
          await firestoreSet({ ...fsCtx, collection: 'google_calendar_links', id: body.werkora_appointment_id, data: { werkora_appointment_id: body.werkora_appointment_id, google_calendar_event_id: created.id, created_at: new Date().toISOString() } });
        }
        await logAction(fsCtx, { action: 'create_calendar_event', resourceType: 'event', resourceId: created.id, status: 'success' });
        return okResponse({ ...calendarEventToApi(created), werkora_appointment_id: body.werkora_appointment_id || undefined, already_existed: false }, 201);
      }
      if (teile[0] === 'calendar' && teile[1] === 'events' && teile[2] && request.method === 'PATCH') {
        let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
        const patch = {};
        if (body.title !== undefined) patch.summary = body.title;
        if (body.description !== undefined) patch.description = body.description;
        if (body.location !== undefined) patch.location = body.location;
        if (body.start !== undefined) patch.start = { dateTime: body.start };
        if (body.end !== undefined) patch.end = { dateTime: body.end };
        const updated = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${teile[2]}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        await logAction(fsCtx, { action: 'update_calendar_event', resourceType: 'event', resourceId: teile[2], status: 'success' });
        return okResponse(calendarEventToApi(updated));
      }

      return errorResponse('NOT_FOUND', `Unbekannter Endpunkt: ${request.method} ${url.pathname}`, 404);
    } catch (err) {
      await logAction(fsCtx, { action: 'error', status: 'error', error: err.message || String(err) });
      return errorResponse('SERVER_ERROR', err.message || 'Unbekannter Fehler', 500);
    }
  },
};
