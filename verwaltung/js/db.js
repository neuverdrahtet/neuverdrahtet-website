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
const DB_VERSION = 20;

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
  konten: 'id',
  buchungen: 'id',
  bankbuchungen: 'id',
  anlagegueter: 'id',
  kundenStatus: 'id',
  subunternehmer: 'id',
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
  'subunternehmer',
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
  rechtsform: 'kapitalgesellschaft',
  gewerbesteuerHebesatz: 480,
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
  lohnnebenkostenProzent: 25,
  jahresarbeitsstundenProMitarbeiter: 1720,
  produktivitaetsgradProzent: 70,
  stundensatzGewinnaufschlagProzent: 0,
  stundensatzModus: 'ist',
  stundensatzSchaetzPersonalkosten: 0,
  stundensatzSchaetzBetriebskosten: 0,
  datevBeraterNr: '',
  datevMandantNr: '',
  datevErloesKonto: '8400',
  datevAufwandKonto: '4900',
  kontoBankId: 'konto-1200',
  kontoKasseId: 'konto-1000',
  gwgGrenzeNetto: 800,
  kontoAnlagevermoegenId: 'konto-0400',
  kontoGwgId: 'konto-0480',
  kontoAbschreibungenId: 'konto-6220',
  ustvaZeitraum: 'monatlich',
  bankImportSpalten: {},
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
  { id: 'putz', titel: 'Putz/Stuckateur', farbe: '#be185d' },
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

Prüfgrundlage: DIN VDE 0100 / DIN VDE 0701-0702

Festgestellte Mängel:


Empfohlene Maßnahmen:


Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Auftragsdaten', felder: [{ label: 'Geprüfte Anlage/Geräte', typ: 'text' }] },
      { typ: 'checkliste', titel: '1. Sichtprüfung', punkte: ['Zustand Leitungen/Anschlüsse i.O.', 'Kennzeichnung/Beschriftung i.O.'] },
      {
        typ: 'kopfdaten', titel: '2. Messungen',
        felder: [
          { label: 'Isolationswiderstand', typ: 'text' },
          { label: 'Schutzleiterwiderstand', typ: 'text' },
          { label: 'Schleifenimpedanz', typ: 'text' },
          { label: 'Auslösung RCD (falls vorhanden)', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: '3. Funktionsprüfung', fragen: ['Funktionsprüfung bestanden'] },
      { typ: 'janein', titel: 'Prüfergebnis', fragen: ['Prüfung bestanden'] },
      { typ: 'kopfdaten', titel: 'Abschluss', felder: [{ label: 'Nächste Prüfung fällig am', typ: 'datum' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Prüfer'] },
    ],
  },
  {
    id: 'vorlage-dguv-v3', typ: 'dokumentation', name: 'Wiederkehrende Prüfung (DGUV V3)',
    textVorlage: `PRÜFPROTOKOLL – WIEDERKEHRENDE PRÜFUNG NACH DGUV VORSCHRIFT 3

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Prüfdatum: {{datum}}

Festgestellte Mängel:


Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Auftragsdaten', felder: [{ label: 'Geprüfte elektrische Anlage/Betriebsmittel', typ: 'text' }] },
      { typ: 'checkliste', titel: 'Prüfintervall', punkte: ['ortsfest', 'ortsveränderlich'] },
      { typ: 'janein', titel: 'Prüfergebnisse', fragen: ['Sichtprüfung i.O.', 'Erprobung/Funktionsprüfung i.O.', 'Messung i.O.'] },
      { typ: 'checkliste', titel: 'Gesamtergebnis', punkte: ['keine Mängel', 'Mängel beseitigt', 'Mängel vorhanden (Nachprüfung erforderlich)'] },
      { typ: 'kopfdaten', titel: 'Abschluss', felder: [{ label: 'Nächste Prüfung fällig am', typ: 'datum' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Prüfer'] },
    ],
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


Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'janein', titel: 'Beurteilung', fragen: ['Anlage funktionstüchtig und betriebsbereit'] },
      { typ: 'kopfdaten', titel: 'Abschluss', felder: [{ label: 'Nächster Wartungstermin', typ: 'datum' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Techniker'] },
    ],
  },
  {
    id: 'vorlage-tagesbericht', typ: 'dokumentation', name: 'Tagesbericht',
    textVorlage: `TAGESBERICHT

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Anwesende Mitarbeiter:


Ausgeführte Arbeiten:
-
-
-

Verwendetes Material:


Besondere Vorkommnisse / Behinderungen:


Offene Punkte für den nächsten Tag:


Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Rahmendaten', felder: [{ label: 'Wetter (bei Außenarbeiten)', typ: 'text' }, { label: 'Arbeitszeit (von – bis)', typ: 'text' }] },
      { typ: 'unterschriften', labels: ['Unterschrift'] },
    ],
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


Festgestellte Mängel:


Der Auftragnehmer bestätigt die fach- und normgerechte Ausführung der Arbeiten.
Der Auftraggeber bestätigt die Übernahme der Leistung.

Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'janein', titel: 'Abnahmezustand', fragen: ['Leistung ohne Mängel abgenommen'] },
      { typ: 'kopfdaten', titel: 'Frist', felder: [{ label: 'Frist zur Mängelbeseitigung', typ: 'datum' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Auftragnehmer', 'Unterschrift Auftraggeber/Kunde'] },
    ],
  },
  {
    id: 'vorlage-maengel', typ: 'dokumentation', name: 'Mängelprotokoll',
    textVorlage: `MÄNGELPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Bemerkungen:


Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'tabelle', titel: 'Festgestellte Mängel', spalten: ['Beschreibung', 'Ort/Bauteil', 'Priorität'] },
      { typ: 'kopfdaten', titel: 'Frist', felder: [{ label: 'Vereinbarte Frist zur Beseitigung', typ: 'datum' }, { label: 'Zuständiger Mitarbeiter', typ: 'text' }] },
      { typ: 'unterschriften', labels: ['Unterschrift'] },
    ],
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

Auftragsgegenstand / Beschreibung der Leistung:



Besondere Vereinbarungen / Hinweise:



Der Auftraggeber beauftragt hiermit die oben beschriebene Leistung zu den genannten Bedingungen.

Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Ansprechpartner Kunde', felder: [{ label: 'Ansprechpartner', typ: 'text' }, { label: 'Telefon', typ: 'text' }, { label: 'E-Mail', typ: 'text' }] },
      { typ: 'kopfdaten', titel: 'Rahmendaten', felder: [{ label: 'Vereinbarter Ausführungszeitraum (von – bis)', typ: 'text' }, { label: 'Betrag (falls Festpreis, €)', typ: 'zahl' }] },
      { typ: 'checkliste', titel: 'Vereinbarter Preis', punkte: ['Festpreis', 'nach Aufwand'] },
      { typ: 'kopfdaten', titel: 'Zahlungsbedingungen', felder: [{ label: 'Anzahlung', typ: 'text' }, { label: 'Abschlagszahlung(en)', typ: 'text' }, { label: 'Restzahlung nach Fertigstellung', typ: 'text' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Auftragnehmer', 'Unterschrift Auftraggeber/Kunde'] },
    ],
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
  {
    id: 'vorlage-waermepumpe-wartung', typ: 'dokumentation', name: 'Wärmepumpe-Wartungsprotokoll',
    textVorlage: `WÄRMEPUMPE WARTUNGSPROTOKOLL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Zusätzliche Arbeiten:


Bemerkungen / Mängel:


Empfehlung:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Auftragsnummer', typ: 'text' },
          { label: 'Servicetechniker', typ: 'text' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Infos zur Wärmepumpe',
        felder: [
          { label: 'Typenbezeichnung', typ: 'text' },
          { label: 'Software-Version', typ: 'text' },
          { label: 'Seriennummer', typ: 'text' },
          { label: 'Baujahr', typ: 'text' },
        ],
      },
      {
        typ: 'checkliste', titel: '1–2. Elektrische Komponenten & Regelung',
        punkte: [
          'Überprüfung aller elektrischen Anschlüsse auf festen Sitz', 'Kontrolle der Stromaufnahme von Kompressor und Ventilatoren',
          'Inspektion der Schaltschränke und Steuereinheiten', 'Test der Sicherheitseinrichtungen (z.B. Hochdruckschalter)',
          'Kontrolle/Aktualisierung der Softwareversion', 'Überprüfung und Optimierung der Regelparameter',
          'Test der Fernbedienung und Anzeigen', 'Auslesen und Analyse des Fehlerspeichers',
        ],
      },
      {
        typ: 'checkliste', titel: '3–4. Hydraulisches System & Kältekreislauf',
        punkte: [
          'Überprüfung des Systemdrucks im Heizkreis', 'Kontrolle der Umwälzpumpen auf Funktion und Geräusche',
          'Inspektion der Rohrleitungen und Anschlüsse auf Dichtheit', 'Überprüfung/Reinigung des Filters im Heizkreislauf',
          'Kontrolle des Kältemitteldrucks und der -temperatur', 'Sichtprüfung auf Öl- und Kältemittelleckagen',
          'Überprüfung der Kältemittelfüllung', 'Inspektion und Reinigung von Verdampfer und Kondensator',
        ],
      },
      {
        typ: 'checkliste', titel: '5–6. Wärmetauscher, Ventile & Außeneinheit',
        punkte: [
          'Reinigung der Wärmetauscher (Luft/Wasser)', 'Kontrolle/Reinigung des Kondensatablaufs',
          'Überprüfung aller Ventile auf Funktion und Dichtheit', 'Inspektion des Expansionsventils',
          'Reinigung der Lamellen des Außengeräts', 'Kontrolle des Ventilators auf Beschädigungen und Unwucht',
          'Überprüfung der Schalldämmung und Vibrationsdämpfer', 'Inspektion des Gehäuses auf Korrosion oder Beschädigungen',
        ],
      },
      {
        typ: 'checkliste', titel: '7–8. Allgemeine Prüfungen & Abschluss',
        punkte: [
          'Sichtprüfung aller Komponenten auf Beschädigungen oder Verschleiß', 'Kontrolle der Geräuschentwicklung im Betrieb',
          'Überprüfung der Isolierung aller Rohrleitungen', 'Dokumentation aller Messwerte und durchgeführten Arbeiten',
          'Probelauf und Funktionstest aller Betriebsmodi', 'Optimierung der Effizienz durch Anpassung der Einstellungen',
          'Beratung des Kunden zu energiesparendem Betrieb',
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Messwerte',
        felder: [
          { label: 'Anlagen-Druck (bar)', typ: 'zahl' },
          { label: 'PH-Wert', typ: 'zahl' },
          { label: 'Leitfähigkeit (µS/cm)', typ: 'zahl' },
        ],
      },
      { typ: 'janein', titel: 'Beurteilung', fragen: ['Zustand der Anlage mangelfrei', 'Anlage vollständig betriebsbereit'] },
      {
        typ: 'kopfdaten', titel: 'Abschluss',
        felder: [
          { label: 'Wartung abgeschlossen am', typ: 'datum' },
          { label: 'Nächster Wartungstermin', typ: 'datum' },
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Kunde', 'Unterschrift Servicetechniker'] },
    ],
  },
  {
    id: 'vorlage-geraeteuebergabe', typ: 'dokumentation', name: 'Geräteübergabe',
    textVorlage: `GERÄTEÜBERGABE

Firma: {{firma}}
Ausgabe an: {{mitarbeiter}}
Datum: {{datum}}

Weitere Angaben:


Der Ausleihende erklärt mit seiner Unterschrift, dass er mit folgender Vereinbarung einverstanden ist und diese zur
Kenntnis genommen hat: Das/die Gerät(e) sind zum vereinbarten Rückgabedatum in gereinigtem Zustand zu
übergeben. Der Verleiher bleibt zu jedem Zeitpunkt Eigentümer. Bei Verlust, Diebstahl oder Defekt ist der Schaden
durch den Ausleihenden zu ersetzen oder kann durch den Verleiher in Rechnung gestellt werden.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Gerät',
        felder: [
          { label: 'Gerät', typ: 'text' },
          { label: 'Inventar-Nr.', typ: 'text' },
          { label: 'Serien-Nr.', typ: 'text' },
          { label: 'Zeitraum von', typ: 'datum' },
          { label: 'Zeitraum bis', typ: 'datum' },
        ],
      },
      { typ: 'janein', titel: 'Zustand', fragen: ['Gerät sauber übergeben'] },
      { typ: 'checkliste', titel: 'Abrechnung', punkte: ['Tagessatz', 'Pauschal', 'Kostenfrei'] },
      { typ: 'unterschriften', labels: ['Unterschrift Verleiher', 'Unterschrift Leiher'] },
    ],
  },
  {
    id: 'vorlage-arbeitskleidung-uebergabe', typ: 'dokumentation', name: 'Arbeitskleidung Übergabe',
    textVorlage: `ARBEITSKLEIDUNG ÜBERGABE

Firma: {{firma}}
Empfänger: {{mitarbeiter}}
Datum: {{datum}}

Information zum Eigentum:
Die Arbeitsmittel bleiben Eigentum des Arbeitgebers und sind bei Beendigung des Arbeitsverhältnisses
unaufgefordert zurückzugeben. Beschädigungen oder Verlust sind unverzüglich zu melden.

Empfangsbestätigung:
Hiermit bestätige ich den vollständigen Erhalt bzw. die vollständige Rückgabe der unten aufgeführten Arbeitsmittel
in gepflegtem und funktionstüchtigem Zustand.

Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'checkliste', titel: 'Art des Vorgangs', punkte: ['Übergabe', 'Rückgabe'] },
      { typ: 'tabelle', titel: 'Arbeitsmittel', spalten: ['Beschreibung', 'Anzahl', 'Zustand (Neu/Gebraucht)'] },
      { typ: 'unterschriften', labels: ['Unterschrift Empfänger', 'Unterschrift Übergeber'] },
    ],
  },
  {
    id: 'vorlage-nutzungsrechte', typ: 'dokumentation', name: 'Nutzungsrechte (Arbeitsergebnisse/Urheberrechte)',
    textVorlage: `NUTZUNGSRECHTE – ARBEITSERGEBNISSE, URHEBERRECHTE, ERFINDUNGEN

zwischen {{firma}} und {{mitarbeiter}}

Soweit nicht im Widerspruch zum Arbeitnehmererfindungsgesetz stehend oder durch die Regelungen eines
Gesetzes verboten, erkennt der Arbeitnehmer an, dass seine gesamten Arbeitsergebnisse (allein oder gemeinsam
mit anderen Personen geschaffene Ergebnisse einschließlich etwaiger gewerblicher Schutzrechte an solchen
Arbeitsergebnissen), die im Zusammenhang mit seinem Anstellungsverhältnis geschaffen, entwickelt oder
hergestellt worden sind ("Arbeitsergebnisse"), das ausschließliche Eigentum des Arbeitgebers darstellen.

Der Arbeitnehmer räumt dem Arbeitgeber das ausschließliche und alleinige Nutzungsrecht an allen
urheberrechtlich geschützten geistigen und schöpferischen Leistungen ein, die der Arbeitnehmer im Rahmen
seiner Tätigkeit erbracht hat. Die Nutzungsrechte werden unwiderruflich und unbefristet übertragen. Dem
Arbeitgeber steht das ausschließliche Recht zur vollständigen Verwendung und zur Veränderung jeglicher
Arbeitsergebnisse ohne Beschränkung oder Verpflichtung irgendeiner Art zu.

Außer im Rahmen und zum Zwecke der Nutzung im Zuge seines Anstellungsverhältnisses steht dem Arbeitnehmer
kein Recht zu, die Arbeitsergebnisse zu verwenden. Der Arbeitnehmer verpflichtet sich, alle erforderlichen und
gesetzlich zulässigen Maßnahmen zu ergreifen und jedes Schriftstück auf Verlangen des Unternehmens zu
unterzeichnen, um das Recht des Arbeitgebers an Arbeitsergebnissen zu sichern oder zu übertragen. Der
Arbeitnehmer verzichtet im Rahmen des gesetzlich Zulässigen auf alle sonstigen, ihm als Urheber/Schöpfer
zustehenden Rechte an dem Werk, insbesondere auf die Ausübung des Rechts auf Namensnennung und das Recht
auf Zugänglichmachung des Werkstücks.

Die Übertragung der Rechte umfasst sämtliche übertragbaren Rechte des UrhG, also insbesondere das Recht zur
Veröffentlichung, Vervielfältigung und Verbreitung, das Recht zur Ausstellung, das Vortrags-, Aufführungs- und
Vorführungsrecht, das Recht zur öffentlichen Zugänglichmachung, das Senderecht, Recht der Wiedergabe durch
Bild- und Tonträger, das Recht der Wiedergabe von Funksendungen. Darüber hinaus erteilt der Arbeitnehmer dem
Arbeitgeber im Rahmen des gesetzlich Zulässigen seine Zustimmung zur Änderung und weiteren Bearbeitung.

Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'unterschriften', labels: ['Unterschrift Mitarbeiter', 'Unterschrift Arbeitgeber'] },
    ],
  },
  {
    id: 'vorlage-einwilligung-foto-video', typ: 'dokumentation', name: 'Einwilligung zur Nutzung von Foto- & Videoaufnahmen',
    textVorlage: `EINWILLIGUNG ZUR NUTZUNG VON FOTO- & VIDEOAUFNAHMEN

zwischen {{firma}} und {{mitarbeiter}}

Gegenstand:
Fotografische Aufnahmen der/des Fotografierten am Arbeitsplatz oder auf Firmenevents.

Verwendungszweck:
Veröffentlichung im Internet zur bildlichen Darstellung des Ansprechpartners für die Dauer des
Arbeitsverhältnisses, Postings auf Social Media (z.B. YouTube, Instagram, Google, WhatsApp), Webpräsenz,
Homepage, Flyer, Visitenkarten etc., auch über das Arbeitsverhältnis hinaus.

Erklärung:
Der/die Fotografierte erklärt sein/ihr Einverständnis mit der (unentgeltlichen) Verwendung der fotografischen/
Video-Aufnahmen seiner/ihrer Person für die oben beschriebenen Zwecke. Eine Verwendung für andere als die
beschriebenen Zwecke oder ein Inverkehrbringen durch Überlassung der Aufnahmen an Dritte ist unzulässig.

Der/die Fotografierte hat das Informationsschreiben zur Erhebung personenbezogener Daten im Rahmen der
Nutzung von Fotoaufnahmen gemäß Art. 13 DSGVO erhalten und zur Kenntnis genommen. Diese Einwilligung ist
freiwillig. Wird sie nicht erteilt, entstehen keine Nachteile. Diese Einwilligung kann jederzeit mit Wirkung für die
Zukunft widerrufen werden.

Ort, Datum: {{datum}}

---

INFORMATIONSSCHREIBEN ZUR ERHEBUNG PERSONENBEZOGENER DATEN (ART. 13 DSGVO)

1. Verantwortlicher: {{firma}}
2. Kontaktdaten des Datenschutzbeauftragten: siehe Firmenangaben
3. Zwecke der Verarbeitung: siehe Verwendungszweck oben
4. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO)
5. Empfänger/Kategorien von Empfängern: Dienstleister, Social Media, Kunden
6. Übermittlung in ein Drittland: nur nach ausdrücklicher Einwilligung nach Unterrichtung über die Risiken,
   ggf. inkl. Übermittlung an Cloud-Lösungen, Webhosting, Drittanbieter und Drittländer
7. Dauer der Speicherung: mindestens für die Dauer des Arbeitsverhältnisses, maximal 10 Jahre darüber hinaus
8. Rechte der Betroffenen: Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der
   Verarbeitung (Art. 18), Widerspruch (Art. 21), Datenübertragbarkeit (Art. 20), Widerruf der Einwilligung (Art. 7 Abs. 3)
9. Recht auf Widerruf: jederzeit mit Wirkung für die Zukunft, zu richten an den Verantwortlichen
10. Recht auf Beschwerde bei einer Datenschutzaufsichtsbehörde
11. Die Bereitstellung der personenbezogenen Daten ist für einen Vertragsabschluss erforderlich.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'unterschriften',
        labels: ['Unterschrift Mitarbeiter (Einwilligung)', 'Unterschrift Arbeitgeber (Einwilligung)', 'Unterschrift Mitarbeiter (Infoschreiben)', 'Unterschrift Arbeitgeber (Infoschreiben)'],
      },
    ],
  },
  {
    id: 'vorlage-personalfragebogen', typ: 'dokumentation', name: 'Personalfragebogen',
    textVorlage: `PERSONALFRAGEBOGEN

Firma: {{firma}}
Name des Mitarbeiters: {{mitarbeiter}}
Datum: {{datum}}

Dieser Personalfragebogen dient zur Vorerfassung von Personaldaten für die Lohnabrechnung. Zur Wahrung der
Aufbewahrungsfrist wird der ausgefüllte Personalfragebogen vom Arbeitgeber bzw. der lohnabrechnenden Stelle
gespeichert.

Erklärung des Arbeitnehmers: Ich versichere, dass die vorstehenden Angaben der Wahrheit entsprechen. Ich
verpflichte mich, meinem Arbeitgeber alle Änderungen, insbesondere in Bezug auf weitere Beschäftigungen,
unverzüglich mitzuteilen.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Persönliche Angaben',
        felder: [
          { label: 'Familienname ggf. Geburtsname', typ: 'text' },
          { label: 'Vorname', typ: 'text' },
          { label: 'Straße und Hausnr.', typ: 'text' },
          { label: 'PLZ und Ort', typ: 'text' },
          { label: 'Geburtsdatum', typ: 'datum' },
          { label: 'Geburtsort, -land', typ: 'text' },
          { label: 'Versicherungsnr. (SV-Ausweis)', typ: 'text' },
          { label: 'Staatsangehörigkeit', typ: 'text' },
          { label: 'IBAN', typ: 'text' },
          { label: 'BIC', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: 'Status', fragen: ['Schwerbehindert'] },
      {
        typ: 'kopfdaten', titel: 'Beschäftigung',
        felder: [
          { label: 'Personalnummer', typ: 'text' },
          { label: 'Eintrittsdatum', typ: 'datum' },
          { label: 'Berufsbezeichnung', typ: 'text' },
          { label: 'Ausgeübte Tätigkeit', typ: 'text' },
          { label: 'Kostenstelle', typ: 'text' },
          { label: 'Abt.-Nummer', typ: 'text' },
          { label: 'Personengruppe', typ: 'text' },
          { label: 'Urlaubsanspruch (Tage/Kalenderjahr)', typ: 'zahl' },
        ],
      },
      {
        typ: 'janein', titel: 'Beschäftigung – Details',
        fragen: ['Probezeit', 'Hauptbeschäftigung (sonst Nebenbeschäftigung)', 'Vollzeit (sonst Teilzeit)', 'Weitere Beschäftigung wird ausgeübt', 'Arbeitsverhältnis ist befristet'],
      },
      {
        typ: 'kopfdaten', titel: 'Befristung (falls zutreffend)',
        felder: [
          { label: 'Befristung Arbeitsvertrag zum', typ: 'datum' },
          { label: 'Abschluss Arbeitsvertrag am', typ: 'datum' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Steuer',
        felder: [
          { label: 'Identifikationsnummer', typ: 'text' },
          { label: 'Steuerklasse/Faktor', typ: 'text' },
          { label: 'Kinderfreibeträge', typ: 'zahl' },
          { label: 'Konfession', typ: 'text' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Sozialversicherung',
        felder: [
          { label: 'Gesetzl. Krankenkasse', typ: 'text' },
          { label: 'UV-Gefahrentarif', typ: 'text' },
        ],
      },
      { typ: 'janein', titel: 'Sozialversicherung – Status', fragen: ['Elterneigenschaft'] },
      {
        typ: 'kopfdaten', titel: 'Entlohnung',
        felder: [
          { label: 'Grundgehalt (€/Monat)', typ: 'zahl' },
          { label: 'Stundenlohn (€)', typ: 'zahl' },
          { label: 'Verpflegungszuschuss (€/Monat)', typ: 'zahl' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'VWL (falls Vertrag vorliegt)',
        felder: [
          { label: 'Empfänger VWL', typ: 'text' },
          { label: 'Betrag (€)', typ: 'zahl' },
          { label: 'AG-Anteil (€ mtl.)', typ: 'zahl' },
          { label: 'Vertragsnr.', typ: 'text' },
        ],
      },
      {
        typ: 'checkliste', titel: 'Angaben zu den Arbeitspapieren',
        punkte: [
          'Arbeitsvertrag liegt vor', 'Bescheinigung über LSt.-Abzug liegt vor', 'SV-Ausweis liegt vor',
          'Mitgliedsbescheinigung Krankenkasse liegt vor', 'VWL-Vertrag liegt vor', 'Nachweis Elterneigenschaft liegt vor',
          'Vertrag Betriebliche Altersversorgung liegt vor', 'Schwerbehindertenausweis liegt vor',
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Arbeitnehmer', 'Unterschrift Arbeitgeber'] },
    ],
  },
  {
    id: 'vorlage-datenschutzhinweise-beschaeftigte', typ: 'dokumentation', name: 'Datenschutzhinweise für Beschäftigte',
    textVorlage: `DATENSCHUTZHINWEISE FÜR BESCHÄFTIGTE

Firma: {{firma}}
Name Arbeitnehmer: {{mitarbeiter}}
Datum: {{datum}}

Im Rahmen deiner Tätigkeit bei uns verarbeiten wir personenbezogene Daten. Die folgenden Hinweise geben dir
einen Überblick über Art, Zweck und Rechtsgrundlage der Datenverarbeitung.

Verarbeitete Daten & Zwecke:
Wir verarbeiten Stammdaten (Name, Adresse, Geburtsdatum, Kontaktdaten), Vertragsdaten (Arbeitsvertrag,
Position, Eintrittsdatum, Vergütung), Abrechnungsdaten (Bankverbindung, Steuer-ID, Sozialversicherungsnummer),
Kommunikationsdaten, Leistungs- und Verhaltensdaten (z.B. Arbeitszeiten) sowie IT-Nutzungsdaten. Zwecke sind
insbesondere die Durchführung und Verwaltung des Beschäftigungsverhältnisses, Lohn- und Gehaltsabrechnung,
Einhaltung gesetzlicher Verpflichtungen, Organisation von Arbeitsabläufen, IT-Sicherheit sowie Personalentwicklung.

Rechtsgrundlagen: §26 BDSG und ggf. Art. 6 Abs. 1 lit. c oder lit. f DSGVO.

Dauer der Speicherung: so lange wie zur Erfüllung gesetzlicher Pflichten oder zur Geltendmachung, Ausübung oder
Verteidigung von Rechtsansprüchen notwendig.

Weitergabe & Verarbeitung: nur im Rahmen gesetzlicher Pflichten an z.B. Sozialversicherungsträger,
Finanzbehörden oder Steuerberater. Die Verarbeitung findet ausschließlich innerhalb der EU statt.

Deine Rechte: Auskunft, Berichtigung, Löschung, Einschränkung und Widerspruch gegen die Verarbeitung deiner
Daten. Du kannst dich bei Fragen an den internen Datenschutzbeauftragten wenden und hast das Recht, dich bei
der zuständigen Aufsichtsbehörde zu beschweren.

Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'unterschriften', labels: ['Unterschrift Arbeitnehmer (Erhalt/Kenntnisnahme)', 'Unterschrift Arbeitgeber (Unterweisung durchgeführt)'] },
    ],
  },
  {
    id: 'vorlage-bewirtungsbeleg', typ: 'dokumentation', name: 'Bewirtungsbeleg',
    textVorlage: `BEWIRTUNGSBELEG

Angaben zum Nachweis der Höhe und der geschäftlichen Veranlassung von Bewirtungsaufwendungen
(§ 4 Abs. 5 Nr. 2 EStG)

Firma: {{firma}}

Anlass der Bewirtung:


Bewirtete Personen intern:


Bewirtete Personen extern:


Sonstige Angaben:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Bewirtung',
        felder: [
          { label: 'Ort der Bewirtung', typ: 'text' },
          { label: 'Datum der Bewirtung', typ: 'datum' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Beträge',
        felder: [
          { label: 'Rechnungsbetrag (€)', typ: 'zahl' },
          { label: 'Trinkgeld (€)', typ: 'zahl' },
          { label: 'Gesamtbetrag inkl. Trinkgeld (€)', typ: 'zahl' },
        ],
      },
      { typ: 'checkliste', titel: 'Zahlungsart', punkte: ['Karte', 'PayPal', 'Bar'] },
      { typ: 'unterschriften', labels: ['Unterschrift Gastgeber'] },
    ],
  },
  {
    id: 'vorlage-gefahrenunterweisung', typ: 'dokumentation', name: 'Gefahrenunterweisung',
    textVorlage: `GEFAHRENUNTERWEISUNG

Firma: {{firma}}
Arbeitnehmer: {{mitarbeiter}}
Datum: {{datum}}

Grundsätze im Arbeits- und Gesundheitsschutz:
Sicherheit am Arbeitsplatz und Schutz vor arbeitsbedingten Gesundheitsgefahren haben höchste Priorität. Jede/r
Mitarbeiter/in ist vom ersten Tag an verpflichtet, sicher, gesundheits- und umweltgerecht zu arbeiten.

Aufgaben im Arbeits- und Umweltschutz:
- auf Ordnung und Sauberkeit bei der Arbeit achten
- vermeiden, dass andere Personen durch eigene Handlungen oder Unterlassungen gefährdet werden
- schriftliche und mündliche Anweisungen zum Arbeits- und Umweltschutz befolgen
- die zur Verfügung gestellte persönliche Schutzausrüstung bestimmungsgemäß verwenden und pfleglich behandeln
- Arbeitsmittel vor Verwendung durch Sichtkontrolle auf sicheren Zustand und Eignung prüfen
- sicherheits- und gesundheitsbewusst arbeiten, sicherer Umgang mit Gefahrstoffen
- Mängel wo möglich selbst abstellen oder umgehend dem Vorgesetzten melden
- sicherheitswidriges Verhalten von Kollegen und Dritten ansprechen und/oder melden
- Verbot von Alkohol und anderen Rauschmitteln beachten; in Arbeitsräumen und Fahrzeugen nicht rauchen

Sonstige Bemerkungen:


Information: Die oben genannten Punkte wurden einvernehmlich mit dem/der Arbeitnehmer/in durchgesprochen.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'checkliste', titel: 'Besprochen wurde auch',
        punkte: [
          'die besonderen Gefährdungen bei den auszuführenden Tätigkeiten', 'die Erste Hilfe (z.B. Verbandskästen)',
          'das Verhalten bei Feuer', 'das Verbot, Fahrzeuge ohne gültigen Fahrausweis zu führen',
          'die Maßnahmen zur Vermeidung von Unfällen und arbeitsbedingten Erkrankungen', 'das Verhalten bei Unfällen',
          'die Meldung von Unfällen', 'die Notrufnummer', 'Maßnahmen des Brandschutzes',
        ],
      },
      {
        typ: 'checkliste', titel: 'Gezeigt wurden',
        punkte: [
          'der zukünftige Arbeitsplatz', 'die Flucht- und Rettungswege',
          'wo sich Verbandskästen, Feuerlöscher und Abfallsammelstellen befinden', 'Tragen von PSA bei Arbeiten auf der Baustelle & beim Kunden',
        ],
      },
      { typ: 'checkliste', titel: 'Empfangsbestätigung', punkte: ['Ich habe die Inhalte verstanden', 'Ich verpflichte mich, die entsprechenden Vorschriften und Verhaltensregeln zu beachten'] },
      { typ: 'kopfdaten', titel: 'Unterweisung durch', felder: [{ label: 'Name des Unterweisenden', typ: 'text' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Arbeitnehmer', 'Unterschrift Arbeitgeber'] },
    ],
  },
  {
    id: 'vorlage-einzelauftrag-regiezettel', typ: 'dokumentation', name: 'Einzelauftrag / Regiezettel',
    textVorlage: `EINZELAUFTRAG / REGIEZETTEL

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Art der auszuführenden Arbeiten:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Objekt',
        felder: [
          { label: 'Objekt/Baustellenadresse', typ: 'text' },
          { label: 'Objektnummer', typ: 'text' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Ausführung',
        felder: [
          { label: 'Datum', typ: 'datum' },
          { label: 'Zeit der Ausführung', typ: 'text' },
          { label: 'Verantwortliche(r)', typ: 'text' },
        ],
      },
      { typ: 'checkliste', titel: 'Abrechnungsart', punkte: ['Pauschalpreis', 'Zeit', 'Quadratmeter', 'Stückpreis'] },
      {
        typ: 'kopfdaten', titel: 'Vereinbarter Preis',
        felder: [
          { label: 'Netto (€)', typ: 'zahl' },
          { label: 'MwSt. (€)', typ: 'zahl' },
          { label: 'Brutto (€)', typ: 'zahl' },
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Auftraggeber (Erhebung)'] },
    ],
  },
  {
    id: 'vorlage-sicherheitsbeleuchtung-fluchtwege', typ: 'dokumentation', name: 'Sicherheitsbeleuchtung/-stromversorgung & Kennzeichnung von Fluchtwegen',
    textVorlage: `SICHERHEITSBELEUCHTUNG/-STROMVERSORGUNG | KENNZEICHNUNG VON FLUCHTWEGEN

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Einrichtungen für den technischen Brandschutz müssen dem Stand der Technik entsprechen und so beschaffen,
bemessen, ausgeführt und in Stand gehalten sein, dass sie funktionstüchtig und jederzeit betriebsbereit sind.

Weitere Informationen:


Mit der Unterschrift bestätigt der Installateur/die Fachfirma, dass die installierten Sicherheitseinrichtungen
funktionstüchtig und jederzeit betriebsbereit sind.

Ort, Datum: {{datum}}`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Auftragsdaten', felder: [{ label: 'Objekt', typ: 'text' }, { label: 'Auftrags-Nr.', typ: 'text' }] },
      {
        typ: 'janein', titel: '1. Sicherheitsstromversorgung',
        fragen: [
          'Einzelbatterieleuchten korrekt installiert', 'Gruppen- oder Zentralbatterie korrekt installiert',
          'Funktionserhalt des Verteilnetzes entspricht der Nennbetriebsdauer', 'Eigentümer/Betreiber über Funktion und Wartung instruiert',
        ],
      },
      {
        typ: 'janein', titel: '2. Sicherheitsbeleuchtung',
        fragen: [
          'Jede Sicherheitsleuchte als solche erkennbar/gekennzeichnet', 'Umschaltzeiten normgerecht eingehalten',
          'Minimale Nennbetriebsdauer 30 Minuten', 'Minimale Beleuchtungsstärke 1 Lux während 30 Minuten',
        ],
      },
      {
        typ: 'janein', titel: '3. Kennzeichnung von Fluchtwegen & Ausgängen',
        fragen: [
          'Rettungszeichen normgerecht montiert (Seitenlänge mind. 150 mm)', 'Dauerschaltung in Räumen mit großer Personenbelegung',
          'Dauerschaltung in Verkaufsgeschäften',
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift Installateur'] },
    ],
  },
  {
    id: 'vorlage-mittelspannungskabel-messung', typ: 'dokumentation', name: 'Mittelspannungskabel Messung',
    textVorlage: `MITTELSPANNUNGSKABEL MESSUNG

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Anmerkungen:


Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Auftragsbezeichnung', typ: 'text' },
          { label: 'Prüfer', typ: 'text' },
          { label: 'NC', typ: 'text' },
          { label: 'Service', typ: 'text' },
          { label: 'Spannung (kV)', typ: 'zahl' },
          { label: 'Kabelkategorie', typ: 'text' },
          { label: 'Kabelstrecke von', typ: 'text' },
          { label: 'Kabelstrecke bis', typ: 'text' },
          { label: 'Witterung', typ: 'text' },
        ],
      },
      { typ: 'tabelle', titel: 'Beschreibung Prüfstrecke', spalten: ['Prüfobjekt', 'Garnitur', 'Typ', 'Kabel Typ', 'Hersteller', 'Querschnitt (mm²)', 'Länge (m)'] },
      { typ: 'tabelle', titel: 'Isolationsprüfung', spalten: ['Phase', 'Isolationsmessung R (MΩ)', 'Prüfung U (kV)', 'Prüfung I (mA)'] },
      { typ: 'tabelle', titel: 'Mantelprüfung (Kabel mit PE-Mantel)', spalten: ['Phase', 'Isolationsmessung R (MΩ)', 'Prüfung U (kV)', 'Prüfung I (mA)'] },
      { typ: 'kopfdaten', titel: 'Messgeräte', felder: [{ label: 'Messgerät Isolationsprüfung', typ: 'text' }, { label: 'Messgerät Mantelprüfung', typ: 'text' }] },
      { typ: 'unterschriften', labels: ['Unterschrift Prüfer'] },
    ],
  },
  {
    id: 'vorlage-brief', typ: 'dokumentation', name: 'Brief / Geschäftsschreiben',
    textVorlage: `{{firma}}

{{kunde}}


Betreff:


Sehr geehrte Damen und Herren,




Mit freundlichen Grüßen
{{firma}}

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Empfänger',
        felder: [
          { label: 'Ansprechpartner', typ: 'text' },
          { label: 'Straße/Hausnummer', typ: 'text' },
          { label: 'PLZ/Ort', typ: 'text' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Bezug',
        felder: [
          { label: 'Ihr Zeichen/Ihre Nachricht vom', typ: 'text' },
          { label: 'Unser Zeichen', typ: 'text' },
        ],
      },
      { typ: 'unterschriften', labels: ['Unterschrift'] },
    ],
  },
  {
    id: 'vorlage-arbeitsvertrag', typ: 'dokumentation', name: 'Arbeitsvertrag',
    textVorlage: `ARBEITSVERTRAG

zwischen

{{firma}}
– nachfolgend "Arbeitgeber" genannt –

und

{{mitarbeiter}}
– nachfolgend "Arbeitnehmer" genannt –

§ 1 Beginn und Dauer des Arbeitsverhältnisses
Das Arbeitsverhältnis beginnt am {{datum}} und wird auf unbestimmte Zeit geschlossen, sofern nachfolgend keine Befristung vereinbart ist.

§ 2 Tätigkeit
Der Arbeitnehmer wird gemäß nachfolgender Vertragsdaten eingestellt. Der Arbeitgeber behält sich vor, dem Arbeitnehmer im Rahmen seiner Fähigkeiten und Fertigkeiten auch andere zumutbare Tätigkeiten zu übertragen.

§ 3 Arbeitszeit
Die wöchentliche Arbeitszeit richtet sich nach den nachfolgenden Vertragsdaten. Die Verteilung der Arbeitszeit auf die einzelnen Wochentage richtet sich nach den betrieblichen Erfordernissen.

§ 4 Vergütung
Die Vergütung richtet sich nach den nachfolgenden Vertragsdaten und wird jeweils zum Monatsende auf ein vom Arbeitnehmer benanntes Konto überwiesen.

§ 5 Urlaub
Der Arbeitnehmer hat Anspruch auf den in den Vertragsdaten genannten Erholungsurlaub pro Kalenderjahr.

§ 6 Kündigung
Für die Kündigung des Arbeitsverhältnisses gelten die gesetzlichen Kündigungsfristen, soweit in den Vertragsdaten keine abweichenden Fristen vereinbart sind.

§ 7 Verschwiegenheit
Der Arbeitnehmer verpflichtet sich, über alle betrieblichen und geschäftlichen Angelegenheiten, die ihm im Rahmen seiner Tätigkeit bekannt werden, Stillschweigen zu bewahren – auch über das Ende des Arbeitsverhältnisses hinaus.

§ 8 Schlussbestimmungen
Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Sollte eine Bestimmung dieses Vertrages unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Vertragsdaten',
        felder: [
          { label: 'Position/Tätigkeit', typ: 'text' },
          { label: 'Arbeitsort', typ: 'text' },
          { label: 'Probezeit (Monate)', typ: 'text' },
          { label: 'Befristet bis (falls befristet)', typ: 'datum' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Arbeitszeit & Vergütung',
        felder: [
          { label: 'Wochenstunden', typ: 'zahl' },
          { label: 'Bruttogehalt/Stundenlohn (€)', typ: 'zahl' },
          { label: 'Urlaubstage pro Jahr', typ: 'zahl' },
        ],
      },
      {
        typ: 'kopfdaten', titel: 'Kündigungsfrist',
        felder: [
          { label: 'Kündigungsfrist während Probezeit', typ: 'text' },
          { label: 'Kündigungsfrist nach Probezeit', typ: 'text' },
        ],
      },
      { typ: 'checkliste', titel: 'Vereinbarte Nebenleistungen', punkte: ['Firmenfahrzeug', 'Werkzeug/Arbeitskleidung gestellt', 'Weiterbildungsbudget', 'Betriebliche Altersvorsorge'] },
      { typ: 'unterschriften', labels: ['Unterschrift Arbeitnehmer', 'Unterschrift Arbeitgeber'] },
    ],
  },
  {
    id: 'vorlage-kurzrapport', typ: 'dokumentation', name: 'Kurzrapport (Service-Einsatz)',
    textVorlage: `KURZRAPPORT

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Kurzbeschreibung des Einsatzes:


Ergebnis: ☐ Erledigt  ☐ Folgetermin nötig

Unterschrift Kunde:`,
    abschnitte: [
      { typ: 'kopfdaten', titel: 'Einsatzdaten', felder: [{ label: 'Rapport-Nr.', typ: 'text' }, { label: 'Anfahrt von', typ: 'text' }, { label: 'Anfahrt bis', typ: 'text' }] },
      { typ: 'checkliste', titel: 'Art des Einsatzes', punkte: ['Störung', 'Wartung', 'Installation', 'Beratung vor Ort', 'Sonstiges'] },
      { typ: 'janein', titel: 'Abschluss', fragen: ['Auftrag vollständig erledigt', 'Folgetermin erforderlich'] },
      { typ: 'unterschriften', labels: ['Unterschrift Kunde'] },
    ],
  },
  {
    id: 'vorlage-ki-pruefung-elektrischer-anlagen', typ: 'dokumentation', name: 'KI-unterstützte Prüfung elektrischer Anlagen',
    textVorlage: `KI-UNTERSTÜTZTE PRÜFUNG ELEKTRISCHER ANLAGEN

Firma: {{firma}}
Kunde: {{kunde}}
Projekt/Objekt: {{projekt}}
Datum: {{datum}}

Objekt-Bezeichnung / weitere Informationen:


Von der KI-Analyse hervorgehobene Auffälligkeiten:


Beurteilung der Elektrofachkraft (Ergebnis, ggf. nächster Prüftermin):


Hinweis: Die Prüfung erfolgte nach den geltenden Bestimmungen der DIN VDE 0100-600 / 0105-100 und umfasst nur
zugängliche und überprüfbare Anlagenteile. KI-gestützte Auswertungen (z.B. Foto-/Bildanalyse) dienen als
Hilfestellung zur Auffälligkeitserkennung und ersetzen nicht die fachliche Beurteilung durch die Elektrofachkraft;
verantwortlich für das Prüfergebnis bleibt allein die unterzeichnende Fachkraft.

Ort, Datum: {{datum}}`,
    abschnitte: [
      {
        typ: 'kopfdaten', titel: 'Auftragsdaten',
        felder: [
          { label: 'Auftragsnummer', typ: 'text' },
          { label: 'Auftragsdatum', typ: 'datum' },
          { label: 'Beginn der Prüfung', typ: 'text' },
        ],
      },
      { typ: 'checkliste', titel: 'Art der Prüfung – DIN VDE 0100-600 / 0105-100', punkte: ['Neuanlage', 'Änderung', 'Erweiterung', 'Wiederholung', 'Instandsetzung'] },
      {
        typ: 'checkliste', titel: 'Sichtprüfung / Zustand der Anlage',
        punkte: [
          'Allgemeiner Zustand / Sauberkeit i.O.', 'Auswahl der Betriebsmittel geeignet', 'Berührungsschutz / Abdeckungen vorhanden',
          'Leiterkennzeichnung normgerecht', 'Leitungsführung ordentlich', 'Leiterverbindungen fest', 'Schutzpotentialausgleich vollständig',
        ],
      },
      {
        typ: 'tabelle', titel: 'KI-Analyse: erkannte Auffälligkeiten', spalten: ['Bereich/Bauteil', 'Auffälligkeit laut KI-Analyse', 'Bewertung Elektrofachkraft'],
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
];

export const TERMIN_TYPEN = [
  { id: 'termin', titel: 'Termin', farbe: '#2b7fd6' },
  { id: 'baustelle', titel: 'Baustelle', farbe: '#f0a020' },
  { id: 'schulung', titel: 'Schulung', farbe: '#8e44ad' },
  { id: 'krank', titel: 'Krank', farbe: '#c0392b' },
  { id: 'urlaub', titel: 'Urlaub', farbe: '#1f8a4c' },
];

// Kern-Kontenplan nach SKR03 (konsistent mit den bestehenden DATEV-Settings
// datevErloesKonto/datevAufwandKonto, die bereits SKR03-Nummern sind). Bewusst
// nur die am häufigsten gebrauchten Konten eines kleinen Handwerksbetriebs -
// frei erweiterbar/anpassbar über die Kontenplan-Verwaltung in Buchhaltung.
// Ersetzt keine steuerliche Beratung; die endgültige Kontenzuordnung gehört
// weiterhin in die Hände des Steuerberaters.
export const KONTEN_KLASSEN = [
  { id: 'aktiv', titel: 'Aktivkonto (Vermögen)' },
  { id: 'passiv', titel: 'Passivkonto (Schulden/Kapital)' },
  { id: 'ertrag', titel: 'Ertragskonto (Erlöse)' },
  { id: 'aufwand', titel: 'Aufwandskonto (Kosten)' },
];
export const DEFAULT_KONTEN = [
  { id: 'konto-1000', nummer: '1000', name: 'Kasse', klasse: 'aktiv' },
  { id: 'konto-1200', nummer: '1200', name: 'Bank', klasse: 'aktiv' },
  { id: 'konto-1400', nummer: '1400', name: 'Forderungen aus Lieferungen und Leistungen', klasse: 'aktiv' },
  { id: 'konto-1571', nummer: '1571', name: 'Abziehbare Vorsteuer 7 %', klasse: 'aktiv' },
  { id: 'konto-1576', nummer: '1576', name: 'Abziehbare Vorsteuer 19 %', klasse: 'aktiv' },
  { id: 'konto-1600', nummer: '1600', name: 'Verbindlichkeiten aus Lieferungen und Leistungen', klasse: 'passiv' },
  { id: 'konto-1771', nummer: '1771', name: 'Umsatzsteuer 7 %', klasse: 'passiv' },
  { id: 'konto-1776', nummer: '1776', name: 'Umsatzsteuer 19 %', klasse: 'passiv' },
  { id: 'konto-1800', nummer: '1800', name: 'Privatentnahmen allgemein', klasse: 'passiv' },
  { id: 'konto-1890', nummer: '1890', name: 'Privateinlagen', klasse: 'passiv' },
  { id: 'konto-8300', nummer: '8300', name: 'Erlöse 7 % USt.', klasse: 'ertrag' },
  { id: 'konto-8400', nummer: '8400', name: 'Erlöse 19 % USt.', klasse: 'ertrag' },
  { id: 'konto-8125', nummer: '8125', name: 'Steuerfreie Umsätze (Export/IG-Lieferung/§13b)', klasse: 'ertrag' },
  { id: 'konto-4900', nummer: '4900', name: 'Sonstige betriebliche Aufwendungen', klasse: 'aufwand' },
  { id: 'konto-0400', nummer: '0400', name: 'Sachanlagen (Maschinen, Geräte, Fuhrpark, Ausstattung)', klasse: 'aktiv' },
  { id: 'konto-0480', nummer: '0480', name: 'Geringwertige Wirtschaftsgüter (GWG)', klasse: 'aktiv' },
  { id: 'konto-6220', nummer: '6220', name: 'Abschreibungen auf Sachanlagen', klasse: 'aufwand' },
];

export const ANLAGE_KATEGORIEN = ['Werkzeug/Maschine', 'Fahrzeug', 'Betriebs- und Geschäftsausstattung', 'Sonstiges'];

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

export const DEFAULT_KUNDEN_STATUS = [
  { id: 'lead', titel: 'Lead', farbe: '#2b7fd6', reihenfolge: 0 },
  { id: 'interessent', titel: 'Interessent', farbe: '#f0a020', reihenfolge: 1 },
  { id: 'kunde', titel: 'Kunde', farbe: '#1f8a4c', reihenfolge: 2 },
  { id: 'verloren', titel: 'Verloren', farbe: '#95a5a6', reihenfolge: 3, geschlossen: true },
];

export const ZUGRIFFSROLLEN = [
  { id: 'admin', titel: 'Administrator', beschreibung: 'Voller Zugriff auf alle Bereiche, inkl. Einstellungen und Buchhaltung.' },
  { id: 'buero', titel: 'Büro', beschreibung: 'Kunden, Projekte, Termine, Angebote/Rechnungen, Katalog – ohne Einstellungen und Buchhaltungs-Export.' },
  { id: 'mitarbeiter', titel: 'Mitarbeiter', beschreibung: 'Nur Zeiterfassung, eigene Aufgaben, Kalender/Plantafel und Geräte – keine Finanz- oder Personaldaten.' },
];

export const ROUTE_ROLLEN = {
  dashboard: ['admin', 'buero', 'mitarbeiter'],
  kunden: ['admin', 'buero'],
  leadpipeline: ['admin', 'buero'],
  kanban: ['admin', 'buero'],
  projekte: ['admin', 'buero', 'mitarbeiter'],
  auftraege: ['admin', 'buero', 'mitarbeiter'],
  plantafel: ['admin', 'buero', 'mitarbeiter'],
  zeiterfassung: ['admin', 'buero', 'mitarbeiter'],
  aufgaben: ['admin', 'buero', 'mitarbeiter'],
  mitarbeiter: ['admin', 'buero'],
  subunternehmer: ['admin', 'buero'],
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
  // Einmalige Migration: alte, vor dem Berichts-Baukasten gespeicherte Default-Vorlagen
  // (noch ohne abschnitte) auf den aktuellen strukturierten Stand bringen.
  for (const def of DEFAULT_DOKU_VORLAGEN) {
    const bestehend = vorlagen.find((v) => v.id === def.id);
    if (bestehend && def.abschnitte?.length && !bestehend.abschnitte?.length) {
      await put('vorlagen', { ...def });
    }
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
  // Einmalige Korrektur: Stornorechnungen wurden früher mit status:'bezahlt'
  // angelegt statt 'storniert' - dadurch verfälschte ihr negativer Betrag
  // Auswertungen/Dashboard (z.B. "Bezahlt"-Summe, Umsatz nach Marke), obwohl
  // die stornierte Original-Rechnung dort bereits korrekt ausgeschlossen wird.
  const rechnungen = await getAll('rechnungen');
  for (const r of rechnungen) {
    if (r.stornoVonNummer && r.status !== 'storniert') {
      await put('rechnungen', { ...r, status: 'storniert', bezahltAm: '' });
    }
  }
  const konten = await getAll('konten');
  const kontenIds = new Set(konten.map((k) => k.id));
  const missingKonten = DEFAULT_KONTEN.filter((k) => !kontenIds.has(k.id));
  for (const k of missingKonten) {
    await put('konten', k);
  }
  const kundenStatus = await getAll('kundenStatus');
  const kundenStatusIds = new Set(kundenStatus.map((s) => s.id));
  const missingKundenStatus = DEFAULT_KUNDEN_STATUS.filter((s) => !kundenStatusIds.has(s.id));
  for (const s of missingKundenStatus) {
    await put('kundenStatus', s);
  }
  // Bestehende Kunden aus der Zeit vor der Lead-Pipeline haben noch kein
  // status-Feld - sie haben i.d.R. bereits eine Historie und werden daher
  // nicht rückwirkend zu "Lead" degradiert, sondern direkt als "Kunde" geführt.
  const kunden = await getAll('kunden');
  for (const k of kunden) {
    if (!k.status) {
      await put('kunden', { ...k, status: 'kunde' });
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
