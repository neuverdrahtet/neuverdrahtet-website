// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 7 ab:
// Korrekturen aus Phase 6 (Gmail-Entwurf-Sync, echte Mahndaten beim
// Bearbeiten, CONTROL-Dokumentation) sowie JARVIS TECH (Dokument-/Bild-
// Analyse, Prüfprotokolle, Wärmepumpen-/PV-Unterstützung).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase7.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p7',
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

const googleBueroAufrufe = [];
let googleBueroVerhalten = null; // Test-spezifisch überschreibbar

const ORIG_FETCH = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-access-token' });
  if (u.href === 'https://api.anthropic.com/v1/messages') {
    if (typeof global.__anthropicMock === 'function') return global.__anthropicMock(JSON.parse(init.body));
    throw new Error('Kein Anthropic-Mock für diesen Test gesetzt (global.__anthropicMock).');
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

  if (u.href.startsWith('https://google-buero.test')) {
    const body = init.body ? JSON.parse(init.body) : {};
    googleBueroAufrufe.push({ method, pathname: u.pathname, body });
    if (googleBueroVerhalten) return googleBueroVerhalten({ method, pathname: u.pathname, body });
    // Standardverhalten (wie Gmail selbst): draft_id vorhanden -> dieselbe
    // zurückgeben (Update), sonst eine neue erzeugen (Create).
    const draftId = body.draft_id || 'draft-neu';
    return jsonResponse(200, { success: true, data: { draft_id: draftId, aktualisiert: !!body.draft_id } });
  }

  if (u.href.startsWith('https://ki-buerokraft.test')) {
    return jsonResponse(404, { success: false, error: { message: `unbekannte KI-Bürokraft-Route im Mock: ${method} ${u.pathname}` } });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function envBasis(extra = {}) {
  return { GOOGLE_BUERO_URL: 'https://google-buero.test', GOOGLE_BUERO_API_KEY: 'fake-google', ANTHROPIC_API_KEY: 'fake-anthropic', ...extra };
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

const HEUTE = new Date().toISOString().slice(0, 10);

// =============================================================================
// A) Phase-7-Korrektur: Gmail-Entwurf-Synchronisierung. Vorher legte jede
//    Bearbeitung einen ZWEITEN, parallelen Gmail-Entwurf an. Jetzt wird die
//    gespeicherte gmailDraftId mitgeschickt (siehe cloudflare-worker-google-
//    buero für die serverseitige PUT-/Update-Semantik, hier nur die
//    Haupt-Worker-Seite: wird draft_id korrekt mitgesendet/gespeichert, und
//    blockiert ein Sync-Fehler tatsächlich die Freigabe).
// =============================================================================
await pruefe('A1: erste Bearbeitung ohne vorhandene gmailDraftId sendet KEINE draft_id, speichert die neu erzeugte', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-a1', {
    status: 'verarbeitet', entwurfErstellt: true, version: 1, freigabeStatus: 'offen',
    antwortentwurfBetreff: 'Alt', antwortentwurfText: 'Alter Text', emailVon: 'kunde@test.local', gmailDraftId: null,
  });
  const ergebnis = await W.bearbeiteEmailAntwortentwurf({ serviceAccount, env: envBasis(), id: 'mail-a1', erwarteteVersion: 1, antwortentwurfBetreff: 'Neu', antwortentwurfText: 'Neuer Text' });
  assert(ergebnis.gmailDraftSyncFehler === null, 'Sync darf hier nicht fehlschlagen');
  const letzterAufruf = googleBueroAufrufe[googleBueroAufrufe.length - 1];
  assert(letzterAufruf.body.draft_id === undefined, 'beim allerersten Entwurf darf keine draft_id gesendet werden (es gibt noch keine)');
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-a1');
  assert(doc.gmailDraftId === 'draft-neu', 'die neu erzeugte draft_id muss gespeichert werden');
});

await pruefe('A2: zweite Bearbeitung sendet die GESPEICHERTE gmailDraftId mit - kein zweiter, paralleler Entwurf', async () => {
  const vorAnzahl = googleBueroAufrufe.length;
  const ergebnis = await W.bearbeiteEmailAntwortentwurf({ serviceAccount, env: envBasis(), id: 'mail-a1', erwarteteVersion: 2, antwortentwurfBetreff: 'Noch neuer', antwortentwurfText: 'Noch neuerer Text' });
  assert(ergebnis.gmailDraftSyncFehler === null, 'Sync darf hier nicht fehlschlagen');
  assert(googleBueroAufrufe.length === vorAnzahl + 1, 'es darf genau EIN weiterer Google-Büro-Aufruf erfolgen (Update), kein zusätzlicher');
  const letzterAufruf = googleBueroAufrufe[googleBueroAufrufe.length - 1];
  assert(letzterAufruf.body.draft_id === 'draft-neu', 'die zuvor gespeicherte draft_id muss mitgesendet werden (Update statt Duplikat)');
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-a1');
  assert(doc.gmailDraftId === 'draft-neu', 'dieselbe draft_id bleibt erhalten (kein neuer Entwurf)');
});

