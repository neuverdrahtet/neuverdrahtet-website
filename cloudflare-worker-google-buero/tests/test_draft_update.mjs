// Echter Test gegen den TATSÄCHLICHEN, produktiv deployten Worker-Code
// (import von ../worker.js, default-fetch-Handler) - deckt die Phase-7-
// Korrektur ab: ein Gmail-Entwurf wird bei erneutem Aufruf mit "draft_id"
// AKTUALISIERT (PUT /drafts/{id}), nicht ein zweites Mal angelegt.
//
// Ausführen: node cloudflare-worker-google-buero/tests/test_draft_update.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'google-buero-test',
};

const env = {
  API_KEY: 'test-api-key',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
};

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const putRequests = [];
const postRequests = [];

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') {
    return jsonResponse(200, { access_token: 'fake-access-token' });
  }
  if (u.hostname === 'firestore.googleapis.com') {
    if (u.pathname.endsWith('/google_oauth_tokens/neuverdrahtet')) {
      return jsonResponse(200, { name: u.pathname, fields: { refresh_token: { stringValue: 'fake-refresh-token' } } });
    }
    return jsonResponse(200, { name: u.pathname, fields: {} });
  }
  if (u.hostname === 'gmail.googleapis.com') {
    if (u.pathname.endsWith('/messages/msg-1') && method === 'GET') {
      return jsonResponse(200, { payload: { headers: [{ name: 'Message-ID', value: '<orig@test>' }, { name: 'Subject', value: 'Anfrage' }] }, threadId: 'thread-1' });
    }
    if (u.pathname.endsWith('/drafts') && method === 'POST') {
      postRequests.push(JSON.parse(init.body));
      return jsonResponse(200, { id: 'draft-neu-1' });
    }
    if (u.pathname.endsWith('/drafts/draft-bestehend-1') && method === 'PUT') {
      putRequests.push(JSON.parse(init.body));
      return jsonResponse(200, { id: 'draft-bestehend-1' });
    }
    if (u.pathname.endsWith('/drafts/draft-geloescht') && method === 'PUT') {
      return jsonResponse(404, { error: { message: 'Requested entity was not found.' } }, false);
    }
    return jsonResponse(404, { error: { message: `unbekannte Gmail-Route im Mock: ${method} ${u.pathname}` } }, false);
  }
  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data, ok = status >= 200 && status < 300) {
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function request(path, body) {
  return new Request(`https://google-buero.test${path}`, {
    method: 'POST', headers: { Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

await pruefe('A1: ohne draft_id wird ein NEUER Entwurf angelegt (POST /drafts)', async () => {
  const res = await worker.fetch(request('/emails/msg-1/draft', { to: 'kunde@test.local', subject: 'Re: Anfrage', body_text: 'Erster Entwurf' }), env);
  const data = await res.json();
  assert(res.status === 201, 'Statuscode 201 bei Neuanlage');
  assert(data.data.draft_id === 'draft-neu-1', 'neue draft_id muss zurückgegeben werden');
  assert(data.data.aktualisiert === false, 'aktualisiert muss false sein');
  assert(postRequests.length === 1, 'genau EIN POST /drafts muss ausgeführt worden sein');
});

await pruefe('A2: MIT draft_id wird der BESTEHENDE Entwurf aktualisiert (PUT /drafts/{id}), kein zweiter Entwurf entsteht', async () => {
  const res = await worker.fetch(request('/emails/msg-1/draft', { to: 'kunde@test.local', subject: 'Re: Anfrage', body_text: 'Bearbeiteter Entwurfstext', draft_id: 'draft-bestehend-1' }), env);
  const data = await res.json();
  assert(res.status === 200, 'Statuscode 200 bei Aktualisierung (kein 201 "created")');
  assert(data.data.draft_id === 'draft-bestehend-1', 'dieselbe draft_id muss erhalten bleiben');
  assert(data.data.aktualisiert === true, 'aktualisiert muss true sein');
  assert(putRequests.length === 1, 'genau EIN PUT /drafts/{id} muss ausgeführt worden sein');
  assert(postRequests.length === 1, 'es darf KEIN zusätzlicher POST /drafts (= zweiter Entwurf) ausgeführt worden sein');
  const gesendeterText = Buffer.from(putRequests[0].message.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert(gesendeterText.includes('Bearbeiteter Entwurfstext'), 'der aktualisierte Text muss im PUT-Body enthalten sein');
});

await pruefe('A3: schlägt das Update fehl (Entwurf z.B. gelöscht/versendet), wird der Fehler weitergereicht - KEIN stillschweigender Fallback auf einen neuen Entwurf', async () => {
  const vorherPost = postRequests.length;
  const res = await worker.fetch(request('/emails/msg-1/draft', { to: 'kunde@test.local', body_text: 'Text', draft_id: 'draft-geloescht' }), env);
  assert(res.status === 500, 'Fehler muss als Server-Fehler propagiert werden');
  assert(postRequests.length === vorherPost, 'es darf trotz Fehler KEIN Fallback-POST /drafts ausgeführt worden sein (keine stillschweigende Entwurfs-Duplizierung)');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
