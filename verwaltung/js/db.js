const DB_NAME = 'neuverdrahtet-verwaltung';
const DB_VERSION = 2;

const STORES = {
  kunden: 'id',
  mitarbeiter: 'id',
  projekte: 'id',
  kanbanSpalten: 'id',
  termine: 'id',
  katalog: 'id',
  angebote: 'id',
  rechnungen: 'id',
  mahnungen: 'id',
  einstellungen: 'key',
  zeiterfassung: 'id',
  fotos: 'id',
  vorlagen: 'id',
  ausgaben: 'id',
};

export const STORE_NAMES = Object.keys(STORES);

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function storeTx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function getAll(storeName) {
  const store = await storeTx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(storeName, key) {
  const store = await storeTx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(storeName, value) {
  const store = await storeTx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(storeName, key) {
  const store = await storeTx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(storeName) {
  const store = await storeTx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function exportAll() {
  const data = {};
  for (const name of STORE_NAMES) {
    data[name] = await getAll(name);
  }
  data.__meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
  return data;
}

export async function importAll(data, { replace = false } = {}) {
  for (const name of STORE_NAMES) {
    if (!Array.isArray(data[name])) continue;
    if (replace) await clearStore(name);
    for (const item of data[name]) {
      await put(name, item);
    }
  }
}

const DEFAULT_SETTINGS = {
  firmenname: 'neuverdrahtet UG',
  strasse: 'Donnerstr. 131',
  plzOrt: '45357 Essen',
  telefon: '0201 89085050',
  email: 'info@neuverdrahtet.com',
  ustId: '',
  steuernummer: '',
  iban: '',
  bic: '',
  bank: '',
  kleinunternehmer: false,
  standardSteuersatz: 19,
  angebotPrefix: 'AN-',
  rechnungPrefix: 'RE-',
  naechsteAngebotNr: 1,
  naechsteRechnungNr: 1,
  zahlungszielTage: 14,
  angebotGueltigTage: 30,
  mahnGebuehr: [0, 5, 10, 15],
  mahnfristTage: 10,
  passcode: '',
  googleClientId: '',
  googleCalendarId: 'primary',
  stundensatz: 60,
  datevBeraterNr: '',
  datevMandantNr: '',
  datevErloesKonto: '8400',
  datevAufwandKonto: '4900',
  aiWorkerUrl: '',
  aiAppSecret: '',
};

const DEFAULT_KANBAN_SPALTEN = [
  { id: 'anfrage', titel: 'Anfrage', reihenfolge: 0 },
  { id: 'angebot', titel: 'Angebot erstellt', reihenfolge: 1 },
  { id: 'beauftragt', titel: 'Beauftragt', reihenfolge: 2 },
  { id: 'in-arbeit', titel: 'In Arbeit', reihenfolge: 3 },
  { id: 'abgeschlossen', titel: 'Abgeschlossen', reihenfolge: 4 },
];

export async function ensureSeeded() {
  const settingsRows = await getAll('einstellungen');
  if (settingsRows.length === 0) {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await put('einstellungen', { key, value });
    }
  }
  const spalten = await getAll('kanbanSpalten');
  if (spalten.length === 0) {
    for (const s of DEFAULT_KANBAN_SPALTEN) {
      await put('kanbanSpalten', s);
    }
  }
}

export async function getSettings() {
  const rows = await getAll('einstellungen');
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

export async function setSetting(key, value) {
  await put('einstellungen', { key, value });
}

export async function setSettings(obj) {
  for (const [key, value] of Object.entries(obj)) {
    await put('einstellungen', { key, value });
  }
}
