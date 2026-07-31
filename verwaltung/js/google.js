import { getSettings, setSettings, exportAll } from './db.js';

// gmail.modify (statt nur gmail.readonly) wird gebraucht, damit
// markAsRead() (.../modify) und trashMessage() (.../trash) im Postfach
// funktionieren - beide schlagen mit reinem gmail.readonly mit einem
// 403 "insufficient authentication scopes" fehl. gmail.modify deckt
// Lesen mit ab, ersetzt also gmail.readonly vollständig.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

let tokenClient = null;
let accessToken = localStorage.getItem('nv-google-token') || null;
let tokenExpiresAt = Number(localStorage.getItem('nv-google-token-exp') || 0);
// Merkt sich, mit welchem Scope der aktuelle Token geholt wurde. Ändert sich
// SCOPES im Code (z.B. weil eine neue Berechtigung wie gmail.modify dazukommt),
// bleibt ein alter, noch nicht abgelaufener Token sonst unbemerkt zu schwach
// und jeder Aufruf schlägt mit "insufficient authentication scopes" fehl,
// ohne dass die App das erkennt oder von sich aus neu nach Zustimmung fragt.
let grantedScope = localStorage.getItem('nv-google-token-scope') || '';
let gisReady = false;
let gisLoadPromise = null;

function loadGis() {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      gisReady = true;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => { gisReady = true; resolve(); };
    script.onerror = () => reject(new Error('Google-Anmeldeskript konnte nicht geladen werden.'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

export function isConnected() {
  return !!accessToken && Date.now() < tokenExpiresAt && grantedScope === SCOPES;
}

export async function isConfigured() {
  const settings = await getSettings();
  return !!settings.googleClientId;
}

function requestToken(settings, prompt) {
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: settings.googleClientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 30000;
        grantedScope = SCOPES;
        localStorage.setItem('nv-google-token', accessToken);
        localStorage.setItem('nv-google-token-exp', String(tokenExpiresAt));
        localStorage.setItem('nv-google-token-scope', grantedScope);
        resolve(accessToken);
        maybeAutoBackup().catch(() => { /* Auto-Backup ist ein Komfort-Feature, darf die Verbindung nicht stören */ });
      },
      error_callback: (err) => reject(new Error(err?.message || err?.type || 'Google-Anmeldung abgebrochen.')),
    });
    tokenClient.requestAccessToken({ prompt });
  });
}

/** Lädt das Google-Anmeldeskript schon beim App-Start vor (ohne Popup), damit
 * beim späteren Klick auf "Mit Google verbinden/synchronisieren" kein await
 * auf den Skript-Download mehr zwischen Klick und Popup-Öffnung liegt - auf
 * mobilen Browsern (v.a. Safari) verfällt das kurze Zeitfenster, in dem ein
 * Klick noch window.open() erlaubt, sonst und das Popup wird stillschweigend
 * blockiert ("Failed to open popup window"). */
export function preloadGis() {
  loadGis().catch(() => { /* schlägt das Vorladen fehl, versucht connect() es beim Klick erneut */ });
}

