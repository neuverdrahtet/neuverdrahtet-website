import { getAll, put, getSettings, setSettings } from './db.js';
import * as google from './google.js';
import { classifyEmails } from './ai.js';
import { uid, nextDailyNummer } from './utils.js';
import * as push from './push.js';

// Wie viele E-Mails pro KI-Aufruf zur Kategorisierung geschickt werden - ein
// guter Kompromiss zwischen Aufrufanzahl (bei z.B. 500+ Mails) und Prompt-Größe.
const CLASSIFY_BATCH_SIZE = 25;

// Firestore-Dokumente dürfen max. 1 MiB groß sein - Mailbodys (v.a. HTML mit
// eingebetteten Bildern) können das sprengen. Großzügig, aber sicher kappen.
const MAX_BODY_LEN = 300000;

// Schneidet nie mitten in einem Surrogatpaar ab (z.B. Emoji, die in JS als
// zwei UTF-16-Einheiten codiert sind) - sonst bleibt ein einzelnes, ungültiges
// High-Surrogate-Zeichen übrig, das beim JSON-Versand an die Anthropic-API
// mit "no low surrogate in string" fehlschlägt.
function safeSlice(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  let end = maxLen;
  const code = str.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return str.slice(0, end);
}

function truncate(text) {
  if (!text || text.length <= MAX_BODY_LEN) return text || '';
  return safeSlice(text, MAX_BODY_LEN) + '\n\n[... gekürzt, Original in Gmail ansehen ...]';
}

function toStoredEmail(full) {
  return {
    id: full.id,
    threadId: full.threadId,
    subject: full.subject,
    from: full.from,
    to: full.to,
    date: full.date,
    dateSort: full.date ? new Date(full.date).toISOString() : '',
    text: truncate(full.text),
    html: truncate(full.html),
    attachments: full.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, attachmentId: a.attachmentId, size: a.size })),
    unread: full.unread,
    messageIdHeader: full.messageIdHeader,
    referencesHeader: full.referencesHeader,
    // "SENT" ist Gmails eigenes Label für von uns gesendete Mails - zuverlässiger
    // als ein Vergleich der Absenderadresse (funktioniert auch bei mehreren Aliassen).
    richtung: (full.labelIds || []).includes('SENT') ? 'ausgang' : 'eingang',
    // Leer bis classifyPendingEmails() sie per KI einsortiert hat (kundenanfrage/
    // rechnung-lieferant/werbung/sonstiges) - läuft automatisch im Hintergrund.
    kategorie: '',
    // Leer bis verknuepfeEmailsMitKundenUndProjekten() sie per Adressabgleich
    // automatisch einem Kunden/Projekt zugeordnet hat - ebenfalls automatisch.
    kundeId: '', projektId: '',
    importedAt: new Date().toISOString(),
  };
}

async function fetchAndStoreBatch(ids, concurrency = 5) {
  let stored = 0;
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const fulls = await Promise.all(chunk.map((id) => google.getMessageFull(id).catch(() => null)));
    for (const full of fulls) {
      if (!full) continue;
      await put('emails', toStoredEmail(full));
      stored++;
    }
  }
  return stored;
}

/**
 * Lädt das komplette Postfach (alle Mails außer Spam/Papierkorb, Gmails
 * Standard-Suchausschluss) einmalig in den lokalen Speicher. Kann bei großen
 * Postfächern mehrere Minuten dauern, da Gmail pro Nachricht einen eigenen
 * API-Aufruf für den vollen Inhalt braucht - läuft daher in kleinen Batches,
 * meldet Fortschritt über onProgress und speichert laufend, statt erst am Ende.
 */
export async function fullImport({ onProgress } = {}) {
  let pageToken = null;
  let totalStored = 0;
  let estimate = 0;
  do {
    const page = await google.listMessageIds({ query: '', maxResults: 100, pageToken });
    estimate = Math.max(estimate, page.resultSizeEstimate || 0);
    totalStored += await fetchAndStoreBatch(page.ids);
    pageToken = page.nextPageToken;
    if (onProgress) onProgress({ done: totalStored, estimate });
  } while (pageToken);

  await setSettings({
    emailImportDone: true,
    emailImportCount: totalStored,
    emailLastSyncAt: new Date().toISOString(),
  });
  return { total: totalStored };
}

