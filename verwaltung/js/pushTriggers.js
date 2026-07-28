import { getAll, getSettings, setSettings } from './db.js';
import { todayISO } from './utils.js';
import * as push from './push.js';

/**
 * Prüft beim App-Start auf Dinge, die sonst leicht übersehen werden
 * (fällige Mahnungen, fällige Geräteprüfungen), und benachrichtigt
 * admin/buero-Geräte höchstens einmal pro Tag je Anlass (Dedup über ein
 * Datumsfeld in den Settings) - unabhängig davon, welche Seite gerade
 * geöffnet wird. push.notifyRoles() selbst ist bereits ein No-Op, wenn
 * Push in diesem Browser/Modus nicht verfügbar ist.
 */
export async function checkPushTriggers() {
  const settings = await getSettings();
  await checkFaelligeMahnungen(settings).catch(() => { /* Push ist ein Komfort-Feature */ });
  await checkFaelligeGeraetePruefungen(settings).catch(() => { /* Push ist ein Komfort-Feature */ });
}

async function checkFaelligeMahnungen(settings) {
  const today = todayISO();
  if (settings.pushNotifiedMahnungenAm === today) return;

  const [rechnungen, mahnungen] = await Promise.all([getAll('rechnungen'), getAll('mahnungen')]);
  const bereit = rechnungen.filter((r) => {
    if (r.status !== 'offen' && r.status !== 'teilbezahlt') return false;
    if (!r.faelligAm || r.faelligAm >= today) return false;
    const mahnungenFuerR = mahnungen.filter((m) => m.rechnungId === r.id).sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));
    const letzte = mahnungenFuerR[mahnungenFuerR.length - 1];
    const wartetBis = letzte ? letzte.neueFrist : r.faelligAm;
    return !wartetBis || wartetBis < today;
  });
  if (bereit.length === 0) return;

  await push.notifyRoles(['admin', 'buero'], {
    title: 'Fällige Mahnungen',
    body: `${bereit.length} Rechnung${bereit.length === 1 ? '' : 'en'} bereit für die nächste Mahnstufe.`,
    url: './index.html#/mahnungen',
  });
  await setSettings({ pushNotifiedMahnungenAm: today });
}

async function checkFaelligeGeraetePruefungen(settings) {
  const today = todayISO();
  if (settings.pushNotifiedGeraetePruefungAm === today) return;

  const geraete = await getAll('geraete');
  const faellig = geraete.filter((g) => g.naechstePruefung && g.naechstePruefung <= today);
  if (faellig.length === 0) return;

  await push.notifyRoles(['admin', 'buero'], {
    title: 'Fällige Geräteprüfungen',
    body: `${faellig.length} Gerät${faellig.length === 1 ? '' : 'e'} mit fälliger nächster Prüfung.`,
    url: './index.html#/geraete',
  });
  await setSettings({ pushNotifiedGeraetePruefungAm: today });
}
