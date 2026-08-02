import { getSettings } from './db.js';
import { todayISO } from './utils.js';

export async function generateAngebotFromStichpunkte({ stichpunkte, kundeName, katalog }) {
  const settings = await getSettings();
  if (!settings.aiWorkerUrl) {
    throw new Error('KI-Funktion ist noch nicht eingerichtet (Einstellungen → KI-Angebotserstellung).');
  }
  const res = await fetch(settings.aiWorkerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': settings.aiAppSecret || '',
    },
    body: JSON.stringify({
      stichpunkte,
      kundeName,
      katalog: (katalog || []).map((k) => ({ bezeichnung: k.bezeichnung, einheit: k.einheit, preis: k.preis, steuersatz: k.steuersatz })),
      standardSteuersatz: settings.standardSteuersatz,
    }),
  });
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}

/** Ordnet eine Charge von E-Mails per KI in Kategorien ein (kundenanfrage/rechnung-lieferant/werbung/sonstiges). */
export async function classifyEmails({ emails }) {
  const settings = await getSettings();
  if (!settings.aiWorkerUrl) {
    throw new Error('KI-Funktion ist noch nicht eingerichtet (Einstellungen → KI-Angebotserstellung).');
  }
  // Läuft unbeaufsichtigt im Hintergrund (siehe classifyPendingEmails in
  // emailsync.js) - ohne Timeout würde ein hängender Worker-Aufruf die
  // komplette restliche Kategorisierung für immer blockieren, statt nur
  // diesen einen Batch zu überspringen.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(settings.aiWorkerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Secret': settings.aiAppSecret || '',
      },
      body: JSON.stringify({ action: 'email-classify', emails, heute: todayISO() }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Zeitüberschreitung beim KI-Worker (keine Antwort innerhalb von 45s).');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}

/** Lässt einen fotografierten Beleg per KI auslesen (Händler/Datum/Betrag/Kategorie). */
export async function analyzeBeleg({ imageDataUrl, kategorien }) {
  const settings = await getSettings();
  if (!settings.aiWorkerUrl) {
    throw new Error('KI-Funktion ist noch nicht eingerichtet (Einstellungen → KI-Angebotserstellung).');
  }
  const res = await fetch(settings.aiWorkerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': settings.aiAppSecret || '',
    },
    body: JSON.stringify({ action: 'beleg-scan', imageDataUrl, kategorien }),
  });
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}

/** Erzeugt aus einem Foto Social-Media-Texte (Instagram/Facebook/LinkedIn/Google Unternehmensprofil) samt Alt-Text und Hashtags. */
export async function generateSocialPost({ imageDataUrl, firmenname, ort, leistung, kontext }) {
  const settings = await getSettings();
  if (!settings.aiWorkerUrl) {
    throw new Error('KI-Funktion ist noch nicht eingerichtet (Einstellungen → KI-Angebotserstellung).');
  }
  const res = await fetch(settings.aiWorkerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': settings.aiAppSecret || '',
    },
    body: JSON.stringify({ action: 'social-post', imageDataUrl, firmenname, ort, leistung, kontext }),
  });
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Löst über denselben Cloudflare Worker eine Push-Benachrichtigung an die
 * übergebenen FCM-Geräte-Tokens aus. Der Worker braucht dafür zusätzlich das
 * Secret FIREBASE_SERVICE_ACCOUNT_JSON (siehe worker.js-Kommentar). Läuft
 * bewusst "best effort" im Hintergrund - ein Fehler hier darf die eigentliche
 * Aktion (z.B. Postfach-Sync), die die Benachrichtigung ausgelöst hat, nicht
 * stören.
 */
export async function sendPushNotification({ tokens, title, body, url }) {
  if (!tokens || tokens.length === 0) return;
  const settings = await getSettings();
  if (!settings.aiWorkerUrl) return;
  await fetch(settings.aiWorkerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': settings.aiAppSecret || '',
    },
    body: JSON.stringify({ action: 'push-send', tokens, title, body, url }),
  }).catch(() => { /* Push ist ein Komfort-Feature, darf den Aufrufer nicht stören */ });
}
