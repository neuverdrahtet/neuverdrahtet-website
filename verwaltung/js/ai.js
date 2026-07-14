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
