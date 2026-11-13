// Test für den täglichen Gesundheitscheck im scheduled()-Cron-Handler
// (siehe worker.js, Branch "0 6 * * *"): meldet fehlenden/zu kurzen API_KEY
// als hochpriore Aufgabe + Push, statt wie bisher spurlos zu bleiben, bis
// zufällig jemand die HTTP-/MCP-Schnittstelle benutzt (genau das führte am
// 13.11.2026 zu einem tagelang unbemerkten Totalausfall des Custom
// Connectors). Gleiches Mock-Muster wie test_token_haertung.mjs.
//
// Ausführen: node cloudflare-worker-ki-buerokraft/tests/test_health_check.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'ki-buerokraft-test',
};
const GUELTIGER_API_KEY = 'test-api-key-123456-mindestens-32-zeichen';

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = toFirestoreValue(v);
  return out;
}

// --- generischer In-Memory-Firestore-Mock, identisch zum Muster aus
// test_token_haertung.mjs/test_finanz_freigabe.mjs. ---
const firestoreDb = new Map(); // "collection/id" -> fields
let fcmAufrufe = 0;

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.hostname === 'fcm.googleapis.com') { fcmAufrufe++; return jsonResponse(200, { name: 'projects/x/messages/1' }); }
  if (u.hostname === 'firestore.googleapis.com') {
    const namePrefix = `projects/${serviceAccount.project_id}/databases/(default)/documents/`;
    const pathPrefix = `/v1/${namePrefix}`;
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (teile.length === 1) {
      const [collection] = teile;
      const documents = [];
      for (const [key, fields] of firestoreDb.entries()) {
        const [c, docId] = key.split('/');
        if (c === collection) documents.push({ name: `${namePrefix}${collection}/${docId}`, fields });
      }
      return jsonResponse(200, { documents });
    }
    const [collection, id] = teile;
    const key = `${collection}/${id}`;
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      firestoreDb.set(key, body.fields);
      return jsonResponse(200, { name: `${namePrefix}${key}`, fields: body.fields });
    }
    const fields = firestoreDb.get(key);
    if (!fields) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields });
  }
  throw new Error(`Unerwarteter fetch() im Test: ${init.method || 'GET'} ${u.href}`);
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
  if ('booleanValue' in f) return f.booleanValue;
  return f;
}

function heuteISO() {
  return new Date().toISOString().slice(0, 10);
}

await pruefe('H1: fehlender API_KEY wird beim täglichen Cron als hochpriore Aufgabe gemeldet + Push gesendet', async () => {
  firestoreDb.clear();
  fcmAufrufe = 0;
  firestoreDb.set('pushTokens/t1', toFirestoreFields({ id: 't1', role: 'admin' }));
  const env = { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }; // kein API_KEY
  await worker.scheduled({ cron: '0 6 * * *' }, env);
  const healthId = `health-api-key-${heuteISO()}`;
  const eintrag = firestoreDb.get(`aufgaben/${healthId}`);
  assert(eintrag, 'es muss eine Gesundheits-Aufgabe angelegt worden sein');
  assert(feldWert(eintrag, 'prioritaet') === 'hoch', 'die Aufgabe muss hohe Priorität haben');
  assert(feldWert(eintrag, 'status') === 'offen', 'die Aufgabe muss offen sein');
  assert(fcmAufrufe === 1, `erwartet genau 1 Push-Versuch, war ${fcmAufrufe}`);
});

await pruefe('H2: zu kurzer API_KEY (<32 Zeichen) wird ebenso gemeldet', async () => {
  firestoreDb.clear();
  fcmAufrufe = 0;
  firestoreDb.set('pushTokens/t1', toFirestoreFields({ id: 't1', role: 'admin' }));
  const env = { API_KEY: 'zu-kurz', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };
  await worker.scheduled({ cron: '0 6 * * *' }, env);
  const healthId = `health-api-key-${heuteISO()}`;
  assert(firestoreDb.get(`aufgaben/${healthId}`), 'auch ein zu kurzer Schlüssel muss gemeldet werden');
});

await pruefe('H3: ein gültiger API_KEY (>=32 Zeichen) erzeugt KEINE Gesundheits-Aufgabe (keine Regression/kein Fehlalarm)', async () => {
  firestoreDb.clear();
  fcmAufrufe = 0;
  const env = { API_KEY: GUELTIGER_API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };
  await worker.scheduled({ cron: '0 6 * * *' }, env);
  const healthId = `health-api-key-${heuteISO()}`;
  assert(!firestoreDb.get(`aufgaben/${healthId}`), 'bei gültigem API_KEY darf keine Gesundheits-Aufgabe entstehen');
  assert(fcmAufrufe === 0, 'bei gültigem API_KEY darf kein Push gesendet werden');
});

await pruefe('H4: ein zweiter Cron-Lauf am selben Tag meldet nicht doppelt (kein Spam)', async () => {
  firestoreDb.clear();
  fcmAufrufe = 0;
  firestoreDb.set('pushTokens/t1', toFirestoreFields({ id: 't1', role: 'admin' }));
  const env = { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };
  await worker.scheduled({ cron: '0 6 * * *' }, env);
  await worker.scheduled({ cron: '0 6 * * *' }, env);
  assert(fcmAufrufe === 1, `erwartet genau 1 Push über beide Läufe (Dedup pro Tag), war ${fcmAufrufe}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