await pruefe('A3: schlägt die Gmail-Synchronisierung fehl, wird gmailDraftSyncFehler gesetzt UND die anschließende Freigabe (email.pruefen) wird verweigert', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-a3', {
    status: 'verarbeitet', entwurfErstellt: true, version: 1, freigabeStatus: 'offen',
    antwortentwurfBetreff: 'Alt', antwortentwurfText: 'Alter Text', emailVon: 'kunde@test.local', gmailDraftId: 'draft-wird-geloescht',
  });
  const vorherigesVerhalten = googleBueroVerhalten;
  googleBueroVerhalten = () => { throw new Error('simulierter Gmail-Fehler: Entwurf nicht gefunden'); };
  try {
    const ergebnis = await W.bearbeiteEmailAntwortentwurf({ serviceAccount, env: envBasis(), id: 'mail-a3', erwarteteVersion: 1, antwortentwurfBetreff: 'Neu', antwortentwurfText: 'Neuer Text' });
    assert(ergebnis.gmailDraftSyncFehler, 'gmailDraftSyncFehler muss gesetzt sein');
    const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-a3');
    assert(doc.gmailDraftSyncFehler, 'der Fehler muss persistiert worden sein');
    assert(doc.antwortentwurfText === 'Neuer Text', 'der bearbeitete Text wird trotzdem lokal gespeichert (Danny soll ihn sehen können)');
    // Jetzt versuchen, freizugeben - MUSS verweigert werden.
    try {
      await W.erstelleUndFuehreJarvisFreigabeAus({
        serviceAccount, env: envBasis(), typ: 'email.pruefen', entityId: 'mail-a3',
        payload: { entscheidung: 'freigeben', erwarteteVersion: doc.version }, callerUid: 'admin-1', callerRole: 'admin',
      });
      throw new Error('FEHLSCHLAG: Freigabe hätte verweigert werden müssen');
    } catch (freigabeErr) {
      assert(freigabeErr.status === 409, 'Freigabe-Verweigerung muss 409 liefern');
      assert(/nicht synchronisiert/.test(freigabeErr.message), 'Fehlermeldung muss den Sync-Fehler erklären');
    }
  } finally {
    googleBueroVerhalten = vorherigesVerhalten;
  }
});

await pruefe('A4: nach erfolgreicher erneuter Bearbeitung (Sync behoben) ist die Freigabe wieder möglich', async () => {
  const ergebnis = await W.bearbeiteEmailAntwortentwurf({ serviceAccount, env: envBasis(), id: 'mail-a3', erwarteteVersion: 2, antwortentwurfBetreff: 'Repariert', antwortentwurfText: 'Reparierter Text' });
  assert(ergebnis.gmailDraftSyncFehler === null, 'Sync muss jetzt wieder erfolgreich sein');
  const freigabe = await W.erstelleUndFuehreJarvisFreigabeAus({
    serviceAccount, env: envBasis(), typ: 'email.pruefen', entityId: 'mail-a3',
    payload: { entscheidung: 'freigeben', erwarteteVersion: 3 }, callerUid: 'admin-1', callerRole: 'admin',
  });
  assert(freigabe.freigabeStatus === 'freigegeben', `Freigabe muss jetzt durchgehen, war: ${JSON.stringify(freigabe)}`);
});

// =============================================================================
// B) Phase-7-Korrektur: holeJarvisZentraleDaten reichert Mahnentwürfe mit dem
//    ECHTEN bisherigen Mahntext, der Gebühr, der Frist und dem tatsächlich
//    offenen Betrag an (vorher immer "blind" - Formular zeigte nichts davon).
// =============================================================================
await pruefe('B1: Mahnentwurf wird mit echtem Mahntext/Gebühr/Frist/offenem Betrag angereichert', async () => {
  setDoc('mahnungen', 'mahnung-b1', { rechnungId: 'rech-b1', stufe: 2, datum: HEUTE, neueFrist: '2026-12-15', gebuehr: 5, text: 'Bitte zahlen Sie den Betrag.' });
  setDoc('rechnungen', 'rech-b1', { status: 'teilbezahlt', brutto: 1000, teilzahlungBetrag: 300, faelligAm: '2026-09-01' });
  setDoc('jarvisMahnEntwuerfe', 'rech-b1-stufe-2', { status: 'erstellt', rechnungId: 'rech-b1', stufe: 2, mahnungId: 'mahnung-b1', version: 1, freigabeStatus: 'offen' });
  const daten = await W.holeJarvisZentraleDaten({ serviceAccount, env: envBasis() });
  const eintrag = daten.mahnentwuerfe.find((m) => m.rechnungId === 'rech-b1');
  assert(eintrag, 'Mahnentwurf muss gelistet sein');
  assert(eintrag.aktuellerMahntext === 'Bitte zahlen Sie den Betrag.', 'echter Mahntext muss angezeigt werden');
  assert(eintrag.aktuelleGebuehr === 5, 'echte Gebühr muss angezeigt werden');
  assert(eintrag.neueFrist === '2026-12-15', 'echte Frist muss angezeigt werden');
  assert(eintrag.offenerBetragBrutto === 700, `offener Betrag muss Teilzahlung berücksichtigen (1000-300=700), war ${eintrag.offenerBetragBrutto}`);
});

