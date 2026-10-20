// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, kein Kopieren/Abtippen von
// Funktionen in eine separate Testdatei - siehe __test__-Export am Ende von
// worker.js). Mockt nur die "Ränder" (fetch zu Firestore/Google/Anthropic/
// Google-Büro/KI-Bürokraft) über ein In-Memory-Firestore + einen Fetch-
// Router, nicht die JARVIS-Geschäftslogik selbst.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase3.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

// --- Selbst erzeugtes RSA-Schlüsselpaar für den (im echten Code genutzten)
// Google-Service-Account-JWT-Signiervorgang (getGoogleAccessToken) - die
// Signatur wird in diesem Mock nie geprüft, aber crypto.subtle.importKey
// braucht einen strukturell echten PKCS8-Schlüssel, kein Fake-String. ---
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const serviceAccount = { client_email: 'test@test.iam.gserviceaccount.com', private_key: privateKey, project_id: 'jarvis-test' };

// --- In-Memory-Firestore (Schlüssel "collection/id" -> {fields, updateTime}) ---
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

// Steuerbare Fehlersimulation: wenn gesetzt, schlägt der NÄCHSTE PATCH
// (firestoreSetDoc) auf genau diesen "collection/id"-Schlüssel fehl (einmalig)
// - simuliert einen Absturz/Netzwerkfehler NACH bereits ausgeführter externer
// Nebenwirkung, aber VOR dem abschließenden Dedup-Schreibvorgang.
let patchFehlschlagFuer = null;

// Zähler für externe Nebenwirkungen (zum Prüfen auf Doppelausführung)
const zaehler = { draftErstellt: 0, labelGesetzt: 0, quoteErstellt: 0, reminderErstellt: 0 };
const quoteAufrufe = [];
const reminderAufrufe = [];

let anthropicHandler = null; // von jedem Testfall individuell gesetzt

