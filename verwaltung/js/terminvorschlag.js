import { addDays, todayISO } from './utils.js';

const GANZTAGS_TYPEN = ['urlaub', 'krank', 'schulung', 'baustelle'];

function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Regelbasierter Terminvorschlag ohne Kartendienst: sucht den nächsten freien
 * Slot für einen Mitarbeiter innerhalb der Arbeitszeit, unter Berücksichtigung
 * ganztägiger Blocker (Urlaub/Krank/Schulung/Baustelle) und bestehender
 * Termine (mit angenommener Standarddauer, da keine Endzeit gespeichert wird).
 */
export function suggestSlot(termine, mitarbeiterId, {
  durationMinutes = 120, workStart = 7, workEnd = 17, horizonDays = 21, fromDate,
} = {}) {
  const start = fromDate || todayISO();
  for (let d = 0; d < horizonDays; d++) {
    const dateStr = addDays(start, d);
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (dow === 0 || dow === 6) continue;

    const dayTermine = termine.filter((t) => {
      if (!t.mitarbeiterIds?.includes(mitarbeiterId)) return false;
      const s = (t.start || '').slice(0, 10);
      const e = (t.ende || '').slice(0, 10) || s;
      return dateStr >= s && dateStr <= e;
    });
    if (dayTermine.some((t) => GANZTAGS_TYPEN.includes(t.typ))) continue;

    const busy = dayTermine
      .map((t) => {
        const time = (t.start || '').slice(11, 16) || '09:00';
        const [h, m] = time.split(':').map(Number);
        const startMin = h * 60 + m;
        return [startMin, startMin + 60];
      })
      .sort((a, b) => a[0] - b[0]);

    let cursor = workStart * 60;
    for (const [busyStart, busyEnd] of busy) {
      if (busyStart - cursor >= durationMinutes) {
        return { datum: dateStr, uhrzeit: minToTime(cursor) };
      }
      cursor = Math.max(cursor, busyEnd);
    }
    if (workEnd * 60 - cursor >= durationMinutes) {
      return { datum: dateStr, uhrzeit: minToTime(cursor) };
    }
  }
  return null;
}
