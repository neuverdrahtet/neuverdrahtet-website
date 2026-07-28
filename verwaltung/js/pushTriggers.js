import { getAll, put, getSettings, setSettings } from './db.js';
import { todayISO, addDays, formatDate } from './utils.js';
import * as push from './push.js';
import * as google from './google.js';

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
  await checkFaelligeAnlagenPruefungen(settings).catch(() => { /* Push ist ein Komfort-Feature */ });
  await checkTerminErinnerungen(settings).catch(() => { /* E-Mail-Erinnerung ist ein Komfort-Feature */ });
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

async function checkFaelligeAnlagenPruefungen(settings) {
  const today = todayISO();
  if (settings.pushNotifiedAnlagenPruefungAm === today) return;

  const anlagen = await getAll('anlagen');
  const faellig = anlagen.filter((a) => a.naechstePruefung && a.naechstePruefung <= today);
  if (faellig.length === 0) return;

  await push.notifyRoles(['admin', 'buero'], {
    title: 'Fällige Anlagen-Prüfungen',
    body: `${faellig.length} Kundenanlage${faellig.length === 1 ? '' : 'n'} mit fälliger nächster Prüfung.`,
    url: './index.html#/kunden',
  });
  await setSettings({ pushNotifiedAnlagenPruefungAm: today });
}

// Erinnert Kunden per E-Mail an ihren Termin am nächsten Tag (reduziert
// No-Shows). Läuft nur, wenn gerade eine gültige Google-Sitzung besteht -
// sonst würde ensureToken() beim bloßen App-Start ein Login-Popup aufreißen
// (siehe auch das gleiche Muster in postfach.js). Dedup läuft je Termin
// (nicht global pro Tag), da an verschiedenen Tagen verschiedene Termine
// jeweils einmalig ihre eigene Erinnerung bekommen sollen.
async function checkTerminErinnerungen(settings) {
  if (!google.isConnected()) return;
  const morgen = addDays(todayISO(), 1);
  const [termine, kunden] = await Promise.all([getAll('termine'), getAll('kunden')]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));

  const anstehend = termine.filter((t) =>
    t.kundeId && (t.start || '').slice(0, 10) === morgen && !t.erinnerungGesendetAm && kundenById[t.kundeId]?.email
  );
  for (const termin of anstehend) {
    const kunde = kundenById[termin.kundeId];
    const uhrzeit = (termin.start || '').slice(11, 16);
    try {
      await google.sendEmail({
        to: kunde.email,
        subject: `Erinnerung: Ihr Termin morgen bei ${settings.firmenname}`,
        bodyText: `Guten Tag${kunde.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\n` +
          `wir möchten Sie an Ihren Termin morgen erinnern:\n\n` +
          `${termin.titel}\nDatum: ${formatDate(morgen)}${uhrzeit ? ', ' + uhrzeit + ' Uhr' : ''}\n${termin.ort ? 'Ort: ' + termin.ort + '\n' : ''}\n` +
          `Bei Fragen erreichen Sie uns telefonisch unter ${settings.telefon || ''}.\n\n` +
          `Mit freundlichen Grüßen\n${settings.firmenname}`,
      });
      await put('termine', { ...termin, erinnerungGesendetAm: todayISO() });
    } catch { /* einzelner Fehlschlag (z.B. Netzwerk) blockt nicht die übrigen Erinnerungen */ }
  }
}
