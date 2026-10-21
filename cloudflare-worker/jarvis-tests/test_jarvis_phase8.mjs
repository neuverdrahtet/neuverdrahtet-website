// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 8 ab:
// Siri-Kurzbefehle (gehashte, gerätegebundene, widerrufbare Tokens, rein
// lesende Abfragen, niemals eine Freigabe über Sprache).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase8.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p8',
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

const ORIG_FETCH = global.fetch;
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

const HEUTE = new Date().toISOString().slice(0, 10);
const MORGEN = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const GESTERN = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function seedeGueltigesToken(id, { erlaubteIntents = W.SIRI_ERLAUBTE_INTENTS, ablaufAm = MORGEN, widerrufenAm = null } = {}) {
  const rawToken = `rohes-test-token-${id}-0123456789abcdef`;
  const hash = await W.sha256Hex(rawToken);
  setDoc('siriGeraeteTokens', hash, { label: `Test-${id}`, erlaubteIntents, erstelltAm: new Date().toISOString(), ablaufAm, widerrufenAm, letzteNutzungAm: null, anzeigeSuffix: rawToken.slice(-6) });
  return rawToken;
}

// =============================================================================
// A) Gerätetoken-Prüfung: gültig, abgelaufen, widerrufen, manipuliert/unbekannt.
// =============================================================================
await pruefe('A1: gültiges Token + erlaubte Abfrage funktioniert und liefert eine Sprachantwort', async () => {
  const rawToken = await seedeGueltigesToken('a1');
  setDoc('angebote', 'ang-1', { status: 'versendet' });
  const ergebnis = await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'angebote-offen' });
  assert(typeof ergebnis.sprachantwort === 'string' && ergebnis.sprachantwort.length > 0, 'muss eine Sprachantwort liefern');
  assert(ergebnis.daten.anzahlOffen === 1, `muss die echte Anzahl liefern, war ${ergebnis.daten.anzahlOffen}`);
});

await pruefe('A2: abgelaufenes Token wird abgelehnt (401), auch wenn Intent/Rechte sonst passen würden', async () => {
  const rawToken = await seedeGueltigesToken('a2', { ablaufAm: GESTERN });
  try {
    await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'angebote-offen' });
    throw new Error('FEHLSCHLAG: abgelaufenes Token hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 401, `muss mit 401 abgelehnt werden, war ${err.status}`);
    assert(/abgelaufen/.test(err.message), 'Fehlermeldung muss "abgelaufen" erwähnen');
  }
});

await pruefe('A3: widerrufenes Token wird abgelehnt (401), selbst kurz vor Ablaufdatum', async () => {
  const rawToken = await seedeGueltigesToken('a3', { widerrufenAm: new Date().toISOString() });
  try {
    await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'angebote-offen' });
    throw new Error('FEHLSCHLAG: widerrufenes Token hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 401, `muss mit 401 abgelehnt werden, war ${err.status}`);
    assert(/widerrufen/.test(err.message), 'Fehlermeldung muss "widerrufen" erwähnen');
  }
});

await pruefe('A4: manipuliertes/unbekanntes Token (falscher Hash) wird abgelehnt (401) mit generischer Meldung', async () => {
  await seedeGueltigesToken('a4');
  try {
    await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken: 'ein-komplett-erfundenes-token-das-nirgends-existiert', intent: 'angebote-offen' });
    throw new Error('FEHLSCHLAG: unbekanntes Token hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 401, `muss mit 401 abgelehnt werden, war ${err.status}`);
    assert(/Ungültiges/.test(err.message), 'Fehlermeldung muss generisch bleiben (kein Hinweis, WARUM es ungültig ist)');
  }
});

await pruefe('A5: fehlendes/leeres Token wird abgelehnt (401)', async () => {
  try {
    await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken: '', intent: 'angebote-offen' });
    throw new Error('FEHLSCHLAG: leeres Token hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 401, 'muss mit 401 abgelehnt werden');
  }
});

