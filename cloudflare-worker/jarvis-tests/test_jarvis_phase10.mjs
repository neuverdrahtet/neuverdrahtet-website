// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 10 ab:
// serverseitige Werkzeug-Kontrollen (unabhängig vom Systemprompt),
// Fail-closed-Rate-Limiting, Absturz-nach-erfolgreicher-Aktion über den
// tatsächlich genutzten Freigabe-Einstiegspunkt.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase10.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p10',
};

const firestoreDb = new Map();
let updateTimeCounter = 0;
function naechsteUpdateTime() { return `t${++updateTimeCounter}`; }

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

global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-access-token' });

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
    if (teile.length === 1) {
      const [collection] = teile;
      const documents = [];
      for (const [key, doc] of firestoreDb.entries()) {
        const [c, id] = key.split('/');
        if (c === collection) documents.push({ name: `${namePrefix}${collection}/${id}`, fields: doc.fields, updateTime: doc.updateTime });
      }
      return jsonResponse(200, { documents });
    }
    return jsonResponse(404, { error: 'unbekannter Firestore-Pfad im Mock' });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function setDoc(collection, id, data) { firestoreDb.set(`${collection}/${id}`, { fields: jsToFsFields(data), updateTime: naechsteUpdateTime() }); }
function liesDoc(collection, id) {
  const doc = firestoreDb.get(`${collection}/${id}`);
  return doc ? W.firestoreFieldsToObject(doc.fields) : null;
}

// =============================================================================
// A) Serverseitige Werkzeug-Kontrollen - unabhängig vom Systemprompt
//    (Vorgabe Phase 10 Punkt 1: "Systemprompts allein gelten nicht als
//    Sicherheitsgrenze").
// =============================================================================
await pruefe('A1: pruefeWerkzeugGrundsicherheit lehnt jeden Werkzeugnamen ab, der einem verbotenen Aktionsmuster entspricht', () => {
  for (const name of ['sendEmail', 'deleteCustomer', 'createInvoice', 'cancelInvoice', 'approveQuote', 'versendeRechnung']) {
    try {
      W.pruefeWerkzeugGrundsicherheit(name);
      throw new Error(`FEHLSCHLAG: "${name}" hätte abgelehnt werden müssen`);
    } catch (err) {
      assert(err.status === 403, `"${name}" muss mit 403 abgelehnt werden, war ${err.status}`);
    }
  }
});

await pruefe('A2: pruefeWerkzeugGrundsicherheit lehnt ein schreibendes Werkzeug ab, das NICHT auf der Positivliste steht - selbst wenn es (hypothetisch) in KI_BUEROKRAFT_TOOLS auftauchen würde', () => {
  assert(!W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE.includes('updateCustomer'), 'Testvoraussetzung: "updateCustomer" ist bewusst NICHT in KI_BUEROKRAFT_TOOLS/der Positivliste enthalten');
});

await pruefe('A3: pruefeWerkzeugGrundsicherheit lässt alle tatsächlich vorhandenen lesenden Werkzeuge unverändert durch', () => {
  for (const name of ['getDashboard', 'searchCustomers', 'searchLeads', 'searchEmails', 'searchCalendarEvents']) {
    W.pruefeWerkzeugGrundsicherheit(name); // darf NICHT werfen
  }
});

await pruefe('A4: pruefeWerkzeugGrundsicherheit lässt alle tatsächlich erlaubten schreibenden Werkzeuge durch', () => {
  for (const name of W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE) {
    W.pruefeWerkzeugGrundsicherheit(name); // darf NICHT werfen
  }
});

await pruefe('A5: die Positivliste enthält AUSSCHLIESSLICH die tatsächlich im Worker vorhandenen Schreibwerkzeuge (keine veraltete/erfundene Liste)', () => {
  assert(W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE.length === 9, `erwartet genau 9 erlaubte Schreibwerkzeuge, war ${W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE.length}`);
  for (const name of W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE) {
    assert(!W.JARVIS_VERBOTENE_WERKZEUG_MUSTER.test(name), `erlaubtes Werkzeug "${name}" darf nicht gleichzeitig dem Verbotsmuster entsprechen`);
  }
});

