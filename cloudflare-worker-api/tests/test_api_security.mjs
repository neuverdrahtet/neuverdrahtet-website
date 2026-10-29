// Echter Test gegen den TATSÄCHLICHEN Worker-Code (import von worker.js) für
// die P0-Sicherheitskorrektur vom 28./29.10.2026 (Master-Audit Bericht 03,
// Finding #5: "ein einziger, statischer API-Key mit vollem Lese-/
// Schreibzugriff ..., kein Rate-Limiting im Code" + "kein Schlüssel ohne
// Rollentrennung"): deckt die drei neu eingebauten Schutzmaßnahmen ab -
// zeitkonstanter API_KEY-Vergleich, FAIL-CLOSED Rate-Limiting und den
// optionalen nur-lesenden API_KEY_READONLY.
//
// Ausführen: node cloudflare-worker-api/tests/test_api_security.mjs
import crypto from 'node:crypto';
import worker, { zeitkonstanterVergleich } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'api-test',
};
const API_KEY = 'voller-schluessel-123456';
const API_KEY_READONLY = 'nur-lesend-schluessel-789';

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}
function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  return out;
}

const firestoreDb = new Map();
firestoreDb.set('kunden/k1', toFirestoreFields({ name: 'Mustermann GmbH' }));

global.fetch = async (url) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.hostname === 'firestore.googleapis.com') {
    const namePrefix = `projects/${serviceAccount.project_id}/databases/(default)/documents/`;
    const rel = u.pathname.slice(u.pathname.indexOf(`/v1/${namePrefix}`) + `/v1/${namePrefix}`.length);
    const teile = rel.split('/').filter(Boolean);
    if (teile.length === 1) {
      const documents = [...firestoreDb.entries()].filter(([k]) => k.startsWith(`${teile[0]}/`)).map(([k, fields]) => ({ name: `${namePrefix}${k}`, fields }));
      return jsonResponse(200, { documents });
    }
    const key = teile.join('/');
    const fields = firestoreDb.get(key);
    if (!fields) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields });
  }
  throw new Error(`Unerwarteter fetch() im Test: ${u.href}`);
};

function req(path, { method = 'GET', key } = {}) {
  const headers = {};
  if (key !== undefined) headers.Authorization = `Bearer ${key}`;
  return new Request(`https://api.test.example${path}`, { method, headers });
}

// RATE_LIMITER-Mock: erlaubt standardmäßig, kann pro Test auf "sperrt alles" gestellt werden.
function machRateLimiter(erlaubt = true) {
  return { limit: async () => ({ success: erlaubt }) };
}

const baseEnv = { API_KEY, API_KEY_READONLY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: machRateLimiter(true) };

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await pruefe('zeitkonstanterVergleich: gleiche Strings gleicher Länge -> true', () => {
  assert(zeitkonstanterVergleich('abc123', 'abc123') === true);
});
await pruefe('zeitkonstanterVergleich: unterschiedliche Strings -> false', () => {
  assert(zeitkonstanterVergleich('abc123', 'abc124') === false);
  assert(zeitkonstanterVergleich('abc', 'abcdef') === false);
  assert(zeitkonstanterVergleich('', '') === true);
});

await pruefe('S1: fehlender Authorization-Header -> 401', async () => {
  const res = await worker.fetch(req('/kunden'), baseEnv);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

await pruefe('S2: voller API_KEY auf GET -> 200 mit Daten', async () => {
  const res = await worker.fetch(req('/kunden', { key: API_KEY }), baseEnv);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const data = await res.json();
  assert(data.ok === true && Array.isArray(data.data));
});

await pruefe('S3: API_KEY_READONLY auf GET -> 200', async () => {
  const res = await worker.fetch(req('/kunden', { key: API_KEY_READONLY }), baseEnv);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
});

await pruefe('S4: API_KEY_READONLY auf POST -> 403 (keine Rollentrennung umgangen)', async () => {
  const res = await worker.fetch(req('/kunden', { method: 'POST', key: API_KEY_READONLY }), baseEnv);
  assert(res.status === 403, `erwartet 403, war ${res.status}`);
});

await pruefe('S5: falscher Schlüssel -> 401 (nicht versehentlich als nur-lesend durchgelassen)', async () => {
  const res = await worker.fetch(req('/kunden', { key: 'irgendein-falscher-schluessel' }), baseEnv);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

await pruefe('S6: fehlendes RATE_LIMITER-Binding -> FAIL-CLOSED 503, nicht fail-open durchgelassen', async () => {
  const env = { ...baseEnv, RATE_LIMITER: undefined };
  const res = await worker.fetch(req('/kunden', { key: API_KEY }), env);
  assert(res.status === 503, `erwartet 503 (fail-closed), war ${res.status}`);
});

await pruefe('S7: Rate-Limit überschritten -> 429, Firestore wird gar nicht erst aufgerufen', async () => {
  const env = { ...baseEnv, RATE_LIMITER: machRateLimiter(false) };
  const res = await worker.fetch(req('/kunden', { key: API_KEY }), env);
  assert(res.status === 429, `erwartet 429, war ${res.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
