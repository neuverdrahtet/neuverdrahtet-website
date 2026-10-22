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

// firestoreDb speichert { fields, updateTime } - wie in test_jarvis_phase10.mjs,
// weil beanspracheTagesJob (firestoreCreateIfMissing/firestoreBeanspruche)
// echte Firestore-Preconditions (currentDocument.exists/updateTime) braucht,
// um die atomare Claim-Semantik überhaupt testen zu können - ein Mock ohne
// Preconditions würde den race-condition-Schutz, der hier geprüft werden
// soll, gar nicht abbilden.
const firestoreDb = new Map();
let updateTimeCounter = 0;
function naechsteUpdateTime() { return `t${++updateTimeCounter}`; }
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, { fields: toFirestoreFields(data), updateTime: naechsteUpdateTime() }); }

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
      const pathPrefixFull = `/v1/${namePrefix}`;
      const relMitQuery = u.pathname.slice(u.pathname.indexOf(pathPrefixFull) + pathPrefixFull.length);
      const [collection, id] = relMitQuery.split('/').filter(Boolean);
      const body = JSON.parse(init.body);
      const key = `${collection}/${id}`;
      const vorhanden = firestoreDb.get(key);
      firestoreDb.set(key, { fields: { ...(vorhanden?.fields || {}), ...body.fields }, updateTime: naechsteUpdateTime() });
      return jsonResponse(200, {});
    }
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (teile.length === 1) {
      const [collection] = teile;
      const documents = [];
      for (const [key, doc] of firestoreDb.entries()) {
        const [c, id] = key.split('/');
        if (c === collection) documents.push({ name: `${namePrefix}${collection}/${id}`, fields: doc.fields, updateTime: doc.updateTime });
      }
      return jsonResponse(200, { documents });
    }
    if (teile.length === 2) {
      const doc = firestoreDb.get(`${teile[0]}/${teile[1]}`);
      if (!doc) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
      return jsonResponse(200, { name: `${namePrefix}${teile[0]}/${teile[1]}`, fields: doc.fields, updateTime: doc.updateTime });
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
// M) runTagescheck - Idempotenz ÜBER mehrere Läufe hinweg per ATOMAREM
//    Lauf-Claim (Phase 11.1 Punkt 2, ersetzt die reine Lese-Vorab-Prüfung
//    aus Phase 11 - siehe jarvisJobs/tagescheck-${heute}).
// =============================================================================

const BASIS_ENV = { JARVIS_TAGESCHECK_AKTIV: 'true', ANTHROPIC_API_KEY: 'fake', KI_BUEROKRAFT_URL: 'https://fake-kibuerokraft.test', KI_BUEROKRAFT_API_KEY: 'fake-key', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };
const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const jobId = `tagescheck-${heute}`;

await pruefe('M0a: OHNE JARVIS_TAGESCHECK_AKTIV läuft der Tagescheck NICHT, auch wenn alle übrigen Secrets gesetzt sind (Standard: aus, Direktstart ohne Staging)', async () => {
  const { JARVIS_TAGESCHECK_AKTIV, ...ohneFlag } = BASIS_ENV;
  claudeAufrufe = 0;
  await W.runTagescheck(ohneFlag);
  assert(claudeAufrufe === 0, `ohne gesetzten Schalter darf KEIN Claude-Aufruf erfolgen, war ${claudeAufrufe}`);
  assert(!firestoreDb.get(`jarvisJobs/${jobId}`), 'ohne gesetzten Schalter darf nicht einmal ein Job-Dokument angelegt werden');
});

await pruefe('M0b: JARVIS_TAGESCHECK_AKTIV="false" (oder ein anderer Wert als "true") blockiert den Lauf genauso wie ein fehlender Wert', async () => {
  claudeAufrufe = 0;
  await W.runTagescheck({ ...BASIS_ENV, JARVIS_TAGESCHECK_AKTIV: 'false' });
  assert(claudeAufrufe === 0, `bei "false" darf KEIN Claude-Aufruf erfolgen, war ${claudeAufrufe}`);
  assert(!firestoreDb.get(`jarvisJobs/${jobId}`), 'bei "false" darf kein Job-Dokument angelegt werden');
});

await pruefe('M1: ein bereits erledigter Tagescheck-Job für heute lässt den Lauf überspringen (KEIN Claude-Aufruf)', async () => {
  setDoc('jarvisJobs', jobId, { typ: 'tagescheck', status: 'done', abgeschlossenAm: new Date().toISOString() });
  claudeAufrufe = 0;
  await W.runTagescheck(BASIS_ENV);
  assert(claudeAufrufe === 0, `bei bereits erledigtem Job darf KEIN Claude-Aufruf erfolgen, war ${claudeAufrufe}`);
  firestoreDb.delete(`jarvisJobs/${jobId}`);
});

await pruefe('M2: ohne vorhandenen Job läuft der Check regulär durch, claimt den Job atomar und markiert ihn am Ende als "done"', async () => {
  claudeAufrufe = 0;
  await W.runTagescheck(BASIS_ENV);
  assert(claudeAufrufe >= 1, `ohne vorhandenen Job muss der Lauf stattfinden, Claude-Aufrufe: ${claudeAufrufe}`);
  const job = firestoreDb.get(`jarvisJobs/${jobId}`);
  assert(job, 'Job-Dokument muss nach dem Lauf existieren');
  assert(job.fields.status.stringValue === 'done', `Job muss "done" sein, war ${job.fields.status.stringValue}`);
  firestoreDb.delete(`jarvisJobs/${jobId}`);
});

await pruefe('M3 (Kernfall "zwei gleichzeitig gestartete Läufe"): von zwei PARALLEL gestarteten runTagescheck-Aufrufen für denselben Tag führt nur EINER den Claude-Aufruf tatsächlich aus - der atomare Claim verhindert die Race Condition, die die reine Lese-Vorab-Prüfung aus Phase 11 noch hatte', async () => {
  claudeAufrufe = 0;
  await Promise.all([W.runTagescheck(BASIS_ENV), W.runTagescheck(BASIS_ENV)]);
  assert(claudeAufrufe === 1, `GENAU EIN Claude-Aufruf erwartet (nicht 0, nicht 2), war ${claudeAufrufe} - zwei parallele Läufe dürfen sich nicht beide für "berechtigt" halten`);
  const job = firestoreDb.get(`jarvisJobs/${jobId}`);
  assert(job.fields.status.stringValue === 'done', 'Job muss trotz zwei paralleler Aufrufe konsistent als "done" enden, nicht doppelt/inkonsistent');
  firestoreDb.delete(`jarvisJobs/${jobId}`);
});

await pruefe('M4 (Kernfall "Absturz zwischen Claim und Abschluss"): ein Job, der noch "running" ist und erst vor Kurzem gestartet wurde, lässt einen zweiten Lauf NICHT zu (vermutlich noch aktiv) - kein zweiter Claude-Aufruf, kein automatischer Zweitversuch', async () => {
  setDoc('jarvisJobs', jobId, { typ: 'tagescheck', status: 'running', gestartetAm: new Date().toISOString(), versuch: 1 });
  claudeAufrufe = 0;
  await W.runTagescheck(BASIS_ENV);
  assert(claudeAufrufe === 0, `ein gerade erst gestarteter, noch laufender Job darf keinen zweiten Claude-Aufruf auslösen, war ${claudeAufrufe}`);
  const job = firestoreDb.get(`jarvisJobs/${jobId}`);
  assert(job.fields.status.stringValue === 'running', 'Status muss unverändert "running" bleiben, solange er nicht als veraltet (stale) erkannt wird');
  firestoreDb.delete(`jarvisJobs/${jobId}`);
});

await pruefe('M5 (Absturz, Fortsetzung): ist derselbe "running"-Job länger als JARVIS_JOB_STALE_MINUTEN alt (simulierter Absturz zwischen Claim und Abschluss), wird er als "unklar" markiert - KEIN automatischer erneuter Lauf, NIE eine zweite Ausführung ohne menschliche Prüfung', async () => {
  const laengstVergangen = new Date(Date.now() - (W.JARVIS_JOB_STALE_MINUTEN + 5) * 60000).toISOString();
  setDoc('jarvisJobs', jobId, { typ: 'tagescheck', status: 'running', gestartetAm: laengstVergangen, versuch: 1 });
  claudeAufrufe = 0;
  await W.runTagescheck(BASIS_ENV);
  assert(claudeAufrufe === 0, `ein als veraltet erkannter Job darf NICHT automatisch erneut ausgeführt werden, Claude-Aufrufe: ${claudeAufrufe}`);
  const job = firestoreDb.get(`jarvisJobs/${jobId}`);
  assert(job.fields.status.stringValue === 'unklar', `Job muss als "unklar" markiert werden, war ${job.fields.status.stringValue}`);
  firestoreDb.delete(`jarvisJobs/${jobId}`);
});

await pruefe('M6 (Fehlerbehandlung): schlägt der Claude-Aufruf fehl, wird der Job als "failed" markiert (nicht "done", nicht hängend) - ein Folgelauf kann es dann erneut versuchen', async () => {
  const ORIG = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    if (u.href === 'https://api.anthropic.com/v1/messages') throw new Error('Simulierter Netzwerkfehler');
    return ORIG(url, init);
  };
  try {
    await W.runTagescheck(BASIS_ENV);
  } finally {
    global.fetch = ORIG;
  }
  const job = firestoreDb.get(`jarvisJobs/${jobId}`);
  assert(job.fields.status.stringValue === 'failed', `Job muss "failed" sein, war ${job.fields.status.stringValue}`);
  firestoreDb.delete(`jarvisJobs/${jobId}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