await pruefe('A6: gültiges Token, aber Intent NICHT in erlaubteIntents -> 403 (serverseitig begrenzte Berechtigungen)', async () => {
  const rawToken = await seedeGueltigesToken('a6', { erlaubteIntents: ['angebote-offen'] });
  try {
    await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'freigaben-offen' });
    throw new Error('FEHLSCHLAG: nicht erlaubter Intent hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('A7: unbekannter/erfundener Intent wird abgelehnt (400), bevor überhaupt geprüft wird', async () => {
  const rawToken = await seedeGueltigesToken('a7');
  try {
    await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'loesche-alle-rechnungen' });
    throw new Error('FEHLSCHLAG: unbekannter Intent hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, `muss mit 400 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('A8: erfolgreiche Abfrage aktualisiert letzteNutzungAm (Audit-Trail)', async () => {
  const rawToken = await seedeGueltigesToken('a8');
  const hash = await W.sha256Hex(rawToken);
  await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'angebote-offen' });
  const doc = liesDoc('siriGeraeteTokens', hash);
  assert(!!doc.letzteNutzungAm, 'letzteNutzungAm muss nach erfolgreicher Nutzung gesetzt sein');
});

// =============================================================================
// B) Die drei read-only Intents liefern korrekte, echte Daten - niemals eine
//    Freigabe-/Schreibmöglichkeit.
// =============================================================================
await pruefe('B1: "taetigkeiten-morgen" findet echte Termine/Aufgaben von morgen, ignoriert andere Tage', async () => {
  const rawToken = await seedeGueltigesToken('b1');
  setDoc('termine', 'termin-morgen', { start: `${MORGEN}T09:00:00`, titel: 'Kundentermin Müller' });
  setDoc('termine', 'termin-uebermorgen', { start: `${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T09:00:00`, titel: 'Nicht relevant' });
  setDoc('aufgaben', 'aufgabe-morgen', { status: 'offen', faelligAm: MORGEN, titel: 'Material bestellen' });
  setDoc('aufgaben', 'aufgabe-erledigt-morgen', { status: 'erledigt', faelligAm: MORGEN, titel: 'Bereits erledigt' });
  const ergebnis = await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'taetigkeiten-morgen' });
  assert(ergebnis.daten.anzahlTermine === 1, `genau 1 Termin morgen erwartet, war ${ergebnis.daten.anzahlTermine}`);
  assert(ergebnis.daten.anzahlAufgaben === 1, `genau 1 offene Aufgabe morgen erwartet (erledigte zählt nicht), war ${ergebnis.daten.anzahlAufgaben}`);
  assert(ergebnis.sprachantwort.includes('Kundentermin Müller'), 'Sprachantwort muss den echten Termintitel enthalten');
});

await pruefe('B2: "freigaben-offen" zeigt NUR eine Zahl/Sprachantwort - es existiert keine Möglichkeit, über diesen Pfad etwas freizugeben', async () => {
  const rawToken = await seedeGueltigesToken('b2');
  setDoc('jarvisAktionen', 'aktion-1', { typ: 'email.pruefen', status: 'pending' });
  setDoc('jarvisAktionen', 'aktion-2', { typ: 'rechnung.pruefen', status: 'executed' });
  const ergebnis = await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: 'freigaben-offen' });
  assert(ergebnis.daten.anzahlOffenerFreigaben === 1, `nur die EINE pending-Aktion darf zählen, war ${ergebnis.daten.anzahlOffenerFreigaben}`);
  assert(typeof ergebnis.sprachantwort === 'string', 'Ergebnis darf NUR eine Sprachantwort/Zahl sein, keine Freigabe-Funktion wird hier je aufgerufen');
  assert(!('fuehreFreigabeAus' in ergebnis) && !('entscheidung' in ergebnis), 'es darf keinerlei Freigabe-Handlung im Ergebnis stecken');
});

