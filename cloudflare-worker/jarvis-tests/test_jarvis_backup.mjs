// Echter Integrationstest gegen den TATSÄCHLICHEN Worker-Code (import von
// ../worker.js, __test__-Export) - deckt P0 Phase 1, Maßnahme 3 ab:
// runFirestoreBackup() (wöchentlicher Firestore-Export nach Cloud Storage,
// siehe Kopfkommentar der Funktion in worker.js).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_backup.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-backup',
};

let firestoreDb;
let updateTimeCounter;
function naechsteUpdateTime() { return `t${++updateTimeCounter}`; }

let exportAufrufe;
let letzterExportBody;
let exportSollFehlschlagen;

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-access-token' });

  if (u.hostname === 'firestore.googleapis.com' && u.pathname.endsWith(':exportDocuments')) {
    exportAufrufe++;
    letzterExportBody = JSON.parse(init.body);
    if (exportSollFehlschlagen) return jsonResponse(500, { error: { message: 'simulierter Export-API-Fehler' } });
    return jsonResponse(200, { name: `projects/${serviceAccount.project_id}/databases/(default)/operations/op-${exportAufrufe}` });
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
    return jsonResponse(404, { error: 'unbekannter Firestore-Pfad im Mock' });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function reset() {
  firestoreDb = new Map();
  updateTimeCounter = 0;
  exportAufrufe = 0;
  letzterExportBody = null;
  exportSollFehlschlagen = false;
}

const baseEnv = { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), BACKUP_EXPORT_AKTIV: 'true', BACKUP_GCS_BUCKET: 'test-bucket' };

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  reset();
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await pruefe('B1: BACKUP_EXPORT_AKTIV nicht "true" -> kein Export, kein Job angelegt', async () => {
  await W.runFirestoreBackup({ ...baseEnv, BACKUP_EXPORT_AKTIV: 'false' });
  assert(exportAufrufe === 0, 'Export-API wurde trotz deaktiviertem Schalter aufgerufen');
  assert(firestoreDb.size === 0, 'es wurde trotzdem ein Job-/Log-Dokument angelegt');
});

await pruefe('B2: fehlendes BACKUP_GCS_BUCKET -> kein Export, aber Fehler protokolliert', async () => {
  await W.runFirestoreBackup({ ...baseEnv, BACKUP_GCS_BUCKET: undefined });
  assert(exportAufrufe === 0, 'Export-API wurde trotz fehlendem Bucket aufgerufen');
  const hatFehlerEintrag = [...firestoreDb.keys()].some((k) => k.startsWith('ai_action_log/'));
  assert(hatFehlerEintrag, 'kein Fehler in ai_action_log protokolliert');
});

await pruefe('B3: Erfolgsfall -> Export-API mit korrektem outputUriPrefix aufgerufen, Job auf "done"', async () => {
  await W.runFirestoreBackup(baseEnv);
  assert(exportAufrufe === 1, `erwartet genau 1 Export-Aufruf, war ${exportAufrufe}`);
  const heute = new Date().toISOString().slice(0, 10);
  assert(letzterExportBody.outputUriPrefix === `gs://test-bucket/firestore-backups/${heute}`, `unerwarteter outputUriPrefix: ${letzterExportBody.outputUriPrefix}`);
  const job = firestoreDb.get(`jarvisJobs/firestore-backup-${heute}`);
  assert(job, 'kein Job-Dokument angelegt');
  assert(job.fields.status.stringValue === 'done', `Job-Status erwartet "done", war ${job.fields.status.stringValue}`);
});

await pruefe('B4: Export-API-Fehler -> Job auf "failed", Fehler protokolliert, keine stille Fehlannahme von Erfolg', async () => {
  exportSollFehlschlagen = true;
  await W.runFirestoreBackup(baseEnv);
  const heute = new Date().toISOString().slice(0, 10);
  const job = firestoreDb.get(`jarvisJobs/firestore-backup-${heute}`);
  assert(job, 'kein Job-Dokument angelegt');
  assert(job.fields.status.stringValue === 'failed', `Job-Status erwartet "failed", war ${job.fields.status.stringValue}`);
  const hatFehlerEintrag = [...firestoreDb.keys()].some((k) => k.startsWith('ai_action_log/'));
  assert(hatFehlerEintrag, 'kein Fehler in ai_action_log protokolliert');
});

await pruefe('B5: zweiter Aufruf am selben Tag -> kein zweiter Export (Job bereits "done")', async () => {
  await W.runFirestoreBackup(baseEnv);
  assert(exportAufrufe === 1);
  await W.runFirestoreBackup(baseEnv);
  assert(exportAufrufe === 1, `Export lief ein zweites Mal am selben Tag (Aufrufe: ${exportAufrufe})`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
