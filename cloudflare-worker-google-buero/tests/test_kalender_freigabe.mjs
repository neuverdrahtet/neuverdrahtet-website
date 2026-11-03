// Echter Test gegen den TATSÄCHLICHEN Worker-Code (import von worker.js,
// keine Kopie) für Maßnahme 5 (Google-Kalender-Freigabe-Gate, November
// 2026): createCalendarEvent/updateCalendarEvent legen einen Termin NICHT
// mehr sofort im echten Firmenkalender an/ändern ihn nicht mehr sofort,
// sondern nur noch eine Freigabe-Anfrage - erst POST /approvals/{id}/approve
// führt die Aktion tatsächlich aus.
//
// Ausführen: node cloudflare-worker-google-buero/tests/test_kalender_freigabe.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'google-buero-test',
};

const env = {
  API_KEY: 'test-api-key-123456-mindestens-32-zeichen',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
};

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

// --- generischer In-Memory-Firestore-Mock (gleiches Muster wie
// cloudflare-worker-ki-buerokraft/tests/test_finanz_freigabe.mjs), plus
// ein In-Memory-"Google Kalender"-Mock. ---
const firestoreDb = new Map(); // "collection/id" -> fields
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, toFirestoreFields(data)); }
setDoc('google_oauth_tokens', 'neuverdrahtet', { refresh_token: 'fake-refresh-token' });