/** Holt nur die seit dem letzten Sync neu eingetroffenen Mails nach (schnell, für jeden Postfach-Aufruf gedacht). */
export async function incrementalSync({ onProgress } = {}) {
  const existing = await getAll('emails');
  const knownIds = new Set(existing.map((e) => e.id));

  let dates = existing.map((e) => e.dateSort).filter(Boolean).sort();
  const lastDate = dates.length ? new Date(dates[dates.length - 1]) : null;
  // Gmails "after:"-Operator kennt nur Tage, kein Uhrzeit - einen Tag Puffer
  // zurückgehen, damit an diesem Tag eingetroffene Mails nicht durchrutschen;
  // bereits bekannte IDs werden unten übersprungen, doppelte Arbeit ist selten.
  const after = lastDate ? new Date(lastDate.getTime() - 24 * 60 * 60 * 1000) : null;
  const query = after ? `after:${after.getFullYear()}/${after.getMonth() + 1}/${after.getDate()}` : '';

  let pageToken = null;
  let newIds = [];
  do {
    const page = await google.listMessageIds({ query, maxResults: 100, pageToken });
    newIds = newIds.concat(page.ids.filter((id) => !knownIds.has(id)));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const stored = await fetchAndStoreBatch(newIds);
  await setSettings({ emailLastSyncAt: new Date().toISOString() });
  if (onProgress) onProgress({ done: stored, estimate: stored });
  return { neu: stored };
}

/**
 * Sortiert alle noch nicht kategorisierten E-Mails per KI in eine der festen
 * Kategorien ein (siehe EMAIL_KATEGORIEN in db.js). Läuft in Batches, damit bei
 * großen Postfächern nicht hunderte Einzelaufrufe nötig sind, und schreibt das
 * Ergebnis laufend zurück, damit die Anzeige schon während des Laufs aktuell wird.
 */
const LEERER_KONTAKT = { name: '', email: '', telefon: '', anliegen: '' };

// Legt bei einer als "kundenanfrage" erkannten E-Mail automatisch einen
// Kunden (falls noch nicht vorhanden, per E-Mail-Adresse abgeglichen) samt
// Projekt an - z.B. für Anfragen über das Kontaktformular der eigenen
// Webseite. Der KI-Kontakt-Auszug (nicht das "Absender"-Feld!) liefert die
// echten Kundendaten, da bei Formular-Mails im "Absender" oft nur der
// Formular-Versanddienst steht, nicht der tatsächliche Interessent.
async function autoErstelleKundeAusAnfrage(email) {
  const kontakt = email.kontakt;
  if (!kontakt?.email) return;
  const [kunden, kanbanSpalten, settings] = await Promise.all([getAll('kunden'), getAll('kanbanSpalten'), getSettings()]);
  kanbanSpalten.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const bestehenderKunde = kunden.find((k) => (k.email || '').toLowerCase() === kontakt.email.toLowerCase());

  let kundeId, kundeName;
  if (bestehenderKunde) {
    kundeId = bestehenderKunde.id;
    kundeName = bestehenderKunde.firma;
  } else {
    const { nummer: autoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
      '', { datum: settings.kundeNummerDatum, zaehler: settings.kundeNummerZaehler }
    );
    const neuerKunde = {
      id: uid(), firma: kontakt.name || kontakt.email, ansprechpartner: '', strasse: '', plz: '', ort: '',
      telefon: kontakt.telefon || '', email: kontakt.email, notizen: '', kundennummer: autoNummer,
    };
    await put('kunden', neuerKunde);
    await setSettings({ kundeNummerDatum: nDatum, kundeNummerZaehler: nZaehler });
    kundeId = neuerKunde.id;
    kundeName = neuerKunde.firma;
  }

  const titel = kontakt.anliegen || email.subject || 'Anfrage';
  const projekt = {
    id: uid(), titel, kundeId, status: kanbanSpalten[0]?.id || '',
    beschreibung: `Automatisch aus E-Mail-Anfrage angelegt.\n\nBetreff: ${email.subject || ''}\n${kontakt.anliegen ? '\n' + kontakt.anliegen : ''}`,
    start: '', ende: '', mitarbeiterIds: [], bereich: 'auftrag', kategorieId: '', gewerk: '',
    // Auffällige Farbe + Kennzeichnung, damit die Karte im Kanban sofort ins
    // Auge fällt - wird beim ersten Öffnen der Karte wieder zurückgesetzt.
    farbe: '#f59e0b', autoErstellt: true, createdAt: new Date().toISOString(),
  };
  await put('projekte', projekt);
  await put('emails', { ...email, kundeAngelegtId: projekt.id });

  push.notifyRoles(['admin', 'buero'], {
    title: 'Neuer Kunde aus E-Mail-Anfrage',
    body: `${kundeName}: ${titel}`,
    url: './index.html#/postfach',
  }).catch(() => { /* Push ist ein Komfort-Feature */ });

  return { kundeId, projektId: projekt.id };
}

const DATUM_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT_REGEX = /^\d{2}:\d{2}$/;

// Legt bei einer als "kundenanfrage" erkannten E-Mail mit eindeutigem
// Terminwunsch (Datum + Uhrzeit von der KI erkannt) automatisch einen Termin
// in der Plantafel an - noch ohne Mitarbeiter-Zuweisung, damit das Büro ihn
// nur noch bestätigen/verteilen muss statt ihn komplett neu anzulegen.
async function autoErstelleTerminAusAnfrage(email, termin, { kundeId, projektId } = {}) {
  if (!DATUM_REGEX.test(termin?.datum || '') || !UHRZEIT_REGEX.test(termin?.uhrzeit || '')) return;
  const kontakt = email.kontakt;
  const terminStatus = await getAll('terminStatus');
  terminStatus.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));

  const titel = kontakt?.anliegen || email.subject || 'Termin';
  const neuerTermin = {
    id: uid(), titel, typ: 'termin', start: `${termin.datum}T${termin.uhrzeit}`, ende: '', ort: '',
    kundeId: kundeId || '', projektId: projektId || '',
    mitarbeiterIds: [], geraeteIds: [], flottenIds: [],
    notizen: `Automatisch aus E-Mail-Anfrage erkannt.\n\nBetreff: ${email.subject || ''}`,
    // Auffällige Farbe + Kennzeichnung, damit der Termin in der Plantafel
    // sofort ins Auge fällt - wird beim ersten Öffnen wieder zurückgesetzt.
    farbe: '#f59e0b', autoErstellt: true, status: terminStatus[0]?.id || 'geplant',
  };
  await put('termine', neuerTermin);
  await put('emails', { ...email, terminAngelegtId: neuerTermin.id });

  push.notifyRoles(['admin', 'buero'], {
    title: 'Neuer Termin aus E-Mail-Anfrage',
    body: `${titel} am ${termin.datum} um ${termin.uhrzeit} Uhr`,
    url: './index.html#/plantafel',
  }).catch(() => { /* Push ist ein Komfort-Feature */ });
}