await pruefe('B2: Anreicherung schlägt fehl (kaputte Verknüpfung), Mahnentwurf bleibt trotzdem gelistet - kein Absturz der Zentrale', async () => {
  setDoc('jarvisMahnEntwuerfe', 'rech-ohne-mahnung-stufe-1', { status: 'erstellt', rechnungId: 'rech-fehlt', stufe: 1, mahnungId: 'mahnung-existiert-nicht', version: 1, freigabeStatus: 'offen' });
  const daten = await W.holeJarvisZentraleDaten({ serviceAccount, env: envBasis() });
  const eintrag = daten.mahnentwuerfe.find((m) => m.rechnungId === 'rech-fehlt');
  assert(eintrag, 'Mahnentwurf muss trotz fehlender echter Mahnung/Rechnung weiterhin gelistet sein');
  assert(!eintrag.aktuellerMahntext, 'kein erfundener Mahntext, wenn die echte Mahnung nicht gefunden wird');
  assert(eintrag.offenerBetragBrutto === null, 'kein erfundener Betrag, wenn die echte Rechnung nicht gefunden wird');
});

// =============================================================================
// C) Phase-7-Korrektur: berechneProjektDeckungsbeitraege - bei der
//    dokumentierenden Prüfung entdeckte Lücke: eine Ausgabe OHNE gültigen
//    betragNetto (fehlend/leer/nicht-numerisch, z.B. eine neu angelegte, noch
//    nicht ausgefüllte Ausgabe) wurde bisher stillschweigend als 0 € Kosten
//    gerechnet statt als unvollständige Datengrundlage markiert - das hätte
//    einen Deckungsbeitrag künstlich zu positiv ausweisen können. Ein ECHTER,
//    bewusst eingetragener Betrag von 0 € bleibt dagegen weiterhin gültig.
// =============================================================================
await pruefe('C1: Ausgabe ohne gültigen Nettobetrag markiert das Projekt als unvollständig (statt 0 € Kosten anzunehmen)', async () => {
  const projekte = [{ id: 'proj-c1', titel: 'Projekt mit kaputter Ausgabe' }];
  const angebote = [{ status: 'angenommen', projektId: 'proj-c1', netto: 1000 }];
  const ausgaben = [{ projektId: 'proj-c1', betragNetto: undefined }, { projektId: 'proj-c1', betragNetto: 150 }];
  const ergebnisse = W.berechneProjektDeckungsbeitraege({ projekte, angebote, ausgaben, zeiterfassung: [], mitarbeiter: [] });
  const eintrag = ergebnisse.find((e) => e.projektId === 'proj-c1');
  assert(eintrag.unvollstaendig === true, 'Projekt mit einer Ausgabe ohne gültigen Betrag muss als unvollständig markiert werden');
  assert(/Nettobetrag/.test(eintrag.grund), 'Grund muss den fehlenden Nettobetrag benennen');
});

await pruefe('C2: eine ECHTE Ausgabe mit 0 € (z.B. kostenlose Ersatzlieferung) blockiert die Berechnung NICHT', async () => {
  const projekte = [{ id: 'proj-c2', titel: 'Projekt mit 0-€-Ausgabe' }];
  const angebote = [{ status: 'angenommen', projektId: 'proj-c2', netto: 1000 }];
  const ausgaben = [{ projektId: 'proj-c2', betragNetto: 0 }, { projektId: 'proj-c2', betragNetto: 200 }];
  const ergebnisse = W.berechneProjektDeckungsbeitraege({ projekte, angebote, ausgaben, zeiterfassung: [], mitarbeiter: [] });
  const eintrag = ergebnisse.find((e) => e.projektId === 'proj-c2');
  assert(eintrag.unvollstaendig === false, 'ein echter 0-€-Betrag darf die Berechnung nicht blockieren');
  assert(eintrag.materialkosten === 200, `Materialkosten müssen 200 € sein (0+200), war ${eintrag.materialkosten}`);
  assert(eintrag.deckungsbeitrag === 800, `Deckungsbeitrag muss 800 sein, war ${eintrag.deckungsbeitrag}`);
});

