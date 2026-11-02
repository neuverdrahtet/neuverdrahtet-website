// Testgate-Nachtrag zur P0-Sicherheitskorrektur (siehe cloudflare-worker-api/
// tests/test_api_security.mjs für das Referenzmuster): dieser Worker hatte
// bisher ein FAIL-OPEN Rate-Limiting ("unterSchwellenwert" ließ bei
// fehlendem/kaputtem RATE_LIMITER-Binding einfach alles durch) - jetzt
// FAIL-CLOSED ("pruefeRateLimit", 1:1 das Muster aus cloudflare-worker/
// worker.js). Deckt nur das Rate-Limit-Gate ab, nicht den gesamten
// Claude-Vision-Ablauf danach (dafür bräuchte es einen vollständigen
// Anthropic-API-Mock, der hier nicht Gegenstand der Korrektur ist).
//
// Ausführen: node cloudflare-worker-ki-check/tests/test_rate_limit.mjs
import worker from '../worker.js';

const ALLOWED_ORIGIN = 'https://neuverdrahtet.com';

function machRateLimiter(erlaubt) {
  return { limit: async () => ({ success: erlaubt }) };
}

function req({ origin = ALLOWED_ORIGIN, method = 'POST' } = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': '1.2.3.4' };
  return new Request('https://ki-check.test.example/', { method, headers });
}

const baseEnv = { ALLOWED_ORIGINS: ALLOWED_ORIGIN, RATE_LIMITER: machRateLimiter(true) };

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await pruefe('R1: fehlendes RATE_LIMITER-Binding -> FAIL-CLOSED 503, nicht fail-open durchgelassen', async () => {
  const env = { ...baseEnv, RATE_LIMITER: undefined };
  const res = await worker.fetch(req(), env);
  assert(res.status === 503, `erwartet 503 (fail-closed), war ${res.status}`);
});

await pruefe('R2: Rate-Limit überschritten -> 429, nicht an Claude Vision weitergereicht', async () => {
  const env = { ...baseEnv, RATE_LIMITER: machRateLimiter(false) };
  const res = await worker.fetch(req(), env);
  assert(res.status === 429, `erwartet 429, war ${res.status}`);
});

await pruefe('R3: Rate-Limiter erlaubt -> Gate passiert, Ablauf läuft weiter (scheitert danach am Body, nicht am Rate-Limit)', async () => {
  const res = await worker.fetch(req(), baseEnv);
  assert(res.status === 400, `erwartet 400 (ungültiger Body, also hinter dem Rate-Limit-Gate), war ${res.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
