import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, deleteField, onSnapshot,
} from './vendor/firebase/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { deleteBlobFromStorage } from './blobstore.js';

// Solange kein echtes Firebase-Projekt in firebase-config.js hinterlegt ist,
// läuft die App unverändert mit der bisherigen lokalen IndexedDB weiter (wie
// vor der Mehrbenutzer-Umstellung). Erst wenn firebaseConfig.projectId gesetzt
// ist, wird auf die gemeinsame Firestore-Datenbank umgeschaltet. So bricht die
// produktiv genutzte App nicht, bevor das Firebase-Projekt wirklich eingerichtet
// und die Zugangsdaten eingetragen sind.
const FIREBASE_ENABLED = !!firebaseConfig.projectId;
let firestore = null;
if (FIREBASE_ENABLED) {
  ({ firestore } = await import('./firebase.js'));
}

export const DB_NAME = 'neuverdrahtet-verwaltung';
const DB_VERSION = 16;

// 'einstellungen' ist keine normale Collection, sondern ein einzelnes Dokument
// (einstellungen/global) mit allen Settings als Feldern – siehe die Sonderfälle
// weiter unten in getAll/get/put/remove/clearStore. Grund: getSettings() wird
// bei praktisch jedem View-Rendering aufgerufen; ein Dokument statt ~40
// Einzeldokumenten spart massiv Firestore-Lesevorgänge.
const EINSTELLUNGEN_DOC = () => doc(firestore, 'einstellungen', 'global');

const STORES = {
  kunden: 'id',
  mitarbeiter: 'id',
  projekte: 'id',
  kanbanSpalten: 'id',
  termine: 'id',
  katalog: 'id',
  angebote: 'id',
  auftragsbestaetigungen: 'id',
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
  nachrichten: 'id',
  geraete: 'id',
  flotten: 'id',
  terminStatus: 'id',
  textbausteine: 'id',
  aufgabenStatus: 'id',
  lagerbewegungen: 'id',
  verwendungen: 'id',
  emails: 'id',
  pushTokens: 'id',
  fahrten: 'id',
  anlagen: 'id',
  marken: 'id',
};

export const KALK_KATEGORIEN = [
  { id: 'material', titel: 'Material', farbe: '#4d8bf0' },
  { id: 'lohn', titel: 'Lohn', farbe: '#a463f2' },
  { id: 'fremdleistung', titel: 'Fremdleistungen', farbe: '#ef4444' },
  { id: 'geraete', titel: 'Geräte', farbe: '#14b8a6' },
  { id: 'sonstige', titel: 'Sonstige', farbe: '#8a8a94' },
];

export const STORE_NAMES = Object.keys(STORES);

// --- IndexedDB-Implementierung (Fallback, solange kein Firebase-Projekt konfiguriert ist) ---

let idbPromise = null;