// =============================================================================
// C) Architektur-Garantie (Vorgabe Phase 8 Punkt 5): über Siri kann NIEMALS
//    eine Freigabe ausgelöst werden - nicht als Konfigurationsfehler, sondern
//    weil die erlaubte Intent-Liste strukturell keinen schreibenden/
//    freigebenden Intent enthalten kann.
// =============================================================================
await pruefe('C1: SIRI_ERLAUBTE_INTENTS enthält ausschließlich rein lesende Abfragen - kein "freigeben"/"bearbeiten"/"pruefen"-Aktionstyp', async () => {
  for (const intent of W.SIRI_ERLAUBTE_INTENTS) {
    assert(!/freigeb|bearbeit|pruef|aktion/i.test(intent), `Intent "${intent}" sieht nach einer schreibenden JARVIS-Freigabe-Aktion aus - das darf über Siri nicht möglich sein`);
  }
  assert(W.SIRI_ERLAUBTE_INTENTS.length === 3, 'erwartet genau die drei dokumentierten read-only Intents');
});

await pruefe('C2: selbst ein Token mit ALLEN erlaubten Intents kann keine Freigabe-Aktion anstoßen (unbekannter Intent-Name wird abgelehnt)', async () => {
  const rawToken = await seedeGueltigesToken('c2');
  for (const verbotenerIntent of ['email.pruefen', 'rechnung.bearbeiten', 'freigeben', 'email.bearbeiten']) {
    try {
      await W.fuehreSiriAbfrageAus({ serviceAccount, rawToken, intent: verbotenerIntent });
      throw new Error(`FEHLSCHLAG: Intent "${verbotenerIntent}" hätte abgelehnt werden müssen`);
    } catch (err) {
      assert(err.status === 400, `"${verbotenerIntent}" muss mit 400 abgelehnt werden (unbekannter Intent), war ${err.status}`);
    }
  }
});

// =============================================================================
// D) Prüfprotokolle: Versionierung/Gültigkeitsbereich der Grenzwerte (Vorgabe
//    Phase 8 Punkt 6 "Versionierung der Prüfgrenzwerte", "Gültigkeitsbereich").
// =============================================================================
await pruefe('D1: Grenzwertbewertung trägt normId/normVersion/gueltigkeitsbereich der tatsächlich angewendeten Norm', async () => {
  setDoc('anlagen', 'anl-d1', { bezeichnung: 'Verteilung D1', kundeId: 'kunde-d1' });
  setDoc('pruefnormenGrenzwerte', 'norm-d1', {
    pruefart: 'dguv-v3', messgroesse: 'Isolationswiderstand', einheit: 'MΩ', grenzwertMin: 1, grenzwertMax: null,
    bedingung: 'bei abgeklemmter Last', gueltigkeitsbereich: 'Endstromkreise TN-S, 230V', normReferenz: 'DIN VDE 0100-610', version: 1,
  });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-d1', kundeId: 'kunde-d1', pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Isolationswiderstand', wert: '5', einheit: 'MΩ', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-d1',
  });
  const m = protokoll.messwerte[0].grenzwertPruefung;
  assert(m.normId === 'norm-d1', `normId muss die angewendete Norm referenzieren, war ${m.normId}`);
  assert(m.normVersion === 1, `normVersion muss 1 sein, war ${m.normVersion}`);
  assert(m.gueltigkeitsbereich === 'Endstromkreise TN-S, 230V', 'gueltigkeitsbereich muss durchgereicht werden');
});

