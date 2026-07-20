import { DB_NAME, STORE_NAMES, put } from './db.js';

// Liest die alte, rein lokale IndexedDB direkt aus (unabhängig von db.js"s
// aktuellem Firestore-Modus) - wird nur auf Geräten etwas finden, auf denen
// vor der Mehrbenutzer-Umstellung tatsächlich lokal gearbeitet wurde.
function openLegacyIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readLegacyStore(idb, storeName) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// { storeName: [...rows] } - nur Stores, die es in der alten DB tatsächlich gibt.
export async function readLegacyData() {
  const idb = await openLegacyIndexedDB();
  const data = {};
  for (const storeName of STORE_NAMES) {
    if (!idb.objectStoreNames.contains(storeName)) continue;
    data[storeName] = await readLegacyStore(idb, storeName);
  }
  idb.close();
  return data;
}

export async function previewLegacyData() {
  const data = await readLegacyData();
  const counts = {};
  let total = 0;
  for (const [storeName, rows] of Object.entries(data)) {
    if (rows.length === 0) continue;
    counts[storeName] = rows.length;
    total += rows.length;
  }
  return { counts, total };
}

// Schreibt jede Zeile einzeln über die normale put()-API (die im Firestore-
// Modus automatisch dorthin schreibt) - pro Zeile try/catch, damit einzelne
// zu große Dokumente (Fotos/Belege/Unterschriften über dem 1-MB-Firestore-
// Limit, siehe Phase B) den Rest des Imports nicht abbrechen.
export async function migrateLegacyData(onProgress) {
  const data = await readLegacyData();
  const result = {};
  for (const [storeName, rows] of Object.entries(data)) {
    if (rows.length === 0) continue;
    let migrated = 0;
    const errors = [];
    for (const row of rows) {
      try {
        await put(storeName, row);
        migrated += 1;
      } catch (err) {
        errors.push({ id: row.id || row.key, message: err.message });
      }
      if (onProgress) onProgress({ storeName, done: migrated + errors.length, total: rows.length });
    }
    result[storeName] = { total: rows.length, migrated, failed: errors.length, errors };
  }
  return result;
}
