import { firebaseConfig } from './firebase-config.js';
import { selfhostConfig } from './selfhost-config.js';
import { uploadFileSelfhost, deleteFileSelfhost } from './selfhostClient.js';
import { enqueueUpload, listQueuedUploads, removeQueuedUpload } from './uploadQueue.js';
import { toast } from './utils.js';

// Solange weder Selfhost-Server noch Firebase-Projekt konfiguriert sind,
// werden Blobs weiterhin direkt in IndexedDB gespeichert (unverändertes
// Verhalten). Im Firebase-Modus können Blobs nicht direkt in
// Firestore-Dokumenten liegen (kein unterstützter Feldtyp, zusätzlich
// 1-MB-Dokumentgrenze) - sie werden stattdessen in Firebase Storage
// hochgeladen; das Firestore-Dokument bekommt nur URL/Pfad/Mime/Größe statt
// des rohen Blobs. Im Selfhost-Modus gilt dieselbe Begründung für den
// eigenen Server statt Firebase Storage.
const SELFHOST_ENABLED = !!selfhostConfig.enabled;
// Name bewusst beibehalten (siehe fotos.js/ausgaben.js/... - Gate "gibt es
// einen echten Upload-Backend-Dienst").
export const FIREBASE_ENABLED = SELFHOST_ENABLED || !!firebaseConfig.projectId;

function isNetworkError(err) {
  return !navigator.onLine
    || err?.code === 'storage/retry-limit-exceeded'
    || err?.code === 'storage/unknown'
    || /network|failed to fetch/i.test(err?.message || '');
}

// Ohne diese Absicherung blieb ein Upload, der wegen fehlender Storage-
// Berechtigung/-Konfiguration am Backend nie eine Antwort bekommt, im
// UI für immer auf "Lädt ..." hängen - kein Fehler, keine Rückmeldung.
// Der Timeout sorgt dafür, dass der Nutzer nach spätestens 30s eine klare
// Fehlermeldung sieht statt einer endlosen Wartezeit.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Lädt einen Blob nach Firebase Storage hoch. Schlägt der Upload wegen
 * fehlendem Netz fehl (typischer Außendienst-Fall: Baustelle ohne Empfang),
 * wird der Blob stattdessen lokal zwischengespeichert (siehe uploadQueue.js)
 * und ein Platzhalter mit pendingUpload:true zurückgegeben - der Aufrufer
 * speichert sein Firestore-Dokument dadurch trotzdem ganz normal, nur ohne
 * echte URL. trySyncPendingUploads() holt das später nach, sobald wieder
 * Netz da ist.
 */
// Ohne Obergrenze könnte ein eingeloggter Nutzer (versehentlich oder per
// Skript) beliebig große Dateien hochladen und dabei unkontrolliert
// Firebase-Storage-Kosten verursachen - storage.rules erzwingt dieselbe
// Grenze serverseitig, diese Prüfung hier gibt nur die schnellere,
// verständlichere Fehlermeldung VOR dem eigentlichen Upload-Versuch.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// Backend-spezifischer Upload/Download/Löschvorgang - der Rest (Größenlimit,
// Offline-Warteschlange, Timeouts) ist für Selfhost und Firebase identisch,
// siehe uploadBlobToStorage/deleteBlobFromStorage unten.
async function uploadToBackend(path, blob) {
  if (SELFHOST_ENABLED) {
    const meta = await withTimeout(
      uploadFileSelfhost(path, blob),
      30000, 'Hochladen abgebrochen (Zeitüberschreitung nach 30 Sekunden). Bitte Internetverbindung prüfen und erneut versuchen.',
    );
    return { url: meta.url, path, mime: blob.type || '', size: blob.size || 0 };
  }
  const { storage } = await import('./firebase.js');
  const { ref, uploadBytes, getDownloadURL } = await import('./vendor/firebase/firebase-storage.js');
  const storageRef = ref(storage, path);
  await withTimeout(
    uploadBytes(storageRef, blob, { contentType: blob.type || 'application/octet-stream' }),
    30000, 'Hochladen abgebrochen (Zeitüberschreitung nach 30 Sekunden). Bitte Internetverbindung prüfen und erneut versuchen.',
  );
  const url = await withTimeout(
    getDownloadURL(storageRef),
    15000, 'Datei wurde hochgeladen, aber die Download-URL konnte nicht abgerufen werden (Zeitüberschreitung).',
  );
  return { url, path, mime: blob.type || '', size: blob.size || 0 };
}