await pruefe('C3: Nachtragsangebot wird korrekt zum Umsatz-Soll desselben Projekts addiert', async () => {
  const projekte = [{ id: 'proj-c3', titel: 'Projekt mit Nachtrag' }];
  const angebote = [
    { status: 'angenommen', projektId: 'proj-c3', netto: 1000 },
    { status: 'angenommen', projektId: 'proj-c3', netto: 250 }, // Nachtragsangebot auf dasselbe Projekt
  ];
  const ergebnisse = W.berechneProjektDeckungsbeitraege({ projekte, angebote, ausgaben: [], zeiterfassung: [], mitarbeiter: [] });
  const eintrag = ergebnisse.find((e) => e.projektId === 'proj-c3');
  assert(eintrag.umsatzNetto === 1250, `Umsatz-Soll muss Basis+Nachtrag summieren (1000+250=1250), war ${eintrag.umsatzNetto}`);
});

// =============================================================================
// D) JARVIS TECH - Dokument-/Bild-/Text-Analyse. Kernsicherheit: "herkunft"
//    darf nur "herstellerquelle" sein, wenn tatsächlich ein Herstellertext
//    übergeben wurde - serverseitig erzwungen, nicht nur per Prompt erbeten.
// =============================================================================
const WINZIGES_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Hinweis Phase 8 Punkt 6: die Herkunft "herstellerquelle" wurde in
// "herstellertext_hochgeladen" umbenannt/aufgetrennt (siehe
// test_jarvis_phase8.mjs Gruppe F) - ein hochgeladener Herstellertext ist
// IMMER nur "hochgeladen, ungeprüft", niemals automatisch "verifiziert".
// Diese Tests hier prüfen weiterhin dieselbe serverseitige Durchsetzungslogik,
// nur mit dem aktuellen Enum-Namen.
await pruefe('D1: ohne Herstellerquelle wird "herstellertext_hochgeladen" serverseitig IMMER zu "diagnosehypothese" herabgestuft (auch wenn Claude es anders liefert)', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: 'Viessmann', modell: 'Vitocal 200', seriennummer: null, geraetetyp: 'Wärmepumpe', baujahr: null },
      erkannterFehlercode: 'F.75',
      ausgeleseneMesswerte: [],
      befunde: [{ aussage: 'F.75 bedeutet laut Hersteller Kommunikationsfehler.', herkunft: 'herstellertext_hochgeladen', quelle: 'allgemeines Wissen' }],
      unsicherheitshinweis: 'Keine besonderen Unsicherheiten.',
      bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({
    serviceAccount, env: envBasis(), analyseTyp: 'fehlermeldung', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'admin',
  });
  assert(analyse.befunde[0].herkunft === 'diagnosehypothese', 'ohne Herstellerquelle MUSS auf diagnosehypothese herabgestuft werden');
  assert(analyse.befunde[0].quelle === null, 'quelle muss bei der Herabstufung geleert werden');
  assert(/automatisch.*korrigiert/.test(analyse.unsicherheitshinweis), 'der Unsicherheitshinweis muss die Korrektur erwähnen');
});

await pruefe('D2: MIT übergebener Herstellerquelle bleibt "herstellertext_hochgeladen" erhalten (NICHT automatisch "verifiziert")', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: 'Viessmann', modell: 'Vitocal 200', seriennummer: null, geraetetyp: 'Wärmepumpe', baujahr: null },
      erkannterFehlercode: 'F.75',
      ausgeleseneMesswerte: [],
      befunde: [{ aussage: 'F.75 bedeutet laut Anleitung Kommunikationsfehler zum Außengerät.', herkunft: 'herstellertext_hochgeladen', quelle: 'Abschnitt 4.2 der Anleitung' }],
      unsicherheitshinweis: 'Keine besonderen Unsicherheiten.',
      bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({
    serviceAccount, env: envBasis(), analyseTyp: 'fehlermeldung', bildDataUrl: WINZIGES_PNG_DATA_URL,
    herstellerquelleText: 'Abschnitt 4.2: Fehlercode F.75 = Kommunikationsfehler zum Außengerät.', callerRole: 'admin',
  });
  assert(analyse.befunde[0].herkunft === 'herstellertext_hochgeladen', 'mit Herstellerquelle darf herstellertext_hochgeladen erhalten bleiben');
  assert(analyse.hatHerstellerquelle === true, 'hatHerstellerquelle muss gespeichert werden');
});

