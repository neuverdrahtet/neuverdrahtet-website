// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import des default-Exports "fetch"-Handlers, keine
// __test__-Hintertür nötig - dieser Worker hat bisher GAR KEINE Testdatei
// gehabt). Deckt Phase 11 Punkt 1 ab: bulkFixReceipts darf Ausgaben nicht
// mehr direkt ändern, sondern nur noch Vorschläge anlegen (alte+neue Werte),
// inkl. Dedup gegen bereits offene Vorschläge.
//
// Ausführen: node cloudflare-worker-ki-buerokraft/tests/test_bulk_fix_receipts.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'ki-buerokraft-test',
};
const API_KEY = 'test-api-key-123456';

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

// --- generischer In-Memory-Firestore-Mock, passend zu den einfachen
// firestoreList/firestoreGet/firestoreCreate/firestoreUpdate-Helfern dieses
// Workers (reines PATCH mit updateMask, keine :commit-Preconditions). ---
const firestoreDb = new Map(); // "collection/id" -> fields
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, toFirestoreFields(data)); }

let aiWorkerAufrufe = 0;
let letzteAiWorkerHeaders = null;
let aiWorkerAntwort = () => ({ haendler: 'Test-Lieferant GmbH', datum: '2026-01-15', betragNetto: 84.03, betragBrutto: 100, steuersatz: 19, kategorie: 'Material', beschreibung: 'Testmaterial', lesbar: true, kategorieSicher: true });

