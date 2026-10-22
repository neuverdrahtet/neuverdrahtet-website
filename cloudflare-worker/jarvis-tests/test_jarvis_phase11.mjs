// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 11
// Punkt 1 ab: der autonome tägliche Büro-Check (runTagescheck) muss gegen
// Aufgabenfluten UND doppelte Aufgaben abgesichert sein - sowohl INNERHALB
// eines Laufs (gleicher Titel zweimal) als auch ÜBER mehrere Läufe hinweg
// (ein doppelt ausgelöster Cron-Trigger für denselben Tag).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase11.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p11',
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

let claudeAufrufe = 0;
const BASIS_FETCH_MOCK = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
  if (u.href === 'https://api.anthropic.com/v1/messages') {
    claudeAufrufe++;
    return jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fertig.' }], usage: { input_tokens: 5, output_tokens: 5 } });
  }
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
    return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
  }
  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};
global.fetch = BASIS_FETCH_MOCK;

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// L) pruefeTagescheckWerkzeugErlaubt - Duplikat-Schutz INNERHALB eines Laufs
// =============================================================================

await pruefe('L1: derselbe Aufgaben-Titel wird innerhalb EINES Laufs nicht zweimal akzeptiert (doppelte Aufgabe)', () => {
  const zaehler = { count: 0 };
  W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: 'Unvollständige Belege prüfen' }); // darf nicht werfen
  try {
    W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: 'Unvollständige Belege prüfen' });
    throw new Error('FEHLSCHLAG: zweiter identischer Titel hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('L2: Groß-/Kleinschreibung und zusätzliche Leerzeichen sind keine Lücke im Duplikat-Schutz', () => {
  const zaehler = { count: 0 };
  W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: 'Tages-Zusammenfassung 2026-01-01' });
  try {
    W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: '  tages-zusammenfassung   2026-01-01 ' });
    throw new Error('FEHLSCHLAG: normalisiert gleicher Titel hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('L3: unterschiedliche Titel bleiben unbegrenzt erlaubt (bis zum regulären Gesamtlimit)', () => {
  const zaehler = { count: 0 };
  W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: 'Aufgabe A' });
  W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: 'Aufgabe B' });
  W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler, { title: 'Aufgabe C' }); // darf NICHT werfen
  assert(zaehler.count === 3, 'drei unterschiedliche Titel müssen drei Schreibaufrufe zählen');
});

// =============================================================================
// M) runTagescheck - Idempotenz ÜBER mehrere Läufe hinweg (doppelt
//    ausgelöster Cron für denselben Tag darf den Tag nicht zweimal durchlaufen)
// =============================================================================

const BASIS_ENV = { ANTHROPIC_API_KEY: 'fake', KI_BUEROKRAFT_URL: 'https://fake-kibuerokraft.test', KI_BUEROKRAFT_API_KEY: 'fake-key', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };

await pruefe('M1: existiert für heute schon eine "Tages-Zusammenfassung"-Aufgabe, wird der komplette Lauf übersprungen (KEIN Claude-Aufruf, kein zweiter Durchlauf)', async () => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  setDoc('aufgaben', 'bereits-da', { titel: `Tages-Zusammenfassung ${heute}` });
  claudeAufrufe = 0;
  await W.runTagescheck(BASIS_ENV);
  assert(claudeAufrufe === 0, `bei bereits vorhandener Tages-Zusammenfassung darf KEIN Claude-Aufruf erfolgen, war ${claudeAufrufe}`);
  firestoreDb.delete('aufgaben/bereits-da');
});

await pruefe('M2: ohne vorhandene Tages-Zusammenfassung läuft der Check regulär durch (mindestens ein Claude-Aufruf)', async () => {
  claudeAufrufe = 0;
  await W.runTagescheck(BASIS_ENV);
  assert(claudeAufrufe >= 1, `ohne vorhandene Tages-Zusammenfassung muss der Lauf stattfinden, Claude-Aufrufe: ${claudeAufrufe}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
