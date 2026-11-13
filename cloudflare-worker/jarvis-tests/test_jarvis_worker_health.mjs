// Test für den zentralen Erreichbarkeits-Check (runJarvisWorkerHealthCheck),
// der am 13.11.2026 als Reaktion auf einen 2 Tage unbemerkten Totalausfall
// des KI-Bürokraft-Workers (gelöschter API_KEY-Secret) ergänzt wurde: JARVIS
// pingt bei seinem täglichen Cron-Lauf zusätzlich die anderen 8 Worker (ohne
// eigene Secrets dafür nötig zu haben) und prüft seine eigenen drei
// kritischen Secrets. Gleiches Firestore-Mock-Muster wie test_jarvis_phase6.mjs.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_worker_health.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-health',
};
const baseEnv = { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), ANTHROPIC_API_KEY: 'x', KI_BUEROKRAFT_API_KEY: 'x', GOOGLE_BUERO_API_KEY: 'x' };

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

let firestoreDb = new Map();
let updateTimeCounter = 0;
function naechsteUpdateTime() { return `t${++updateTimeCounter}`; }

// Steuert, wie die gemockten Worker-URLs antworten - pro Test überschreibbar.
let workerAntworten = {};
let fcmAufrufe = 0;

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-access-token' });
  if (u.hostname === 'fcm.googleapis.com') { fcmAufrufe++; return jsonResponse(200, { name: 'x' }); }

  if (u.hostname === 'firestore.googleapis.com') {
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
      if (write.currentDocument?.exists === false) {
        if (vorhanden) return jsonResponse(409, { error: { status: 'ALREADY_EXISTS' } });
        firestoreDb.set(key, { fields: write.update.fields, updateTime: naechsteUpdateTime() });
        return jsonResponse(200, {});
      }
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
      const relMitQuery = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
      const [collection, id] = relMitQuery.split('/').filter(Boolean);
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
      return jsonResponse(200, {});
    }
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (teile.length === 2) {
      const [collection, id] = teile;
      const doc = firestoreDb.get(`${collection}/${id}`);
      if (!doc) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
      return jsonResponse(200, { name: `${namePrefix}${collection}/${id}`, fields: doc.fields, updateTime: doc.updateTime });
    }
    if (teile.length === 1) {
      const [collection] = teile;
      const documents = [];
      for (const [key, doc] of firestoreDb.entries()) {
        const [c, id] = key.split('/');
        if (c === collection) documents.push({ name: `${namePrefix}${collection}/${id}`, fields: doc.fields, updateTime: doc.updateTime });
      }
      return jsonResponse(200, { documents });
    }
    return jsonResponse(404, { error: 'unbekannter Firestore-Pfad im Mock' });
  }

  for (const [name, workerUrl] of Object.entries(W.WORKER_HEALTHCHECK_URLS)) {
    if (u.href.startsWith(workerUrl)) {
      const verhalten = workerAntworten[name] || 'ok';
      if (verhalten === 'ok') return jsonResponse(200, {});
      if (verhalten === 'server-error') return jsonResponse(500, { error: 'SERVER_MISCONFIGURED' });
      if (verhalten === 'nicht-erreichbar') throw new Error('fetch failed (Netzwerkfehler, Mock)');
    }
  }
  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function feldWert(fields, key) {
  const f = fields?.[key];
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  return f;
}
function heuteISO() { return new Date().toISOString().slice(0, 10); }
function toFs(v) {
  if (typeof v === 'string') return { stringValue: v };
  return v;
}
function reset() {
  firestoreDb = new Map();
  fcmAufrufe = 0;
  workerAntworten = {};
  firestoreDb.set('pushTokens/t1', { fields: { id: toFs('t1'), role: toFs('admin') }, updateTime: 't0' });
}

await pruefe('WH1: alle 8 Worker erreichbar + alle 3 JARVIS-Secrets vorhanden -> keine Aufgabe, kein Push', async () => {
  reset();
  await W.runJarvisWorkerHealthCheck(baseEnv);
  const eintrag = firestoreDb.get(`aufgaben/worker-health-${heuteISO()}`);
  assert(!eintrag, 'bei allem OK darf keine Gesundheits-Aufgabe entstehen');
  assert(fcmAufrufe === 0, 'bei allem OK darf kein Push gesendet werden');
});

await pruefe('WH2: ein Worker antwortet mit 5xx -> Aufgabe + Push mit diesem Worker benannt', async () => {
  reset();
  workerAntworten['neuverdrahtet-kostenschaetzer'] = 'server-error';
  await W.runJarvisWorkerHealthCheck(baseEnv);
  const eintrag = firestoreDb.get(`aufgaben/worker-health-${heuteISO()}`);
  assert(eintrag, 'es muss eine Gesundheits-Aufgabe angelegt worden sein');
  assert(feldWert(eintrag.fields, 'prioritaet') === 'hoch', 'muss hohe Priorität haben');
  assert(feldWert(eintrag.fields, 'beschreibung').includes('neuverdrahtet-kostenschaetzer'), 'der betroffene Worker muss in der Beschreibung genannt sein');
  assert(fcmAufrufe === 1, 'es muss genau ein Push gesendet werden');
});

await pruefe('WH3: ein Worker ist komplett nicht erreichbar (Netzwerkfehler) -> ebenso gemeldet', async () => {
  reset();
  workerAntworten['neuverdrahtet-qonto-sync'] = 'nicht-erreichbar';
  await W.runJarvisWorkerHealthCheck(baseEnv);
  const eintrag = firestoreDb.get(`aufgaben/worker-health-${heuteISO()}`);
  assert(eintrag, 'ein nicht erreichbarer Worker muss gemeldet werden');
  assert(feldWert(eintrag.fields, 'beschreibung').includes('neuverdrahtet-qonto-sync'), 'der betroffene Worker muss benannt sein');
});

await pruefe('WH4: fehlendes JARVIS-eigenes Secret (KI_BUEROKRAFT_API_KEY) wird ebenfalls gemeldet', async () => {
  reset();
  const env = { ...baseEnv, KI_BUEROKRAFT_API_KEY: undefined };
  delete env.KI_BUEROKRAFT_API_KEY;
  await W.runJarvisWorkerHealthCheck(env);
  const eintrag = firestoreDb.get(`aufgaben/worker-health-${heuteISO()}`);
  assert(eintrag, 'ein fehlendes JARVIS-Secret muss eine Gesundheits-Aufgabe erzeugen');
  assert(feldWert(eintrag.fields, 'beschreibung').includes('KI_BUEROKRAFT_API_KEY'), 'das fehlende Secret muss benannt sein');
});

await pruefe('WH5: ein zweiter Lauf am selben Tag meldet nicht doppelt (Dedup über beanspracheTagesJob)', async () => {
  reset();
  workerAntworten['neuverdrahtet-api'] = 'server-error';
  await W.runJarvisWorkerHealthCheck(baseEnv);
  await W.runJarvisWorkerHealthCheck(baseEnv);
  assert(fcmAufrufe === 1, `erwartet genau 1 Push über beide Läufe, war ${fcmAufrufe}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
