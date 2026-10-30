// Echter Test gegen den TATSÄCHLICHEN Worker-Code (import von worker.js,
// keine Kopie) für die P0-Sicherheitskorrektur vom 28.10.2026 (Master-Audit
// Bericht 03 Risiko #3 + Bericht 05): werkora_create_invoice,
// werkora_mark_invoice_paid, werkora_cancel_invoice, werkora_create_mahnung
// (MCP) und POST /reminders (REST) dürfen die eigentliche Aktion nicht mehr
// sofort ausführen, sondern nur noch eine Freigabe-Anfrage anlegen - erst
// werkora_approve_action bzw. POST /approvals/{id}/approve führt sie aus.
//
// Ausführen: node cloudflare-worker-ki-buerokraft/tests/test_finanz_freigabe.mjs
import crypto from 'node:crypto';
import worker, { callWerkoraMcpTool } from '../worker.js';

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
// test_bulk_fix_receipts.mjs (passend zu den einfachen firestoreList/Get/
// Create/Update-Helfern dieses Workers). ---
const firestoreDb = new Map(); // "collection/id" -> fields
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, toFirestoreFields(data)); }

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-token' });
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

const env = { API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), RATE_LIMITER: { limit: async () => ({ success: true }) } };
// callWerkoraMcpTool() direkt aufrufen (ohne OAuth-Umweg) - firestoreGet/
// Create/Update prüfen den Token-WERT nicht, nur dass einer gesendet wird.
const ctx = { accessToken: 'fake-token', projectId: serviceAccount.project_id, ip: '' };

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
  if ('doubleValue' in f) return f.doubleValue;
  if ('integerValue' in f) return Number(f.integerValue);
  return f;
}

setDoc('einstellungen', 'global', { rechnungPrefix: 'RE-' });

await pruefe('F1: werkora_mark_invoice_paid legt nur eine Freigabe-Anfrage an, "rechnungen" bleibt UNVERÄNDERT', async () => {
  setDoc('rechnungen', 'r1', { id: 'r1', nummer: 'RE-1', status: 'offen', versendet: true, brutto: 119, bezahltAm: '' });
  const res = await callWerkoraMcpTool('werkora_mark_invoice_paid', { invoice_id: 'r1' }, ctx);
  const data = JSON.parse(res.content[0].text);
  assert(data.approval_required === true, 'Antwort muss approval_required:true enthalten');
  assert(typeof data.approval_id === 'string' && data.approval_id.length > 0, 'approval_id muss gesetzt sein');
  const rechnungDanach = firestoreDb.get('rechnungen/r1');
  assert(feldWert(rechnungDanach, 'status') === 'offen', 'Rechnung darf vor Freigabe NICHT als bezahlt gelten');
  assert(feldWert(rechnungDanach, 'bezahltAm') === '', 'bezahltAm darf vor Freigabe nicht gesetzt sein');
  global.__approvalIdF1 = data.approval_id;
});

await pruefe('F2: werkora_approve_action führt die Freigabe aus F1 jetzt tatsächlich aus - "rechnungen" wird bezahlt markiert', async () => {
  const res = await callWerkoraMcpTool('werkora_approve_action', { approval_id: global.__approvalIdF1 }, ctx);
  assert(!res.isError, `Freigabe darf nicht fehlschlagen: ${res.content?.[0]?.text}`);
  const rechnungDanach = firestoreDb.get('rechnungen/r1');
  assert(feldWert(rechnungDanach, 'status') === 'bezahlt', 'Rechnung muss nach Freigabe bezahlt sein');
  assert(feldWert(rechnungDanach, 'bezahltAm') !== '', 'bezahltAm muss nach Freigabe gesetzt sein');
});

await pruefe('F3: dieselbe approval_id lässt sich NICHT zweimal freigeben (Schutz vor doppelter Ausführung)', async () => {
  const res = await callWerkoraMcpTool('werkora_approve_action', { approval_id: global.__approvalIdF1 }, ctx);
  assert(res.isError === true, 'zweite Freigabe derselben ID muss fehlschlagen');
  assert(/bereits den Status/.test(res.content[0].text), `erwartete Fehlermeldung zu "bereits den Status", war: ${res.content[0].text}`);
});

await pruefe('F4: werkora_reject_action lehnt ab, OHNE die Aktion auszuführen', async () => {
  setDoc('rechnungen', 'r2', { id: 'r2', nummer: 'RE-2', status: 'offen', versendet: true, brutto: 50, bezahltAm: '' });
  const propose = await callWerkoraMcpTool('werkora_mark_invoice_paid', { invoice_id: 'r2' }, ctx);
  const { approval_id } = JSON.parse(propose.content[0].text);
  const reject = await callWerkoraMcpTool('werkora_reject_action', { approval_id, reason: 'Testweise abgelehnt' }, ctx);
  assert(!reject.isError, 'Ablehnung selbst darf nicht fehlschlagen');
  const rechnungDanach = firestoreDb.get('rechnungen/r2');
  assert(feldWert(rechnungDanach, 'status') === 'offen', 'Rechnung darf nach Ablehnung weiterhin offen sein');
  const nochmalFreigeben = await callWerkoraMcpTool('werkora_approve_action', { approval_id }, ctx);
  assert(nochmalFreigeben.isError === true, 'eine abgelehnte Freigabe darf nicht nachträglich freigegeben werden können');
});