export async function connect() {
  const settings = await getSettings();
  if (!settings.googleClientId) {
    throw new Error('Bitte zuerst in den Einstellungen die Google Client-ID hinterlegen.');
  }
  await loadGis();
  // Hat sich der benötigte Scope seit dem letzten Verbinden geändert (z.B.
  // neue Berechtigung im Code hinzugekommen), bringt ein stiller Versuch
  // nichts - Google kann den fehlenden Scope ohne Zustimmungsdialog nicht
  // stillschweigend nachreichen. Dann direkt den sichtbaren Dialog anzeigen.
  if (grantedScope && grantedScope !== SCOPES) {
    return await requestToken(settings, 'consent');
  }
  if (!grantedScope) {
    // Noch nie verbunden: ein stiller Versuch (prompt:'') würde ohnehin fehlschlagen,
    // da es keine aktive Google-Zustimmung gibt - er würde aber das kurze Zeitfenster
    // verbrauchen, in dem mobile Browser nach einem Klick noch ein Popup erlauben.
    // Deshalb hier direkt und einzig den sichtbaren Dialog anzeigen.
    return await requestToken(settings, 'consent');
  }
  try {
    // Erst still versuchen: Wenn der Nutzer schon einmal zugestimmt hat und die
    // Google-Sitzung im Browser noch aktiv ist, erneuert Google den Zugriff ohne
    // sichtbaren Dialog. Nur wenn das nicht klappt (erste Verbindung, Zugriff
    // widerrufen o.ä.) kommt der normale Auswahl-/Zustimmungsdialog.
    return await requestToken(settings, '');
  } catch {
    return await requestToken(settings, 'consent');
  }
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  grantedScope = '';
  localStorage.removeItem('nv-google-token');
  localStorage.removeItem('nv-google-token-exp');
  localStorage.removeItem('nv-google-token-scope');
}

async function ensureToken() {
  if (isConnected()) return accessToken;
  await connect();
  return accessToken;
}

async function apiFetch(url, options = {}) {
  const token = await ensureToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    accessToken = null;
    localStorage.removeItem('nv-google-token');
    throw new Error('Google-Sitzung abgelaufen. Bitte erneut verbinden.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google-API-Fehler (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Calendar ---

export async function listCalendarEvents({ calendarId = 'primary', timeMin, timeMax }) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
    timeMin,
    timeMax,
  });
  const data = await apiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return data.items || [];
}

export async function insertCalendarEvent(calendarId, event) {
  return apiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

export async function updateCalendarEvent(calendarId, eventId, event) {
  return apiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

export async function deleteCalendarEvent(calendarId, eventId) {
  try {
    await apiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    if (!String(err.message).includes('404') && !String(err.message).includes('410')) throw err;
  }
}

// --- Gmail ---

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendEmailWithAttachment({
  to, subject, bodyText, attachmentName, attachmentBlob, mimeType = 'application/pdf',
  inReplyTo, referencesHeader, threadId,
}) {
  const attachmentBytes = new Uint8Array(await attachmentBlob.arrayBuffer());
  const boundary = 'nvBoundary' + Date.now();
  let headerPart =
    `To: ${to}\r\n` +
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n`;
  if (inReplyTo) {
    headerPart += `In-Reply-To: ${inReplyTo}\r\n`;
    headerPart += `References: ${(referencesHeader ? referencesHeader + ' ' : '') + inReplyTo}\r\n`;
  }
  headerPart +=
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    `${bodyText}\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; name="${attachmentName}"\r\n` +
    `Content-Disposition: attachment; filename="${attachmentName}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n`;
  const footerPart = `\r\n--${boundary}--`;

  const headerBytes = new TextEncoder().encode(headerPart);
  const attachmentB64 = base64UrlEncodeBytes(attachmentBytes).replace(/-/g, '+').replace(/_/g, '/');
  const attachmentB64WithPadding = attachmentB64 + '='.repeat((4 - (attachmentB64.length % 4)) % 4);
  const bodyBytes = new TextEncoder().encode(attachmentB64WithPadding + footerPart);

  const combined = new Uint8Array(headerBytes.length + bodyBytes.length);
  combined.set(headerBytes, 0);
  combined.set(bodyBytes, headerBytes.length);
  const raw = base64UrlEncodeBytes(combined);

  const body = { raw };
  if (threadId) body.threadId = threadId;
  return apiFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function searchEmailsForAddress(email, maxResults = 8) {
  if (!email) return [];
  const q = `to:${email} OR from:${email}`;
  const list = await apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`);
  const messages = list.messages || [];
  const details = await Promise.all(messages.map((m) =>
    apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`)
  ));
  return details.map((d) => {
    const headers = Object.fromEntries((d.payload?.headers || []).map((h) => [h.name, h.value]));
    return {
      id: d.id,
      threadId: d.threadId,
      subject: headers.Subject || '(kein Betreff)',
      from: headers.From || '',
      date: headers.Date || '',
      snippet: d.snippet || '',
    };
  });
}