await pruefe('D2: ein später geänderter Grenzwert (neue Version) ändert NICHT rückwirkend ein bereits gespeichertes Protokoll', async () => {
  setDoc('anlagen', 'anl-d2', { bezeichnung: 'Verteilung D2', kundeId: 'kunde-d2' });
  setDoc('pruefnormenGrenzwerte', 'norm-d2', {
    pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', einheit: 'ms', grenzwertMax: 300,
    gueltigkeitsbereich: 'RCD Typ AC', version: 1,
  });
  const alt = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-d2', kundeId: 'kunde-d2', pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Auslösezeit RCD', wert: '150', einheit: 'ms', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-d2',
  });
  assert(alt.messwerte[0].grenzwertPruefung.normVersion === 1, 'altes Protokoll referenziert Version 1');
  // Danny ändert den Grenzwert ("neue Fassung") - ein NEUES Protokoll sieht die neue Version, das alte bleibt unverändert.
  setDoc('pruefnormenGrenzwerte', 'norm-d2', {
    pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', einheit: 'ms', grenzwertMax: 200,
    gueltigkeitsbereich: 'RCD Typ AC', version: 2,
  });
  const altErneutGelesen = liesDoc('jarvisPruefprotokolle', alt.id);
  assert(altErneutGelesen.messwerte[0].grenzwertPruefung.normVersion === 1, 'bereits gespeichertes Protokoll darf sich NICHT rückwirkend ändern');
  const neu = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-d2', kundeId: 'kunde-d2', pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Auslösezeit RCD', wert: '150', einheit: 'ms', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-d2',
  });
  assert(neu.messwerte[0].grenzwertPruefung.normVersion === 2, 'ein neues Protokoll muss die aktuell gültige Version anwenden');
});

