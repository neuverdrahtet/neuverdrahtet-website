// Echter Test gegen den TATSÄCHLICHEN Worker-Code (import von worker.js,
// keine Kopie) für Maßnahme 4 (Token-Härtung, November 2026):
//  1. ein zu kurzer API_KEY (< 32 Zeichen, siehe README-Empfehlung) wird als
//     Fehlkonfiguration behandelt statt klaglos akzeptiert.
//  2. ein falscher/fehlender API_KEY erzeugt jetzt einen sichtbaren Eintrag
//     in ai_action_log (Status "auth_failed") statt spurlos mit 401 zu
//     enden - sichtbar in der Werkora-Ansicht "KI-Aktivität".
//
// Ausführen: node cloudflare-worker-ki-buerokraft/tests/test_token_haertung.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'ki-buerokraft-test',
};
const API_KEY = 'test-api-key-123456-mindestens-32-zeichen';

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
// test_finanz_freigabe.mjs. ---
const firestoreDb = new Map(); // "collection/id" -> fields
let oauthAufrufe = 0;

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';
  if (u.href === 'https://oauth2.googleapis.com/token') { oauthAufrufe++; return jsonResponse(200, { access_token: 'fake-token' }); }
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

function req(path, { headers = {} } = {}) {
  return new Request(`https://ki-buerokraft.test.example${path}`, { method: 'GET', headers });
}

const rateLimiterOk = { limit: async () => ({ success: true }) };

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

await pruefe('T1: ein zu kurzer API_KEY (< 32 Zeichen) wird als SERVER_MISCONFIGURED abgelehnt, auch mit korrektem Schlüssel-Wert', async () => {
  const kurzerSchluessel = 'nur-19-zeichen-xx';
  const env = { API_KEY: kurzerSchluessel, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: rateLimiterOk };
  const res = await worker.fetch(req('/customers', { headers: { Authorization: `Bearer ${kurzerSchluessel}` } }), env);
  assert(res.status === 500, `erwartet 500, war ${res.status}`);
  const data = await res.json();
  assert(data.error.code === 'SERVER_MISCONFIGURED', `erwartet SERVER_MISCONFIGURED, war ${data.error.code}`);
});

await pruefe('T2: ein falscher API_KEY (richtige Länge, falscher Wert) führt zu 401 UND einem "auth_failed"-Eintrag in ai_action_log', async () => {
  const env = { API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: rateLimiterOk };
  const falscherSchluessel = 'x'.repeat(API_KEY.length);
  const vorherOauthAufrufe = oauthAufrufe;
  const res = await worker.fetch(req('/customers', { headers: { Authorization: `Bearer ${falscherSchluessel}` } }), env);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
  const data = await res.json();
  assert(data.error.code === 'UNAUTHORIZED', `erwartet UNAUTHORIZED, war ${data.error.code}`);
  assert(oauthAufrufe > vorherOauthAufrufe, 'Protokollierung des Fehlversuchs muss einen Google-Token für den Firestore-Zugriff anfordern');
  const eintrag = [...firestoreDb.entries()].find(([k, f]) => k.startsWith('ai_action_log/') && feldWert(f, 'status') === 'auth_failed');
  assert(eintrag, 'es muss ein ai_action_log-Eintrag mit status "auth_failed" angelegt worden sein');
  assert(feldWert(eintrag[1], 'action') === 'auth.failed', `erwartete action "auth.failed", war "${feldWert(eintrag[1], 'action')}"`);
  assert(!JSON.stringify(eintrag[1]).includes(falscherSchluessel), 'der versuchte Schlüssel selbst darf NIE mitprotokolliert werden');
});

await pruefe('T3: fehlender Authorization-Header führt ebenfalls zu 401 + Protokoll-Eintrag', async () => {
  const env = { API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: rateLimiterOk };
  firestoreDb.clear();
  const res = await worker.fetch(req('/customers'), env);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
  const eintrag = [...firestoreDb.entries()].find(([k, f]) => k.startsWith('ai_action_log/') && feldWert(f, 'status') === 'auth_failed');
  assert(eintrag, 'auch ein komplett fehlender Authorization-Header muss protokolliert werden');
});

await pruefe('T4: ein korrekter API_KEY wird weiterhin normal akzeptiert (keine Regression)', async () => {
  const env = { API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: rateLimiterOk };
  const res = await worker.fetch(req('/customers', { headers: { Authorization: `Bearer ${API_KEY}` } }), env);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