const ORIG_FETCH = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  // --- Google OAuth (Service-Account-Token-Tausch) ---
  if (u.href === 'https://oauth2.googleapis.com/token') {
    return jsonResponse(200, { access_token: 'fake-access-token' });
  }

  // --- Anthropic ---
  if (u.href === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(init.body);
    if (!anthropicHandler) throw new Error('Kein anthropicHandler für diesen Testfall gesetzt.');
    return jsonResponse(200, anthropicHandler(body));
  }

  // --- Firestore REST ---
  if (u.hostname === 'firestore.googleapis.com') {
    // ACHTUNG: zwei unterschiedliche Präfix-Formen - das "name"-Feld in einem
    // commit-Schreibvorgang ist der relative Ressourcenname OHNE "/v1/"
    // (siehe docName in firestoreBeanspruche/firestoreCreateIfMissing), eine
    // URL-pathname dagegen enthält "/v1/" (siehe firestoreGetDoc/firestoreSetDoc).
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
        if (!vorhanden || vorhanden.updateTime !== write.currentDocument.updateTime) {
          return jsonResponse(409, { error: { status: 'FAILED_PRECONDITION' } });
        }
        const mask = write.updateMask?.fieldPaths || Object.keys(write.update.fields);
        const neueFields = { ...vorhanden.fields };
        for (const f of mask) neueFields[f] = write.update.fields[f];
        firestoreDb.set(key, { fields: neueFields, updateTime: naechsteUpdateTime() });
        return jsonResponse(200, {});
      }
      firestoreDb.set(key, { fields: write.update.fields, updateTime: naechsteUpdateTime() });
      return jsonResponse(200, {});
    }
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (method === 'PATCH') {
      const [collection, id] = teile;
      const key = `${collection}/${id}`;
      if (patchFehlschlagFuer === key) { patchFehlschlagFuer = null; return jsonResponse(500, { error: 'simulierter Netzwerkfehler' }); }
      const body = JSON.parse(init.body);
      firestoreDb.set(key, { fields: body.fields, updateTime: naechsteUpdateTime() });
      return jsonResponse(200, {});
    }
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

  // --- Google-Büro (Fallback-URL-Pfad, kein Service Binding in diesen Tests) ---
  if (u.href.startsWith('https://google-buero.test')) {
    if (u.pathname === '/emails' && method === 'GET') return jsonResponse(200, { success: true, data: global.__testEmails || [] });
    if (/\/emails\/.+\/draft$/.test(u.pathname) && method === 'POST') { zaehler.draftErstellt++; return jsonResponse(200, { success: true, data: { id: 'draft-1' } }); }
    if (/\/emails\/.+\/labels$/.test(u.pathname) && method === 'POST') { zaehler.labelGesetzt++; return jsonResponse(200, { success: true, data: {} }); }
    return jsonResponse(404, { success: false, error: { message: 'unbekannte Google-Büro-Route im Mock' } });
  }

  // --- KI-Bürokraft (Fallback-URL-Pfad) ---
  if (u.href.startsWith('https://ki-buerokraft.test')) {
    const kib = global.__testKiBuerokraft || {};
    if (u.pathname === '/quotes' && method === 'POST') {
      const body = JSON.parse(init.body);
      zaehler.quoteErstellt++;
      quoteAufrufe.push(body);
      return jsonResponse(201, { success: true, data: { id: `quote-${zaehler.quoteErstellt}`, number: `AN-${zaehler.quoteErstellt}`, items: body.items } });
    }
    if (u.pathname === '/projects' && method === 'GET') return jsonResponse(200, { success: true, data: kib.projects || [] });
    if (u.pathname === '/quotes' && method === 'GET') return jsonResponse(200, { success: true, data: kib.quotesFor?.(u.searchParams) ?? [] });
    if (u.pathname === '/invoices' && method === 'GET') return jsonResponse(200, { success: true, data: kib.invoicesFor?.(u.searchParams) ?? [] });
    if (u.pathname === '/time-entries' && method === 'GET') return jsonResponse(200, { success: true, data: kib.timeEntries || { sum_minutes: 0 } });
    if (u.pathname === '/reminders' && method === 'GET') return jsonResponse(200, { success: true, data: kib.remindersFor?.(u.searchParams) ?? [] });
    if (u.pathname === '/reminders' && method === 'POST') {
      const body = JSON.parse(init.body);
      zaehler.reminderErstellt++;
      reminderAufrufe.push(body);
      return jsonResponse(201, { success: true, data: { id: `reminder-${zaehler.reminderErstellt}`, ...body } });
    }
    return jsonResponse(404, { success: false, error: { message: `unbekannte KI-Bürokraft-Route im Mock: ${method} ${u.pathname}` } });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function envBasis(extra = {}) {
  return {
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
    ANTHROPIC_API_KEY: 'fake', MODEL_ID: 'claude-opus-4-8',
    GOOGLE_BUERO_URL: 'https://google-buero.test', GOOGLE_BUERO_API_KEY: 'fake-google',
    KI_BUEROKRAFT_URL: 'https://ki-buerokraft.test', KI_BUEROKRAFT_API_KEY: 'fake-kib',
    ...extra,
  };
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

function setzeKatalog(eintraege) {
  for (const key of [...firestoreDb.keys()]) if (key.startsWith('katalog/')) firestoreDb.delete(key);
  for (const k of eintraege) firestoreDb.set(`katalog/${k.id}`, { fields: jsToFsFields(k), updateTime: naechsteUpdateTime() });
}
function setzeKunde(kunde) { firestoreDb.set(`kunden/${kunde.id}`, { fields: jsToFsFields(kunde), updateTime: naechsteUpdateTime() }); }
function liesDoc(collection, id) {
  const doc = firestoreDb.get(`${collection}/${id}`);
  return doc ? W.firestoreFieldsToObject(doc.fields) : null;
}

// =============================================================================
// A) Phase 2+3: normaler Lauf - Kundenanfrage -> Aufgabe+Entwurf+Angebot;
//    Spam -> Label; Manipulationsversuch -> kein Angebot/keine Aufgabe.
// =============================================================================
await pruefe('A: normaler Lauf - Aufgabe+Entwurf+echtes Angebot aus Katalogdaten', async () => {
  setzeKatalog([{ id: 'art-1', typ: 'leistung', bezeichnung: 'Steckdose setzen', einheit: 'Stk.', gewerk: 'Elektro', preis: 45, steuersatz: 19 }]);
  setzeKunde({ id: 'kunde-1', email: 'kunde@beispiel.de', firma: 'Beispiel GmbH' });
  global.__testEmails = [
    { message_id: 'mail-1', from: 'Kunde <kunde@beispiel.de>', subject: 'Steckdosen', body_text: 'Bitte 2 Steckdosen setzen.' },
    { message_id: 'mail-2', from: 'spam@werbung.de', subject: 'Angebot', body_text: 'Kaufen Sie jetzt!' },
  ];
  anthropicHandler = (body) => {
    if (body.system.includes('ANGEBOTSENTWURF')) {
      return { content: [{ type: 'text', text: JSON.stringify({ vollstaendigGenug: true, positionen: [{ katalogId: 'art-1', menge: 2, begruendung: 'lt. E-Mail' }], fehlendeInformationen: [] }) }], usage: { input_tokens: 10, output_tokens: 5 } };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ ergebnisse: [
        { id: 'mail-1', kategorie: 'kundenanfrage', prioritaet: 'normal', verdachtAufManipulation: false, aufgabe: { titel: 'Steckdosen', beschreibung: 'Kunde möchte 2 Steckdosen.' }, antwortentwurf: { betreff: 'Re: Steckdosen', text: 'Gerne, wir melden uns.' } },
        { id: 'mail-2', kategorie: 'spam_werbung', prioritaet: 'niedrig', verdachtAufManipulation: false, aufgabe: { titel: '', beschreibung: '' }, antwortentwurf: { betreff: '', text: '' } },
      ] }) }], usage: { input_tokens: 20, output_tokens: 10 },
    };
  };

  await W.runJarvisEmailCheck(envBasis({ JARVIS_EMAIL_AKTIV: 'true', JARVIS_ANGEBOT_AKTIV: 'true' }));

  assert(zaehler.draftErstellt === 1, 'genau ein Antwortentwurf sollte erstellt worden sein');
  assert(zaehler.labelGesetzt === 1, 'genau ein Spam-Label sollte gesetzt worden sein');
  assert(zaehler.quoteErstellt === 1, 'genau ein Angebot sollte erstellt worden sein');
  assert(quoteAufrufe[0].items[0].unit_price_net === 45, 'Preis muss aus dem echten Katalog stammen, nicht von der KI erfunden sein');
  assert(quoteAufrufe[0].items[0].quantity === 2, 'Menge muss aus der KI-Erkennung übernommen werden');

  const mail1 = liesDoc('jarvisEmailVerarbeitung', 'mail-1');
  assert(mail1.status === 'verarbeitet', 'mail-1 muss als verarbeitet markiert sein');
  assert(mail1.angebotId === 'quote-1', 'angebotId muss im Dedup-Dokument vermerkt sein');
  const mail2 = liesDoc('jarvisEmailVerarbeitung', 'mail-2');
  assert(mail2.status === 'spam_markiert', 'mail-2 muss als spam_markiert gelten');
  const job = liesDoc('jarvisJobs', `email-check-${new Date().toISOString().slice(0, 10)}`);
  assert(job.status === 'done', 'Job muss als done markiert sein');
});

