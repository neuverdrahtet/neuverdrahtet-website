// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export UND default-Export
// "fetch"-Handler) - deckt Phase 10.1 ab: Begrenzung der autonomen
// Schreibrechte des täglichen Büro-Checks (runTagescheck) inkl. Prompt-
// Injection-/Rechteüberschreitungs-/Wiederholungsschutz (Abschnitte G/H/I),
// UND den vereinheitlichten /siri-abfrage-API-Vertrag gegen die ECHTE
// HTTP-Route (Abschnitt J), nicht nur gegen die tiefer liegende Funktion
// fuehreSiriAbfrageAus (die war schon in test_jarvis_phase8.mjs abgedeckt).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase10_1.mjs
import crypto from 'node:crypto';
import worker, { __test__ as W } from '../worker.js';

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

// --- Firestore-REST-Mock (In-Memory), nur für Abschnitt J (echte HTTP-Route)
// gebraucht - GET einzelnes Dokument + PATCH mit updateMask (firestoreGetDoc/
// firestoreMergeFelder), exakt wie in test_jarvis_phase8/phase10.mjs. ---
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p10-1',
};
const firestoreDb = new Map();
function jsToFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(jsToFsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: jsToFsFields(v) } };
  return { stringValue: String(v) };
}
function jsToFsFields(obj) {
  const out = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = jsToFsValue(val);
  return out;
}
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, jsToFsFields(data)); }

const BASIS_FETCH_MOCK = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';
  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-access-token' });
  if (u.hostname === 'firestore.googleapis.com') {
    const namePrefix = `projects/${serviceAccount.project_id}/databases/(default)/documents/`;
    const pathPrefix = `/v1/${namePrefix}`;
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (teile.length === 1) {
      // Collection-Listing (firestoreListDocuments) - z.B. GET .../angebote
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
      const maskFields = u.searchParams.getAll('updateMask.fieldPaths');
      const body = JSON.parse(init.body);
      const vorhanden = firestoreDb.get(key) || {};
      const neu = { ...vorhanden };
      const feldListe = maskFields.length > 0 ? maskFields : Object.keys(body.fields);
      for (const f of feldListe) neu[f] = body.fields[f];
      firestoreDb.set(key, neu);
      return jsonResponse(200, {});
    }
    const fields = firestoreDb.get(key);
    if (!fields) return jsonResponse(404, { error: { status: 'NOT_FOUND' } });
    return jsonResponse(200, { name: `${namePrefix}${key}`, fields });
  }
  throw new Error(`Unerwarteter fetch() im Basis-Mock: ${method} ${u.href}`);
};
global.fetch = BASIS_FETCH_MOCK;

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// G) pruefeTagescheckWerkzeugErlaubt - eigene, sehr kleine Positivliste für
//    den autonomen täglichen Büro-Check (Rechteüberschreitung).
// =============================================================================

await pruefe('G1: pruefeTagescheckWerkzeugErlaubt erlaubt AUSSCHLIESSLICH createTask - jedes andere Schreibwerkzeug wird abgelehnt (Rechteüberschreitung)', () => {
  for (const name of ['bulkFixReceipts', 'updateExpense', 'createQuoteDraft', 'createAppointment', 'createCustomer', 'updateLead', 'updateTask']) {
    assert(W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE.includes(name), `Testvoraussetzung: "${name}" muss auf der großen JARVIS-Positivliste stehen (sonst testet dieser Fall nichts)`);
    try {
      W.pruefeTagescheckWerkzeugErlaubt(name, null, { count: 0 });
      throw new Error(`FEHLSCHLAG: "${name}" hätte dem Tagescheck verweigert werden müssen`);
    } catch (err) {
      assert(err.status === 403, `"${name}" muss mit 403 abgelehnt werden, war ${err.status}`);
    }
  }
  W.pruefeTagescheckWerkzeugErlaubt('createTask', null, { count: 0 }); // darf NICHT werfen
});

await pruefe('G2: pruefeTagescheckWerkzeugErlaubt lässt alle lesenden Werkzeuge unbegrenzt durch', () => {
  const zaehler = { count: 0 };
  for (let i = 0; i < 50; i++) W.pruefeTagescheckWerkzeugErlaubt('searchLeads', null, zaehler);
  assert(zaehler.count === 0, 'lesende Werkzeuge dürfen den Schreib-Zähler nicht erhöhen');
});

