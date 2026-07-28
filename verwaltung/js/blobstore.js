import { firebaseConfig } from './firebase-config.js';
import { enqueueUpload, listQueuedUploads, removeQueuedUpload } from './uploadQueue.js';
import { toast } from './utils.js';

// Solange kein Firebase-Projekt konfiguriert ist, werden Blobs weiterhin
// direkt in IndexedDB gespeichert (unverändertes Verhalten). Im Firebase-
// Modus können Blobs nicht direkt in Firestore-Dokumenten liegen (kein
// unterstützter Feldtyp, zusätzlich 1-MB-Dokumentgrenze) - sie werden
// stattdessen in Firebase Storage hochgeladen; das Firestore-Dokument
// bekommt nur URL/Pfad/Mime/Größe statt des rohen Blobs.
export const FIREBASE_ENABLED = !!firebaseConfig.projectId;

function isNetworkError(err) {
  return !navigator.onLine
    || err?.code === 'storage/retry-limit-exceeded'
    || err?.code === 'storage/unknown'
    || /network|failed to fetch/i.test(err?.message || '');
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
export async function uploadBlobToStorage(path, blob) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    const { storage } = await import('./firebase.js');
    const { ref, uploadBytes, getDownloadURL } = await import('./vendor/firebase/firebase-storage.js');
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob, { contentType: blob.type || 'application/octet-stream' });
    const url = await getDownloadURL(storageRef);
    return { url, path, mime: blob.type || '', size: blob.size || 0 };
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
  const { storage } = await import('./firebase.js');
  const { ref, deleteObject } = await import('./vendor/firebase/firebase-storage.js');
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Datei existiert evtl. schon nicht mehr (z.B. doppelt gelöscht, oder war
    // nur lokal in der Warteschlange und nie tatsächlich hochgeladen)
  }
}

async function patchDocForPath(path, meta) {
  const { getAll, put } = await import('./db.js');
  const store = path.split('/')[0];
  if (store === 'dokumente') {
    const alle = await getAll('dokumente');
    const doc = alle.find((d) => d.path === path);
    if (doc) await put('dokumente', { ...doc, ...meta });
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
  const { storage } = await import('./firebase.js');
  const { ref, uploadBytes, getDownloadURL } = await import('./vendor/firebase/firebase-storage.js');
  let synced = 0;
  for (const item of queued) {
    try {
      const storageRef = ref(storage, item.path);
      await uploadBytes(storageRef, item.blob, { contentType: item.blob.type || 'application/octet-stream' });
      const url = await getDownloadURL(storageRef);
      const meta = { url, path: item.path, mime: item.blob.type || '', size: item.blob.size || 0, pendingUpload: undefined };
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
