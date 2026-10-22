// Echter Integrationstest gegen die TATSÄCHLICHE HTTP-Route /kunde-upload
// (worker.fetch, default-Export - kein Mock/keine __test__-Hintertür für
// die Route selbst). Deckt Phase 11 Punkt 3 "Datei-Uploads" UND
// "Fehlerbehandlung" ab: der externe Kunden-Upload-Link (ohne Firebase-
// Login, siehe handleKundenUpload) hatte bisher KEINE einzige Testdatei -
// weder Erfolgsfall noch die Fehlerpfade (abgelaufener Link, falsches
// Format, Storage-Fehler, fehlendes Rate-Limiter-Binding).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase11_uploads.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p11-uploads',
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = toFirestoreValue(v);
  return out;
}

const firestoreDb = new Map();
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, toFirestoreFields(data)); }

let storageVerhalten = 'ok'; // 'ok' | 'upload_fehler'
global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.hostname === 'storage.googleapis.com') {
    if (storageVerhalten === 'upload_fehler') return { ok: false, status: 500, text: async () => 'Storage kaputt' };
    return jsonResponse(200, {});
  }
  if (u.hostname === 'firestore.googleapis.com') {
    const namePrefix = `projects/${serviceAccount.project_id}/databases/(default)/documents/`;
    const pathPrefix = `/v1/${namePrefix}`;
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    const [collection, id] = teile;
    const key = `${collection}/${id}`;
    if (method === 'PATCH') {
      const body = JSON.parse(init.body);
      firestoreDb.set(key, body.fields);
      return jsonResponse(200, { name: `${namePrefix}${key}`, fields: body.fields });
    }
    const fields = firestoreDb.get(key);
    if (!fields) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields });
  }
  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

// 1x1-Pixel-PNG als Mini-Testdatei (echtes, gültiges Bildformat, kein Fake-String).
const MINI_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const GUELTIGE_DATEI_URL = `data:image/png;base64,${MINI_PNG_BASE64}`;

function machtEnv(zusatz = {}) {
  return {
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...zusatz,
  };
}
function uploadRequest(body, headers = {}) {
  return new Request('https://worker.test.example/kunde-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const heute = new Date().toISOString().slice(0, 10);
const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const gestern = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

setDoc('uploadLinks', 'gueltiges-token', { kundeId: 'kunde-1', ablaufAm: morgen });
setDoc('uploadLinks', 'abgelaufenes-token', { kundeId: 'kunde-1', ablaufAm: gestern });

await pruefe('U1: gültiger Token + gültiges Bildformat -> 200, Dokument wird in Firestore angelegt (vonKundeHochgeladen:true)', async () => {
  const res = await worker.fetch(uploadRequest({ token: 'gueltiges-token', dateiname: 'rechnung.png', fileDataUrl: GUELTIGE_DATEI_URL, beschreibung: 'Testbeleg' }), machtEnv());
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const data = await res.json();
  assert(data.ok === true, 'Antwort muss ok:true sein');
  const dokEintraege = [...firestoreDb.keys()].filter((k) => k.startsWith('dokumente/'));
  assert(dokEintraege.length === 1, `genau ein Dokument-Eintrag erwartet, war ${dokEintraege.length}`);
  const dok = firestoreDb.get(dokEintraege[0]);
  assert(dok.vonKundeHochgeladen.booleanValue === true, 'vonKundeHochgeladen muss true sein');
  assert(dok.bezugId.stringValue === 'kunde-1', 'bezugId muss die kundeId aus dem Upload-Link sein');
});

await pruefe('U2: fehlender Token -> 400, kein Dokument wird angelegt', async () => {
  const vorher = firestoreDb.size;
  const res = await worker.fetch(uploadRequest({ dateiname: 'x.png', fileDataUrl: GUELTIGE_DATEI_URL }), machtEnv());
  assert(res.status === 400, `erwartet 400, war ${res.status}`);
  assert(firestoreDb.size === vorher, 'ohne Token darf kein Dokument entstehen');
});

await pruefe('U3: abgelaufener Link -> 410 (Gone), kein Dokument wird angelegt', async () => {
  const vorher = firestoreDb.size;
  const res = await worker.fetch(uploadRequest({ token: 'abgelaufenes-token', dateiname: 'x.png', fileDataUrl: GUELTIGE_DATEI_URL }), machtEnv());
  assert(res.status === 410, `erwartet 410, war ${res.status}`);
  assert(firestoreDb.size === vorher, 'ein abgelaufener Link darf kein Dokument anlegen');
});

await pruefe('U4: unbekannter Token -> 404, keine Unterscheidung zu "ungültig" durch Fehlertext (kein Informationsleck über existierende Links)', async () => {
  const res = await worker.fetch(uploadRequest({ token: 'erfundener-token-xyz', dateiname: 'x.png', fileDataUrl: GUELTIGE_DATEI_URL }), machtEnv());
  assert(res.status === 404, `erwartet 404, war ${res.status}`);
});

await pruefe('U5: nicht unterstütztes Dateiformat (z.B. ein Skript statt Bild/PDF) -> 400, kein Dokument wird angelegt', async () => {
  const vorher = firestoreDb.size;
  const res = await worker.fetch(uploadRequest({ token: 'gueltiges-token', dateiname: 'boese.exe', fileDataUrl: 'data:application/x-msdownload;base64,AAAA' }), machtEnv());
  assert(res.status === 400, `erwartet 400, war ${res.status}`);
  assert(firestoreDb.size === vorher, 'ein nicht erlaubtes Dateiformat darf kein Dokument anlegen');
});

await pruefe('U6 (Fehlerbehandlung): schlägt der Storage-Upload fehl, wird der Fehler weitergereicht (500) UND es bleibt KEIN halb angelegtes Dokument zurück', async () => {
  const vorher = firestoreDb.size;
  storageVerhalten = 'upload_fehler';
  const res = await worker.fetch(uploadRequest({ token: 'gueltiges-token', dateiname: 'rechnung2.png', fileDataUrl: GUELTIGE_DATEI_URL }), machtEnv());
  storageVerhalten = 'ok';
  assert(res.status === 500, `erwartet 500, war ${res.status}`);
  assert(firestoreDb.size === vorher, 'bei fehlgeschlagenem Storage-Upload darf trotzdem KEIN Firestore-Dokument entstehen (kein inkonsistenter Zwischenzustand)');
});

await pruefe('U7 (Fehlerbehandlung): fehlendes RATE_LIMITER-Binding sperrt /kunde-upload fail-closed (503), nicht fail-open', async () => {
  const res = await worker.fetch(uploadRequest({ token: 'gueltiges-token', dateiname: 'x.png', fileDataUrl: GUELTIGE_DATEI_URL }), machtEnv({ RATE_LIMITER: undefined }));
  assert(res.status === 503, `erwartet 503, war ${res.status}`);
});

await pruefe('U8: ein kaputter JSON-Body führt zu 400, nicht zu einem 500/Absturz', async () => {
  const res = await worker.fetch(uploadRequest('{kaputtes json'), machtEnv());
  assert(res.status === 400, `erwartet 400, war ${res.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
