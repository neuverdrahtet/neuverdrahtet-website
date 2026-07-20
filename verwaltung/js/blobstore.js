import { firebaseConfig } from './firebase-config.js';

// Solange kein Firebase-Projekt konfiguriert ist, werden Blobs weiterhin
// direkt in IndexedDB gespeichert (unverändertes Verhalten). Im Firebase-
// Modus können Blobs nicht direkt in Firestore-Dokumenten liegen (kein
// unterstützter Feldtyp, zusätzlich 1-MB-Dokumentgrenze) - sie werden
// stattdessen in Firebase Storage hochgeladen; das Firestore-Dokument
// bekommt nur URL/Pfad/Mime/Größe statt des rohen Blobs.
export const FIREBASE_ENABLED = !!firebaseConfig.projectId;

export async function uploadBlobToStorage(path, blob) {
  const { storage } = await import('./firebase.js');
  const { ref, uploadBytes, getDownloadURL } = await import('./vendor/firebase/firebase-storage.js');
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'application/octet-stream' });
  const url = await getDownloadURL(storageRef);
  return { url, path, mime: blob.type || '', size: blob.size || 0 };
}

export async function deleteBlobFromStorage(path) {
  if (!path) return;
  const { storage } = await import('./firebase.js');
  const { ref, deleteObject } = await import('./vendor/firebase/firebase-storage.js');
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Datei existiert evtl. schon nicht mehr (z.B. doppelt gelöscht) - kein Fehler nötig
  }
}
