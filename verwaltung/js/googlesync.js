import { getAll, put, remove, getSettings } from './db.js';
import { uid } from './utils.js';
import * as google from './google.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoToLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToRfc3339(local) {
  return new Date(local.length === 10 ? `${local}T00:00` : local).toISOString();
}

function addMinutes(local, minutes) {
  const d = new Date(local.length === 10 ? `${local}T00:00` : local);
  d.setMinutes(d.getMinutes() + minutes);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toGoogleEvent(termin) {
  const end = termin.ende || addMinutes(termin.start, 60);
  return {
    summary: termin.titel || '(ohne Titel)',
    location: termin.ort || undefined,
    description: termin.notizen || undefined,
    start: { dateTime: localInputToRfc3339(termin.start) },
    end: { dateTime: localInputToRfc3339(end) },
  };
}

function fromGoogleEvent(event) {
  const startIso = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00` : null);
  const endIso = event.end?.dateTime || (event.end?.date ? `${event.end.date}T00:00:00` : null);
  return {
    titel: event.summary || '(ohne Titel)',
    ort: event.location || '',
    notizen: event.description || '',
    start: startIso ? isoToLocalInput(startIso) : '',
    ende: endIso ? isoToLocalInput(endIso) : '',
  };
}

export async function syncCalendar({ silent = false } = {}) {
  const settings = await getSettings();
  if (!settings.googleClientId) {
    throw new Error('Google ist noch nicht eingerichtet (Einstellungen → Google-Verbindung).');
  }
  const calendarId = settings.googleCalendarId || 'primary';

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setMonth(timeMin.getMonth() - 3);
  const timeMax = new Date(now);
  timeMax.setMonth(timeMax.getMonth() + 12);

  const googleEvents = await google.listCalendarEvents({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  });
  const googleById = Object.fromEntries(googleEvents.filter((e) => e.status !== 'cancelled').map((e) => [e.id, e]));

  const allTermine = await getAll('termine');
  const inWindow = (t) => t.start && t.start >= timeMin.toISOString().slice(0, 16) && t.start <= timeMax.toISOString().slice(0, 16);
  const consumedGoogleIds = new Set();

  let created = 0, updated = 0, pulled = 0, deletedLocal = 0, pushedNew = 0;

  for (const termin of allTermine) {
    if (!termin.googleEventId) continue;
    if (!inWindow(termin)) continue;
    const gEvent = googleById[termin.googleEventId];
    if (!gEvent) {
      await remove('termine', termin.id);
      deletedLocal++;
      continue;
    }
    consumedGoogleIds.add(termin.googleEventId);

    const syncedAt = termin.googleSyncedAt || '';
    const localChanged = !syncedAt || (termin.aktualisiertAm || '') > syncedAt;
    const googleChanged = !syncedAt || (gEvent.updated || '') > syncedAt;

    if (googleChanged && (!localChanged || (gEvent.updated || '') >= (termin.aktualisiertAm || ''))) {
      const fields = fromGoogleEvent(gEvent);
      const merged = { ...termin, ...fields, googleSyncedAt: gEvent.updated, aktualisiertAm: new Date().toISOString() };
      await put('termine', merged);
      pulled++;
    } else if (localChanged) {
      const resp = await google.updateCalendarEvent(calendarId, termin.googleEventId, toGoogleEvent(termin));
      await put('termine', { ...termin, googleSyncedAt: resp.updated });
      updated++;
    }
  }

  for (const termin of allTermine) {
    if (termin.googleEventId) continue;
    if (!inWindow(termin)) continue;
    const resp = await google.insertCalendarEvent(calendarId, toGoogleEvent(termin));
    await put('termine', { ...termin, googleEventId: resp.id, googleSyncedAt: resp.updated });
    consumedGoogleIds.add(resp.id);
    pushedNew++;
  }

  for (const [id, gEvent] of Object.entries(googleById)) {
    if (consumedGoogleIds.has(id)) continue;
    const fields = fromGoogleEvent(gEvent);
    if (!fields.start) continue;
    await put('termine', {
      id: uid(), ...fields, kundeId: '', projektId: '', mitarbeiterIds: [],
      googleEventId: id, googleSyncedAt: gEvent.updated, aktualisiertAm: new Date().toISOString(),
    });
    created++;
  }

  return { created, updated, pulled, deletedLocal, pushedNew };
}

export async function deleteSyncedEvent(termin) {
  if (!termin.googleEventId) return;
  const settings = await getSettings();
  if (!settings.googleClientId || !google.isConnected()) return;
  await google.deleteCalendarEvent(settings.googleCalendarId || 'primary', termin.googleEventId);
}