async function deleteFromBackend(path) {
  if (SELFHOST_ENABLED) return deleteFileSelfhost(path);
  const { storage } = await import('./firebase.js');
  const { ref, deleteObject } = await import('./vendor/firebase/firebase-storage.js');
  await deleteObject(ref(storage, path));
}

export async function uploadBlobToStorage(path, blob) {
  if ((blob?.size || 0) > MAX_UPLOAD_BYTES) {
    throw new Error(`Datei ist zu groß (${(blob.size / 1024 / 1024).toFixed(1)} MB) - maximal ${MAX_UPLOAD_BYTES / 1024 / 1024} MB erlaubt.`);
  }
  try {
    if (!navigator.onLine) throw new Error('offline');
    return await uploadToBackend(path, blob);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await enqueueUpload(path, blob);
    toast('Kein Netz - Datei wird gespeichert, sobald wieder Verbindung besteht.', 'info');
    return { url: null, path, mime: blob.type || '', size: blob.size || 0, pendingUpload: true };
  }
}

export async function deleteBlobFromStorage(path) {
  if (!path) return;
  await removeQueuedUpload(path).catch(() => { /* war evtl. nie in der Warteschlange */ });
  try {
    await deleteFromBackend(path);
  } catch {
    // Datei existiert evtl. schon nicht mehr (z.B. doppelt gelöscht, oder war
    // nur lokal in der Warteschlange und nie tatsächlich hochgeladen)
  }
}

async function patchDocForPath(path, meta) {
  const { getAll, put } = await import('./db.js');
  const store = path.split('/')[0];
  if (store === 'fotos' || store === 'dokumente') {
    const alle = await getAll(store);
    const doc = alle.find((d) => d.path === path);
    if (doc) await put(store, { ...doc, ...meta });
  } else if (store === 'ausgaben') {
    const alle = await getAll('ausgaben');
    const eintrag = alle.find((a) => a.beleg?.path === path);
    if (eintrag) await put('ausgaben', { ...eintrag, beleg: meta });
  } else if (store === 'zeiterfassung') {
    const alle = await getAll('zeiterfassung');
    const eintrag = alle.find((z) => (z.medien || []).some((m) => m.path === path));
    if (eintrag) {
      const medien = eintrag.medien.map((m) => (m.path === path ? { ...m, dataUrl: meta.url, pendingUpload: undefined } : m));
      await put('zeiterfassung', { ...eintrag, medien });
    }
  }
}

/** Versucht alle offline zwischengespeicherten Uploads erneut - aufgerufen bei Verbindung/App-Start. */
export async function trySyncPendingUploads() {
  if (!FIREBASE_ENABLED || !navigator.onLine) return;
  const queued = await listQueuedUploads();
  if (queued.length === 0) return;
  let synced = 0;
  for (const item of queued) {
    try {
      const result = await uploadToBackend(item.path, item.blob);
      const meta = { url: result.url, path: item.path, mime: item.blob.type || '', size: item.blob.size || 0, pendingUpload: undefined };
      await patchDocForPath(item.path, meta);
      await removeQueuedUpload(item.path);
      synced += 1;
    } catch {
      // Netz evtl. schon wieder weg oder noch instabil - beim nächsten
      // Aufruf (nächstes "online"-Event/App-Start) erneut versuchen
    }
  }
  if (synced > 0) toast(`${synced} zwischengespeicherte Datei(en) hochgeladen.`, 'success');
}
