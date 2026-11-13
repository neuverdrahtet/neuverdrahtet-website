// Test für die REST-API-Erweiterung vom 13.11.2026 ("Werkora-Vereinfachung"
// Dashboard-Schritt "REST-API"): zusätzliche Collections ausgaben (lesen+
// anlegen), rechnungen (nur lesen, GoBD-Sperre), angebote (nur Entwürfe
// änderbar) und katalog (freigabepflichtig über dieselbe mcpFinanzFreigaben-
// Collection wie der KI-Bürokraft-MCP-Server). Gleiches Mock-Muster wie
// test_api_security.mjs, erweitert um PATCH (mit/ohne updateMask) und
// documents:commit (für die atomare Freigabe-Ausführung).
//
// Ausführen: node cloudflare-worker-api/tests/test_api_erweiterung.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'api-test-erweiterung',
};
const API_KEY = 'voller-schluessel-123456';

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function toFsFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = toFs(v);
  return out;
}

let firestoreDb = new Map();
let updateTimeCounter = 0;
function naechsteUpdateTime() { return `t${++updateTimeCounter}`; }

const rateLimiterOk = { limit: async () => ({ success: true }) };
const baseEnv = { API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: rateLimiterOk };

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.hostname !== 'firestore.googleapis.com') throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);

  const namePrefix = `projects/${serviceAccount.project_id}/databases/(default)/documents/`;
  const pathPrefix = `/v1/${namePrefix}`;

  if (u.pathname.endsWith(':commit')) {
    const body = JSON.parse(init.body);
    const write = body.writes[0];
    const name = write.update.name;
    const rel = name.slice(name.indexOf(namePrefix) + namePrefix.length);
    const [collection, id] = rel.split('/');
    const key = `${collection}/${id}`;
    const vorhanden = firestoreDb.get(key);
    if (write.currentDocument?.updateTime !== undefined) {
      if (!vorhanden || vorhanden.updateTime !== write.currentDocument.updateTime) return jsonResponse(409, { error: { status: 'FAILED_PRECONDITION' } });
      const mask = write.updateMask?.fieldPaths || Object.keys(write.update.fields);
      const neueFields = { ...vorhanden.fields };
      for (const f of mask) neueFields[f] = write.update.fields[f];
      firestoreDb.set(key, { fields: neueFields, updateTime: naechsteUpdateTime() });
      return jsonResponse(200, {});
    }
    firestoreDb.set(key, { fields: write.update.fields, updateTime: naechsteUpdateTime() });
    return jsonResponse(200, {});
  }

  if (method === 'PATCH') {
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const [collection, id] = rel.split('/').filter(Boolean);
    const body = JSON.parse(init.body);
    const maskFields = u.searchParams.getAll('updateMask.fieldPaths');
    const key = `${collection}/${id}`;
    if (maskFields.length > 0) {
      const vorhanden = firestoreDb.get(key);
      if (!vorhanden) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
      const neueFields = { ...vorhanden.fields };
      for (const f of maskFields) neueFields[f] = body.fields[f];
      firestoreDb.set(key, { fields: neueFields, updateTime: naechsteUpdateTime() });
    } else {
      firestoreDb.set(key, { fields: body.fields, updateTime: naechsteUpdateTime() });
    }
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields: firestoreDb.get(key).fields });
  }

  const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
  const teile = rel.split('/').filter(Boolean);
  if (teile.length === 1) {
    const [collection] = teile;
    const documents = [];
    for (const [key, doc] of firestoreDb.entries()) {
      const [c, id] = key.split('/');
      if (c === collection) documents.push({ name: `${namePrefix}${collection}/${id}`, fields: doc.fields });
    }
    return jsonResponse(200, { documents });
  }
  const [collection, id] = teile;
  const doc = firestoreDb.get(`${collection}/${id}`);
  if (!doc) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
  return jsonResponse(200, { name: `${namePrefix}${collection}/${id}`, fields: doc.fields, updateTime: doc.updateTime });
};

