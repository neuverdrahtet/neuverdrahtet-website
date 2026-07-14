const DB_NAME = 'neuverdrahtet-verwaltung';
const DB_VERSION = 3;

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
  aufgaben: 'id',
  dokumente: 'id',
  kategorien: 'id',
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

export const DEFAULT_KANBAN_SPALTEN = [
  { id: 'neue-anfrage', titel: 'Neue Anfrage', reihenfolge: 0, geschlossen: false },
  { id: 'vor-ort-termin', titel: 'Vor-Ort-Termin', reihenfolge: 1, geschlossen: false },
  { id: 'angebot-erstellt', titel: 'Angebot erstellt', reihenfolge: 2, geschlossen: false },
  { id: 'angebot-versendet', titel: 'Angebot versendet', reihenfolge: 3, geschlossen: false },
  { id: 'angebot-abgelehnt', titel: 'Angebot abgelehnt', reihenfolge: 4, geschlossen: false },
  { id: 'auftragsbestaetigung', titel: 'Auftragsbestätigung', reihenfolge: 5, geschlossen: false },
  { id: 'abschlagsrechnung', titel: 'Abschlagsrechnung', reihenfolge: 6, geschlossen: false },
  { id: 'materialbestellung', titel: 'Materialbestellung', reihenfolge: 7, geschlossen: false },
  { id: 'umsetzungsbeginn', titel: 'Umsetzungsbeginn', reihenfolge: 8, geschlossen: false },
  { id: 'in-arbeit', titel: 'In Arbeit', reihenfolge: 9, geschlossen: false },
  { id: 'projekt-erledigt', titel: 'Projekt erledigt', reihenfolge: 10, geschlossen: false },
  { id: 'kundenrechnung', titel: 'Kundenrechnung', reihenfolge: 11, geschlossen: false },
  { id: 'reklamation', titel: 'Reklamation', reihenfolge: 12, geschlossen: false },
  { id: 'abgeschlossen', titel: 'Abgeschlossen', reihenfolge: 13, geschlossen: true },
  { id: 'archiviert', titel: 'Archiviert', reihenfolge: 14, geschlossen: true },
];

export const BEREICHE = [
  { id: 'auftrag', titel: 'Aufträge' },
  { id: 'service', titel: 'Service' },
  { id: 'wartung', titel: 'Wartungen & Prüfungen' },
];

export const DEFAULT_KATEGORIEN = [
  { id: 'auftrag-elektroinstallation', bereich: 'auftrag', titel: 'Elektroinstallation', reihenfolge: 0 },
  { id: 'auftrag-neubau', bereich: 'auftrag', titel: 'Neubau', reihenfolge: 1 },
  { id: 'auftrag-sanierung', bereich: 'auftrag', titel: 'Sanierung / Altbau', reihenfolge: 2 },
  { id: 'auftrag-smarthome', bereich: 'auftrag', titel: 'Smart Home', reihenfolge: 3 },
  { id: 'auftrag-sonstiges', bereich: 'auftrag', titel: 'Sonstiges', reihenfolge: 4 },
  { id: 'service-reparatur', bereich: 'service', titel: 'Reparatur', reihenfolge: 0 },
  { id: 'service-stoerung', bereich: 'service', titel: 'Störungsbeseitigung', reihenfolge: 1 },
  { id: 'service-beratung', bereich: 'service', titel: 'Beratung', reihenfolge: 2 },
  { id: 'service-kleinauftrag', bereich: 'service', titel: 'Kleinauftrag', reihenfolge: 3 },
  { id: 'service-sonstiges', bereich: 'service', titel: 'Sonstiges', reihenfolge: 4 },
  { id: 'wartung-echeck', bereich: 'wartung', titel: 'E-Check', reihenfolge: 0 },
  { id: 'wartung-dguv-v3', bereich: 'wartung', titel: 'Wiederkehrende Prüfung (DGUV V3)', reihenfolge: 1 },
  { id: 'wartung-uvv', bereich: 'wartung', titel: 'UVV-Prüfung', reihenfolge: 2 },
  { id: 'wartung-blitzschutz', bereich: 'wartung', titel: 'Blitzschutzprüfung', reihenfolge: 3 },
  { id: 'wartung-vertrag', bereich: 'wartung', titel: 'Wartungsvertrag', reihenfolge: 4 },
  { id: 'wartung-sonstiges', bereich: 'wartung', titel: 'Sonstiges', reihenfolge: 5 },
];

export const TERMIN_TYPEN = [
  { id: 'termin', titel: 'Termin', farbe: '#2b7fd6' },
  { id: 'baustelle', titel: 'Baustelle', farbe: '#f0a020' },
  { id: 'schulung', titel: 'Schulung', farbe: '#8e44ad' },
  { id: 'krank', titel: 'Krank', farbe: '#c0392b' },
  { id: 'urlaub', titel: 'Urlaub', farbe: '#1f8a4c' },
];

export async function ensureSeeded() {
  const settingsRows = await getAll('einstellungen');
  if (settingsRows.length === 0) {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await put('einstellungen', { key, value });
    }
  }
  const spalten = await getAll('kanbanSpalten');
  const spaltenIds = new Set(spalten.map((s) => s.id));
  const missingSpalten = DEFAULT_KANBAN_SPALTEN.filter((s) => !spaltenIds.has(s.id));
  for (const s of missingSpalten) {
    await put('kanbanSpalten', { ...s, reihenfolge: spalten.length + missingSpalten.indexOf(s) });
  }
  const kategorien = await getAll('kategorien');
  if (kategorien.length === 0) {
    for (const k of DEFAULT_KATEGORIEN) {
      await put('kategorien', k);
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