// =============================================================================
// B) Idempotenz pro E-Mail: Absturz NACH Entwurf-Erstellung, VOR dem
//    abschließenden Dedup-Schreibvorgang darf beim nächsten Lauf KEINEN
//    zweiten Entwurf erzeugen.
// =============================================================================
await pruefe('B1: Absturz nach Entwurf, vor Dedup-Abschluss -> kein zweiter Entwurf im selben Tag', async () => {
  const heuteB = new Date().toISOString().slice(0, 10);
  firestoreDb.delete(`jarvisJobs/email-check-${heuteB}`);
  firestoreDb.delete('jarvisEmailVerarbeitung/mail-b');
  setzeKatalog([]);
  global.__testEmails = [{ message_id: 'mail-b', from: 'kunde@beispiel.de', subject: 'Frage', body_text: 'Wann können Sie kommen?' }];
  anthropicHandler = () => ({
    content: [{ type: 'text', text: JSON.stringify({ ergebnisse: [
      { id: 'mail-b', kategorie: 'kundenanfrage', prioritaet: 'normal', verdachtAufManipulation: false, aufgabe: { titel: 'Termin', beschreibung: 'Kunde fragt nach Termin.' }, antwortentwurf: { betreff: 'Re: Termin', text: 'Wir melden uns.' } },
    ] }) }], usage: { input_tokens: 5, output_tokens: 5 },
  });
  patchFehlschlagFuer = 'jarvisEmailVerarbeitung/mail-b'; // simuliert Absturz GENAU beim letzten Schreibvorgang dieser E-Mail

  const vorherDraftAnzahl = zaehler.draftErstellt;
  await W.runJarvisEmailCheck(envBasis({ JARVIS_EMAIL_AKTIV: 'true' }));
  assert(zaehler.draftErstellt === vorherDraftAnzahl + 1, 'Entwurf sollte im ersten (fehlschlagenden) Lauf erstellt worden sein');
  const nachAbsturz = liesDoc('jarvisEmailVerarbeitung', 'mail-b');
  assert(nachAbsturz.status === 'in_bearbeitung', 'Dedup-Dokument muss nach simuliertem Absturz auf in_bearbeitung stehenbleiben');

  // Job als "pending" zurücksetzen, um einen ZWEITEN Lauf AM SELBEN TAG zu
  // simulieren (in echt würde das ein manuell zurückgesetzter oder erneut
  // ausgelöster Job sein) - der eigentliche Test ist, ob die E-Mail selbst
  // (nicht der Job) vor doppelter Ausführung geschützt ist.
  const heute = new Date().toISOString().slice(0, 10);
  const jobKey = `jarvisJobs/email-check-${heute}`;
  firestoreDb.set(jobKey, { fields: jsToFsFields({ typ: 'email-check', status: 'pending', versuch: 1, erstelltAm: new Date().toISOString() }), updateTime: naechsteUpdateTime() });

  global.__testEmails = [{ message_id: 'mail-b', from: 'kunde@beispiel.de', subject: 'Frage', body_text: 'Wann können Sie kommen?' }];
  await W.runJarvisEmailCheck(envBasis({ JARVIS_EMAIL_AKTIV: 'true' }));
  assert(zaehler.draftErstellt === vorherDraftAnzahl + 1, 'KEIN zweiter Entwurf - die E-Mail gilt als "vermutlich_aktiv" und wird übersprungen, nicht erneut ausgeführt');
});