await pruefe('D3: unbekannter Analysetyp wird abgelehnt (400)', async () => {
  try {
    await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'unbekannt', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, 'muss mit 400 abgelehnt werden');
  }
});

await pruefe('D4: weder Bild noch Kontext übergeben wird abgelehnt (400) - nichts zu analysieren', async () => {
  try {
    await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, 'muss mit 400 abgelehnt werden');
  }
});

await pruefe('D5: unplausibles/kaputtes Bildformat (Datei-/Bildverarbeitung) wird klar abgelehnt, keine erfundene Analyse', async () => {
  try {
    await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', bildDataUrl: 'data:text/plain;base64,xxx', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, 'muss mit 400 abgelehnt werden (Bildformat nicht unterstützt)');
  }
});

await pruefe('D6: Rollenprüfung lehnt Nicht-Admin ab, OHNE überhaupt Claude aufzurufen', async () => {
  let aufgerufen = false;
  global.__anthropicMock = async () => { aufgerufen = true; return jsonResponse(500, {}); };
  try {
    await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'mitarbeiter' });
    throw new Error('FEHLSCHLAG: hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden, war ${err.status}`);
    assert(!aufgerufen, 'Claude darf bei fehlender Berechtigung gar nicht erst aufgerufen werden');
  }
});

await pruefe('D7: wartungsvorschlag-Analyse funktioniert auch rein textbasiert (kein Bild nötig)', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
      erkannterFehlercode: null,
      ausgeleseneMesswerte: [],
      befunde: [{ aussage: 'Luftfilter und Verdampfer prüfen, da Leistungsabfall ein typisches Anzeichen für Verschmutzung ist.', herkunft: 'diagnosehypothese', quelle: null }],
      unsicherheitshinweis: 'Ohne Vor-Ort-Messung keine sichere Ursache bestimmbar.',
      bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({
    serviceAccount, env: envBasis(), analyseTyp: 'wartungsvorschlag', kontextText: 'Wärmepumpe zeigt spürbaren Leistungsabfall seit letzter Woche.', callerRole: 'admin',
  });
  assert(analyse.befunde.length === 1, 'Analyse muss auch ohne Bild funktionieren');
  assert(analyse.befunde[0].herkunft === 'diagnosehypothese', 'ohne Quelle muss es bei diagnosehypothese bleiben');
});

// =============================================================================
// E) Verknüpfung mit einer echten Anlage - NIEMALS automatisch, prüft
//    zwingend die Kundenzuordnung (Vorgabe Punkt 7 "Falsche Kundenzuordnung").
// =============================================================================
await pruefe('E1: Verknüpfung mit korrekter Kundenzuordnung funktioniert', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: 'Viessmann', modell: 'Vitocal', seriennummer: 'SN123', geraetetyp: 'Wärmepumpe', baujahr: '2022' },
      erkannterFehlercode: null, ausgeleseneMesswerte: [], befunde: [], unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'admin' });
  setDoc('anlagen', 'anlage-e1', { kundeId: 'kunde-richtig', bezeichnung: 'Wärmepumpe Keller', kategorie: 'wartungsvertrag' });
  const ergebnis = await W.verknuepfeTechAnalyseMitAnlage({ serviceAccount, analyseId: analyse.id, erwarteteVersion: 1, anlagenId: 'anlage-e1', kundeId: 'kunde-richtig', callerRole: 'admin' });
  assert(ergebnis.verknuepftMitAnlageId === 'anlage-e1', 'Verknüpfung muss erfolgreich sein');
  const doc = liesDoc('jarvisTechAnalysen', analyse.id);
  assert(doc.verknuepftMitAnlageId === 'anlage-e1', 'Verknüpfung muss persistiert sein');
});

await pruefe('E2: FALSCHE Kundenzuordnung wird abgelehnt (409) - keine Verknüpfung über Kundengrenzen hinweg', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
      erkannterFehlercode: null, ausgeleseneMesswerte: [], befunde: [], unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'admin' });
  setDoc('anlagen', 'anlage-e2', { kundeId: 'kunde-a', bezeichnung: 'Anlage bei Kunde A', kategorie: 'wartungsvertrag' });
  try {
    await W.verknuepfeTechAnalyseMitAnlage({ serviceAccount, analyseId: analyse.id, erwarteteVersion: 1, anlagenId: 'anlage-e2', kundeId: 'kunde-b', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: falsche Kundenzuordnung hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
  const doc = liesDoc('jarvisTechAnalysen', analyse.id);
  assert(!doc.verknuepftMitAnlageId, 'es darf KEINE Verknüpfung entstanden sein');
});

await pruefe('E3: Verknüpfung mit veralteter Version wird abgelehnt (409)', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
      erkannterFehlercode: null, ausgeleseneMesswerte: [], befunde: [], unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'admin' });
  setDoc('anlagen', 'anlage-e3', { kundeId: 'kunde-c', bezeichnung: 'Anlage C', kategorie: 'wartungsvertrag' });
  try {
    await W.verknuepfeTechAnalyseMitAnlage({ serviceAccount, analyseId: analyse.id, erwarteteVersion: 99, anlagenId: 'anlage-e3', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: veraltete Version hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, 'muss mit 409 abgelehnt werden');
  }
});

