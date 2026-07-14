import { getSettings } from './db.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

let tokenClient = null;
let accessToken = sessionStorage.getItem('nv-google-token') || null;
let tokenExpiresAt = Number(sessionStorage.getItem('nv-google-token-exp') || 0);
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
  return !!accessToken && Date.now() < tokenExpiresAt;
}

export async function isConfigured() {
  const settings = await getSettings();
  return !!settings.googleClientId;
}

export async function connect() {
  const settings = await getSettings();
  if (!settings.googleClientId) {
    throw new Error('Bitte zuerst in den Einstellungen die Google Client-ID hinterlegen.');
  }
  await loadGis();
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
        sessionStorage.setItem('nv-google-token', accessToken);
        sessionStorage.setItem('nv-google-token-exp', String(tokenExpiresAt));
        resolve(accessToken);
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google-Anmeldung abgebrochen.')),
    });
    tokenClient.requestAccessToken({ prompt: isConnected() ? '' : 'consent' });
  });
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  sessionStorage.removeItem('nv-google-token');
  sessionStorage.removeItem('nv-google-token-exp');
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
    sessionStorage.removeItem('nv-google-token');
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

export async function sendEmailWithAttachment({ to, subject, bodyText, attachmentName, attachmentBlob }) {
  const attachmentBytes = new Uint8Array(await attachmentBlob.arrayBuffer());
  const boundary = 'nvBoundary' + Date.now();
  const headerPart =
    `To: ${to}\r\n` +
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    `${bodyText}\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/pdf; name="${attachmentName}"\r\n` +
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

  return apiFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
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