await pruefe('B2: dasselbe wie B1, aber die hängengebliebene E-Mail ist länger als 15 Minuten alt -> "unklar", kein Retry', async () => {
  const alt = new Date(Date.now() - 20 * 60000).toISOString();
  const bestehend = firestoreDb.get('jarvisEmailVerarbeitung/mail-b');
  firestoreDb.set('jarvisEmailVerarbeitung/mail-b', { fields: { ...bestehend.fields, gestartetAm: { stringValue: alt } }, updateTime: naechsteUpdateTime() });

  const heute = new Date().toISOString().slice(0, 10);
  firestoreDb.set(`jarvisJobs/email-check-${heute}`, { fields: jsToFsFields({ typ: 'email-check', status: 'pending', versuch: 2, erstelltAm: new Date().toISOString() }), updateTime: naechsteUpdateTime() });

  const vorherDraftAnzahl = zaehler.draftErstellt;
  await W.runJarvisEmailCheck(envBasis({ JARVIS_EMAIL_AKTIV: 'true' }));
  assert(zaehler.draftErstellt === vorherDraftAnzahl, 'immer noch kein zweiter Entwurf');
  const nachStale = liesDoc('jarvisEmailVerarbeitung', 'mail-b');
  assert(nachStale.status === 'unklar', 'nach 15+ Minuten muss der Vorgang als unklar markiert werden, NICHT automatisch fortgesetzt');
});

// =============================================================================
// C) Angebotsentwurf mit unvollständigen Kalkulationsdaten: eine von der KI
//    genannte, nicht existierende Katalog-ID wird verworfen statt übernommen;
//    kein Preis wird erfunden.
// =============================================================================
await pruefe('C: nicht existierende Katalog-ID wird verworfen, keine Position erfunden', async () => {
  setzeKatalog([]); // bewusst LEER - keine einzige echte Katalogposition vorhanden
  setzeKunde({ id: 'kunde-c', email: 'c@beispiel.de' });
  const ergebnis = await W.versucheAngebotsentwurf({
    env: envBasis({}), serviceAccount,
    email: { message_id: 'm-c', subject: 'Anfrage', body_text: 'Bitte 5 Lampen montieren.' },
    kundeId: 'kunde-c', katalog: [], heute: '2026-10-20',
  });
  anthropicHandler = () => ({
    content: [{ type: 'text', text: JSON.stringify({ vollstaendigGenug: true, positionen: [{ katalogId: 'erfunden-123', menge: 5, begruendung: 'Lampen' }], fehlendeInformationen: [] }) }],
    usage: { input_tokens: 5, output_tokens: 5 },
  });
  const ergebnis2 = await W.versucheAngebotsentwurf({
    env: envBasis({}), serviceAccount,
    email: { message_id: 'm-c', subject: 'Anfrage', body_text: 'Bitte 5 Lampen montieren.' },
    kundeId: 'kunde-c', katalog: [], heute: '2026-10-20',
  });
  assert(ergebnis2.angebotId === '', 'ohne echte Katalogposition darf KEIN Angebot angelegt werden');
  assert(ergebnis2.fehlendeInfos.some((f) => f.includes('erfunden-123')), 'die nicht existierende Katalog-ID muss in fehlendeInfos benannt werden');
  assert(zaehler.quoteErstellt === 1, 'quoteErstellt darf sich gegenüber Test A nicht erhöht haben (kein POST /quotes hier)');
  void ergebnis;
});