const env = {
  API_KEY,
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  AI_WORKER: {
    async fetch(url, init) {
      aiWorkerAufrufe++;
      letzteAiWorkerHeaders = init?.headers || {};
      return { ok: true, json: async () => aiWorkerAntwort() };
    },
  },
};

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.href === 'https://fake-storage.test/beleg.jpg') return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };

  if (u.hostname === 'firestore.googleapis.com') {
    const namePrefix = `projects/${serviceAccount.project_id}/databases/(default)/documents/`;
    const pathPrefix = `/v1/${namePrefix}`;
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (teile.length === 1) {
      const [collection] = teile;
      const documents = [];
      for (const [key, fields] of firestoreDb.entries()) {
        const [c, id] = key.split('/');
        if (c === collection) documents.push({ name: `${namePrefix}${collection}/${id}`, fields });
      }
      return jsonResponse(200, { documents });
    }
    const [collection, id] = teile;
    const key = `${collection}/${id}`;
    if (method === 'PATCH') {
      const body = JSON.parse(init.body);
      const maskFields = u.searchParams.getAll('updateMask.fieldPaths');
      const vorhanden = firestoreDb.get(key);
      const neu = maskFields.length > 0 ? { ...(vorhanden || {}), ...body.fields } : body.fields;
      firestoreDb.set(key, neu);
      return jsonResponse(200, { name: `${namePrefix}${key}`, fields: neu });
    }
    const fields = firestoreDb.get(key);
    if (!fields) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields });
  }
  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function authRequest(path, { method = 'POST', body } = {}) {
  return new Request(`https://ki-buerokraft.test.example${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

setDoc('einstellungen', 'global', { aiWorkerUrl: 'https://ai-worker.internal', aiAppSecret: 'secret' });

await pruefe('K1: ein sicher lesbarer Beleg erzeugt einen VORSCHLAG in belegVorschlaege - "ausgaben" wird NICHT verändert', async () => {
  setDoc('ausgaben', 'a1', { betragBrutto: 0, beleg: { url: 'https://fake-storage.test/beleg.jpg', mime: 'image/jpeg' }, lieferant: '', datum: '2026-01-01', kategorie: 'Sonstiges' });
  const res = await worker.fetch(authRequest('/expenses/bulk-fix-receipts', { body: { limit: 10 } }), env);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const data = await res.json();
  assert(data.success === true, 'Antwort muss success:true sein');
  assert(data.data.vorschlaege.length === 1, `erwartet 1 Vorschlag, war ${data.data.vorschlaege.length}`);
  assert(data.data.vorschlaege[0].ausgabeId === 'a1', 'Vorschlag muss sich auf a1 beziehen');
  assert(data.data.vorschlaege[0].neueWerte.betragBrutto === 100, 'neueWerte muss den erkannten Betrag enthalten');
  assert(data.data.vorschlaege[0].alteWerte.betragBrutto === 0, 'alteWerte muss den BISHERIGEN (alten) Betrag enthalten');
  assert(!('updated' in data.data), 'Antwort darf kein "updated"-Feld mehr enthalten (alte, direkt schreibende API)');

  const ausgabeNachLauf = firestoreDb.get('ausgaben/a1');
  assert(ausgabeNachLauf.betragBrutto.integerValue === '0' || ausgabeNachLauf.betragBrutto.doubleValue === 0, 'die echte Ausgabe darf durch bulkFixReceipts NICHT verändert werden - nur der Vorschlag');
});

await pruefe('K2: ein zweiter Lauf schlägt denselben Beleg NICHT erneut vor, solange der erste Vorschlag noch offen ist (Dedup)', async () => {
  const res = await worker.fetch(authRequest('/expenses/bulk-fix-receipts', { body: { limit: 10 } }), env);
  const data = await res.json();
  assert(data.data.vorschlaege.length === 0, `erwartet 0 neue Vorschläge (Dedup), war ${data.data.vorschlaege.length}`);
  assert(data.data.remaining_incomplete === 0, 'die bereits vorgeschlagene Ausgabe darf nicht mehr als "offen zu bearbeiten" gezählt werden');
});

await pruefe('K3: ein NICHT sicher lesbarer Beleg wird weiterhin direkt als kiAnalyseUnsicher markiert (kein Vorschlag, keine Freigabe nötig - das ist kein Finanzwert)', async () => {
  setDoc('ausgaben', 'a2', { betragBrutto: 0, beleg: { url: 'https://fake-storage.test/beleg.jpg', mime: 'image/jpeg' } });
  const ORIG = aiWorkerAntwort;
  aiWorkerAntwort = () => ({ lesbar: false });
  const res = await worker.fetch(authRequest('/expenses/bulk-fix-receipts', { body: { limit: 10 } }), env);
  aiWorkerAntwort = ORIG;
  const data = await res.json();
  assert(data.data.needs_manual_review.some((r) => r.id === 'a2'), 'a2 muss in needs_manual_review stehen');
  assert(data.data.vorschlaege.every((v) => v.ausgabeId !== 'a2'), 'für einen unlesbaren Beleg darf kein Vorschlag entstehen');
  const markiert = firestoreDb.get('ausgaben/a2');
  assert(markiert.kiAnalyseUnsicher.booleanValue === true, 'a2 muss als kiAnalyseUnsicher markiert sein');
});

await pruefe('K4: ohne gültigen API-Schlüssel wird bulk-fix-receipts abgelehnt (401), unabhängig vom Vorschlagsmodus', async () => {
  const req = new Request('https://ki-buerokraft.test.example/expenses/bulk-fix-receipts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  const res = await worker.fetch(req, env);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

// =============================================================================
// Phase 11.1 Punkt 3 ("API-Basisadressen"): der Origin-Header beim Aufruf
// des AI_WORKER-Service-Bindings (Beleg-Scan) war fest auf die
// Produktions-Domain verdrahtet - das hätte in Staging (eigene
// ALLOWED_ORIGINS) jeden Beleg-Scan mit 403 scheitern lassen. Jetzt über
// AI_WORKER_ORIGIN konfigurierbar, mit der Produktions-Domain als
// unverändertem Standardwert.
// =============================================================================

await pruefe('K5: ohne AI_WORKER_ORIGIN wird weiterhin die bisherige Produktions-Domain als Origin-Header gesendet (Rückwärtskompatibilität für Produktion)', async () => {
  setDoc('ausgaben', 'a-k5', { betragBrutto: 0, beleg: { url: 'https://fake-storage.test/beleg.jpg', mime: 'image/jpeg' } });
  await worker.fetch(authRequest('/expenses/bulk-fix-receipts', { body: { limit: 1 } }), env);
  assert(letzteAiWorkerHeaders.Origin === 'https://neuverdrahtet.com', `erwartet Produktions-Origin als Standard, war ${letzteAiWorkerHeaders.Origin}`);
});

await pruefe('K6: mit gesetztem AI_WORKER_ORIGIN (z.B. Staging-Vorschau-Domain) wird GENAU dieser Wert als Origin-Header gesendet, nicht die Produktions-Domain', async () => {
  setDoc('ausgaben', 'a-k6', { betragBrutto: 0, beleg: { url: 'https://fake-storage.test/beleg.jpg', mime: 'image/jpeg' } });
  const stagingEnv = { ...env, AI_WORKER_ORIGIN: 'https://staging-preview.example.pages.dev' };
  await worker.fetch(authRequest('/expenses/bulk-fix-receipts', { body: { limit: 1 } }), stagingEnv);
  assert(letzteAiWorkerHeaders.Origin === 'https://staging-preview.example.pages.dev', `erwartet konfigurierte Staging-Origin, war ${letzteAiWorkerHeaders.Origin}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