function req(path, { method = 'GET', key = API_KEY, body } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  const init = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  return new Request(`https://api.test.example${path}`, init);
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function reset() { firestoreDb = new Map(); }

await pruefe('A1: POST /ausgaben legt eine Ausgabe an, GET /ausgaben liefert sie', async () => {
  reset();
  const res = await worker.fetch(req('/ausgaben', { method: 'POST', body: { beschreibung: 'Material', betragNetto: 100 } }), baseEnv);
  assert(res.status === 201, `erwartet 201, war ${res.status}`);
  const resList = await worker.fetch(req('/ausgaben'), baseEnv);
  const data = await resList.json();
  assert(data.data.length === 1, 'die angelegte Ausgabe muss in der Liste stehen');
});

await pruefe('A2: PATCH /ausgaben/{id} ist nicht erlaubt (nur Lesen/Anlegen)', async () => {
  reset();
  firestoreDb.set('ausgaben/a1', { fields: toFsFields({ id: 'a1' }), updateTime: 't0' });
  const res = await worker.fetch(req('/ausgaben/a1', { method: 'PATCH', body: { betragNetto: 200 } }), baseEnv);
  assert(res.status === 405, `erwartet 405, war ${res.status}`);
});

await pruefe('R1: GET /rechnungen funktioniert', async () => {
  reset();
  firestoreDb.set('rechnungen/r1', { fields: toFsFields({ id: 'r1', status: 'bezahlt' }), updateTime: 't0' });
  const res = await worker.fetch(req('/rechnungen'), baseEnv);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
});

await pruefe('R2: POST /rechnungen -> 405 (GoBD-Sperre, kein Anlegen über die API)', async () => {
  reset();
  const res = await worker.fetch(req('/rechnungen', { method: 'POST', body: { betrag: 100 } }), baseEnv);
  assert(res.status === 405, `erwartet 405, war ${res.status}`);
});

await pruefe('R3: PATCH /rechnungen/{id} -> 405', async () => {
  reset();
  firestoreDb.set('rechnungen/r1', { fields: toFsFields({ id: 'r1' }), updateTime: 't0' });
  const res = await worker.fetch(req('/rechnungen/r1', { method: 'PATCH', body: { status: 'storniert' } }), baseEnv);
  assert(res.status === 405, `erwartet 405, war ${res.status}`);
});

await pruefe('AN1: POST /angebote erzwingt status "entwurf" unabhängig vom Body', async () => {
  reset();
  const res = await worker.fetch(req('/angebote', { method: 'POST', body: { titel: 'Test', status: 'versendet' } }), baseEnv);
  assert(res.status === 201, `erwartet 201, war ${res.status}`);
  const data = await res.json();
  assert(data.data.status === 'entwurf', `status muss serverseitig auf "entwurf" erzwungen werden, war "${data.data.status}"`);
});

await pruefe('AN2: PATCH /angebote/{id} funktioniert, solange status "entwurf" ist, "status" selbst bleibt dabei unverändert', async () => {
  reset();
  firestoreDb.set('angebote/an1', { fields: toFsFields({ id: 'an1', titel: 'Alt', status: 'entwurf' }), updateTime: 't0' });
  const res = await worker.fetch(req('/angebote/an1', { method: 'PATCH', body: { titel: 'Neu', status: 'versendet' } }), baseEnv);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const data = await res.json();
  assert(data.data.titel === 'Neu', 'titel muss aktualisiert worden sein');
  assert(data.data.status === 'entwurf', `status darf über PATCH nicht änderbar sein, war "${data.data.status}"`);
});

await pruefe('AN3: PATCH /angebote/{id} schlägt fehl (409), wenn das Angebot nicht mehr im Entwurf ist', async () => {
  reset();
  firestoreDb.set('angebote/an2', { fields: toFsFields({ id: 'an2', titel: 'Alt', status: 'versendet' }), updateTime: 't0' });
  const res = await worker.fetch(req('/angebote/an2', { method: 'PATCH', body: { titel: 'Neu' } }), baseEnv);
  assert(res.status === 409, `erwartet 409, war ${res.status}`);
});

await pruefe('K1: POST /katalog schreibt NICHT direkt, sondern erzeugt nur eine Freigabe-Anfrage (202)', async () => {
  reset();
  const res = await worker.fetch(req('/katalog', { method: 'POST', body: { bezeichnung: 'Schraube', preis: 1.5 } }), baseEnv);
  assert(res.status === 202, `erwartet 202, war ${res.status}`);
  const data = await res.json();
  assert(data.freigabe_erforderlich === true);
  assert(data.freigabe?.id, 'es muss eine freigabe.id zurückgegeben werden');
  const listRes = await worker.fetch(req('/katalog'), baseEnv);
  const listData = await listRes.json();
  assert(listData.data.length === 0, 'der Katalog-Eintrag darf vor der Freigabe noch nicht existieren');
});

await pruefe('K2: GET /freigaben listet die offene Freigabe, POST /freigaben/{id}/freigeben führt sie aus', async () => {
  reset();
  const postRes = await worker.fetch(req('/katalog', { method: 'POST', body: { bezeichnung: 'Schraube', preis: 1.5 } }), baseEnv);
  const { freigabe } = await postRes.json();

  const listRes = await worker.fetch(req('/freigaben'), baseEnv);
  const listData = await listRes.json();
  assert(listData.data.some((f) => f.id === freigabe.id), 'die Freigabe muss in der offenen Liste stehen');

  const freigebenRes = await worker.fetch(req(freigabe.freigeben_url, { method: 'POST' }), baseEnv);
  assert(freigebenRes.status === 200, `erwartet 200, war ${freigebenRes.status}`);

  const katalogRes = await worker.fetch(req('/katalog'), baseEnv);
  const katalogData = await katalogRes.json();
  assert(katalogData.data.length === 1, 'nach der Freigabe muss der Katalog-Eintrag existieren');
  assert(katalogData.data[0].bezeichnung === 'Schraube');
});

await pruefe('K3: ein zweiter "freigeben"-Aufruf für dieselbe Freigabe schlägt fehl (kein Doppel-Ausführen)', async () => {
  reset();
  const postRes = await worker.fetch(req('/katalog', { method: 'POST', body: { bezeichnung: 'Schraube' } }), baseEnv);
  const { freigabe } = await postRes.json();
  await worker.fetch(req(freigabe.freigeben_url, { method: 'POST' }), baseEnv);
  const zweiterVersuch = await worker.fetch(req(freigabe.freigeben_url, { method: 'POST' }), baseEnv);
  assert(zweiterVersuch.status === 409, `erwartet 409 beim zweiten Versuch, war ${zweiterVersuch.status}`);
});

await pruefe('K4: POST /freigaben/{id}/ablehnen lehnt ab, danach ist "freigeben" nicht mehr möglich', async () => {
  reset();
  const postRes = await worker.fetch(req('/katalog', { method: 'POST', body: { bezeichnung: 'Schraube' } }), baseEnv);
  const { freigabe } = await postRes.json();
  const ablehnenRes = await worker.fetch(req(freigabe.ablehnen_url, { method: 'POST', body: { grund: 'Preis falsch' } }), baseEnv);
  assert(ablehnenRes.status === 200, `erwartet 200, war ${ablehnenRes.status}`);
  const freigebenVersuch = await worker.fetch(req(freigabe.freigeben_url, { method: 'POST' }), baseEnv);
  assert(freigebenVersuch.status === 409, `erwartet 409 nach Ablehnung, war ${freigebenVersuch.status}`);
  const katalogRes = await worker.fetch(req('/katalog'), baseEnv);
  const katalogData = await katalogRes.json();
  assert(katalogData.data.length === 0, 'ein abgelehnter Eintrag darf nie im Katalog landen');
});

await pruefe('K5: PATCH /katalog/{id} erzeugt ebenfalls nur eine Freigabe-Anfrage statt direkt zu schreiben', async () => {
  reset();
  firestoreDb.set('katalog/kat1', { fields: toFsFields({ id: 'kat1', bezeichnung: 'Schraube', preis: 1.5 }), updateTime: 't0' });
  const res = await worker.fetch(req('/katalog/kat1', { method: 'PATCH', body: { preis: 2.0 } }), baseEnv);
  assert(res.status === 202, `erwartet 202, war ${res.status}`);
  const unveraendert = await worker.fetch(req('/katalog/kat1'), baseEnv);
  const data = await unveraendert.json();
  assert(data.data.preis === 1.5, 'der Preis darf sich vor der Freigabe nicht ändern');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
