import { getSettings } from './db.js';

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
      body: JSON.stringify({ action: 'email-classify', emails }),
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
