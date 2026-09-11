import { getSettings } from './db.js';

/** Ruft eingehende Kontobewegungen der letzten `tage` Tage über den Qonto-Sync-Worker ab. */
export async function holeQontoTransaktionen({ tage = 30 } = {}) {
  const settings = await getSettings();
  if (!settings.qontoWorkerUrl) {
    throw new Error('Qonto-Zahlungsabgleich ist noch nicht eingerichtet (Einstellungen → Qonto-Zahlungsabgleich).');
  }
  const res = await fetch(settings.qontoWorkerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': settings.qontoAppSecret || '',
    },
    body: JSON.stringify({ tage }),
  });
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  const data = await res.json();
  return data.transaktionen || [];
}