await pruefe('D3: Messgröße ohne hinterlegte Norm bleibt "nicht_bewertbar" mit normId=null (kein erfundener Grenzwert)', async () => {
  setDoc('anlagen', 'anl-d3', { bezeichnung: 'Verteilung D3', kundeId: 'kunde-d3' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-d3', kundeId: 'kunde-d3', pruefart: 'dguv-v3',
    messwerte: [{ bezeichnung: 'Unbekannte Messgröße XYZ', wert: '42', einheit: '', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-d3',
  });
  const m = protokoll.messwerte[0].grenzwertPruefung;
  assert(m.status === 'nicht_bewertbar', `Status muss nicht_bewertbar sein, war ${m.status}`);
  assert(m.normId === null, 'ohne hinterlegte Norm darf keine normId existieren');
});

// =============================================================================
// E) Durchsicht-Dokumentation (Vorgabe Punkt 6 "Dokumentation von Ersteller und
//    Freigeber") - AUSDRÜCKLICH KEINE automatische fachliche Prüfungsfreigabe.
// =============================================================================
await pruefe('E1: Ersteller (erstelltVonUid) wird dokumentiert, durchsicht startet leer', async () => {
  setDoc('anlagen', 'anl-e1', { bezeichnung: 'Verteilung E1', kundeId: 'kunde-e1' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-e1', kundeId: 'kunde-e1', pruefart: 'e-check',
    messwerte: [{ bezeichnung: 'Schutzleiterwiderstand', wert: '0.3', einheit: 'Ω', pruefbedingungBestaetigt: false }],
    callerRole: 'admin', callerUid: 'uid-ersteller-e1',
  });
  assert(protokoll.erstelltVonUid === 'uid-ersteller-e1', 'erstelltVonUid muss den tatsächlichen Ersteller tragen');
  assert(protokoll.durchsicht === null, 'durchsicht muss ohne explizite Aktion leer bleiben - keine automatische Freigabe');
});

await pruefe('E2: dokumentiereDurchsichtPruefprotokoll setzt einen Vermerk, verändert aber NICHT das gesamtergebnis', async () => {
  setDoc('anlagen', 'anl-e2', { bezeichnung: 'Verteilung E2', kundeId: 'kunde-e2' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-e2', kundeId: 'kunde-e2', pruefart: 'e-check',
    messwerte: [{ bezeichnung: 'Schutzleiterwiderstand', wert: '0.3', einheit: 'Ω', pruefbedingungBestaetigt: false }],
    callerRole: 'admin', callerUid: 'uid-ersteller-e2',
  });
  const vorherErgebnis = protokoll.gesamtergebnis;
  const ergebnis = await W.dokumentiereDurchsichtPruefprotokoll({
    serviceAccount, protokollId: protokoll.id, erwarteteVersion: protokoll.version, vonUid: 'uid-pruefer-e2', vonName: 'Erika Musterfrau', notiz: 'Werte vor Ort plausibilisiert', callerRole: 'admin',
  });
  assert(ergebnis.durchsicht.vonName === 'Erika Musterfrau', 'vonName muss übernommen werden');
  const gespeichert = liesDoc('jarvisPruefprotokolle', protokoll.id);
  assert(gespeichert.durchsicht.vonUid === 'uid-pruefer-e2', 'durchsicht muss persistiert werden');
  assert(gespeichert.gesamtergebnis === vorherErgebnis, 'Durchsicht darf das Gesamtergebnis NICHT verändern (keine automatische Freigabe)');
});

await pruefe('E3: dokumentiereDurchsichtPruefprotokoll verlangt einen nicht-leeren vonName', async () => {
  setDoc('anlagen', 'anl-e3', { bezeichnung: 'Verteilung E3', kundeId: 'kunde-e3' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-e3', kundeId: 'kunde-e3', pruefart: 'e-check', messwerte: [{ bezeichnung: 'x', wert: '1', einheit: '', pruefbedingungBestaetigt: false }],
    callerRole: 'admin', callerUid: 'uid-e3',
  });
  try {
    await W.dokumentiereDurchsichtPruefprotokoll({ serviceAccount, protokollId: protokoll.id, erwarteteVersion: protokoll.version, vonUid: 'uid-pruefer-e3', vonName: '  ', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: leerer vonName hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 400, `muss mit 400 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('E4: dokumentiereDurchsichtPruefprotokoll erzwingt Versionssicherung (409 bei veralteter Version)', async () => {
  setDoc('anlagen', 'anl-e4', { bezeichnung: 'Verteilung E4', kundeId: 'kunde-e4' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-e4', kundeId: 'kunde-e4', pruefart: 'e-check', messwerte: [{ bezeichnung: 'x', wert: '1', einheit: '', pruefbedingungBestaetigt: false }],
    callerRole: 'admin', callerUid: 'uid-e4',
  });
  try {
    await W.dokumentiereDurchsichtPruefprotokoll({ serviceAccount, protokollId: protokoll.id, erwarteteVersion: protokoll.version + 1, vonUid: 'uid-pruefer-e4', vonName: 'Jemand', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: veraltete Version hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('E5: dokumentiereDurchsichtPruefprotokoll erzwingt die JARVIS-Rollenprüfung wie jede andere Aktion', async () => {
  setDoc('anlagen', 'anl-e5', { bezeichnung: 'Verteilung E5', kundeId: 'kunde-e5' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-e5', kundeId: 'kunde-e5', pruefart: 'e-check', messwerte: [{ bezeichnung: 'x', wert: '1', einheit: '', pruefbedingungBestaetigt: false }],
    callerRole: 'admin', callerUid: 'uid-e5',
  });
  try {
    await W.dokumentiereDurchsichtPruefprotokoll({ serviceAccount, protokollId: protokoll.id, erwarteteVersion: protokoll.version, vonUid: 'x', vonName: 'Jemand', callerRole: 'buero' });
    throw new Error('FEHLSCHLAG: nicht-admin hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden, war ${err.status}`);
  }
});

// =============================================================================
// F) herkunft-Trennung "herstellertext_hochgeladen" vs
//    "herstellerquelle_verifiziert" (Vorgabe Punkt 6) - die Analyse-Pipeline
//    kann NIEMALS selbst "verifiziert" vergeben, nur ein separater, manueller
//    Aufruf von verifiziereHerstellerBefund darf das.
// =============================================================================
function mitGefaketerClaudeAntwort(befunde, fn) {
  const ORIG = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    if (u.href === 'https://api.anthropic.com/v1/messages') {
      return jsonResponse(200, { content: [{ type: 'text', text: JSON.stringify({
        erkannteGeraetedaten: { hersteller: null, modell: null, seriennummer: null, geraetetyp: null, baujahr: null },
        erkannterFehlercode: null, ausgeleseneMesswerte: [], befunde, unsicherheitshinweis: 'Keine besonderen Unsicherheiten.', bildLesbar: true,
      }) }] });
    }
    return ORIG(url, init);
  };
  return fn().finally(() => { global.fetch = ORIG; });
}

await pruefe('F1: ein Befund mit mitgegebener Herstellerquelle wird als "herstellertext_hochgeladen" gespeichert (NICHT "verifiziert")', async () => {
  await mitGefaketerClaudeAntwort(
    [{ aussage: 'Laut Anleitung max. Druck 3 bar.', herkunft: 'herstellertext_hochgeladen', quelle: 'Abschnitt 4.2' }],
    async () => {
      const analyse = await W.fuehreJarvisTechAnalyseAus({
        serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
        analyseTyp: 'wartungsvorschlag', herstellerquelleText: 'Montageanleitung Auszug ...', herstellerquelleName: 'Montageanleitung WP', herstellerquelleDatum: '2024-01',
        kontextText: 'Testfall F1', callerUid: 'uid-f1', callerRole: 'admin',
      });
      assert(analyse.befunde[0].herkunft === 'herstellertext_hochgeladen', `Herkunft muss herstellertext_hochgeladen sein, war ${analyse.befunde[0].herkunft}`);
      assert(analyse.herstellerquelleName === 'Montageanleitung WP', 'herstellerquelleName muss gespeichert werden');
      assert(analyse.herstellerquelleDatum === '2024-01', 'herstellerquelleDatum muss gespeichert werden');
    },
  );
});

await pruefe('F2: gibt das Modell trotz Schema-Verbot "herstellerquelle_verifiziert" zurück, wird das serverseitig auf diagnosehypothese zurückgestuft', async () => {
  await mitGefaketerClaudeAntwort(
    [{ aussage: 'Manipulierter Versuch.', herkunft: 'herstellerquelle_verifiziert', quelle: 'x' }],
    async () => {
      const analyse = await W.fuehreJarvisTechAnalyseAus({
        serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
        analyseTyp: 'wartungsvorschlag', kontextText: 'Testfall F2', callerUid: 'uid-f2', callerRole: 'admin',
      });
      assert(analyse.befunde[0].herkunft === 'diagnosehypothese', `ein von der Analyse behauptetes "verifiziert" muss zurückgestuft werden, war ${analyse.befunde[0].herkunft}`);
    },
  );
});

await pruefe('F3: verifiziereHerstellerBefund befördert EXPLIZIT einen Befund zu "herstellerquelle_verifiziert" und protokolliert wer/wann', async () => {
  const analyse = await mitGefaketerClaudeAntwort(
    [{ aussage: 'Laut Anleitung max. Druck 3 bar.', herkunft: 'herstellertext_hochgeladen', quelle: 'Abschnitt 4.2' }],
    () => W.fuehreJarvisTechAnalyseAus({
      serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
      analyseTyp: 'wartungsvorschlag', herstellerquelleText: 'Montageanleitung Auszug ...', kontextText: 'Testfall F3', callerUid: 'uid-f3', callerRole: 'admin',
    }),
  );
  const ergebnis = await W.verifiziereHerstellerBefund({
    serviceAccount, analyseId: analyse.id, erwarteteVersion: analyse.version, befundIndex: 0, callerUid: 'uid-pruefer-f3', callerRole: 'admin',
    dokumentName: 'Montageanleitung Vitocal 200', dokumentHersteller: 'Viessmann', dokumentVersionOderDatum: 'Rev. 3 / 2024-01',
    fundstelle: 'Abschnitt 4.2, Seite 12', pruefendePersonName: 'Erika Musterfrau',
  });
  assert(ergebnis.befunde[0].herkunft === 'herstellerquelle_verifiziert', 'Befund muss nach Verifizierung "herstellerquelle_verifiziert" sein');
  assert(ergebnis.befunde[0].verifiziertVonUid === 'uid-pruefer-f3', 'verifiziertVonUid muss protokolliert werden');
  assert(!!ergebnis.befunde[0].verifiziertAm, 'verifiziertAm muss gesetzt sein');
  assert(ergebnis.befunde[0].verifizierteQuelle.dokumentName === 'Montageanleitung Vitocal 200', 'Dokumentname muss gespeichert werden');
  assert(ergebnis.befunde[0].verifizierteQuelle.fundstelle === 'Abschnitt 4.2, Seite 12', 'Fundstelle muss gespeichert werden');
  assert(ergebnis.befunde[0].verifizierteQuelle.pruefendePersonName === 'Erika Musterfrau', 'prüfende Person muss gespeichert werden');
});

await pruefe('F3b: verifiziereHerstellerBefund verlangt Dokumentname, Fundstelle und prüfende Person (Phase 9 Sicherheitsprüfung Punkt 4)', async () => {
  const analyse = await mitGefaketerClaudeAntwort(
    [{ aussage: 'Laut Anleitung.', herkunft: 'herstellertext_hochgeladen', quelle: 'x' }],
    () => W.fuehreJarvisTechAnalyseAus({
      serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
      analyseTyp: 'wartungsvorschlag', herstellerquelleText: 'x', kontextText: 'Testfall F3b', callerUid: 'uid-f3b', callerRole: 'admin',
    }),
  );
  for (const fehlendesFeld of ['dokumentName', 'fundstelle', 'pruefendePersonName']) {
    const vollstaendig = { dokumentName: 'Doku', fundstelle: 'S.1', pruefendePersonName: 'Jemand' };
    delete vollstaendig[fehlendesFeld];
    try {
      await W.verifiziereHerstellerBefund({ serviceAccount, analyseId: analyse.id, erwarteteVersion: analyse.version, befundIndex: 0, callerUid: 'x', callerRole: 'admin', ...vollstaendig });
      throw new Error(`FEHLSCHLAG: fehlendes Feld "${fehlendesFeld}" hätte abgelehnt werden müssen`);
    } catch (err) {
      assert(err.status === 400, `"${fehlendesFeld}" fehlend muss mit 400 abgelehnt werden, war ${err.status}`);
    }
  }
});

await pruefe('F4: verifiziereHerstellerBefund lehnt ab, wenn der Befund NICHT "herstellertext_hochgeladen" ist (z.B. schon diagnosehypothese)', async () => {
  const analyse = await mitGefaketerClaudeAntwort(
    [{ aussage: 'Allgemeine fachliche Einschätzung.', herkunft: 'diagnosehypothese', quelle: null }],
    () => W.fuehreJarvisTechAnalyseAus({
      serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
      analyseTyp: 'wartungsvorschlag', kontextText: 'Testfall F4', callerUid: 'uid-f4', callerRole: 'admin',
    }),
  );
  try {
    await W.verifiziereHerstellerBefund({ serviceAccount, analyseId: analyse.id, erwarteteVersion: analyse.version, befundIndex: 0, callerUid: 'uid-pruefer-f4', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: diagnosehypothese hätte nicht verifiziert werden dürfen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('F5: verifiziereHerstellerBefund erzwingt Versionssicherung und Rollenprüfung wie jede andere JARVIS-Aktion', async () => {
  const analyse = await mitGefaketerClaudeAntwort(
    [{ aussage: 'Laut Anleitung.', herkunft: 'herstellertext_hochgeladen', quelle: 'x' }],
    () => W.fuehreJarvisTechAnalyseAus({
      serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
      analyseTyp: 'wartungsvorschlag', herstellerquelleText: 'x', kontextText: 'Testfall F5', callerUid: 'uid-f5', callerRole: 'admin',
    }),
  );
  try {
    await W.verifiziereHerstellerBefund({ serviceAccount, analyseId: analyse.id, erwarteteVersion: analyse.version + 1, befundIndex: 0, callerUid: 'x', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: veraltete Version hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden (Versionssicherung), war ${err.status}`);
  }
  try {
    await W.verifiziereHerstellerBefund({ serviceAccount, analyseId: analyse.id, erwarteteVersion: analyse.version, befundIndex: 0, callerUid: 'x', callerRole: 'buero' });
    throw new Error('FEHLSCHLAG: nicht-admin hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden (Rollenprüfung), war ${err.status}`);
  }
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