function openIndexedDB() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!idb.objectStoreNames.contains(name)) {
          idb.createObjectStore(name, { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}

async function idbStoreTx(storeName, mode) {
  const idb = await openIndexedDB();
  return idb.transaction(storeName, mode).objectStore(storeName);
}

async function getAllIdb(storeName) {
  const store = await idbStoreTx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getIdb(storeName, key) {
  const store = await idbStoreTx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putIdb(storeName, value) {
  const store = await idbStoreTx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function removeIdb(storeName, key) {
  const store = await idbStoreTx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearStoreIdb(storeName) {
  const store = await idbStoreTx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- Firestore-Implementierung (aktiv sobald firebase-config.js ein echtes Projekt trägt) ---

// Firestore rechnet jeden getDocs()-Aufruf als N Lesevorgänge ab, egal ob sich
// etwas geändert hat. Da getAll() sehr häufig aufgerufen wird (praktisch jedes
// View-Rendering), hält db.js pro Collection einen einzigen langlebigen
// onSnapshot()-Listener, der einen In-Memory-Cache aktuell hält – das ist
// gleichzeitig die Grundlage für Firestores Offline-Unterstützung (erster
// Snapshot kommt bei fehlendem Netz aus dem lokalen persistentLocalCache()).
const cache = new Map(); // storeName -> Map(id -> row)
const listeners = new Map(); // storeName -> unsubscribe
const ready = new Map(); // storeName -> Promise, resolved nach dem ersten Snapshot

// 'mitarbeiter' enthält sensible Personalakte-Felder (Adresse, Stundenlohn, ...)
// und ist deshalb in firestore.rules für die Rolle "mitarbeiter" komplett
// gesperrt. Trotzdem brauchen ganz normale Mitarbeiter an vielen Stellen die
// simple Namensliste (z.B. "Ich bin: ..."-Auswahl in Zeiterfassung/Aufgaben/
// Teamchat). Deshalb pflegt db.js parallel eine öffentliche, nicht-sensible
// Teilmenge (Name/Farbe/Gewerk) in einer eigenen Collection - siehe
// syncMitarbeiterOeffentlich() und den Firestore-Permission-Fallback unten.
const MITARBEITER_OEFFENTLICH = 'mitarbeiterOeffentlich';

function ensureListening(storeName) {
  if (listeners.has(storeName)) return ready.get(storeName);
  const storeCache = new Map();
  cache.set(storeName, storeCache);
  let resolveReady;
  ready.set(storeName, new Promise((resolve) => { resolveReady = resolve; }));
  let usingFallback = false;
  function subscribe(collectionName, isFallback) {
    return onSnapshot(collection(firestore, collectionName), (snap) => {
      if (isFallback && !usingFallback) { storeCache.clear(); usingFallback = true; }
      snap.docChanges().forEach((change) => {
        if (change.type === 'removed') storeCache.delete(change.doc.id);
        else storeCache.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
      });
      resolveReady();
    }, (err) => {
      if (storeName === 'mitarbeiter' && !usingFallback) {
        console.warn(`Firestore: kein Zugriff auf "mitarbeiter" (${err.code}) - falle auf öffentliche Mitarbeiterliste zurück.`);
        listeners.set(storeName, subscribe(MITARBEITER_OEFFENTLICH, true));
        return;
      }
      console.error(`Firestore-Listener-Fehler (${storeName}):`, err);
      resolveReady();
    });
  }
  listeners.set(storeName, subscribe(storeName, false));
  return ready.get(storeName);
}

async function getEinstellungenRows() {
  const snap = await getDoc(EINSTELLUNGEN_DOC());
  const data = snap.exists() ? snap.data() : {};
  return Object.entries(data).map(([key, value]) => ({ key, value }));
}

async function getAllFs(storeName) {
  if (storeName === 'einstellungen') return getEinstellungenRows();
  await ensureListening(storeName);
  return [...cache.get(storeName).values()];
}

async function getFs(storeName, key) {
  if (storeName === 'einstellungen') {
    const rows = await getEinstellungenRows();
    return rows.find((r) => r.key === key);
  }
  await ensureListening(storeName);
  return cache.get(storeName).get(key);
}

function mitarbeiterOeffentlichData(value) {
  return { name: value.name || '', farbe: value.farbe || '', rolle: value.rolle || '' };
}

async function putFs(storeName, value) {
  if (storeName === 'einstellungen') {
    await setDoc(EINSTELLUNGEN_DOC(), { [value.key]: value.value }, { merge: true });
    return value.key;
  }
  await setDoc(doc(firestore, storeName, value.id), value);
  if (storeName === 'mitarbeiter') {
    await setDoc(doc(firestore, MITARBEITER_OEFFENTLICH, value.id), mitarbeiterOeffentlichData(value));
  }
  return value.id;
}

async function removeFs(storeName, key) {
  if (storeName === 'einstellungen') {
    await setDoc(EINSTELLUNGEN_DOC(), { [key]: deleteField() }, { merge: true });
    return;
  }
  await deleteDoc(doc(firestore, storeName, key));
  if (storeName === 'mitarbeiter') {
    await deleteDoc(doc(firestore, MITARBEITER_OEFFENTLICH, key));
  }
}

async function clearStoreFs(storeName) {
  if (storeName === 'einstellungen') {
    await deleteDoc(EINSTELLUNGEN_DOC());
    return;
  }
  const snap = await getDocs(collection(firestore, storeName));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  cache.get(storeName)?.clear();
}

// --- Öffentliche API: wählt je nach FIREBASE_ENABLED die passende Implementierung ---

export async function openDB() {
  if (!FIREBASE_ENABLED) return openIndexedDB();
  return Promise.resolve(); // Firestore braucht kein explizites "Öffnen" wie IndexedDB
}

// Stores, für die "Löschen" ein Papierkorb ist (Soft-Delete statt echtem
// Entfernen) - bewusst auf die Stores begrenzt, die schon die bestehende
// Mehrfachauswahl+Löschen-Funktion haben; Hilfsdaten wie Kanban-Spalten,
// Termine, E-Mails oder Verwendungen bleiben normale Hard-Deletes.
export const TRASH_STORES = [
  'kunden', 'projekte', 'aufgaben', 'mitarbeiter', 'geraete', 'flotten',
  'katalog', 'angebote', 'rechnungen', 'mahnungen', 'ausgaben', 'zeiterfassung', 'vorlagen',
];
export function isTrashStore(storeName) {
  return TRASH_STORES.includes(storeName);
}

const TRASH_TAGE = 30;

export async function getAll(storeName, { includeDeleted = false } = {}) {
  const rows = FIREBASE_ENABLED ? await getAllFs(storeName) : await getAllIdb(storeName);
  if (includeDeleted || !isTrashStore(storeName)) return rows;
  return rows.filter((r) => !r._geloescht);
}

export async function get(storeName, key) {
  return FIREBASE_ENABLED ? getFs(storeName, key) : getIdb(storeName, key);
}

export async function put(storeName, value) {
  return FIREBASE_ENABLED ? putFs(storeName, value) : putIdb(storeName, value);
}

// Für Papierkorb-fähige Stores markiert remove() den Datensatz nur als
// gelöscht (Update statt Delete) - er verschwindet aus getAll(), bleibt aber
// per get()/getAllDeleted() erreichbar, bis er wiederhergestellt oder nach
// TRASH_TAGE endgültig entfernt wird (siehe purgeOldTrash / hardRemove).
export async function remove(storeName, key) {
  if (isTrashStore(storeName)) {
    const existing = await get(storeName, key);
    if (existing) {
      await put(storeName, { ...existing, _geloescht: true, _geloeschtAm: new Date().toISOString() });
      // put() pflegt für 'mitarbeiter' den öffentlichen Namens-/Farb-Spiegel
      // (mitarbeiterOeffentlich) automatisch nach - der kennt kein
      // _geloescht-Feld, würde also in "Ich bin: ..."-Auswahlen weiter
      // auftauchen. Deshalb hier explizit entfernen; restoreDeleted() legt
      // ihn über denselben put()-Pfad automatisch wieder an.
      if (storeName === 'mitarbeiter' && FIREBASE_ENABLED) {
        await deleteDoc(doc(firestore, MITARBEITER_OEFFENTLICH, key)).catch(() => { /* ggf. schon weg */ });
      }
      return;
    }
  }
  return hardRemove(storeName, key);
}

// Ausgaben/Zeiterfassung hängen Fotos/Belege/Unterschriften als Blobs in
// Firebase Storage (siehe blobstore.js) - solange ein Datensatz nur im
// Papierkorb liegt (remove()), bleiben diese Dateien unangetastet, damit
// eine Wiederherstellung nicht auf kaputte Anhänge zeigt. Erst hier, beim
// wirklichen Entfernen (manuell "Endgültig löschen" oder purgeOldTrash),
// werden sie mit gelöscht.
async function cleanupBlobs(storeName, record) {
  if (!record) return;
  if (storeName === 'ausgaben' && record.beleg?.path) {
    await deleteBlobFromStorage(record.beleg.path).catch(() => { /* Blob ggf. schon weg */ });
  }
  if (storeName === 'zeiterfassung') {
    for (const it of record.medien || []) {
      if (it.path) await deleteBlobFromStorage(it.path).catch(() => { /* Blob ggf. schon weg */ });
    }
    if (record.unterschriftPath) {
      await deleteBlobFromStorage(record.unterschriftPath).catch(() => { /* Blob ggf. schon weg */ });
    }
  }
}

export async function hardRemove(storeName, key) {
  if (storeName === 'ausgaben' || storeName === 'zeiterfassung') {
    await cleanupBlobs(storeName, await get(storeName, key));
  }
  return FIREBASE_ENABLED ? removeFs(storeName, key) : removeIdb(storeName, key);
}

export async function restoreDeleted(storeName, key) {
  const existing = await get(storeName, key);
  if (!existing) return;
  const { _geloescht, _geloeschtAm, ...rest } = existing;
  await put(storeName, rest);
}

export async function getAllDeleted() {
  const result = [];
  for (const storeName of TRASH_STORES) {
    const rows = await getAll(storeName, { includeDeleted: true });
    for (const row of rows) {
      if (row._geloescht) result.push({ storeName, ...row });
    }
  }
  return result;
}

// Räumt beim App-Start endgültig auf: Datensätze, die schon länger als
// TRASH_TAGE im Papierkorb liegen, werden wirklich gelöscht. Läuft still im
// Hintergrund mit (wie trySyncPendingUploads) - ein einzelner Fehlschlag darf
// den Start nicht blockieren.
export async function purgeOldTrash() {
  const grenze = Date.now() - TRASH_TAGE * 24 * 60 * 60 * 1000;
  for (const storeName of TRASH_STORES) {
    const rows = await getAll(storeName, { includeDeleted: true });
    for (const row of rows) {
      if (row._geloescht && row._geloeschtAm && new Date(row._geloeschtAm).getTime() < grenze) {
        await hardRemove(storeName, row.id);
      }
    }
  }
}

// Backfill für bereits vor diesem Fix angelegte Mitarbeiter-Datensätze, die
// noch kein gespiegeltes mitarbeiterOeffentlich-Dokument haben. Nur admin/
// buero können 'mitarbeiter' überhaupt vollständig lesen (siehe firestore.rules),
// daher wird das einfach beim Öffnen der Mitarbeiter-Seite mit ausgeführt.
export async function syncMitarbeiterOeffentlich() {
  if (!FIREBASE_ENABLED) return;
  const alle = await getAllFs('mitarbeiter');
  await Promise.all(alle.map((m) => setDoc(doc(firestore, MITARBEITER_OEFFENTLICH, m.id), mitarbeiterOeffentlichData(m))));
}

export async function clearStore(storeName) {
  return FIREBASE_ENABLED ? clearStoreFs(storeName) : clearStoreIdb(storeName);
}

export async function exportAll() {
  const data = {};
  for (const name of STORE_NAMES) {
    data[name] = await getAll(name, { includeDeleted: true });
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
  telefon: '01706398575',
  email: 'neuverdrahtet@gmail.com',
  ustId: '',
  steuernummer: '',
  iban: '',
  bic: '',
  bank: '',
  inhaber: '',
  kleinunternehmer: false,
  standardSteuersatz: 19,
  standardAufschlagProzent: 20,
  angebotPrefix: 'AN-',
  auftragsbestaetigungPrefix: 'AB-',
  rechnungPrefix: 'RE-',
  angebotNummerDatum: '',
  angebotNummerZaehler: 0,
  auftragsbestaetigungNummerDatum: '',
  auftragsbestaetigungNummerZaehler: 0,
  rechnungNummerDatum: '',
  rechnungNummerZaehler: 0,
  kundeNummerDatum: '',
  kundeNummerZaehler: 0,
  zahlungszielTage: 14,
  angebotGueltigTage: 30,
  mahnGebuehr: [0, 5, 10, 15],
  mahnfristTage: 10,
  angebotNachfassTage: 7,
  skontoProzentStandard: 0,
  skontoTageStandard: 0,
  autoKundeAusAnfrage: true,
  autoTerminAusAnfrage: true,
  pushNotifiedMahnungenAm: '',
  pushNotifiedGeraetePruefungAm: '',
  pushNotifiedAnlagenPruefungAm: '',
  emailErinnerungGesendetAm: '',
  passcode: '',
  googleClientId: '',
  googleCalendarId: 'primary',
  driveBackupEnabled: false,
  driveBackupLastAt: '',
  emailImportDone: false,
  emailImportCount: 0,
  emailLastSyncAt: '',
  emailSignature: '',
  stundensatz: 60,
  datevBeraterNr: '',
  datevMandantNr: '',
  datevErloesKonto: '8400',
  datevAufwandKonto: '4900',
  aiWorkerUrl: '',
  aiAppSecret: '',
  lexofficeApiKey: '',
  lexofficeArbeitsstundeArtikelId: '',
  lexofficeArbeitsstundeArtikelName: '',
  pushVapidKey: '',
  wetterOrt: 'Essen',
  wetterLat: 51.4556,
  wetterLng: 7.0116,
  logoDataUrl: '',
  theme: 'dark',
  dokAkzentfarbe: '#0f1b2d',
  dokSchriftgroesse: 10,
  dokLogoPosition: 'links',
  dokLogoGroesse: 'mittel',
  dokFooterFirmendaten: true,
  dokFooterSteuerdaten: true,
  dokFooterBankverbindung: true,
  dokFooterSeitenzahl: true,
  dokFooterZusatztext: '',
};

// Gut unterscheidbare Farbfolge für automatisch vergebene Status-/Stufenfarben
// (Kanban-Spalten, Termin-Status, ...). Wird bei "+ Status hinzufügen" reihum vergeben.
export const STATUS_AUTO_PALETTE = [
  '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6',
  '#d35400', '#4d8bf0', '#a463f2', '#16a085', '#e91e8c', '#6b7280',
];

export const DEFAULT_KANBAN_SPALTEN = [
  { id: 'neue-anfrage', titel: 'Neue Anfrage', reihenfolge: 0, geschlossen: false, farbe: STATUS_AUTO_PALETTE[0] },
  { id: 'vor-ort-termin', titel: 'Vor-Ort-Termin', reihenfolge: 1, geschlossen: false, farbe: STATUS_AUTO_PALETTE[7] },
  { id: 'angebot-erstellt', titel: 'Angebot erstellt', reihenfolge: 2, geschlossen: false, farbe: STATUS_AUTO_PALETTE[5] },
  { id: 'angebot-versendet', titel: 'Angebot versendet', reihenfolge: 3, geschlossen: false, farbe: STATUS_AUTO_PALETTE[9] },
  { id: 'angebot-abgelehnt', titel: 'Angebot abgelehnt', reihenfolge: 4, geschlossen: false, farbe: STATUS_AUTO_PALETTE[4] },
  { id: 'auftragsbestaetigung', titel: 'Auftragsbestätigung', reihenfolge: 5, geschlossen: false, farbe: STATUS_AUTO_PALETTE[8] },
  { id: 'abschlagsrechnung', titel: 'Abschlagsrechnung', reihenfolge: 6, geschlossen: false, farbe: STATUS_AUTO_PALETTE[3] },
  { id: 'materialbestellung', titel: 'Materialbestellung', reihenfolge: 7, geschlossen: false, farbe: STATUS_AUTO_PALETTE[6] },
  { id: 'umsetzungsbeginn', titel: 'Umsetzungsbeginn', reihenfolge: 8, geschlossen: false, farbe: STATUS_AUTO_PALETTE[2] },
  { id: 'in-arbeit', titel: 'In Arbeit', reihenfolge: 9, geschlossen: false, farbe: STATUS_AUTO_PALETTE[2] },
  { id: 'projekt-erledigt', titel: 'Projekt erledigt', reihenfolge: 10, geschlossen: false, farbe: STATUS_AUTO_PALETTE[1] },
  { id: 'kundenrechnung', titel: 'Kundenrechnung', reihenfolge: 11, geschlossen: false, farbe: STATUS_AUTO_PALETTE[10] },
  { id: 'reklamation', titel: 'Reklamation', reihenfolge: 12, geschlossen: false, farbe: STATUS_AUTO_PALETTE[4] },
  { id: 'abgeschlossen', titel: 'Abgeschlossen', reihenfolge: 13, geschlossen: true, farbe: STATUS_AUTO_PALETTE[1] },
  { id: 'archiviert', titel: 'Archiviert', reihenfolge: 14, geschlossen: true, farbe: STATUS_AUTO_PALETTE[11] },
];

export const BEREICHE = [
  { id: 'auftrag', titel: 'Aufträge' },
  { id: 'service', titel: 'Service' },
  { id: 'wartung', titel: 'Wartungen & Prüfungen' },
];

export const TAETIGKEITEN = [
  { id: 'baustelle', titel: 'Baustelle', farbe: STATUS_AUTO_PALETTE[7] },
  { id: 'fahrtzeit', titel: 'Fahrtzeit', farbe: STATUS_AUTO_PALETTE[6] },
  { id: 'materialbeschaffung', titel: 'Materialbeschaffung', farbe: STATUS_AUTO_PALETTE[2] },
  { id: 'planung', titel: 'Planung', farbe: STATUS_AUTO_PALETTE[8] },
  { id: 'buero', titel: 'Büro', farbe: STATUS_AUTO_PALETTE[0] },
  { id: 'sonstiges', titel: 'Sonstiges', farbe: STATUS_AUTO_PALETTE[11] },
];

export const GEWERKE = [
  { id: 'elektro', titel: 'Elektro', farbe: '#2b7fd6' },
  { id: 'abbruch', titel: 'Abbruch', farbe: '#7f1d1d' },
  { id: 'fliesen', titel: 'Fliesen', farbe: '#f0a020' },
  { id: 'boden', titel: 'Bodenleger', farbe: '#8e6b3f' },
  { id: 'maler', titel: 'Maler', farbe: '#16a085' },
  { id: 'trockenbau', titel: 'Trockenbau', farbe: '#6b7280' },
  { id: 'komplettbad', titel: 'Komplettbad', farbe: '#8e44ad' },
  { id: 'renovierung', titel: 'Wohnungssanierung/Renovierung', farbe: '#0891b2' },
  { id: 'sonstiges', titel: 'Sonstiges', farbe: '#c0392b' },
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

export const DEFAULT_DOKU_VORLAGEN = [
  {
    id: 'vorlage-echeck', typ: 'dokumentation', name: 'E-Check-Prüfprotokoll',
    textVorlage: `E-CHECK PRÜFPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum der Prüfung: {{datum}}

Geprüfte Anlage/Geräte:


Prüfgrundlage: DIN VDE 0100 / DIN VDE 0701-0702

1. Sichtprüfung
   Zustand Leitungen/Anschlüsse: i.O. / n.i.O.
   Kennzeichnung/Beschriftung: i.O. / n.i.O.

2. Messungen
   Isolationswiderstand:
   Schutzleiterwiderstand:
   Schleifenimpedanz:
   Auslösung RCD (falls vorhanden):

3. Funktionsprüfung
   Ergebnis:

Festgestellte Mängel:


Empfohlene Maßnahmen:


Prüfergebnis: bestanden / nicht bestanden

Nächste Prüfung fällig am:

Ort, Datum: {{datum}}
Unterschrift Prüfer:`,
  },
  {
    id: 'vorlage-dguv-v3', typ: 'dokumentation', name: 'Wiederkehrende Prüfung (DGUV V3)',
    textVorlage: `PRÜFPROTOKOLL – WIEDERKEHRENDE PRÜFUNG NACH DGUV VORSCHRIFT 3

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Prüfdatum: {{datum}}

Geprüfte elektrische Anlage/Betriebsmittel:

Prüfintervall: ☐ ortsfest  ☐ ortsveränderlich

Prüfergebnisse:
   Sichtprüfung: i.O. / n.i.O.
   Erprobung/Funktionsprüfung: i.O. / n.i.O.
   Messung: i.O. / n.i.O.

Festgestellte Mängel:


Gesamtergebnis: keine Mängel / Mängel beseitigt / Mängel vorhanden (Nachprüfung erforderlich)

Nächste Prüfung fällig am:

Ort, Datum: {{datum}}
Unterschrift Prüfer:`,
  },
  {
    id: 'vorlage-wartung', typ: 'dokumentation', name: 'Wartungsprotokoll',
    textVorlage: `WARTUNGSPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Durchgeführte Wartungsarbeiten:
-
-
-

Verbrauchsmaterial/Ersatzteile:


Festgestellter Zustand der Anlage:


Empfehlungen für den Kunden:


Nächster Wartungstermin:

Ort, Datum: {{datum}}
Unterschrift Techniker:`,
  },
  {
    id: 'vorlage-tagesbericht', typ: 'dokumentation', name: 'Tagesbericht',
    textVorlage: `TAGESBERICHT

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Anwesende Mitarbeiter:


Wetter (bei Außenarbeiten):

Ausgeführte Arbeiten:
-
-
-

Verwendetes Material:


Arbeitszeit (von – bis):


Besondere Vorkommnisse / Behinderungen:


Offene Punkte für den nächsten Tag:


Ort, Datum: {{datum}}
Unterschrift:`,
  },
  {
    id: 'vorlage-servicebericht', typ: 'dokumentation', name: 'Servicebericht',
    textVorlage: `SERVICEBERICHT

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum des Einsatzes: {{datum}}

Ansprechpartner vor Ort:

Gemeldetes Problem / Auftrag:


Durchgeführte Arbeiten:
-
-
-

Verwendetes Material/Ersatzteile:


Arbeitszeit (von – bis):

Ergebnis: ☐ Problem behoben  ☐ Teilweise behoben  ☐ Nachtermin erforderlich

Empfehlung für den Kunden:


Ort, Datum: {{datum}}
Unterschrift Techniker:                     Unterschrift Kunde:`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Auftragsdaten', felder: [{ label: 'Rapport-/Auftrags-Nr.', typ: 'text' }] },
      { typ: 'checkliste', titel: 'Vorgangsart', punkte: ['Auftrag', 'Angebot', 'Lieferschein', 'Rechnung'] },
      { typ: 'janein', titel: 'Abschluss', fragen: ['Alle Arbeiten abgeschlossen'] },
      { typ: 'checkliste', titel: 'Zahlung erhalten', punkte: ['Karte', 'Bar', 'PayPal', 'Überweisung', 'Noch offen – Kunde zahlt nach Rechnungserhalt'] },
    ],
  },
  {
    id: 'vorlage-abnahme', typ: 'dokumentation', name: 'Abnahmeprotokoll',
    textVorlage: `ABNAHMEPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum der Abnahme: {{datum}}

Umfang der abgenommenen Leistung:


Die Leistung wurde geprüft und:
☐ ohne Mängel abgenommen
☐ mit folgenden Mängeln abgenommen (siehe unten)

Festgestellte Mängel:


Frist zur Mängelbeseitigung:

Der Auftragnehmer bestätigt die fach- und normgerechte Ausführung der Arbeiten.
Der Auftraggeber bestätigt die Übernahme der Leistung.

Ort, Datum: {{datum}}

Unterschrift Auftragnehmer:                     Unterschrift Auftraggeber/Kunde:`,
  },
  {
    id: 'vorlage-maengel', typ: 'dokumentation', name: 'Mängelprotokoll',
    textVorlage: `MÄNGELPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Festgestellte Mängel:
Nr. | Beschreibung | Ort/Bauteil | Priorität (hoch/mittel/niedrig)
1.
2.
3.

Vereinbarte Frist zur Beseitigung:

Zuständiger Mitarbeiter:

Bemerkungen:


Ort, Datum: {{datum}}
Unterschrift:`,
  },
  {
    id: 'vorlage-aufmass', typ: 'dokumentation', name: 'Aufmaßprotokoll',
    textVorlage: `AUFMASSPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Aufmaß (Raum/Bereich, Maße, Besonderheiten):
Raum/Bereich | Länge (m) | Breite (m) | Höhe (m) | Fläche/Menge | Bemerkung




Besondere Hinweise (Untergrund, Zugänglichkeit, Vorarbeiten):


Aufgemessen von:

Ort, Datum: {{datum}}
Unterschrift:`,
    abschnitte: [
      { typ: 'raeume', titel: 'Aufmaß je Raum (mit Foto)', mitMassen: true, mitFotoProZeile: true },
      { typ: 'unterschriften', labels: ['Unterschrift Ersteller'] },
    ],
  },
  {
    id: 'vorlage-auftragsformular', typ: 'dokumentation', name: 'Auftragsformular',
    textVorlage: `AUFTRAGSFORMULAR / AUFTRAGSBESTÄTIGUNG

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Ansprechpartner Kunde:
Telefon:
E-Mail:

Auftragsgegenstand / Beschreibung der Leistung:



Vereinbarter Ausführungszeitraum (von – bis):

Vereinbarter Preis: ☐ Festpreis  ☐ nach Aufwand
Betrag (falls Festpreis):

Zahlungsbedingungen:
- Anzahlung:
- Abschlagszahlung(en):
- Restzahlung nach Fertigstellung:

Besondere Vereinbarungen / Hinweise:



Der Auftraggeber beauftragt hiermit die oben beschriebene Leistung zu den genannten Bedingungen.

Ort, Datum: {{datum}}

Unterschrift Auftragnehmer:                     Unterschrift Auftraggeber/Kunde:`,
  },
  {
    id: 'vorlage-risikobewertung-vde0100-420', typ: 'dokumentation', name: 'Risikobewertung nach DIN VDE 0100-420',
    textVorlage: `RISIKOBEWERTUNG NACH DIN VDE 0100-420

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

2. Bereits nach VDE 0100-420 ergriffene Maßnahmen

Anlagentechnisch:


Organisatorisch:


Baulich:


Allgemeiner Einsatz von AFDD:


4. Bewertung

Allgemeine Bewertung der Anlage:


Bemerkungen/Mängel:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Kundennr.', typ: 'text' },
          { label: 'Auftragsnr.', typ: 'text' },
          { label: 'Objekt', typ: 'text' },
          { label: 'Wohnung', typ: 'text' },
          { label: 'Stockwerk', typ: 'text' },
          { label: 'Adresse', typ: 'text' },
        ],
      },
      {
        typ: 'janein', titel: '1. Vorhandene Räume',
        fragen: [
          'Räumlichkeiten mit Schlafgelegenheit',
          'Räume oder Orte mit besonderem Brandrisiko',
          'Räume oder Orte aus Bauteilen mit brennbaren Baustoffen, wenn diese einen geringeren Feuerwiderstand als feuerhemmend aufweisen',
          'Räume oder Orte mit Gefährdungen für unersetzbare Güter',
        ],
      },
      { typ: 'tabelle', titel: '3. Risikoanalyse (RPZ = B × A × E)', spalten: ['Ort', 'B', 'A', 'E'], ergebnisSpalte: 'RPZ' },
      { typ: 'tabelle', titel: 'Ergriffene Maßnahmen bei RPZ ≥ 200', spalten: ['Maßnahme', 'B', 'A', 'E'], ergebnisSpalte: 'RPZ Neu' },
      { typ: 'unterschriften', labels: ['Unterschrift Elektroplaner', 'Unterschrift Elektroinstallateur'] },
    ],
  },
  {
    id: 'vorlage-pruefung-instandgesetzte-geraete', typ: 'dokumentation', name: 'Prüfung: Instandgesetzte Geräte',
    textVorlage: `PRÜFUNG: INSTANDGESETZTE GERÄTE

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Prüfer: {{mitarbeiter}}
Datum: {{datum}}

Kundenangaben (Mängel):


Durchgeführte Reparaturarbeiten:


Prüfung nach Instandsetzung – Ergänzende Prüfanforderungen nach DIN VDE 0701-0702:


Nächster Prüftermin:

Verwendete Messgeräte:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Allgemein',
        felder: [
          { label: 'Geräteart', typ: 'text' },
          { label: 'Hersteller', typ: 'text' },
          { label: 'Typenbezeichnung', typ: 'text' },
          { label: 'Fabrikat-Nr.', typ: 'text' },
          { label: 'Baujahr', typ: 'text' },
          { label: 'Schutzklasse', typ: 'text' },
          { label: 'Nennspannung (V)', typ: 'zahl' },
          { label: 'Nennstrom (A)', typ: 'zahl' },
          { label: 'Nennleistung (W)', typ: 'zahl' },
          { label: 'Annahme/Anlieferung am', typ: 'datum' },
          { label: 'Reparatur am', typ: 'datum' },
          { label: 'Rückgabe/Abholung am', typ: 'datum' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Messung',
        felder: [
          { label: 'Schutzleiterwiderstand (Ω)', typ: 'zahl' },
          { label: 'Isolationswiderstand (MΩ)', typ: 'zahl' },
          { label: 'Schutzleiterstrom (mA)', typ: 'zahl' },
          { label: 'Berührungsstrom (mA)', typ: 'zahl' },
        ],
      },
      {
        typ: 'checkliste', titel: 'Sichtprüfung',
        punkte: ['Gehäuse i.O', 'sonstige mechanische Teile i.O', 'Geräte-Anschlußleitungen einschl. Steckvorrichtung mängelfrei'],
      },
      {
        typ: 'checkliste', titel: 'Ergebnis',
        punkte: [
          'Funktions- und Sichtprüfung mängelfrei',
          'Aufschriften vorhanden bzw. vervollständigt',
          'Das Gerät kann nicht mehr instandgesetzt werden',
          'Das Gerät hat erhebliche sicherheitstechnische Mängel (Brandgefahr / Gefahr durch elektrischen Schlag / Mechanische Gefahr)',
          'Nennwerte stimmen mit den Herstellerdaten überein',
        ],
      },
      { typ: 'unterschriften', labels: ['Verantwortlicher Unternehmer', 'Prüfer'] },
    ],
  },
  {
    id: 'vorlage-gefaehrdungsbeurteilung-arbschg', typ: 'dokumentation', name: 'Gefährdungsbeurteilung nach §5 ArbSchG',
    textVorlage: `GEFÄHRDUNGSBEURTEILUNG NACH §5 ARBSCHG

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Zu beurteilende Tätigkeit / Arbeitsbereich:


Erfasste Gefährdungen und implementierte Schutzmaßnahmen:
(Gefährdung – Schutzmaßnahme – Delegiert an – Status)


Anhang: Risikobeurteilung (Nohl-Matrix)
Bewertung nach Schadensausmaß und Eintrittswahrscheinlichkeit.
Gering = keine Maßnahmen notwendig · Mittel = Maßnahmen zur Risikoreduzierung empfohlen · Hoch = Maßnahmen dringend erforderlich

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Allgemein',
        felder: [
          { label: 'Unternehmensbereich', typ: 'text' },
          { label: 'Verantwortliche Person', typ: 'text' },
          { label: 'Erstellt durch', typ: 'text' },
          { label: 'Version', typ: 'text' },
        ],
      },
      {
        typ: 'checkliste', titel: 'Gefährdungsfaktoren – Mechanisch/Elektrisch',
        punkte: [
          'Mechanische Gefährdungen übergreifend', 'Teile mit gefährlichen Oberflächen', 'Unkontrolliert bewegte Teile',
          'Absturz', 'Sturz, Ausrutschen, Stolpern, Umknicken', 'Elektrischer Schlag', 'Elektrostatische Aufladungen', 'Lichtbögen',
        ],
      },
      {
        typ: 'checkliste', titel: 'Gefährdungsfaktoren – Gefahrstoffe/Biologisch/Brand',
        punkte: [
          'Gefährdungen durch Gefahrstoffe übergreifend', 'Einatmen von Gefahrstoffen', 'Hautkontakt mit Gefahrstoffen',
          'Infektionsgefährdung durch Mikroorganismen', 'Allgemeine Brandgefahren', 'Gefahren durch explosionsfähige Atmosphäre',
        ],
      },
      {
        typ: 'checkliste', titel: 'Gefährdungsfaktoren – Arbeitsumgebung/Organisation',
        punkte: [
          'Klima (Hitze/Kälte)', 'Unzureichende Beleuchtung/Licht', 'Unzureichende Flucht- und Verkehrswege',
          'Unzureichende Bewegungsfläche, Pausen-/Sanitärräume', 'Lärm', 'Fehlende Unterweisung',
          'Fehlende Prüfung von Arbeitsmitteln', 'Fehlende Erste Hilfe', 'Fehlende Cybersicherheit bei MSR-Einrichtungen', 'Ungünstige Arbeitszeiten',
        ],
      },
      {
        typ: 'checkliste', titel: 'Physische/Psychische Belastung',
        punkte: [
          'Schwere dynamische Arbeit', 'Haltungsarbeit (Zwangshaltung)', 'Einseitige dynamische Arbeit, Körperbewegung',
          'Ungenügend gestaltete Arbeitsorganisation', 'Ungenügend gestaltete Arbeitsaufgabe',
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Verantwortlicher'] },
    ],
  },
  {
    id: 'vorlage-pruefung-elektrischer-anlagen', typ: 'dokumentation', name: 'Prüfung elektrischer Anlagen',
    textVorlage: `PRÜFUNG ELEKTRISCHER ANLAGEN

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Objekt-Bezeichnung / weitere Informationen:


Beurteilung der Elektrofachkraft (Ergebnis, ggf. nächster Prüftermin):


Hinweis: Die Prüfung erfolgte nach den geltenden Bestimmungen der DIN VDE 0100-600 / 0105-100. Sie umfasst
nur zugängliche und überprüfbare Anlagenteile. Für verdeckte Installationen oder nach der Prüfung vorgenommene
Änderungen wird keine Haftung übernommen. Festgestellte Mängel sind im Prüfprotokoll dokumentiert und dem
Betreiber zur Kenntnis gegeben worden.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Auftragsnummer', typ: 'text' },
          { label: 'Auftragsdatum', typ: 'datum' },
          { label: 'Beginn der Prüfung', typ: 'text' },
          { label: 'Netzbetreiber', typ: 'text' },
          { label: 'Netz', typ: 'text' },
          { label: 'Netzsystem', typ: 'text' },
        ],
      },
      { typ: 'checkliste', titel: 'Art der Prüfung – DIN VDE 0100-600 / 0105-100', punkte: ['Neuanlage', 'Änderung', 'Erweiterung', 'Wiederholung', 'Instandsetzung'] },
      { typ: 'checkliste', titel: 'Sonstige Grundlagen', punkte: ['E-Check', 'DGUV Vorschrift 3', 'BetrSichV'] },
      { typ: 'checkliste', titel: 'Objekt-Art', punkte: ['Einfamilienhaus', 'Mehrfamilienhaus', 'Wohnung', 'Garage', 'Gewerbeeinheit / Büro', 'Außenanlage', 'Sonstiges'] },
      {
        typ: 'checkliste', titel: 'Sichtprüfung / Zustand der Anlage',
        punkte: [
          'Allgemeiner Zustand / Sauberkeit i.O.', 'Auswahl der Betriebsmittel geeignet', 'Berührungsschutz / Abdeckungen vorhanden',
          'Leiterkennzeichnung normgerecht', 'Leitungsführung ordentlich', 'Leiterverbindungen fest',
          'Stromkreise beschriftet', 'Schutz-/Überwachungseinrichtungen vorhanden', 'Schutzpotentialausgleich vollständig',
        ],
      },
      {
        typ: 'checkliste', titel: 'Erproben (Funktionsprüfung)',
        punkte: [
          'Funktionsprüfung der Anlage i.O.', 'FI-Schutzschalter (RCD) i.O.', 'Funktion Schutz-/Sicherheits-/Überwachungseinrichtung i.O.',
          'Rechtsdrehfeld (Drehstromsteckdose) i.O.', 'Spannungsabfall geprüft i.O.', 'Gebäudesystemtechnik i.O.', 'Spannungspolarität i.O.',
        ],
      },
      {
        typ: 'checkliste', titel: 'Durchgängigkeit Potentialausgleichsystem',
        punkte: [
          'Fundamenterder', 'Ringerder', 'Haupterdungsschiene', 'Hauptschutzschalter', 'Heizungsanlage',
          'Wasserzwischenzähler', 'Hauptwasserleitung', 'Gasinnenleitung', 'Klimaanlage', 'Aufzuganlage',
          'EDV-Anlage', 'Telefonanlage', 'Blitzschutzanlage', 'Antennenanlage/BK', 'Gebäudekonstruktion',
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Messwerte',
        felder: [
          { label: 'Spannungsfall nachgewiesen (%)', typ: 'zahl' },
          { label: 'Erdungswiderstand (Ω)', typ: 'zahl' },
          { label: 'Verwendete Messgeräte', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: 'Prüfplakette', fragen: ['Prüfplakette angebracht'] },
      {
        typ: 'kopfdaten', titel: 'Abschluss',
        felder: [
          { label: 'Ende Prüfung', typ: 'text' },
          { label: 'Name vom Prüfer', typ: 'text' },
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Prüfer'] },
    ],
  },
  {
    id: 'vorlage-wiederholungspruefung-ortsveraenderlich', typ: 'dokumentation', name: 'Wiederholungsprüfung ortsveränderlicher elektrischer Geräte',
    textVorlage: `WIEDERHOLUNGSPRÜFUNG ORTSVERÄNDERLICHER ELEKTRISCHER GERÄTE

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Bemerkungen/Mängel:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Kundennr.', typ: 'text' },
          { label: 'Auftragsnr.', typ: 'text' },
        ],
      },
      { typ: 'checkliste', titel: 'Prüfung nach', punkte: ['BetrSichV', 'TRBS 1201', 'DGUV Vorschrift 3', 'DGUV Vorschrift 4', 'VSG 1.4', 'DIN VDE 0701-0702'] },
      {
        typ: 'kopfdaten', titel: 'Prüfling',
        felder: [
          { label: 'Bezeichnung vom elektrischen Gerät', typ: 'text' },
          { label: 'Typ', typ: 'text' },
          { label: 'Hersteller', typ: 'text' },
          { label: 'Fabrikat-Nr.', typ: 'text' },
          { label: 'Inventar-Nr.', typ: 'text' },
          { label: 'Nennspannung (V)', typ: 'zahl' },
          { label: 'Nennstrom (A)', typ: 'zahl' },
          { label: 'Nennleistung (W)', typ: 'zahl' },
          { label: 'Frequenz (Hz)', typ: 'zahl' },
          { label: 'Schutzklasse', typ: 'text' },
          { label: 'Belastung (1-phasig/3-phasig)', typ: 'text' },
        ],
      },
      {
        typ: 'janein', titel: '2. Sichtprüfung',
        fragen: [
          'Isolierung i.O.', 'Auswahl/Anwendung von Leitungen und Steckern i.O.', 'Netzstecker, Anschlussklemmen und -adern i.O.',
          'Biegeschutz i.O.', 'Zugentlastung der Anschlussleitung i.O.', 'Befestigungen, Leitungshalterungen i.O.',
          'Gehäuse und Schutzabdeckungen i.O.', 'Bedienbarkeit von Schaltern/Steuereinrichtungen i.O.',
          'Lesbarkeit der Sicherheits-Aufschriften/Symbole i.O.', 'Lesbarkeit der Bemessungsdaten und Stellungsanzeigen i.O.',
        ],
      },
      {
        typ: 'janein', titel: '3. Gefahrenbeurteilung (erkennbar?)',
        fragen: [
          'Überlastung oder unsachgemäße Anwendung/Bedienung erkennbar', 'Unzulässige Eingriffe oder Veränderungen erkennbar',
          'Sicherheitsbeeinträchtigende Verschmutzung, Korrosion oder Alterung erkennbar', 'Verschmutzung/Verstopfung der Kühlungsöffnungen erkennbar',
        ],
      },
      {
        typ: 'kopfdaten', titel: '4. Messung',
        felder: [
          { label: 'RCD Auslösestrom (mA)', typ: 'text' },
          { label: 'Auslösezeit (ms)', typ: 'text' },
          { label: 'Isolationswiderstand (MΩ)', typ: 'text' },
          { label: 'Schutzleiterstrom (mA)', typ: 'zahl' },
          { label: 'Berührungsstrom (mA)', typ: 'zahl' },
        ],
      },
      { typ: 'janein', titel: 'Messung – Zustand i.O.', fragen: ['RCD i.O.', 'Isolationswiderstand i.O.', 'Schutzleiterstrom i.O.', 'Berührungsstrom i.O.'] },
      {
        typ: 'checkliste', titel: '5. Hinweise für den Auftraggeber/Betreiber',
        punkte: [
          'Bei der Überprüfung wurden keine Mängel festgestellt', 'Mängel wurden durch Reparatur beseitigt',
          'Auf festgestellte Mängel hingewiesen', 'Das elektrische Gerät darf nicht weiter verwendet werden',
        ],
      },
      { typ: 'checkliste', titel: '7. Gesamtbeurteilung – Prüfplakette', punkte: ['Ja, keine Mängel', 'Ja, kleine Mängel', 'Nein, mangelhaft'] },
      {
        typ: 'kopfdaten', titel: 'Gesamtbeurteilung',
        felder: [
          { label: 'Prüfdatum', typ: 'datum' },
          { label: 'Nächster Prüftermin', typ: 'datum' },
          { label: 'Name Prüfer', typ: 'text' },
          { label: 'Verwendetes Messgerät (Typ & Fabrikat)', typ: 'text' },
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Auftraggeber', 'Unterschrift Prüfer'] },
    ],
  },
  {
    id: 'vorlage-installationsprotokoll-elektroanlage', typ: 'dokumentation', name: 'Installationsprotokoll Elektroanlage',
    textVorlage: `INSTALLATIONSPROTOKOLL ELEKTROANLAGE

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Projektbeschreibung:


Bemerkungen zum Vorzustand:


Verwendete Materialien:


Sonstige Bemerkungen:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Projekt',
        felder: [
          { label: 'Anlagenteil', typ: 'text' },
          { label: 'Ausführungsdatum', typ: 'datum' },
        ],
      },
      {
        typ: 'kopfdaten', titel: '1. Isolationsmessung',
        felder: [
          { label: 'Messgerät', typ: 'text' },
          { label: 'Messwert (MΩ)', typ: 'text' },
          { label: 'Messspannung (V)', typ: 'zahl' },
        ],
      },
      { typ: 'janein', titel: 'Isolationsmessung', fragen: ['Isolationsmessung bestanden'] },
      {
        typ: 'kopfdaten', titel: '2. Schleifenimpedanz (Zs)',
        felder: [
          { label: 'Kabel Typ & Querschnitt', typ: 'text' },
          { label: 'Messwert (Ω)', typ: 'text' },
          { label: 'Leitungsschutzschalter', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: 'Schleifenimpedanz', fragen: ['Grenzwert eingehalten'] },
      {
        typ: 'kopfdaten', titel: '3. RCD-Prüfung',
        felder: [
          { label: 'Typ FI/RCD', typ: 'text' },
          { label: 'Bemessungsstrom (mA)', typ: 'zahl' },
          { label: 'Auslösestrom gemessen (mA)', typ: 'text' },
          { label: 'Auslösezeit gemessen (ms)', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: 'RCD-Prüfung – Ergebnis', fragen: ['Funktionsprüfung Prüftaste i.O.', 'Messung bestanden'] },
      { typ: 'janein', titel: 'Abschluss / Bestätigung', fragen: ['Anlage vollständig betriebsbereit', 'Gemeinsame Übergabe mit Auftraggeber vorgenommen'] },
      { typ: 'unterschriften', labels: ['Unterschrift Elektroinstallateur', 'Unterschrift Auftraggeber'] },
    ],
  },
  {
    id: 'vorlage-baubesprechungsprotokoll', typ: 'dokumentation', name: 'Baubesprechungsprotokoll',
    textVorlage: `BAUBESPRECHUNGSPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Teilnehmer:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Bauvorhaben',
        felder: [
          { label: 'Bauvorhaben-Nr.', typ: 'text' },
          { label: 'Ort', typ: 'text' },
          { label: 'Datum & Uhrzeit', typ: 'text' },
        ],
      },
      { typ: 'tabelle', titel: 'Besprechungspunkte', spalten: ['Gewerk/Thema', 'Beschreibung', 'Verantwortlich', 'Erledigt bis'] },
      { typ: 'unterschriften', labels: ['Unterschriftsfeld 1', 'Unterschriftsfeld 2', 'Unterschriftsfeld 3', 'Unterschriftsfeld 4'] },
    ],
  },
  {
    id: 'vorlage-bauabnahme', typ: 'dokumentation', name: 'Bauabnahme',
    textVorlage: `BAUABNAHME

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum der Abnahme: {{datum}}

Mängelliste:


Besondere Hinweise / Vorbehalte:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Auftragsnummer', typ: 'text' },
          { label: 'Ansprechpartner vor Ort', typ: 'text' },
          { label: 'Projektadresse', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: 'Abnahmezustand', fragen: ['Leistungen mängelfrei erbracht'] },
      { typ: 'janein', titel: 'Nachbesserung', fragen: ['Nachbesserungen vereinbart'] },
      { typ: 'unterschriften', labels: ['Unterschrift Auftraggeber', 'Unterschrift Auftragnehmer'] },
    ],
  },
  {
    id: 'vorlage-pv-standortaufnahme', typ: 'dokumentation', name: 'PV-Standortaufnahme',
    textVorlage: `PV-STANDORTAUFNAHME

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Architekt (Name, Kontaktdaten):


Elektromeister (Name, Kontaktdaten):


Dachdecker (Name, Kontaktdaten):


Sonstige Angaben / Bemerkungen:


Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Auftragsdaten', felder: [{ label: 'Auftragsnr.', typ: 'text' }, { label: 'Prüfer', typ: 'text' }] },
      {
        typ: 'kopfdaten', titel: '1. Allgemein',
        felder: [
          { label: 'Anschrift Baustelle', typ: 'text' },
          { label: 'Gebäudeart', typ: 'text' },
          { label: 'Schneelastzone', typ: 'text' },
          { label: 'Höhe ü. N.N. (m)', typ: 'zahl' },
          { label: 'Windlastzone', typ: 'text' },
          { label: 'Aktueller Stromverbrauch (kWh/a)', typ: 'zahl' },
        ],
      },
      { typ: 'janein', titel: 'Denkmalschutz', fragen: ['Denkmal- oder Ensembleschutz vorhanden'] },
      {
        typ: 'checkliste', titel: '2. Unterlagen',
        punkte: [
          'Lageplan', 'Grundriss', 'Dachaufsicht', 'Seitenansicht', 'Schnitt', 'Baubeschreibung',
          'Foto Dach', 'Foto Hausansicht mit Dachfläche', 'Foto Zählerplatz', 'Foto Verschattungssituation',
        ],
      },
      {
        typ: 'kopfdaten', titel: '3. Kundenwünsche',
        felder: [
          { label: 'PV-Modultyp', typ: 'text' },
          { label: 'PV-Leistung ca. (kWp)', typ: 'zahl' },
          { label: 'Maximal nutzbare Fläche (m²)', typ: 'zahl' },
          { label: 'Erwünschter Energieertrag (kWh/a)', typ: 'zahl' },
          { label: 'Maximale Investition (€)', typ: 'zahl' },
        ],
      },
      {
        typ: 'kopfdaten', titel: '4. Angaben zum Dach',
        felder: [
          { label: 'Dachneigung (°)', typ: 'zahl' },
          { label: 'Traufhöhe (m)', typ: 'zahl' },
          { label: 'Firsthöhe (m)', typ: 'zahl' },
          { label: 'Dachform', typ: 'text' },
          { label: 'Dachdeckung', typ: 'text' },
          { label: 'Sparrenabstand (m)', typ: 'zahl' },
        ],
      },
      { typ: 'checkliste', titel: 'Hinderliche Dachelemente', punkte: ['Schornstein', 'Antenne', 'Dachfenster', 'Blitzableiter', 'Gaube'] },
      { typ: 'janein', titel: 'Dach – Zustand', fragen: ['Statik geprüft', 'Dachaufbau Wärmedämmung vorhanden', 'Zufahrtsmöglichkeit vorhanden'] },
      {
        typ: 'kopfdaten', titel: '5. PV-Generator, Wechselrichter & Zähler',
        felder: [
          { label: 'Ort für PV-Generator Erdung', typ: 'text' },
          { label: 'Ort für Generatoranschlusskasten', typ: 'text' },
          { label: 'Ort des Stromzählers', typ: 'text' },
          { label: 'Ort für Wechselrichter', typ: 'text' },
          { label: 'Ort für DC-Hauptschalter', typ: 'text' },
        ],
      },
      {
        typ: 'kopfdaten', titel: '6. Leitungen und Installation',
        felder: [
          { label: 'Entfernung PV-Generator zum Anschlusskasten (m)', typ: 'zahl' },
          { label: 'Entfernung Anschlusskasten zum Wechselrichter (m)', typ: 'zahl' },
          { label: 'Entfernung Wechselrichter zum Netzanschluss (m)', typ: 'zahl' },
          { label: 'Entfernung Gesamt (m)', typ: 'zahl' },
        ],
      },
      {
        typ: 'kopfdaten', titel: '7. Netzeinspeisung',
        felder: [
          { label: 'Name des Netzbetreibers', typ: 'text' },
          { label: 'Ansprechpartner', typ: 'text' },
          { label: 'Netzimpedanz (kΩ)', typ: 'zahl' },
          { label: 'Netzeinspeisung bis (kVA)', typ: 'zahl' },
        ],
      },
      { typ: 'tabelle', titel: '8. Evaluierung der Verschattung', spalten: ['Dachfläche', 'Ausrichtung', 'Neigung', 'Verschattung'] },
      { typ: 'unterschriften', labels: ['Unterschrift Auftraggeber', 'Unterschrift Auftragnehmer'] },
    ],
  },
];

export const TERMIN_TYPEN = [
  { id: 'termin', titel: 'Termin', farbe: '#2b7fd6' },
  { id: 'baustelle', titel: 'Baustelle', farbe: '#f0a020' },
  { id: 'schulung', titel: 'Schulung', farbe: '#8e44ad' },
  { id: 'krank', titel: 'Krank', farbe: '#c0392b' },
  { id: 'urlaub', titel: 'Urlaub', farbe: '#1f8a4c' },
];

export const DEFAULT_TERMIN_STATUS = [
  { id: 'geplant', titel: 'Geplant', farbe: '#2b7fd6', reihenfolge: 0 },
  { id: 'dokumentiert', titel: 'Dokumentiert', farbe: '#8e44ad', reihenfolge: 1 },
  { id: 'abgerechnet', titel: 'Abgerechnet', farbe: '#f0a020', reihenfolge: 2 },
  { id: 'bezahlt', titel: 'Bezahlt', farbe: '#1f8a4c', reihenfolge: 3 },
  { id: 'storniert', titel: 'Storniert', farbe: '#c0392b', reihenfolge: 4 },
];

export const DEFAULT_AUFGABEN_STATUS = [
  { id: 'offen', titel: 'Offen', farbe: '#2b7fd6', reihenfolge: 0 },
  { id: 'in-arbeit', titel: 'In Arbeit', farbe: '#f0a020', reihenfolge: 1 },
  { id: 'klaerung', titel: 'Klärung', farbe: '#8e44ad', reihenfolge: 2 },
  { id: 'erledigt', titel: 'Erledigt', farbe: '#1f8a4c', reihenfolge: 3, geschlossen: true },
];

export const ZUGRIFFSROLLEN = [
  { id: 'admin', titel: 'Administrator', beschreibung: 'Voller Zugriff auf alle Bereiche, inkl. Einstellungen und Buchhaltung.' },
  { id: 'buero', titel: 'Büro', beschreibung: 'Kunden, Projekte, Termine, Angebote/Rechnungen, Katalog – ohne Einstellungen und Buchhaltungs-Export.' },
  { id: 'mitarbeiter', titel: 'Mitarbeiter', beschreibung: 'Nur Zeiterfassung, eigene Aufgaben, Kalender/Plantafel und Geräte – keine Finanz- oder Personaldaten.' },
];

export const ROUTE_ROLLEN = {
  dashboard: ['admin', 'buero', 'mitarbeiter'],
  kunden: ['admin', 'buero'],
  kanban: ['admin', 'buero'],
  projekte: ['admin', 'buero', 'mitarbeiter'],
  auftraege: ['admin', 'buero', 'mitarbeiter'],
  plantafel: ['admin', 'buero', 'mitarbeiter'],
  zeiterfassung: ['admin', 'buero', 'mitarbeiter'],
  aufgaben: ['admin', 'buero', 'mitarbeiter'],
  mitarbeiter: ['admin', 'buero'],
  geraete: ['admin', 'buero', 'mitarbeiter'],
  katalog: ['admin', 'buero'],
  vorlagen: ['admin', 'buero'],
  angebote: ['admin', 'buero'],
  auftragsbestaetigung: ['admin', 'buero'],
  rechnungen: ['admin', 'buero'],
  mahnungen: ['admin', 'buero'],
  ausgaben: ['admin', 'buero'],
  postfach: ['admin', 'buero'],
  buchhaltung: ['admin'],
  auswertungen: ['admin'],
  papierkorb: ['admin'],
  einstellungen: ['admin'],
};

// Alle in Deutschland aktuell gültigen USt.-Sätze (§ 12 UStG) für die
// Positions-/Artikel-Auswahl. Es gibt bewusst keine weiteren Werte – die
// befristete Corona-Absenkung (16%/5%, Jul–Dez 2020) ist ausgelaufen.
export const USTSAETZE = [
  { wert: 19, titel: '19% – Regelsteuersatz' },
  { wert: 7, titel: '7% – Ermäßigter Steuersatz' },
  { wert: 0, titel: '0% – Steuerfrei / Kleinunternehmer' },
];

// Kategorien für die automatische KI-Sortierung im Postfach (siehe emailsync.js
// classifyPendingEmails() und den Cloudflare-Worker "email-classify"-Aktion).
export const EMAIL_KATEGORIEN = [
  { id: 'kundenanfrage', titel: 'Kundenanfrage', icon: '👤', badge: 'badge-accent' },
  { id: 'rechnung-lieferant', titel: 'Rechnung/Lieferant', icon: '🧾', badge: 'badge-warn' },
  { id: 'werbung', titel: 'Werbung', icon: '📢', badge: 'badge-purple' },
  { id: 'sonstiges', titel: 'Sonstiges', icon: '📄', badge: '' },
];

export const STEUERARTEN = [
  { id: 'regel', titel: 'Regelbesteuerung (USt. je Position)', hinweis: '' },
  { id: 'kleinunternehmer', titel: 'Kleinunternehmer § 19 UStG (keine USt.)', hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' },
  { id: 'reverse-charge', titel: 'Bauleistungen – Steuerschuldnerschaft des Leistungsempfängers § 13b UStG', hinweis: 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG. Der Rechnungsbetrag ist ohne Umsatzsteuer zu zahlen; die Umsatzsteuer schuldet der Leistungsempfänger.' },
  { id: 'ig-lieferung', titel: 'Innergemeinschaftliche Lieferung § 4 Nr. 1b UStG (steuerfrei)', hinweis: 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b i.V.m. § 6a UStG.' },
  { id: 'export', titel: 'Ausfuhrlieferung / Drittland § 4 Nr. 1a UStG (steuerfrei)', hinweis: 'Steuerfreie Ausfuhrlieferung gemäß § 4 Nr. 1a UStG.' },
];

export const TEXTBAUSTEIN_KATEGORIEN = [
  { id: 'beide', titel: 'Angebote & Rechnungen' },
  { id: 'angebot', titel: 'Nur Angebote' },
  { id: 'rechnung', titel: 'Nur Rechnungen' },
];

export const DEFAULT_TEXTBAUSTEINE = [
  {
    id: 'tb-angebotseinleitung', titel: 'Begrüßung / Angebotseinleitung', kategorie: 'angebot',
    text: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
  },
  {
    id: 'tb-gueltigkeit', titel: 'Gültigkeit & Ansprechbereitschaft', kategorie: 'angebot',
    text: 'Dieses Angebot ist freibleibend und 30 Tage ab Ausstellungsdatum gültig. Die angegebenen Preise verstehen sich zzgl. der gesetzlichen Mehrwertsteuer.\n\nWir würden uns freuen, den Auftrag für Sie ausführen zu dürfen, und stehen für Rückfragen gerne zur Verfügung.',
  },
  {
    id: 'tb-zugaenglichkeit', titel: 'Zugänglichkeit der Arbeitsstelle', kategorie: 'beide',
    text: 'Alle zu bearbeitenden Flächen müssen frei zugänglich sein, ohne Installationen, Leitungen, Heizkörper oder Mobiliar. Die Arbeitsstelle ist besenrein zu übergeben.',
  },
  {
    id: 'tb-strom-wasser', titel: 'Strom & Wasser bauseits', kategorie: 'beide',
    text: 'Die Bereitstellung von Strom und Wasser erfolgt bauseits durch den Auftraggeber.',
  },
  {
    id: 'tb-staub-laerm', titel: 'Staub- und Lärmbelastung', kategorie: 'beide',
    text: 'Baubedingte Staub- und Lärmbelastungen sind unvermeidbar. Wir empfehlen, empfindliche Gegenstände und Möbel abzudecken oder zu entfernen.',
  },
  {
    id: 'tb-endreinigung', titel: 'Endreinigung', kategorie: 'beide',
    text: 'Eine eventuell notwendige Endreinigung ist nicht im Leistungsumfang enthalten und wird bauseits durchgeführt.',
  },
  {
    id: 'tb-altbausubstanz', titel: 'Altbausubstanz / Mehrarbeiten', kategorie: 'beide',
    text: 'Bei Arbeiten an Altbausubstanz können unvorhergesehene Mehrarbeiten erforderlich werden, die wir vor Ausführung mit Ihnen abstimmen.',
  },
  {
    id: 'tb-abrechnung-aufwand', titel: 'Abrechnung nach Aufwand', kategorie: 'beide',
    text: 'Die Abrechnung erfolgt nach tatsächlichem Arbeitsaufwand. Fahrtzeit ist Arbeitszeit. Materialbeschaffung und Rüstzeit sind ebenfalls Arbeitszeit. Abweichungen zur Angebotsmenge sind daher möglich.',
  },
];

export function hasRouteAccess(role, route) {
  const allowed = ROUTE_ROLLEN[route];
  if (!allowed) return true;
  return allowed.includes(role);
}

export async function ensureSeeded() {
  const settingsRows = await getAll('einstellungen');
  if (settingsRows.length === 0) {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await put('einstellungen', { key, value });
    }
  }
  // Einmalige Korrektur: E-Mail/Telefon waren mit falschen Werten vorbelegt.
  const emailRow = settingsRows.find((r) => r.key === 'email');
  if (emailRow && emailRow.value === 'info@neuverdrahtet.com') {
    await put('einstellungen', { key: 'email', value: DEFAULT_SETTINGS.email });
  }
  const telefonRow = settingsRows.find((r) => r.key === 'telefon');
  if (telefonRow && telefonRow.value === '0201 89085050') {
    await put('einstellungen', { key: 'telefon', value: DEFAULT_SETTINGS.telefon });
  }
  const spalten = await getAll('kanbanSpalten');
  const spaltenIds = new Set(spalten.map((s) => s.id));
  const missingSpalten = DEFAULT_KANBAN_SPALTEN.filter((s) => !spaltenIds.has(s.id));
  for (const s of missingSpalten) {
    await put('kanbanSpalten', { ...s, reihenfolge: spalten.length + missingSpalten.indexOf(s) });
  }
  // Bestehende Spalten aus älteren Versionen (vor automatischer Farbvergabe) nachträglich einfärben.
  for (const s of spalten) {
    if (!s.farbe) {
      s.farbe = STATUS_AUTO_PALETTE[(s.reihenfolge ?? 0) % STATUS_AUTO_PALETTE.length];
      await put('kanbanSpalten', s);
    }
  }
  const kategorien = await getAll('kategorien');
  if (kategorien.length === 0) {
    for (const k of DEFAULT_KATEGORIEN) {
      await put('kategorien', k);
    }
  }
  const terminStatus = await getAll('terminStatus');
  const terminStatusIds = new Set(terminStatus.map((s) => s.id));
  const missingTerminStatus = DEFAULT_TERMIN_STATUS.filter((s) => !terminStatusIds.has(s.id));
  for (const s of missingTerminStatus) {
    await put('terminStatus', s);
  }
  const vorlagen = await getAll('vorlagen');
  const dokuVorlagenIds = new Set(vorlagen.filter((v) => v.typ === 'dokumentation').map((v) => v.id));
  const missingDokuVorlagen = DEFAULT_DOKU_VORLAGEN.filter((v) => !dokuVorlagenIds.has(v.id));
  for (const v of missingDokuVorlagen) {
    await put('vorlagen', v);
  }
  const textbausteine = await getAll('textbausteine');
  const textbausteinIds = new Set(textbausteine.map((t) => t.id));
  const missingTextbausteine = DEFAULT_TEXTBAUSTEINE.filter((t) => !textbausteinIds.has(t.id));
  for (const t of missingTextbausteine) {
    await put('textbausteine', t);
  }
  const aufgabenStatus = await getAll('aufgabenStatus');
  if (aufgabenStatus.length === 0) {
    for (const s of DEFAULT_AUFGABEN_STATUS) {
      await put('aufgabenStatus', s);
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

// Für Firmen mit mehreren Marken unter derselben Rechtseinheit (siehe
// views/einstellungen.js "Marken"): überschreibt nur Name/Logo/Kontaktdaten
// auf den globalen Settings, Steuernummer/USt-IdNr/Bank bleiben bewusst immer
// aus den globalen Settings, da rechtlich/steuerlich eine einzige Firma bleibt.
export function resolveMarkeSettings(settings, marke) {
  if (!marke) return settings;
  return {
    ...settings,
    firmenname: marke.name || settings.firmenname,
    logoDataUrl: marke.logoDataUrl || settings.logoDataUrl,
    strasse: marke.strasse || settings.strasse,
    plzOrt: marke.plzOrt || settings.plzOrt,
    telefon: marke.telefon || settings.telefon,
    email: marke.email || settings.email,
    website: marke.website || settings.website,
  };
}

export async function setSettings(obj) {
  for (const [key, value] of Object.entries(obj)) {
    await put('einstellungen', { key, value });
  }
}