const EMAIL_ADRESSE_REGEX = /<([^<>]+@[^<>]+)>|([^\s<>"]+@[^\s<>"]+)/;

/** Extrahiert die reine Adresse aus einem Header-String wie "Max Mustermann <max@example.com>". */
function extrahiereAdresse(headerText) {
  const match = EMAIL_ADRESSE_REGEX.exec(headerText || '');
  return (match?.[1] || match?.[2] || '').trim().toLowerCase();
}

/**
 * Verknüpft synchronisierte E-Mails automatisch mit dem passenden Kunden
 * (per Adressabgleich) und - falls eindeutig genau ein Projekt zum Kunden
 * gehört - auch direkt mit dem Projekt, damit die Korrespondenz in der
 * jeweiligen Kunden-/Projektakte auftaucht, ohne dass jemand die E-Mail
 * manuell zuordnen muss. Läuft rein lokal (kein KI-Aufruf nötig), deshalb
 * unabhängig von der KI-Kategorisierung bei jedem Postfach-Aufruf erneut
 * für noch unverknüpfte E-Mails. Gibt die Anzahl neu verknüpfter Mails zurück.
 */
export async function verknuepfeEmailsMitKundenUndProjekten() {
  const [alle, kunden, projekte] = await Promise.all([getAll('emails'), getAll('kunden'), getAll('projekte')]);
  const offen = alle.filter((e) => !e.kundeId);
  if (offen.length === 0) return 0;
  const kundeByEmail = new Map();
  for (const k of kunden) {
    const adresse = (k.email || '').trim().toLowerCase();
    if (adresse && !kundeByEmail.has(adresse)) kundeByEmail.set(adresse, k);
  }
  const projekteByKunde = new Map();
  for (const p of projekte) {
    if (!p.kundeId) continue;
    if (!projekteByKunde.has(p.kundeId)) projekteByKunde.set(p.kundeId, []);
    projekteByKunde.get(p.kundeId).push(p);
  }
  let verknuepft = 0;
  for (const e of offen) {
    const gegenpartei = extrahiereAdresse(e.richtung === 'ausgang' ? e.to : e.from);
    if (!gegenpartei) continue;
    const kunde = kundeByEmail.get(gegenpartei);
    if (!kunde) continue;
    const projekteDesKunden = projekteByKunde.get(kunde.id) || [];
    const updated = { ...e, kundeId: kunde.id, projektId: projekteDesKunden.length === 1 ? projekteDesKunden[0].id : '' };
    await put('emails', updated);
    verknuepft++;
  }
  return verknuepft;
}