await pruefe('G3: pruefeTagescheckWerkzeugErlaubt begrenzt createTask auf JARVIS_TAGESCHECK_MAX_SCHREIBAUFRUFE_PRO_LAUF je Lauf (wiederholte Schreibaktionen)', () => {
  const zaehler = { count: 0 };
  for (let i = 0; i < W.JARVIS_TAGESCHECK_MAX_SCHREIBAUFRUFE_PRO_LAUF; i++) {
    W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler); // darf NICHT werfen
  }
  try {
    W.pruefeTagescheckWerkzeugErlaubt('createTask', null, zaehler);
    throw new Error('FEHLSCHLAG: Limit hätte nach der letzten erlaubten Aktion greifen müssen');
  } catch (err) {
    assert(err.status === 429, `muss mit 429 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('G4: die Tagescheck-Positivliste ist eine ECHTE Teilmenge der großen JARVIS-Positivliste (keine zusätzlichen/erfundenen Werkzeuge)', () => {
  for (const name of W.JARVIS_TAGESCHECK_ERLAUBTE_SCHREIBWERKZEUGE) {
    assert(W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE.includes(name), `"${name}" steht in der Tagescheck-Liste, aber nicht in der großen JARVIS-Positivliste`);
  }
  assert(W.JARVIS_TAGESCHECK_ERLAUBTE_SCHREIBWERKZEUGE.length === 1 && W.JARVIS_TAGESCHECK_ERLAUBTE_SCHREIBWERKZEUGE[0] === 'createTask', 'der Tagescheck darf nach der Korrektur ausschließlich createTask nutzen');
});

// =============================================================================
// H) Vollständige Dispatch-Schleife (callClaudeAssistentChat) mit simuliertem
//    Modellverhalten, wie es durch Prompt-Injection ausgelöst werden könnte -
//    z.B. weil eine Lead-Nachricht, eine E-Mail oder ein per KI ausgelesenes
//    Beleg-Foto eine "Anweisung" enthält, die das Modell veranlasst, ein
//    verbotenes Schreibwerkzeug aufzurufen.
// =============================================================================

/** Simuliert eine Anthropic-Antwort mit GENAU einem tool_use-Block, danach eine finale Textantwort. */
function mitSimuliertemToolAufruf(toolName, toolInput, fn) {
  const ORIG = global.fetch;
  const kiBuerokraftAufrufe = [];
  let runde = 0;
  global.fetch = async (url, init = {}) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    if (u.href === 'https://api.anthropic.com/v1/messages') {
      runde++;
      if (runde === 1) {
        return jsonResponse(200, {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'call-1', name: toolName, input: toolInput }],
          usage: { input_tokens: 10, output_tokens: 10 },
        });
      }
      return jsonResponse(200, {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Fertig.' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    }
    if (u.href.startsWith('https://fake-kibuerokraft.test')) {
      kiBuerokraftAufrufe.push({ method: init.method, path: u.pathname });
      return jsonResponse(200, { processed: 1, updated: [], needs_manual_review: [], remaining_incomplete: 0, has_more: false, id: 'task-xyz' });
    }
    return ORIG(url, init);
  };
  return fn(kiBuerokraftAufrufe).finally(() => { global.fetch = ORIG; });
}

await pruefe('H1: ein durch (simulierte) Prompt-Injection ausgelöster bulkFixReceipts-Aufruf im Tagescheck-Kontext wird abgelehnt UND die externe KI-Bürokraft-API NIE wirklich aufgerufen (kein stiller Side-Effect)', async () => {
  await mitSimuliertemToolAufruf('bulkFixReceipts', { limit: 25 }, async (kiBuerokraftAufrufe) => {
    const ergebnis = await W.callClaudeAssistentChat({
      apiKey: 'fake', model: 'fake-model',
      messages: [{ role: 'user', content: 'Führe den täglichen Büro-Check durch.' }],
      kiBuerokraftUrl: 'https://fake-kibuerokraft.test', kiBuerokraftApiKey: 'fake-key',
      googleConfig: null,
      pruefeWerkzeug: W.pruefeTagescheckWerkzeugErlaubt,
    });
    assert(/debugLog/.test(JSON.stringify(Object.keys(ergebnis))) || Array.isArray(ergebnis.debugLog), 'Antwort muss ein debugLog enthalten');
    const fehlerEintrag = ergebnis.debugLog.find((e) => e.tool === 'bulkFixReceipts');
    assert(fehlerEintrag, 'bulkFixReceipts muss im debugLog als abgelehnter Aufruf auftauchen');
    assert(/[Nn]icht erlaubt|Berechtigung verweigert/.test(fehlerEintrag.error || ''), `Ablehnungsgrund muss erkennbar sein, war: ${fehlerEintrag.error}`);
    assert(kiBuerokraftAufrufe.length === 0, 'die externe KI-Bürokraft-API (und damit der echte Schreibzugriff auf Belege) darf NIEMALS erreicht werden, wenn das Werkzeug schon serverseitig abgelehnt wurde');
  });
});

await pruefe('H2: dieselbe simulierte Modellantwort mit createTask statt bulkFixReceipts wird im Tagescheck-Kontext regulär ausgeführt (kein Fehlalarm, die Sperre ist zielgerichtet)', async () => {
  await mitSimuliertemToolAufruf('createTask', { title: 'Test' }, async (kiBuerokraftAufrufe) => {
    const ergebnis = await W.callClaudeAssistentChat({
      apiKey: 'fake', model: 'fake-model',
      messages: [{ role: 'user', content: 'Führe den täglichen Büro-Check durch.' }],
      kiBuerokraftUrl: 'https://fake-kibuerokraft.test', kiBuerokraftApiKey: 'fake-key',
      googleConfig: null,
      pruefeWerkzeug: W.pruefeTagescheckWerkzeugErlaubt,
    });
    const fehlerEintrag = ergebnis.debugLog.find((e) => e.tool === 'createTask' && e.error);
    assert(!fehlerEintrag, `createTask darf im Tagescheck-Kontext nicht abgelehnt werden, Fehler war: ${fehlerEintrag && fehlerEintrag.error}`);
    assert(kiBuerokraftAufrufe.length === 1, 'createTask muss (als einziges erlaubtes Schreibwerkzeug) tatsächlich bei der externen API ankommen');
  });
});

await pruefe('H3: OHNE pruefeWerkzeug (z.B. ein künftiger, versehentlich ungeprüfter Aufrufer) greift IMMER NOCH die werkzeugunabhängige Grundsicherung - bulkFixReceipts bleibt erlaubt (Positivliste), ein frei erfundenes Werkzeug aber nicht', async () => {
  await mitSimuliertemToolAufruf('sendEmailAnKunden', {}, async (kiBuerokraftAufrufe) => {
    const ergebnis = await W.callClaudeAssistentChat({
      apiKey: 'fake', model: 'fake-model',
      messages: [{ role: 'user', content: 'x' }],
      kiBuerokraftUrl: 'https://fake-kibuerokraft.test', kiBuerokraftApiKey: 'fake-key',
      googleConfig: null,
      // kein pruefeWerkzeug übergeben
    });
    const fehlerEintrag = ergebnis.debugLog.find((e) => e.tool === 'sendEmailAnKunden');
    assert(fehlerEintrag, 'ein unbekanntes/verbotenes Werkzeugmuster muss auch ohne rollenspezifische Prüfung abgelehnt werden');
    assert(kiBuerokraftAufrufe.length === 0, 'die Grundsicherung muss den externen Aufruf verhindern, auch ohne pruefeWerkzeug');
  });
});

// =============================================================================
// I) Prompt-Text-Konsistenz: der Tagescheck-Auftragstext darf keine
//    autonome Beleg-Korrektur mehr nahelegen, nachdem der Code sie verweigert
//    (sonst widersprechen sich Prompt und serverseitige Sperre, und das
//    Modell "versucht" ständig sinnlos einen abgelehnten Aufruf).
// =============================================================================

await pruefe('I1: buildTagescheckPrompt weist Belege nur noch als Aufgabe zur manuellen/chat-basierten Klärung aus, nicht mehr als automatisch per bulkFixReceipts zu erledigen', () => {
  const text = W.buildTagescheckPrompt('2026-01-01', { googleVerfuegbar: false });
  assert(/NICHT selbst per bulkFixReceipts/.test(text), 'der Prompt muss dem Modell explizit verbieten, bulkFixReceipts autonom aufzurufen');
  assert(!/räume den Rückstand per bulkFixReceipts/.test(text), 'die alte, autonome Formulierung darf nicht mehr vorkommen');
});

// =============================================================================
// J) Siri-API-Vertrag: Test gegen die ECHTE HTTP-Route (worker.fetch),
//    nicht nur gegen fuehreSiriAbfrageAus - deckt Rate-Limiting, JSON-
//    Parsing, Header-Handling und das tatsächliche Response-Envelope ab, wie
//    es ein echter iOS-Kurzbefehl sieht. Vereinheitlichter Vertrag:
//      POST /siri-abfrage
//      Header: Authorization: Bearer <Gerätetoken>
//      Body (JSON): {"intent": "taetigkeiten-morgen" | "angebote-offen" | "freigaben-offen"}
//      Erfolg (200): {"ok": true, "sprachantwort": "...", "daten": {...}}
//      Fehler: {"error": "..."} mit Status 400/401/403/429/500/503
// =============================================================================

function machtEnv(zusatz = {}) {
  return {
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...zusatz,
  };
}
function siriRequest({ token, body, headers } = {}) {
  return new Request('https://worker.test.example/siri-abfrage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? JSON.stringify({ intent: 'angebote-offen' }) : body,
  });
}

const GUELTIGES_TOKEN = 'echtes-gueltiges-test-geraetetoken-123456';
await (async () => {
  const hash = await W.sha256Hex(GUELTIGES_TOKEN);
  setDoc('siriGeraeteTokens', hash, {
    label: 'Test-iPhone', erlaubteIntents: ['angebote-offen', 'freigaben-offen'],
    erstelltAm: new Date().toISOString(), ablaufAm: '2099-01-01', widerrufenAm: null, letzteNutzungAm: null,
  });
})();
setDoc('angebote', 'a1', { status: 'entwurf' });

await pruefe('J1: korrekte Anfrage (gültiger Header, erlaubter Intent) liefert 200 mit dem dokumentierten Envelope {ok, sprachantwort, daten}', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN, body: JSON.stringify({ intent: 'angebote-offen' }) }), machtEnv());
  assert(res.status === 200, `erwartet 200, war ${res.status}`);
  const data = await res.json();
  assert(data.ok === true, 'Antwort muss ok:true enthalten');
  assert(typeof data.sprachantwort === 'string' && data.sprachantwort.length > 0, 'Antwort muss ein vorlesbares sprachantwort-Feld enthalten');
  assert(typeof data.daten === 'object', 'Antwort muss ein daten-Feld enthalten');
});

await pruefe('J2: fehlender Authorization-Header liefert 401 - Fehlertext enthält kein Token (nichts zu leaken)', async () => {
  const res = await worker.fetch(siriRequest({ token: undefined }), machtEnv());
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
  const data = await res.json();
  assert(!JSON.stringify(data).includes(GUELTIGES_TOKEN), 'Fehlermeldung darf kein Token enthalten');
});

await pruefe('J3: unbekannter Intent liefert 400', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN, body: JSON.stringify({ intent: 'loesche-alles' }) }), machtEnv());
  assert(res.status === 400, `erwartet 400, war ${res.status}`);
});

await pruefe('J4: falsches/erfundenes Token liefert 401, nicht 404/500 (keine Unterscheidung nach Existenz)', async () => {
  const res = await worker.fetch(siriRequest({ token: 'komplett-erfundenes-token-xyz-000000' }), machtEnv());
  assert(res.status === 401, `erwartet 401, war ${res.status}`);
});

await pruefe('J5: Intent, der für dieses Gerätetoken nicht freigegeben ist, liefert 403', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN, body: JSON.stringify({ intent: 'taetigkeiten-morgen' }) }), machtEnv());
  assert(res.status === 403, `erwartet 403, war ${res.status} (erlaubteIntents dieses Testtokens enthält "taetigkeiten-morgen" nicht)`);
});

await pruefe('J6: fehlendes RATE_LIMITER-Binding sperrt die Route fail-closed mit 503 (nicht fail-open)', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN }), machtEnv({ RATE_LIMITER: undefined }));
  assert(res.status === 503, `erwartet 503 (Fail-closed), war ${res.status}`);
});

await pruefe('J7: ungültiger JSON-Body liefert 400, kein 500/Absturz', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN, body: '{kaputtes json' }), machtEnv());
  assert(res.status === 400, `erwartet 400, war ${res.status}`);
});

await pruefe('J8: FIREBASE_SERVICE_ACCOUNT_JSON fehlt -> 500 mit generischer, nicht-technischer Meldung', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN }), machtEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: undefined }));
  assert(res.status === 500, `erwartet 500, war ${res.status}`);
});

await pruefe('J9: Erfolgs-Envelope nutzt GENAU die im UI/Kurzbefehl dokumentierten Feldnamen (ok/sprachantwort/daten), keine abweichenden Namen wie "reply"/"geraetetoken"/"frage"', async () => {
  const res = await worker.fetch(siriRequest({ token: GUELTIGES_TOKEN, body: JSON.stringify({ intent: 'angebote-offen' }) }), machtEnv());
  const data = await res.json();
  assert(!('reply' in data) && !('geraetetoken' in data) && !('frage' in data), 'Envelope darf keine Felder aus einem anderen (z.B. Chat-)Vertrag mischen');
  assert('ok' in data && 'sprachantwort' in data && 'daten' in data, 'Envelope muss genau ok/sprachantwort/daten enthalten');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
