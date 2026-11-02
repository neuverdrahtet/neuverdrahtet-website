// Echter Test gegen den TATSÄCHLICHEN Worker-Code (import von worker.js) für
// die P0-Sicherheitskorrektur vom 29.10.2026 (Master-Audit Bericht 03,
// Finding #9: "echter Gmail/Kalender-Zugriff ... ohne Rate-Limiting"): deckt
// den zeitkonstanten API_KEY/OAUTH_SETUP_SECRET-Vergleich und das neu
// eingebaute FAIL-CLOSED Rate-Limiting ab.
//
// Mockt NICHT Gmail/Kalender selbst - es reicht, nachzuweisen, dass eine
// gültige Anfrage die Rate-Limit- und Auth-Prüfung passiert (danach scheitert
// sie kontrolliert an "Google-Konto ist noch nicht verbunden", weil kein
// echter Firestore/Gmail-Zugriff gemockt ist - das ist für diesen Test
// bewusst nicht nötig und würde nur unnötige Mock-Komplexität hinzufügen).
//
// Ausführen: node cloudflare-worker-google-buero/tests/test_api_security.mjs
import crypto from 'node:crypto';
import worker, { zeitkonstanterVergleich } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'google-buero-test',
};
const API_KEY = 'voller-schluessel-abcdef';
const OAUTH_SETUP_SECRET = 'setup-geheimnis-xyz';

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}
global.fetch = async (url) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.hostname === 'firestore.googleapis.com') return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
  throw new Error(`Unerwarteter fetch() im Test: ${u.href}`);
};

function req(path, { method = 'GET', key, qs } = {}) {
  const headers = {};
  if (key !== undefined) headers.Authorization = `Bearer ${key}`;
  const url = new URL(`https://google-buero.test.example${path}`);
  for (const [k, v] of Object.entries(qs || {})) url.searchParams.set(k, v);
  return new Request(url, { method, headers });
}

function machtRateLimiter(erlaubt = true) {
  return { limit: async () => ({ success: erlaubt }) };
}
const baseEnv = {
  API_KEY, OAUTH_SETUP_SECRET,
  GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  RATE_LIMITER: machtRateLimiter(true),
};

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await pruefe('zeitkonstanterVergleich: gleiche Strings -> true, unterschiedliche -> false', () => {
  assert(zeitkonstanterVergleich('abc', 'abc') === true);
  assert(zeitkonstanterVergleich('abc', 'abd') === false);
  assert(zeitkonstanterVergleich('abc', 'abcdef') === false);
});

await pruefe('G1: fehlender Authorization-Header -> 401', async () => {
  const res = await worker.fetch(req('/emails'), baseEnv);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

await pruefe('G2: falscher API_KEY -> 401', async () => {
  const res = await worker.fetch(req('/emails', { key: 'falscher-schluessel' }), baseEnv);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

await pruefe('G3: korrekter API_KEY passiert Auth+Rate-Limit (scheitert danach kontrolliert an fehlender Google-Verbindung, nicht an 401/429/503)', async () => {
  const res = await worker.fetch(req('/emails', { key: API_KEY }), baseEnv);
  assert(res.status !== 401 && res.status !== 429 && res.status !== 503, `unerwarteter Status ${res.status} - Auth/Rate-Limit hätte passieren müssen`);
  const data = await res.json();
  assert(/noch nicht verbunden/.test(data?.error?.message || ''), `erwartete "noch nicht verbunden"-Fehler, war: ${JSON.stringify(data)}`);
});

await pruefe('G4: DELETE wird immer abgelehnt (403), auch mit korrektem API_KEY', async () => {
  const res = await worker.fetch(req('/emails/123', { method: 'DELETE', key: API_KEY }), baseEnv);
  assert(res.status === 403, `erwartet 403, war ${res.status}`);
});

await pruefe('G5: /oauth/authorize mit falschem setup_key -> 403', async () => {
  const res = await worker.fetch(req('/oauth/authorize', { qs: { setup_key: 'falsch' } }), baseEnv);
  assert(res.status === 403, `erwartet 403, war ${res.status}`);
});

await pruefe('G6: /oauth/authorize mit korrektem setup_key -> 302 Redirect', async () => {
  const res = await worker.fetch(req('/oauth/authorize', { qs: { setup_key: OAUTH_SETUP_SECRET } }), baseEnv);
  assert(res.status === 302, `erwartet 302, war ${res.status}`);
});

await pruefe('G7: fehlendes RATE_LIMITER-Binding -> FAIL-CLOSED 503, auch für /oauth/authorize', async () => {
  const env = { ...baseEnv, RATE_LIMITER: undefined };
  const res = await worker.fetch(req('/oauth/authorize', { qs: { setup_key: OAUTH_SETUP_SECRET } }), env);
  assert(res.status === 503, `erwartet 503 (fail-closed), war ${res.status}`);
});

await pruefe('G8: Rate-Limit überschritten -> 429, vor jeder Auth-Prüfung', async () => {
  const env = { ...baseEnv, RATE_LIMITER: machtRateLimiter(false) };
  const res = await worker.fetch(req('/emails'), env);
  assert(res.status === 429, `erwartet 429, war ${res.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