const kalenderEvents = new Map(); // id -> event (Google-Kalender-API-Form)
let kalenderIdCounter = 0;
let kalenderSchreibzugriffe = 0; // zählt echte POST/PATCH-Aufrufe an die Kalender-API

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
      // firestoreSet() in diesem Worker schickt KEINE updateMask - ein
      // echtes Firestore-PATCH ohne Maske überschreibt das GANZE Dokument.
      const body = JSON.parse(init.body);
      firestoreDb.set(key, body.fields);
      return jsonResponse(200, { name: `${namePrefix}${key}`, fields: body.fields });
    }
    const fields = firestoreDb.get(key);
    if (!fields) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields });
  }
  if (u.hostname === 'www.googleapis.com' && u.pathname.includes('/calendar/v3/')) {
    if (method === 'POST' && u.pathname.endsWith('/events')) {
      kalenderSchreibzugriffe++;
      const body = JSON.parse(init.body);
      const id = `ev-${++kalenderIdCounter}`;
      const event = { id, ...body };
      kalenderEvents.set(id, event);
      return jsonResponse(200, event);
    }
    if (method === 'PATCH') {
      kalenderSchreibzugriffe++;
      const id = u.pathname.split('/').pop();
      const bestehend = kalenderEvents.get(id);
      if (!bestehend) return jsonResponse(404, { error: { message: 'not found' } });
      const patch = JSON.parse(init.body);
      const aktualisiert = { ...bestehend, ...patch };
      kalenderEvents.set(id, aktualisiert);
      return jsonResponse(200, aktualisiert);
    }
    if (method === 'GET') {
      const id = u.pathname.split('/').pop();
      const event = kalenderEvents.get(id);
      if (!event) return jsonResponse(404, { error: { message: 'not found' } });
      return jsonResponse(200, event);
    }
  }
  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function req(path, { method = 'GET', body } = {}) {
  return new Request(`https://google-buero.test.example${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.API_KEY}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

let angelegteApprovalId;

await pruefe('G1: POST /calendar/events legt KEINEN echten Termin an, sondern nur eine Freigabe-Anfrage (202, approval_required)', async () => {
  const vorherSchreibzugriffe = kalenderSchreibzugriffe;
  const res = await worker.fetch(req('/calendar/events', { method: 'POST', body: { title: 'Termin Familie Schmidt', start: '2026-12-01T09:00:00Z', end: '2026-12-01T10:00:00Z' } }), env);
  assert(res.status === 202, `erwartet 202, war ${res.status}`);
  const data = await res.json();
  assert(data.data.approval_required === true, 'approval_required muss true sein');
  assert(typeof data.data.approval_id === 'string' && data.data.approval_id.length > 0, 'approval_id muss gesetzt sein');
  assert(kalenderSchreibzugriffe === vorherSchreibzugriffe, 'es darf NOCH KEIN echter Kalender-Schreibzugriff stattgefunden haben');
  assert(kalenderEvents.size === 0, 'es darf noch kein echter Kalender-Event existieren');
  angelegteApprovalId = data.data.approval_id;
});

await pruefe('G2: GET /approvals zeigt die offene Freigabe-Anfrage aus G1', async () => {
  const res = await worker.fetch(req('/approvals'), env);
  const data = await res.json();
  assert(data.data.some((f) => f.approval_id === angelegteApprovalId), 'offene Freigabe-Anfrage muss in der Liste erscheinen');
});

await pruefe('G3: POST /approvals/{id}/approve führt die Terminanlage aus G1 jetzt tatsächlich aus', async () => {
  const res = await worker.fetch(req(`/approvals/${angelegteApprovalId}/approve`, { method: 'POST' }), env);
  assert(res.status === 200, `erwartet 200, war ${res.status}: ${JSON.stringify(await res.json())}`);
  assert(kalenderEvents.size === 1, 'nach Freigabe muss genau EIN echter Kalender-Event existieren');
  const [event] = kalenderEvents.values();
  assert(event.summary === 'Termin Familie Schmidt', 'Termin-Titel muss übernommen worden sein');
});

await pruefe('G4: dieselbe approval_id lässt sich NICHT zweimal freigeben (Schutz vor doppelter Ausführung)', async () => {
  const res = await worker.fetch(req(`/approvals/${angelegteApprovalId}/approve`, { method: 'POST' }), env);
  const data = await res.json();
  assert(res.status === 409, `erwartet 409, war ${res.status}`);
  assert(data.error.code === 'APPROVAL_NOT_PENDING', `erwartet APPROVAL_NOT_PENDING, war ${data.error.code}`);
  assert(kalenderEvents.size === 1, 'es darf KEIN zweiter Termin entstanden sein');
});

await pruefe('G5: PATCH /calendar/events/{id} ändert den echten Termin NICHT sofort, sondern legt nur eine Freigabe-Anfrage an', async () => {
  const [eventId] = kalenderEvents.keys();
  const vorherSchreibzugriffe = kalenderSchreibzugriffe;
  const res = await worker.fetch(req(`/calendar/events/${eventId}`, { method: 'PATCH', body: { location: 'Musterstraße 1' } }), env);
  assert(res.status === 202, `erwartet 202, war ${res.status}`);
  const data = await res.json();
  assert(data.data.approval_required === true, 'approval_required muss true sein');
  assert(kalenderSchreibzugriffe === vorherSchreibzugriffe, 'es darf noch kein echter Kalender-Schreibzugriff stattgefunden haben');
  assert(kalenderEvents.get(eventId).location === '', 'der echte Termin darf noch NICHT geändert worden sein');
  global.__approvalIdG5 = data.data.approval_id;
  global.__eventIdG5 = eventId;
});

await pruefe('G6: werkora_reject_action-Äquivalent (POST /approvals/{id}/reject) führt die Änderung aus G5 NICHT aus', async () => {
  const res = await worker.fetch(req(`/approvals/${global.__approvalIdG5}/reject`, { method: 'POST', body: { reason: 'Testablehnung' } }), env);
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const data = await res.json();
  assert(data.data.status === 'abgelehnt', `erwartet Status "abgelehnt", war "${data.data.status}"`);
  assert(kalenderEvents.get(global.__eventIdG5).location === '', 'der echte Termin darf nach Ablehnung weiterhin unverändert sein');
});

await pruefe('G7: eine abgelaufene Freigabe-Anfrage kann nicht mehr ausgeführt werden', async () => {
  // Direkt eine bereits abgelaufene Freigabe in den Mock schreiben (gleiche
  // Technik wie im Finanz-Freigabe-Pendant: kein künstliches Warten von >24h nötig).
  setDoc('kalenderFreigaben', 'abgelaufen-1', {
    id: 'abgelaufen-1', aktion: 'create_calendar_event', args: { title: 'x', start: 'a', end: 'b' },
    zusammenfassung: 'x', status: 'offen', angefordertAm: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    ablaufAm: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), bearbeitetAm: '', ausgefuehrtAm: '', fehler: '',
  });
  const res = await worker.fetch(req('/approvals/abgelaufen-1/approve', { method: 'POST' }), env);
  const data = await res.json();
  assert(res.status === 409, `erwartet 409, war ${res.status}`);
  assert(data.error.code === 'APPROVAL_EXPIRED', `erwartet APPROVAL_EXPIRED, war ${data.error.code}`);
});

await pruefe('G8: eine werkora_appointment_id, für die bereits ein Termin existiert, überspringt die Freigabe (Dubletten-Schutz bleibt erhalten)', async () => {
  const [bestehendeEventId] = kalenderEvents.keys();
  setDoc('google_calendar_links', 'werkora-termin-1', { werkora_appointment_id: 'werkora-termin-1', google_calendar_event_id: bestehendeEventId, created_at: new Date().toISOString() });
  const vorherSchreibzugriffe = kalenderSchreibzugriffe;
  const res = await worker.fetch(req('/calendar/events', { method: 'POST', body: { title: 'Dublette', start: '2026-12-02T09:00:00Z', end: '2026-12-02T10:00:00Z', werkora_appointment_id: 'werkora-termin-1' } }), env);
  assert(res.status === 200, `erwartet 200 (sofortige Antwort, keine Freigabe nötig), war ${res.status}`);
  const data = await res.json();
  assert(data.data.already_existed === true, 'already_existed muss true sein');
  assert(kalenderSchreibzugriffe === vorherSchreibzugriffe, 'keine Freigabe-Anfrage und kein neuer Kalender-Schreibzugriff für eine bekannte Dublette');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