// --- Postfach (Posteingang lesen/schreiben) ---

function decodeBase64UrlToText(data) {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeBase64UrlToBytes(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function walkMessageParts(part, acc) {
  if (!part) return;
  if (part.parts && part.parts.length) {
    part.parts.forEach((p) => walkMessageParts(p, acc));
    return;
  }
  const mimeType = part.mimeType || '';
  if (part.filename && part.body && (part.body.attachmentId || part.body.data)) {
    acc.attachments.push({
      filename: part.filename,
      mimeType,
      attachmentId: part.body.attachmentId || null,
      size: part.body.size || 0,
    });
  } else if (mimeType === 'text/plain' && part.body?.data) {
    acc.text += decodeBase64UrlToText(part.body.data);
  } else if (mimeType === 'text/html' && part.body?.data) {
    acc.html += decodeBase64UrlToText(part.body.data);
  }
}

/** Listet nur die nackten Nachrichten-IDs (kein Metadaten-Fanout) – für den Vollimport, wo ohnehin gleich der volle Body je Nachricht geladen wird. */
export async function listMessageIds({ query = '', maxResults = 100, pageToken } = {}) {
  const params = new URLSearchParams({ maxResults: String(maxResults), q: query });
  if (pageToken) params.set('pageToken', pageToken);
  const list = await apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  return {
    nextPageToken: list.nextPageToken || null,
    resultSizeEstimate: list.resultSizeEstimate || 0,
    ids: (list.messages || []).map((m) => m.id),
  };
}

/** Listet Nachrichten (Standard: Posteingang) mit Metadaten (ohne vollen Body) für die Übersichtsliste. */
export async function listInboxMessages({ query = 'in:inbox', maxResults = 25, pageToken } = {}) {
  const params = new URLSearchParams({ maxResults: String(maxResults), q: query });
  if (pageToken) params.set('pageToken', pageToken);
  const list = await apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  const messages = list.messages || [];
  const details = await Promise.all(messages.map((m) =>
    apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`)
  ));
  return {
    nextPageToken: list.nextPageToken || null,
    messages: details.map((d) => {
      const headers = Object.fromEntries((d.payload?.headers || []).map((h) => [h.name, h.value]));
      return {
        id: d.id,
        threadId: d.threadId,
        subject: headers.Subject || '(kein Betreff)',
        from: headers.From || '',
        to: headers.To || '',
        date: headers.Date || '',
        snippet: d.snippet || '',
        unread: (d.labelIds || []).includes('UNREAD'),
      };
    }),
  };
}

/** Lädt eine Nachricht vollständig (Text/HTML-Body + Anhangsliste) zum Lesen/Beantworten. */
export async function getMessageFull(id) {
  const d = await apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
  const headers = Object.fromEntries((d.payload?.headers || []).map((h) => [h.name, h.value]));
  const acc = { text: '', html: '', attachments: [] };
  walkMessageParts(d.payload, acc);
  return {
    id: d.id,
    threadId: d.threadId,
    subject: headers.Subject || '(kein Betreff)',
    from: headers.From || '',
    to: headers.To || '',
    date: headers.Date || '',
    messageIdHeader: headers['Message-ID'] || headers['Message-Id'] || '',
    referencesHeader: headers.References || '',
    text: acc.text,
    html: acc.html,
    attachments: acc.attachments,
    unread: (d.labelIds || []).includes('UNREAD'),
    labelIds: d.labelIds || [],
  };
}

/** Lädt die Rohdaten eines Anhangs (als Bytes, der Aufrufer verpackt sie mit passendem mimeType als Blob). */
export async function getAttachmentData(messageId, attachmentId) {
  const d = await apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return decodeBase64UrlToBytes(d.data);
}

/** Markiert eine Nachricht als gelesen (entfernt das UNREAD-Label). */
export async function markAsRead(id) {
  return apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

/** Verschiebt eine Nachricht in den Gmail-Papierkorb (dort 30 Tage wiederherstellbar, kein Hard-Delete). */
export async function trashMessage(id) {
  return apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/trash`, {
    method: 'POST',
  });
}

/** Liest die in Gmail hinterlegte Standard-Signatur der primären Absenderadresse aus (HTML). */
export async function getSignature() {
  const data = await apiFetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs');
  const sendAs = data.sendAs || [];
  const primary = sendAs.find((s) => s.isPrimary) || sendAs[0];
  return primary?.signature || '';
}

/** Verfasst/beantwortet eine einfache Text-E-Mail (ohne Anhang). */
export async function sendEmail({ to, subject, bodyText, inReplyTo, referencesHeader, threadId }) {
  let headerPart = `To: ${to}\r\n` +
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n`;
  if (inReplyTo) {
    headerPart += `In-Reply-To: ${inReplyTo}\r\n`;
    headerPart += `References: ${(referencesHeader ? referencesHeader + ' ' : '') + inReplyTo}\r\n`;
  }
  headerPart += `MIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${bodyText}`;
  const raw = base64UrlEncode(headerPart);
  const body = { raw };
  if (threadId) body.threadId = threadId;
  return apiFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Drive (automatisches Cloud-Backup) ---

const BACKUP_NAME_PREFIX = 'neuverdrahtet-backup-';
const BACKUP_KEEP_COUNT = 30;
const BACKUP_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~20h, damit ein Backup pro Tag reicht

/** Lädt ein Backup (JSON-Text) als neue Datei in Google Drive hoch (nur App-eigene Dateien, drive.file-Scope). */
export async function uploadBackupToDrive({ filename, jsonText }) {
  const boundary = 'nvDriveBoundary' + Date.now();
  const metadata = { name: filename, mimeType: 'application/json' };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonText}\r\n` +
    `--${boundary}--`;
  return apiFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

/** Listet die von dieser App in Drive abgelegten Backups (neueste zuerst). */
export async function listDriveBackups() {
  const params = new URLSearchParams({
    q: `name contains '${BACKUP_NAME_PREFIX}' and trashed = false`,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,createdTime,size)',
    pageSize: '100',
  });
  const data = await apiFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  return data.files || [];
}

export async function deleteDriveFile(fileId) {
  return apiFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

/** Lädt den Inhalt eines Backups zum Wiederherstellen herunter (Rohinhalt, keine JSON-API-Hülle). */
export async function downloadDriveFileContent(fileId) {
  const token = await ensureToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google-API-Fehler (${res.status})`);
  return res.text();
}

async function pruneOldDriveBackups() {
  const files = await listDriveBackups();
  const toDelete = files.slice(BACKUP_KEEP_COUNT);
  for (const f of toDelete) {
    await deleteDriveFile(f.id).catch(() => { /* einzelnes fehlgeschlagenes Aufräumen soll den Rest nicht blockieren */ });
  }
}

/** Erzwingt sofort ein Backup nach Drive, unabhängig vom Zeitintervall (für den manuellen "Jetzt sichern"-Button). */
export async function runBackupNow() {
  const data = await exportAll();
  const filename = `${BACKUP_NAME_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await uploadBackupToDrive({ filename, jsonText: JSON.stringify(data) });
  await setSettings({ driveBackupLastAt: new Date().toISOString() });
  await pruneOldDriveBackups();
}

/** Läuft automatisch nach jeder erfolgreichen Google-Verbindung; sichert höchstens ca. 1x/Tag. */
async function maybeAutoBackup() {
  const settings = await getSettings();
  if (!settings.driveBackupEnabled) return;
  const last = settings.driveBackupLastAt ? new Date(settings.driveBackupLastAt).getTime() : 0;
  if (Date.now() - last < BACKUP_MIN_INTERVAL_MS) return;
  await runBackupNow();
}