// =============================================================================
// D) Rechnungsmanagement - abgeschlossenes Projekt MIT angenommenem Angebot:
//    Positionen werden 1:1 übernommen, kein Claude-Aufruf nötig.
// =============================================================================
await pruefe('D: Rechnungsentwurf aus angenommenem Angebot (1:1-Kopie, kein Claude-Aufruf)', async () => {
  setzeKatalog([]);
  anthropicHandler = () => { throw new Error('Rechnungsmanagement darf NIE Claude aufrufen'); };
  global.__testKiBuerokraft = {
    projects: [{ id: 'proj-1', customer_id: 'kunde-1', title: 'Hausanschluss', status: 'abgeschlossen', bereich: 'Elektro' }],
    quotesFor: (params) => (params.get('project_id') === 'proj-1' && params.get('status') === 'accepted'
      ? [{ id: 'angebot-1', items: [{ article_id: 'art-1', title: 'Hausanschluss legen', description: '', unit: 'Stk.', quantity: 1, unit_price_net: 800, vat_rate: 19 }] }]
      : []),
  };
  firestoreDb.set('kanbanSpalten/abgeschlossen', { fields: jsToFsFields({ id: 'abgeschlossen', geschlossen: true }), updateTime: naechsteUpdateTime() });

  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' }));

  const entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-1');
  assert(entwurf.status === 'entwurf_erstellt', 'Status muss entwurf_erstellt sein');
  assert(entwurf.quelle === 'angebot', 'Quelle muss "angebot" sein');
  assert(entwurf.positionen[0].unit_price_net === 800, 'Preis muss 1:1 aus dem Angebot übernommen werden');
  const aufgabe = liesDoc('aufgaben', 'jarvis-rechnung-aufgabe-proj-1');
  assert(aufgabe.prioritaet === 'normal', 'vollständiger Entwurf -> normale Priorität');
});

// =============================================================================
// E) Rechnungsmanagement - Projekt OHNE Angebot, mit Zeiterfassung, aber
//    OHNE passende Stundensatz-Katalogposition -> "fehlende_daten" (NICHT
//    erfunden), UND retry-fähig an einem neuen Tag.
// =============================================================================
await pruefe('E: fehlende Kalkulationsdaten -> "fehlende_daten" statt erfundener Preis, später erneut versuchbar', async () => {
  firestoreDb.delete('jarvisRechnungsEntwuerfe/proj-2');
  global.__testKiBuerokraft = {
    projects: [{ id: 'proj-2', customer_id: 'kunde-2', title: 'Reparatur', status: 'abgeschlossen', bereich: 'Elektro' }],
    quotesFor: () => [],
    timeEntries: { sum_minutes: 120 },
  };
  setzeKatalog([{ id: 'art-x', typ: 'artikel', bezeichnung: 'Kabel', einheit: 'm', gewerk: 'Elektro', preis: 2, steuersatz: 19 }]);
  firestoreDb.set('kanbanSpalten/abgeschlossen', { fields: jsToFsFields({ id: 'abgeschlossen', geschlossen: true }), updateTime: naechsteUpdateTime() });
  firestoreDb.delete(`jarvisJobs/rechnung-check-${new Date().toISOString().slice(0, 10)}`);

  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' }));
  let entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-2');
  assert(entwurf.status === 'fehlende_daten', 'ohne passende Stundensatz-Position muss der Status fehlende_daten sein');
  assert(entwurf.positionen.length === 0, 'keine erfundene Position');
  assert(entwurf.fehlendeInfos.some((f) => f.includes('2 Std')), 'erfasste Zeit (2 Std.) muss im Hinweis genannt werden');

  // Neuer Tag -> neuer Job, "fehlende_daten" ist NICHT terminal -> muss erneut versucht werden.
  firestoreDb.delete(`jarvisJobs/rechnung-check-${new Date().toISOString().slice(0, 10)}`);
  setzeKatalog([
    { id: 'art-x', typ: 'artikel', bezeichnung: 'Kabel', einheit: 'm', gewerk: 'Elektro', preis: 2, steuersatz: 19 },
    { id: 'art-std', typ: 'leistung', bezeichnung: 'Facharbeiterstunde', einheit: 'Std.', gewerk: 'Elektro', preis: 65, steuersatz: 19 },
  ]);
  // simuliert einen neuen Job-Lauf (neuer jobId wäre in echt automatisch - hier
  // reicht das Zurücksetzen des Jobs, um den Lauf erneut auszulösen)
  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' }));
  entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-2');
  assert(entwurf.status === 'entwurf_erstellt', 'nach Nachtragen der Katalogposition muss der Retry erfolgreich sein');
  assert(entwurf.positionen[0].unit_price_net === 65, 'Preis muss aus der echten, jetzt vorhandenen Katalogposition stammen');
});