export async function classifyPendingEmails({ onProgress } = {}) {
  const alle = await getAll('emails');
  const offen = alle.filter((e) => !e.kategorie);
  const settings = await getSettings();
  let erledigt = 0;
  let lastError = null;
  for (let i = 0; i < offen.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = offen.slice(i, i + CLASSIFY_BATCH_SIZE);
    try {
      const { ergebnisse } = await classifyEmails({
        emails: batch.map((e) => ({ id: e.id, subject: e.subject, from: e.from, snippet: safeSlice(e.text || '', 1500) })),
      });
      const ergebnisById = new Map((ergebnisse || []).map((r) => [r.id, r]));
      for (const e of batch) {
        const r = ergebnisById.get(e.id);
        if (!r?.kategorie) continue;
        const updated = { ...e, kategorie: r.kategorie, kontakt: r.kontakt || LEERER_KONTAKT };
        await put('emails', updated);
        erledigt++;
        const istUnbeantworteteAnfrage = updated.kategorie === 'kundenanfrage' && updated.richtung !== 'ausgang';
        let kundeProjekt = null;
        if (istUnbeantworteteAnfrage && settings.autoKundeAusAnfrage && updated.kontakt.email && !updated.kundeAngelegtId) {
          kundeProjekt = await autoErstelleKundeAusAnfrage(updated).catch(() => null);
          // Auto-Anlage darf die Kategorisierung nicht blockieren
        }
        if (istUnbeantworteteAnfrage && settings.autoTerminAusAnfrage && !updated.terminAngelegtId) {
          await autoErstelleTerminAusAnfrage(updated, r.termin, kundeProjekt || {}).catch(() => { /* Auto-Anlage darf die Kategorisierung nicht blockieren */ });
        }
      }
    } catch (err) {
      // Kategorisierung ist ein Komfort-Feature - ein fehlgeschlagener Batch
      // darf die restliche Anzeige nicht stören, aber der Grund darf nicht
      // spurlos verschwinden (sonst sieht man nur "kategorisiert nicht mehr"
      // ohne jeden Hinweis, woran es liegt - siehe auch bulkselect.js).
      lastError = err.message || String(err);
    }
    if (onProgress) onProgress({ done: erledigt, total: offen.length, error: lastError });
  }
  return { done: erledigt, total: offen.length, error: lastError };
}