await pruefe('F5: eine abgelaufene Freigabe-Anfrage kann nicht mehr ausgeführt werden', async () => {
  setDoc('rechnungen', 'r3', { id: 'r3', nummer: 'RE-3', status: 'offen', versendet: true, brutto: 10, bezahltAm: '' });
  const propose = await callWerkoraMcpTool('werkora_mark_invoice_paid', { invoice_id: 'r3' }, ctx);
  const { approval_id } = JSON.parse(propose.content[0].text);
  // Ablauf künstlich in die Vergangenheit setzen (Mock erlaubt direktes Schreiben).
  const vorhanden = firestoreDb.get(`mcpFinanzFreigaben/${approval_id}`);
  firestoreDb.set(`mcpFinanzFreigaben/${approval_id}`, { ...vorhanden, ablaufAm: toFirestoreValue('2000-01-01T00:00:00.000Z') });
  const res = await callWerkoraMcpTool('werkora_approve_action', { approval_id }, ctx);
  assert(res.isError === true, 'abgelaufene Freigabe darf nicht mehr ausführbar sein');
  assert(/abgelaufen/.test(res.content[0].text), `erwartete Fehlermeldung zu "abgelaufen", war: ${res.content[0].text}`);
  const rechnungDanach = firestoreDb.get('rechnungen/r3');
  assert(feldWert(rechnungDanach, 'status') === 'offen', 'Rechnung darf durch eine abgelaufene Freigabe nicht verändert werden');
});

await pruefe('F6: werkora_cancel_invoice legt erst nach Freigabe tatsächlich eine Stornorechnung an', async () => {
  setDoc('rechnungen', 'r4', { id: 'r4', nummer: 'RE-4', status: 'offen', versendet: true, brutto: 100, netto: 84.03, steuer: 15.97, positionen: [{ id: 'p1', menge: 1, einzelpreis: 84.03, steuersatz: 19 }] });
  const propose = await callWerkoraMcpTool('werkora_cancel_invoice', { invoice_id: 'r4', reason: 'Testgrund' }, ctx);
  const vorAnzahlRechnungen = [...firestoreDb.keys()].filter((k) => k.startsWith('rechnungen/')).length;
  const { approval_id } = JSON.parse(propose.content[0].text);
  await callWerkoraMcpTool('werkora_approve_action', { approval_id }, ctx);
  const nachAnzahlRechnungen = [...firestoreDb.keys()].filter((k) => k.startsWith('rechnungen/')).length;
  assert(nachAnzahlRechnungen === vorAnzahlRechnungen + 1, 'nach Freigabe muss genau eine neue Stornorechnung entstanden sein');
  const originalDanach = firestoreDb.get('rechnungen/r4');
  assert(feldWert(originalDanach, 'status') === 'storniert', 'Originalrechnung muss nach Freigabe storniert sein');
});

await pruefe('F7: werkora_list_pending_approvals zeigt nur noch offene Freigaben', async () => {
  const res = await callWerkoraMcpTool('werkora_list_pending_approvals', {}, ctx);
  const liste = JSON.parse(res.content[0].text);
  assert(liste.every((e) => e.approval_id), 'jeder Eintrag muss eine approval_id haben');
  // F1 (ausgeführt), F4 (abgelehnt), F5 (abgelaufen), F6 (ausgeführt) dürfen
  // NICHT mehr als offen gelistet sein.
  const nochOffenIds = new Set(liste.map((e) => e.approval_id));
  assert(!nochOffenIds.has(global.__approvalIdF1), 'eine bereits ausgeführte Freigabe darf nicht mehr als offen gelten');
});

await pruefe('F8 (REST): POST /reminders legt nur eine Freigabe-Anfrage an (202), "mahnungen" bleibt leer', async () => {
  setDoc('rechnungen', 'r5', { id: 'r5', nummer: 'RE-5', status: 'offen', faelligAm: '2020-01-01' });
  const res = await worker.fetch(authRequest('/reminders', { body: { invoice_id: 'r5', level: 1 } }), env);
  assert(res.status === 202, `erwartet 202 (Freigabe ausstehend), war ${res.status}`);
  const data = await res.json();
  assert(data.data.approval_required === true, 'REST-Antwort muss approval_required:true enthalten');
  const mahnungenVorher = [...firestoreDb.keys()].filter((k) => k.startsWith('mahnungen/'));
  assert(mahnungenVorher.length === 0, 'vor Freigabe darf noch keine Mahnung existieren');
  global.__approvalIdF8 = data.data.approval_id;
});

await pruefe('F9 (REST): POST /approvals/{id}/approve führt die Mahnungs-Anlage aus F8 jetzt aus', async () => {
  const res = await worker.fetch(authRequest(`/approvals/${global.__approvalIdF8}/approve`, { body: {} }), env);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const mahnungenDanach = [...firestoreDb.keys()].filter((k) => k.startsWith('mahnungen/'));
  assert(mahnungenDanach.length === 1, 'nach Freigabe muss genau eine Mahnung existieren');
});

await pruefe('F10 (REST): GET /approvals ohne gültigen API-Schlüssel wird abgelehnt (401)', async () => {
  const req = new Request('https://ki-buerokraft.test.example/approvals', { headers: {} });
  const res = await worker.fetch(req, env);
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