// =============================================================================
// F) Doppelte Rechnungen verhindern: existiert bereits eine Rechnung, wird
//    kein Entwurf erzeugt und der Vorgang gilt als terminal (kein Retry).
// =============================================================================
await pruefe('F: bereits vorhandene Rechnung -> kein Entwurf, terminal (kein erneuter Versuch)', async () => {
  firestoreDb.delete('jarvisRechnungsEntwuerfe/proj-3');
  global.__testKiBuerokraft = {
    projects: [{ id: 'proj-3', customer_id: 'kunde-3', title: 'Wartung', status: 'abgeschlossen', bereich: 'Elektro' }],
    quotesFor: () => [],
  };
  firestoreDb.set('kanbanSpalten/abgeschlossen', { fields: jsToFsFields({ id: 'abgeschlossen', geschlossen: true }), updateTime: naechsteUpdateTime() });
  firestoreDb.set('rechnungen/rechnung-vorhanden-1', { fields: jsToFsFields({ id: 'rechnung-vorhanden-1', projektId: 'proj-3', rechnungstyp: 'rechnung', status: 'offen', brutto: 500 }), updateTime: naechsteUpdateTime() });
  firestoreDb.delete(`jarvisJobs/rechnung-check-${new Date().toISOString().slice(0, 10)}`);

  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' }));
  let entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-3');
  assert(entwurf.status === 'rechnung_vorhanden', 'Status muss rechnung_vorhanden sein');

  firestoreDb.delete(`jarvisJobs/rechnung-check-${new Date().toISOString().slice(0, 10)}`);
  global.__testKiBuerokraft.quotesFor = () => { throw new Error('darf bei terminalem Status nicht erneut aufgerufen werden'); };
  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' })); // darf NICHT werfen - proj-3 muss übersprungen werden
  entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-3');
  assert(entwurf.status === 'rechnung_vorhanden', 'Status bleibt unverändert - kein erneuter Versuch bei terminalem Status');
});