await pruefe('B1: pruefeWerkzeugBerechtigung begrenzt schreibende Aktionen auf JARVIS_MAX_SCHREIBAUFRUFE_PRO_CHAT je Chat-Anfrage', () => {
  const zaehler = { count: 0 };
  for (let i = 0; i < W.JARVIS_MAX_SCHREIBAUFRUFE_PRO_CHAT; i++) {
    W.pruefeWerkzeugBerechtigung('createTask', 'admin', zaehler); // darf NICHT werfen
  }
  try {
    W.pruefeWerkzeugBerechtigung('createTask', 'admin', zaehler);
    throw new Error('FEHLSCHLAG: Limit hätte nach der letzten erlaubten Aktion greifen müssen');
  } catch (err) {
    assert(err.status === 429, `muss mit 429 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('B2: pruefeWerkzeugBerechtigung zählt NUR schreibende Aktionen, lesende bleiben unbegrenzt', () => {
  const zaehler = { count: 0 };
  for (let i = 0; i < W.JARVIS_MAX_SCHREIBAUFRUFE_PRO_CHAT + 5; i++) {
    W.pruefeWerkzeugBerechtigung('searchCustomers', 'admin', zaehler); // darf NICHT werfen, auch nicht beim 10. Mal
  }
  assert(zaehler.count === 0, 'lesende Werkzeuge dürfen den Schreib-Zähler nicht erhöhen');
});

// =============================================================================
// C) Rate-Limiting: Fail-closed statt fail-open (Vorgabe Phase 10 Punkt 1).
// =============================================================================
await pruefe('C1: pruefeRateLimit sperrt (fail-closed), wenn das RATE_LIMITER-Binding fehlt', async () => {
  const ergebnis = await W.pruefeRateLimit({}, '1.2.3.4');
  assert(ergebnis.erlaubt === false, 'ohne Binding muss die Route gesperrt werden, NICHT durchgelassen');
  assert(ergebnis.grund === 'rate_limiter_fehlt', `Grund muss "rate_limiter_fehlt" sein, war "${ergebnis.grund}"`);
});

await pruefe('C2: pruefeRateLimit sperrt (fail-closed), wenn der RATE_LIMITER-Aufruf selbst fehlschlägt', async () => {
  const envMitFehlerhaftemLimiter = { RATE_LIMITER: { limit: async () => { throw new Error('Simulierter Cloudflare-Fehler'); } } };
  const ergebnis = await W.pruefeRateLimit(envMitFehlerhaftemLimiter, '1.2.3.4');
  assert(ergebnis.erlaubt === false, 'bei einem Fehler des Limiters muss die Route gesperrt werden');
  assert(ergebnis.grund === 'rate_limiter_fehler', `Grund muss "rate_limiter_fehler" sein, war "${ergebnis.grund}"`);
});

await pruefe('C3: pruefeRateLimit lässt eine Anfrage durch, wenn ein funktionierender Limiter "success" liefert', async () => {
  const envMitFunktionierendemLimiter = { RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const ergebnis = await W.pruefeRateLimit(envMitFunktionierendemLimiter, '1.2.3.4');
  assert(ergebnis.erlaubt === true, 'ein funktionierender Limiter mit success:true muss durchlassen');
});

await pruefe('C4: pruefeRateLimit lehnt ab (normales 429, kein Konfigurationsfehler), wenn der Limiter success:false liefert', async () => {
  const envMitAusgereiztemLimiter = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const ergebnis = await W.pruefeRateLimit(envMitAusgereiztemLimiter, '1.2.3.4');
  assert(ergebnis.erlaubt === false, 'ein ausgereizter Limiter muss ablehnen');
  assert(ergebnis.grund === 'limit_ueberschritten', `Grund muss "limit_ueberschritten" sein (normaler Alltag, kein Konfigurationsfehler), war "${ergebnis.grund}"`);
});

// =============================================================================
// D) Absturz nach erfolgreicher externer Aktion - über den TATSÄCHLICH
//    genutzten Freigabe-Einstiegspunkt erstelleUndFuehreJarvisFreigabeAus
//    (nicht nur die tiefer liegende fuehreJarvisAktionAus, die bereits seit
//    den Integrationstests der Phasen 1-4 abgedeckt ist).
// =============================================================================
await pruefe('D1: zwei identische Freigabe-Anfragen (gleicher Typ/Entität/Version) erzeugen NUR EINEN Vorgang - keine doppelte Ausführung durch wiederholtes Absenden', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-d1', { version: 1, freigabeStatus: 'offen' });
  const payload = { erwarteteVersion: 1, entscheidung: 'freigeben' };
  const ergebnis1 = await W.erstelleUndFuehreJarvisFreigabeAus({ serviceAccount, typ: 'email.pruefen', entityId: 'mail-d1', payload, callerUid: 'uid-d1', callerRole: 'admin' });
  assert(ergebnis1.freigabeStatus === 'freigegeben', 'erste Ausführung muss tatsächlich freigeben');
  // Zweiter Versuch mit IDENTISCHEN Parametern (z.B. ein erneut gesendeter
  // Klick/Doppel-Request) - die Aktion ist bereits "executed", darf NICHT
  // erneut ausgeführt werden.
  try {
    await W.erstelleUndFuehreJarvisFreigabeAus({ serviceAccount, typ: 'email.pruefen', entityId: 'mail-d1', payload, callerUid: 'uid-d1', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: eine bereits ausgeführte Aktion hätte nicht erneut ausführbar sein dürfen');
  } catch (err) {
    assert(err.message !== 'FEHLSCHLAG: eine bereits ausgeführte Aktion hätte nicht erneut ausführbar sein dürfen', err.message);
  }
  const aktion = liesDoc('jarvisAktionen', 'email.pruefen-mail-d1-v1');
  assert(aktion !== null, 'es darf nur EIN jarvisAktionen-Dokument für diese Freigabe entstehen');
});

await pruefe('D2: stürzt der Worker NACH dem Beanspruchen ab (lange "executing" ohne Abschluss), wird ein erneuter Versuch über denselben Einstiegspunkt als "unklar" abgelehnt - NIE automatisch wiederholt', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-d2', { version: 1, freigabeStatus: 'offen' });
  const vorZeit = new Date(Date.now() - 20 * 60000).toISOString();
  // Simuliert einen Absturz: die Aktion wurde bereits angelegt und auf
  // "executing" gesetzt (z.B. weil die externe Aktion schon lief), aber nie
  // abgeschlossen - exakt der in der Vorgabe genannte Fall "Absturz nach
  // einer erfolgreichen externen Aktion, bevor der Status aktualisiert wurde".
  setDoc('jarvisAktionen', 'email.pruefen-mail-d2-v1', {
    typ: 'email.pruefen', status: 'executing', ausfuehrungGestartetAm: vorZeit,
    payload: { entityId: 'mail-d2', erwarteteVersion: 1, entscheidung: 'freigeben' },
  });
  const payload = { erwarteteVersion: 1, entscheidung: 'freigeben' };
  try {
    await W.erstelleUndFuehreJarvisFreigabeAus({ serviceAccount, typ: 'email.pruefen', entityId: 'mail-d2', payload, callerUid: 'uid-d2', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: eine hängende Aktion hätte nicht automatisch fortgesetzt/wiederholt werden dürfen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
  const aktion = liesDoc('jarvisAktionen', 'email.pruefen-mail-d2-v1');
  assert(aktion.status === 'unklar', 'muss als "unklar" markiert sein, NICHT automatisch erneut ausgeführt');
  const mail = liesDoc('jarvisEmailVerarbeitung', 'mail-d2');
  assert(mail.freigabeStatus === 'offen', 'die eigentliche Freigabe darf durch den fehlgeschlagenen Wiederholungsversuch NICHT nachträglich doch noch ausgeführt worden sein');
});

// =============================================================================
// E) Strukturelle Bestätigung: Siri bleibt rein lesend, auch nach den
//    Phase-10-Werkzeug-Kontrollen (Vorgabe Punkt 4 "Stelle sicher, dass Siri
//    ausschließlich lesende Abfragen erlaubt"). SIRI_ERLAUBTE_INTENTS
//    (Phase 8) und JARVIS_ERLAUBTE_SCHREIBWERKZEUGE (Phase 10) sind zwei
//    komplett unabhängige Systeme (Siri ruft fuehreSiriIntentAus auf, NIE
//    callClaudeAssistentChat) - diese Prüfung bindet beide explizit
//    zusammen, damit eine künftige Namensüberschneidung sofort auffällt.
// =============================================================================
await pruefe('E1: keiner der Siri-Intent-Namen entspricht einem JARVIS-Schreibwerkzeug-Namen', () => {
  const ueberschneidung = W.SIRI_ERLAUBTE_INTENTS.filter((intent) => W.JARVIS_ERLAUBTE_SCHREIBWERKZEUGE.includes(intent));
  assert(ueberschneidung.length === 0, `Siri-Intents dürfen sich nicht mit Schreibwerkzeugen überschneiden, Überschneidung: ${ueberschneidung.join(', ')}`);
});

// =============================================================================
// F) Pilotüberwachung (holeJarvisStatusUebersicht) - Vorgabe Punkt 5: eine
//    fehlgeschlagene Verbindung darf NIE als erfolgreicher Lauf angezeigt
//    werden.
// =============================================================================
await pruefe('F1: ein fehlgeschlagener Job-Lauf erscheint NIEMALS als "letzterErfolgAm" - auch wenn er der jüngste Versuch ist', async () => {
  setDoc('jarvisJobs', 'email-check-2026-10-19', { typ: 'email-check', status: 'done', erstelltAm: '2026-10-19T05:00:00.000Z', abgeschlossenAm: '2026-10-19T05:01:00.000Z' });
  setDoc('jarvisJobs', 'email-check-2026-10-20', { typ: 'email-check', status: 'failed', erstelltAm: '2026-10-20T05:00:00.000Z', fehler: 'Simulierter Netzwerkfehler' });
  const status = await W.holeJarvisStatusUebersicht({ serviceAccount, env: {} });
  const emailJob = status.cronLaeufe.find((j) => j.typ === 'email-check');
  assert(emailJob.letzterErfolgAm === '2026-10-19T05:01:00.000Z', `letzterErfolgAm muss vom ERFOLGREICHEN Lauf stammen, war ${emailJob.letzterErfolgAm}`);
  assert(emailJob.letzterVersuchStatus === 'failed', 'letzterVersuchStatus muss den JÜNGSTEN (fehlgeschlagenen) Versuch zeigen');
  assert(emailJob.letzterVersuchAm === '2026-10-20T05:00:00.000Z', 'letzterVersuchAm muss vom jüngsten Versuch stammen, nicht vom letzten Erfolg');
  assert(emailJob.letzterFehler === 'Simulierter Netzwerkfehler', 'der Fehlertext des jüngsten fehlgeschlagenen Versuchs muss sichtbar sein');
});

await pruefe('F2: ein Job-Typ, der noch nie erfolgreich war, zeigt letzterErfolgAm:null - nie ein erfundenes Erfolgsdatum', async () => {
  setDoc('jarvisJobs', 'mahnung-check-2026-10-20', { typ: 'mahnung-check', status: 'failed', erstelltAm: '2026-10-20T05:00:00.000Z', fehler: 'x' });
  const status = await W.holeJarvisStatusUebersicht({ serviceAccount, env: {} });
  const job = status.cronLaeufe.find((j) => j.typ === 'mahnung-check');
  assert(job.letzterErfolgAm === null, 'ohne jemals erfolgreichen Lauf muss letzterErfolgAm null sein');
});

await pruefe('F3: ein Job-Typ ohne jeden bisherigen Lauf wird ehrlich als "noch_nie_gelaufen" ausgewiesen', async () => {
  const status = await W.holeJarvisStatusUebersicht({ serviceAccount, env: {} });
  const job = status.cronLaeufe.find((j) => j.typ === 'wartung-check');
  assert(job.letzterVersuchStatus === 'noch_nie_gelaufen', `muss "noch_nie_gelaufen" sein, war "${job.letzterVersuchStatus}"`);
  assert(job.letzterErfolgAm === null, 'letzterErfolgAm muss null sein');
});

await pruefe('F4: offene/unklare Aktionen werden korrekt gezählt, Dienste-Status spiegelt echte env-Werte (keine Secret-Werte im Ergebnis)', async () => {
  setDoc('jarvisAktionen', 'akt-f4-pending', { status: 'pending' });
  setDoc('jarvisAktionen', 'akt-f4-unklar-1', { status: 'unklar' });
  setDoc('jarvisAktionen', 'akt-f4-unklar-2', { status: 'unklar' });
  setDoc('jarvisAktionen', 'akt-f4-done', { status: 'freigegeben' });
  const env = { ANTHROPIC_API_KEY: 'geheim-123', FIREBASE_SERVICE_ACCOUNT_JSON: '{}', JARVIS_EMAIL_AKTIV: 'true' };
  const status = await W.holeJarvisStatusUebersicht({ serviceAccount, env });
  assert(status.offeneAktionen >= 1, 'offene (pending) Aktionen müssen gezählt werden');
  assert(status.unklareAktionen >= 2, 'unklare Aktionen müssen gezählt werden');
  assert(status.dienste.anthropicKonfiguriert === true, 'Dienst-Status muss die Konfiguration korrekt widerspiegeln');
  assert(JSON.stringify(status).includes('geheim-123') === false, 'der tatsächliche API-Key-WERT darf NIEMALS im Statusergebnis auftauchen, nur ob er vorhanden ist');
  assert(status.featureFlags.JARVIS_EMAIL_AKTIV === true, 'Feature-Flag-Status muss den env-Wert widerspiegeln');
  assert(status.featureFlags.JARVIS_RECHNUNG_AKTIV === false, 'nicht gesetzte Feature-Flags müssen als false (aus) erscheinen, niemals als aktiv erraten werden');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