await pruefe('E4: Verknüpfung mit nicht existierender Anlage wird abgelehnt (404) - falscher/unbekannter Gerätetyp-Verweis', async () => {
  global.__anthropicMock = async () => jsonResponse(200, {
    content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
      erkannterFehlercode: null, ausgeleseneMesswerte: [], befunde: [], unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
    }) }],
  });
  const analyse = await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'typenschild', bildDataUrl: WINZIGES_PNG_DATA_URL, callerRole: 'admin' });
  try {
    await W.verknuepfeTechAnalyseMitAnlage({ serviceAccount, analyseId: analyse.id, erwarteteVersion: 1, anlagenId: 'anlage-existiert-nicht', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: nicht existierende Anlage hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 404, 'muss mit 404 abgelehnt werden');
  }
});

await pruefe('E5: Rollenprüfung lehnt Nicht-Admin bei der Verknüpfung ab', async () => {
  try {
    await W.verknuepfeTechAnalyseMitAnlage({ serviceAccount, analyseId: 'irrelevant', erwarteteVersion: 1, anlagenId: 'irrelevant', callerRole: 'mitarbeiter' });
    throw new Error('FEHLSCHLAG: hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden, war ${err.status}`);
  }
});

// =============================================================================
// F) DGUV/VDE-Prüfprotokolle - rein regelbasierte Grenzwertprüfung GEGEN VON
//    DANNY KONFIGURIERTE REFERENZWERTE (pruefnormenGrenzwerte), niemals
//    gegen von JARVIS selbst erfundene/parametrische Grenzwerte.
// =============================================================================
await pruefe('F1: Messwert innerhalb des konfigurierten Bereichs mit bestätigter Prüfbedingung -> "ok"', async () => {
  const pruefnormenGrenzwerte = [{ pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', einheit: 'ms', grenzwertMax: 300, normReferenz: 'von Danny hinterlegt: DIN VDE 0100-410' }];
  const ergebnis = W.berechnePruefprotokollErgebnis({
    pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Auslösezeit RCD', wert: 180, einheit: 'ms', pruefbedingungBestaetigt: true }],
    pruefnormenGrenzwerte,
  });
  assert(ergebnis.messwerte[0].grenzwertPruefung.status === 'ok', `muss "ok" sein, war ${ergebnis.messwerte[0].grenzwertPruefung.status}`);
  assert(ergebnis.gesamtergebnis === 'ohne_auffaelligkeiten', `Gesamtergebnis muss "ohne_auffaelligkeiten" sein, NIEMALS "bestanden", war ${ergebnis.gesamtergebnis}`);
});

await pruefe('F2: Messwert AUSSERHALB des konfigurierten Bereichs -> "auffaellig", Gesamtergebnis "auffaellig"', async () => {
  const pruefnormenGrenzwerte = [{ pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', einheit: 'ms', grenzwertMax: 300, normReferenz: 'von Danny hinterlegt' }];
  const ergebnis = W.berechnePruefprotokollErgebnis({
    pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Auslösezeit RCD', wert: 450, einheit: 'ms', pruefbedingungBestaetigt: true }],
    pruefnormenGrenzwerte,
  });
  assert(ergebnis.messwerte[0].grenzwertPruefung.status === 'auffaellig', 'muss als auffällig erkannt werden');
  assert(ergebnis.gesamtergebnis === 'auffaellig', 'Gesamtergebnis muss "auffaellig" sein');
});

await pruefe('F3: KEINE konfigurierte Prüfnorm für diese Messgröße -> "nicht_bewertbar" (kein erfundener Grenzwert), Gesamtergebnis bleibt "ohne_auffaelligkeiten"', async () => {
  const ergebnis = W.berechnePruefprotokollErgebnis({
    pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Irgendeine unbekannte Messgröße', wert: 42, einheit: 'x', pruefbedingungBestaetigt: true }],
    pruefnormenGrenzwerte: [],
  });
  assert(ergebnis.messwerte[0].grenzwertPruefung.status === 'nicht_bewertbar', 'ohne konfigurierte Norm muss "nicht_bewertbar" stehen, NIE "ok" oder "auffaellig" geraten werden');
  assert(ergebnis.gesamtergebnis === 'ohne_auffaelligkeiten', 'nicht_bewertbar allein macht das Gesamtergebnis NICHT auffällig/unvollständig');
});

await pruefe('F4: fehlender Messwert -> Status "fehlend", Gesamtergebnis "unvollstaendig"', async () => {
  const ergebnis = W.berechnePruefprotokollErgebnis({
    pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: '', einheit: 'MΩ' }],
    pruefnormenGrenzwerte: [],
  });
  assert(ergebnis.messwerte[0].grenzwertPruefung.status === 'fehlend', 'leerer Wert muss als fehlend erkannt werden');
  assert(ergebnis.gesamtergebnis === 'unvollstaendig', 'Gesamtergebnis muss "unvollstaendig" sein');
});

await pruefe('F5: konfigurierte Norm vorhanden, aber Prüfbedingung NICHT bestätigt -> "nicht_bewertbar" (keine Bewertung ohne nachweisbare Prüfbedingung)', async () => {
  const pruefnormenGrenzwerte = [{ pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', grenzwertMax: 300 }];
  const ergebnis = W.berechnePruefprotokollErgebnis({
    pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Auslösezeit RCD', wert: 180, pruefbedingungBestaetigt: false }],
    pruefnormenGrenzwerte,
  });
  assert(ergebnis.messwerte[0].grenzwertPruefung.status === 'nicht_bewertbar', 'ohne bestätigte Prüfbedingung darf NICHT bewertet werden, selbst mit passender Norm');
});

await pruefe('F6: erstelleJarvisPruefprotokoll - falsche Kundenzuordnung wird abgelehnt (409)', async () => {
  setDoc('anlagen', 'anlage-f6', { kundeId: 'kunde-richtig-f6', bezeichnung: 'Verteilung EG', kategorie: 'dguv-v3' });
  try {
    await W.erstelleJarvisPruefprotokoll({
      serviceAccount, anlagenId: 'anlage-f6', kundeId: 'anderer-kunde', pruefart: 'dguv-v3',
      messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: 5, einheit: 'MΩ' }], callerRole: 'admin',
    });
    throw new Error('FEHLSCHLAG: falsche Kundenzuordnung hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('F7: erstelleJarvisPruefprotokoll - unbekannte Anlage wird abgelehnt (404)', async () => {
  try {
    await W.erstelleJarvisPruefprotokoll({
      serviceAccount, anlagenId: 'anlage-existiert-nicht-f7', pruefart: 'dguv-v3',
      messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: 5 }], callerRole: 'admin',
    });
    throw new Error('FEHLSCHLAG: unbekannte Anlage hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 404, 'muss mit 404 abgelehnt werden');
  }
});

await pruefe('F8: erfolgreiche Protokollerstellung + Versionssicherung bei der Aktualisierung', async () => {
  setDoc('anlagen', 'anlage-f8', { kundeId: 'kunde-f8', bezeichnung: 'Verteilung OG', kategorie: 'dguv-v3' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anlage-f8', kundeId: 'kunde-f8', pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: 5, einheit: 'MΩ' }], callerRole: 'admin',
  });
  assert(protokoll.version === 1, 'neues Protokoll muss Version 1 haben');
  assert(protokoll.gesamtergebnis === 'ohne_auffaelligkeiten', 'Gesamtergebnis muss berechnet worden sein');
  try {
    await W.aktualisiereJarvisPruefprotokoll({ serviceAccount, protokollId: protokoll.id, erwarteteVersion: 99, messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: 6 }], callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: veraltete Version hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, 'muss mit 409 abgelehnt werden');
  }
  const ergebnis = await W.aktualisiereJarvisPruefprotokoll({ serviceAccount, protokollId: protokoll.id, erwarteteVersion: 1, messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: 6, einheit: 'MΩ' }], callerRole: 'admin' });
  assert(ergebnis.version === 2, 'Version muss nach erfolgreicher Aktualisierung erhöht werden');
});

await pruefe('F9: Rollenprüfung lehnt Nicht-Admin beim Anlegen eines Protokolls ab', async () => {
  try {
    await W.erstelleJarvisPruefprotokoll({ serviceAccount, anlagenId: 'irrelevant', pruefart: 'dguv-v3', messwerte: [{ bezeichnung: 'x', wert: 1 }], callerRole: 'mitarbeiter' });
    throw new Error('FEHLSCHLAG: hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('F10: leere/fehlende Messwerte-Liste wird abgelehnt (400) statt ein leeres Protokoll anzulegen', async () => {
  setDoc('anlagen', 'anlage-f10', { kundeId: 'kunde-f10', bezeichnung: 'x', kategorie: 'dguv-v3' });
  try {
    await W.erstelleJarvisPruefprotokoll({ serviceAccount, anlagenId: 'anlage-f10', pruefart: 'dguv-v3', messwerte: [], callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: leere Messwerte hätten abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, 'muss mit 400 abgelehnt werden');
  }
});

await pruefe('F11: unbekannte Prüfart wird abgelehnt (400)', async () => {
  setDoc('anlagen', 'anlage-f11', { kundeId: 'kunde-f11', bezeichnung: 'x', kategorie: 'dguv-v3' });
  try {
    await W.erstelleJarvisPruefprotokoll({ serviceAccount, anlagenId: 'anlage-f11', pruefart: 'unbekannt', messwerte: [{ bezeichnung: 'x', wert: 1 }], callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: unbekannte Prüfart hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, 'muss mit 400 abgelehnt werden');
  }
});

// =============================================================================
// G) Wärmepumpen/PV-Unterstützung (Vorgabe Punkt 5): JARVIS TECH nutzt
//    vorhandene ECHTE Werkora-Anlageninformationen, um Wartungsabläufe/
//    Fehlerursachen/Prüfschritte vorzubereiten. Eine explizit von Danny
//    mitgegebene anlagenId wird direkt (ohne Zwischenschritt) verknüpft -
//    das ist keine KI-Vermutung, sondern eine eindeutige menschliche Angabe.
// =============================================================================
await pruefe('G1: anlagenId reichert den Claude-Aufruf mit echten Werkora-Stammdaten an und verknüpft die Analyse automatisch', async () => {
  setDoc('anlagen', 'anlage-g1', { kundeId: 'kunde-g1', bezeichnung: 'Wärmepumpe Keller', kategorie: 'wartungsvertrag', standort: 'Keller', letztePruefung: '2025-01-10', notizen: 'Viessmann Vitocal 200, Baujahr 2020' });
  let gesendeterPrompt = null;
  global.__anthropicMock = async (body) => {
    gesendeterPrompt = body;
    return jsonResponse(200, { content: [{ type: 'text', text: JSON.stringify({
      erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
      erkannterFehlercode: null, ausgeleseneMesswerte: [],
      befunde: [{ aussage: 'Luftfilter prüfen, da ungewöhnliche Geräusche gemeldet wurden.', herkunft: 'diagnosehypothese', quelle: null }],
      unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
    }) }] });
  };
  const analyse = await W.fuehreJarvisTechAnalyseAus({
    serviceAccount, env: envBasis(), analyseTyp: 'wartungsvorschlag', anlagenId: 'anlage-g1', kontextText: 'Ungewöhnliche Geräusche seit heute.', callerRole: 'admin',
  });
  assert(analyse.verknuepftMitAnlageId === 'anlage-g1', 'Analyse muss automatisch mit der explizit angegebenen Anlage verknüpft sein');
  assert(analyse.verknuepftMitKundeId === 'kunde-g1', 'echte kundeId der Anlage muss übernommen werden');
  const gesendeterText = JSON.stringify(gesendeterPrompt);
  assert(gesendeterText.includes('Wärmepumpe Keller') && gesendeterText.includes('Viessmann Vitocal 200'), 'echte Werkora-Anlagendaten müssen tatsächlich im Claude-Aufruf enthalten sein');
});

await pruefe('G2: unbekannte anlagenId wird abgelehnt (404), keine Analyse mit erfundenem Anlagenbezug', async () => {
  try {
    await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'wartungsvorschlag', anlagenId: 'anlage-existiert-nicht-g2', kontextText: 'x', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: unbekannte Anlage hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 404, 'muss mit 404 abgelehnt werden');
  }
});

await pruefe('G3: Wartungsvorschlag funktioniert rein aus Anlagendaten, ganz ohne Bild oder zusätzlichen Kontexttext', async () => {
  setDoc('anlagen', 'anlage-g3', { kundeId: 'kunde-g3', bezeichnung: 'PV-Anlage Dach', kategorie: 'wartungsvertrag' });
  global.__anthropicMock = async () => jsonResponse(200, { content: [{ type: 'text', text: JSON.stringify({
    erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
    erkannterFehlercode: null, ausgeleseneMesswerte: [], befunde: [], unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
  }) }] });
  const analyse = await W.fuehreJarvisTechAnalyseAus({ serviceAccount, env: envBasis(), analyseTyp: 'wartungsvorschlag', anlagenId: 'anlage-g3', callerRole: 'admin' });
  assert(analyse.verknuepftMitAnlageId === 'anlage-g3', 'muss auch ohne Bild/Kontext funktionieren und verknüpft sein');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
