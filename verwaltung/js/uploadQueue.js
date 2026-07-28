// Eigenständige, rohe IndexedDB-Warteschlange (unabhängig vom Firestore/IndexedDB-
// Dual-Mode-System in db.js) für Datei-Uploads, die scheitern, weil das Gerät
// gerade offline ist - z.B. ein Mitarbeiter auf einer Baustelle ohne Empfang,
// der einen Bericht mit Fotos speichert. Firestore selbst puffert Textdaten
// bereits automatisch offline (persistentLocalCache in firebase.js); Firebase-
// Storage-Uploads dagegen schlagen ohne Netz sofort fehl und brauchen diese
// eigene Wiederholungs-Logik.

const DB_NAME = 'nv-upload-queue';
const STORE = 'pending';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function enqueueUpload(path, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ path, blob, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedUploads() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedUpload(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
