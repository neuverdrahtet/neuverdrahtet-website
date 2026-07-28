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

function truncate(text) {
  if (!text || text.length <= MAX_BODY_LEN) return text || '';
  return text.slice(0, MAX_BODY_LEN) + '\n\n[... gekürzt, Original in Gmail ansehen ...]';
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
    start: '', ende: '', mitarbeiterIds: [], bereich: 'auftrag', kategorieId: '', gewerk: '', farbe: '', createdAt: new Date().toISOString(),
  };
  await put('projekte', projekt);
  await put('emails', { ...email, kundeAngelegtId: projekt.id });

  push.notifyRoles(['admin', 'buero'], {
    title: 'Neuer Kunde aus E-Mail-Anfrage',
    body: `${kundeName}: ${titel}`,
    url: './index.html#/postfach',
  }).catch(() => { /* Push ist ein Komfort-Feature */ });
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
        emails: batch.map((e) => ({ id: e.id, subject: e.subject, from: e.from, snippet: (e.text || '').slice(0, 1500) })),
      });
      const ergebnisById = new Map((ergebnisse || []).map((r) => [r.id, r]));
      for (const e of batch) {
        const r = ergebnisById.get(e.id);
        if (!r?.kategorie) continue;
        const updated = { ...e, kategorie: r.kategorie, kontakt: r.kontakt || LEERER_KONTAKT };
        await put('emails', updated);
        erledigt++;
        if (
          settings.autoKundeAusAnfrage && updated.kategorie === 'kundenanfrage' &&
          updated.richtung !== 'ausgang' && updated.kontakt.email && !updated.kundeAngelegtId
        ) {
          await autoErstelleKundeAusAnfrage(updated).catch(() => { /* Auto-Anlage darf die Kategorisierung nicht blockieren */ });
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