// =============================================================================
// G) Mahnungsmanagement: fällige Stufe wird einmalig erstellt, eine noch
//    nicht fällige Stufe wird übersprungen, eine bereits erstellte Stufe
//    wird bei einem zweiten (simulierten doppelten) Lauf NICHT erneut angelegt.
// =============================================================================
await pruefe('G: Mahnstufe wird einmalig erstellt, Duplikat bei doppeltem Lauf verhindert', async () => {
  const heute = '2026-10-20';
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [`${heute}T10:00:00Z`])); }
    static now() { return new RealDate(`${heute}T10:00:00Z`).getTime(); }
  };
  try {
    global.__testKiBuerokraft = {
      remindersFor: (params) => (params.get('invoice_id') === 'rech-faellig' ? [] : [{ invoice_id: 'rech-nicht-faellig', date: '2026-10-15', new_due_date: '2026-10-25' }]),
      invoicesFor: () => [
        { id: 'rech-faellig', customer_id: 'kunde-f', due_date: '2026-10-01', number: 'RE-1', open_value: 500, gross_total: 500 },
        { id: 'rech-nicht-faellig', customer_id: 'kunde-f', due_date: '2026-09-01', number: 'RE-2', open_value: 300, gross_total: 300 },
      ],
    };
    firestoreDb.set('einstellungen/global', { fields: jsToFsFields({ mahnfristTage: 10, mahnGebuehr: { 1: 5 } }), updateTime: naechsteUpdateTime() });
    firestoreDb.delete(`jarvisJobs/mahnung-check-${heute}`);

    await W.runJarvisMahnungCheck(envBasis({ JARVIS_MAHNUNG_AKTIV: 'true' }));
    assert(zaehler.reminderErstellt === 1, 'genau eine Mahnung sollte erstellt worden sein (die fällige Rechnung)');
    assert(reminderAufrufe[0].invoice_id === 'rech-faellig', 'die fällige Rechnung muss gemahnt werden');
    assert(reminderAufrufe[0].fee === 5, 'Gebühr muss aus den echten Einstellungen stammen');

    firestoreDb.delete(`jarvisJobs/mahnung-check-${heute}`);
    const vorher = zaehler.reminderErstellt;
    await W.runJarvisMahnungCheck(envBasis({ JARVIS_MAHNUNG_AKTIV: 'true' }));
    assert(zaehler.reminderErstellt === vorher, 'ein zweiter (simuliert doppelter) Lauf darf KEINE zweite Mahnung derselben Stufe anlegen');
  } finally {
    global.Date = RealDate;
  }
});

// =============================================================================
// H) Fehlende Berechtigungen / Konfiguration: klare Fehler statt Absturz.
// =============================================================================
await pruefe('H1: callGoogleBuero ohne API-Key wirft klaren 503-Fehler', async () => {
  try {
    await W.callGoogleBuero({ env: {}, path: '/emails' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 503, 'Status muss 503 sein');
    assert(err.message.includes('GOOGLE_BUERO_API_KEY'), 'Fehlermeldung muss den fehlenden Schlüssel benennen');
  }
});

await pruefe('H2: callKiBuerokraftRest ohne API-Key wirft klaren 503-Fehler', async () => {
  try {
    await W.callKiBuerokraftRest({ env: {}, path: '/projects' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 503, 'Status muss 503 sein');
  }
});

await pruefe('H3: pruefeJarvisRolle lehnt Nicht-Admin ab', async () => {
  try { W.pruefeJarvisRolle('mitarbeiter'); throw new Error('hätte werfen müssen'); }
  catch (err) { assert(/admin/i.test(err.message), 'Fehlermeldung muss auf fehlende Admin-Rolle hinweisen'); }
});

// =============================================================================
// I) Service Bindings werden bevorzugt verwendet, wenn konfiguriert (statt
//    des öffentlichen URL-Fallbacks) - direkter Test der in dieser Phase
//    korrigierten Worker-zu-Worker-Verbindung.
// =============================================================================
await pruefe('I1: callGoogleBuero nutzt das Service Binding, wenn vorhanden (nicht die öffentliche URL)', async () => {
  let bindingAufgerufen = false;
  const env = {
    GOOGLE_BUERO_API_KEY: 'fake',
    GOOGLE_BUERO_URL: 'https://google-buero.test', // vorhanden, aber muss NICHT benutzt werden
    GOOGLE_BUERO: { fetch: async () => { bindingAufgerufen = true; return jsonResponse(200, { success: true, data: [] }); } },
  };
  await W.callGoogleBuero({ env, path: '/emails' });
  assert(bindingAufgerufen, 'das Service Binding GOOGLE_BUERO muss bevorzugt aufgerufen werden');
});

await pruefe('I2: callKiBuerokraftRest nutzt das Service Binding, wenn vorhanden', async () => {
  let bindingAufgerufen = false;
  const env = {
    KI_BUEROKRAFT_API_KEY: 'fake',
    KI_BUEROKRAFT_URL: 'https://ki-buerokraft.test',
    KI_BUEROKRAFT: { fetch: async () => { bindingAufgerufen = true; return jsonResponse(200, { success: true, data: [] }); } },
  };
  await W.callKiBuerokraftRest({ env, path: '/projects' });
  assert(bindingAufgerufen, 'das Service Binding KI_BUEROKRAFT muss bevorzugt aufgerufen werden');
});

global.fetch = ORIG_FETCH;
console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
