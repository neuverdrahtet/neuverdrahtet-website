// Testgate-Nachtrag zur P0-Sicherheitskorrektur (siehe cloudflare-worker-api/
// tests/test_api_security.mjs für das Referenzmuster): dieser Worker hatte
// bisher ein FAIL-OPEN Rate-Limiting ("unterSchwellenwert" ließ bei
// fehlendem/kaputtem RATE_LIMITER-Binding einfach alles durch) - jetzt
// FAIL-CLOSED ("pruefeRateLimit", 1:1 das Muster aus cloudflare-worker/
// worker.js). Dieser Worker antwortet Meta IMMER mit 200 (Webhook-
// Konvention, siehe Kopfkommentar des Workers), auch wenn der Rate-Limiter
// blockiert - der Unterschied zeigt sich deshalb nicht im HTTP-Status,
// sondern darin, ob die eigentliche Verarbeitung (hier: der
// Google-OAuth-Aufruf als erster Schritt von verarbeiteEingehendeNachricht)
// überhaupt ausgelöst wird.
//
// Ausführen: node cloudflare-worker-ki-assistent-whatsapp/tests/test_rate_limit.mjs
import crypto from 'node:crypto';
import worker from '../worker.js';

const META_APP_SECRET = 'test-app-secret';
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'whatsapp-test',
};

function machRateLimiter(erlaubt) {
  return { limit: async () => ({ success: erlaubt }) };
}

function signiere(rawBody) {
  const mac = crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex');
  return `sha256=${mac}`;
}

function webhookPayload(von = '4915888620339', text = 'Hallo') {
  return JSON.stringify({
    entry: [{ changes: [{ value: {
      messages: [{ from: von, type: 'text', text: { body: text } }],
      contacts: [{ profile: { name: 'Test Kunde' } }],
    } }] }],
  });
}

function req(rawBody) {
  return new Request('https://ki-assistent-whatsapp.test.example/', {
    method: 'POST',
    headers: { 'X-Hub-Signature-256': signiere(rawBody) },
    body: rawBody,
  });
}

function machCtx() {
  let promise = Promise.resolve();
  return { ctx: { waitUntil: (p) => { promise = p; } }, abwarten: () => promise };
}

const baseEnv = {
  META_APP_SECRET,
  RATE_LIMITER: machRateLimiter(true),
  ANTHROPIC_API_KEY: 'x', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  META_ACCESS_TOKEN: 'x', META_PHONE_NUMBER_ID: 'x',
};

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await pruefe('R1: fehlendes RATE_LIMITER-Binding -> FAIL-CLOSED, Verarbeitung (OAuth-Aufruf) wird NICHT ausgelöst', async () => {
  let oauthAufgerufen = false;
  global.fetch = async (url) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href === 'https://oauth2.googleapis.com/token') oauthAufgerufen = true;
    return { ok: true, status: 200, json: async () => ({ access_token: 'x' }), text: async () => '{}' };
  };
  const env = { ...baseEnv, RATE_LIMITER: undefined };
  const rawBody = webhookPayload();
  const { ctx, abwarten } = machCtx();
  const res = await worker.fetch(req(rawBody), env, ctx);
  await abwarten();
  assert(res.status === 200, `Webhook-Konvention: immer 200, war ${res.status}`);
  assert(oauthAufgerufen === false, 'FAIL-CLOSED verletzt: Verarbeitung lief trotz fehlendem RATE_LIMITER-Binding an');
});

await pruefe('R2: Rate-Limit überschritten -> Verarbeitung wird NICHT ausgelöst', async () => {
  let oauthAufgerufen = false;
  global.fetch = async (url) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href === 'https://oauth2.googleapis.com/token') oauthAufgerufen = true;
    return { ok: true, status: 200, json: async () => ({ access_token: 'x' }), text: async () => '{}' };
  };
  const env = { ...baseEnv, RATE_LIMITER: machRateLimiter(false) };
  const rawBody = webhookPayload();
  const { ctx, abwarten } = machCtx();
  const res = await worker.fetch(req(rawBody), env, ctx);
  await abwarten();
  assert(res.status === 200, `Webhook-Konvention: immer 200, war ${res.status}`);
  assert(oauthAufgerufen === false, 'Rate-Limit überschritten, aber Verarbeitung lief trotzdem an');
});

await pruefe('R3: Rate-Limiter erlaubt -> Verarbeitung WIRD ausgelöst (Gate passiert)', async () => {
  let oauthAufgerufen = false;
  global.fetch = async (url) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href === 'https://oauth2.googleapis.com/token') { oauthAufgerufen = true; return { ok: true, status: 200, json: async () => ({ access_token: 'x' }), text: async () => '{}' }; }
    return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
  };
  const rawBody = webhookPayload();
  const { ctx, abwarten } = machCtx();
  const res = await worker.fetch(req(rawBody), baseEnv, ctx);
  await abwarten();
  assert(res.status === 200);
  assert(oauthAufgerufen === true, 'Rate-Limiter erlaubte die Anfrage, aber Verarbeitung lief nicht an (Gate blockiert fälschlich)');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
