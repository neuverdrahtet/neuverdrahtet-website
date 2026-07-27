import { getAll, put, setSettings } from './db.js';
import * as google from './google.js';

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
