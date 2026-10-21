// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 9 ab:
// Sicherheitsprüfung (Prompt-Injection-Warnung, zeitkonstanter Secret-
// Vergleich), unveränderliche Prüfnormen-Versionshistorie, erweiterte
// Herstellerquellen-Verifizierung.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase9.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p9',
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
// A) Prüfnormen: unveränderliche Versionshistorie (Vorgabe Phase 9 Punkt 3).
// =============================================================================
await pruefe('A1: erstelleJarvisPruefnorm legt eine neue Fassung an (Version 1, aktuell: true)', async () => {
  const norm = await W.erstelleJarvisPruefnorm({
    serviceAccount, pruefart: 'dguv-v3', messgroesse: 'Isolationswiderstand', einheit: 'MΩ', grenzwertMin: 1,
    gueltigkeitsbereich: 'Endstromkreise TN-S', normReferenz: 'DIN VDE 0100-610', callerUid: 'uid-a1', callerRole: 'admin',
  });
  assert(norm.version === 1, `erste Fassung muss Version 1 sein, war ${norm.version}`);
  assert(norm.aktuell === true, 'erste Fassung muss aktuell sein');
  assert(norm.erstelltVonUid === 'uid-a1', 'Ersteller muss protokolliert werden');
});

await pruefe('A2: eine neue Fassung mit vorherigeVersionId erhöht die Version und setzt die ALTE Fassung auf aktuell:false, LÖSCHT sie aber NICHT', async () => {
  const v1 = await W.erstelleJarvisPruefnorm({
    serviceAccount, pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', einheit: 'ms', grenzwertMax: 300, callerUid: 'uid-a2', callerRole: 'admin',
  });
  const v2 = await W.erstelleJarvisPruefnorm({
    serviceAccount, pruefart: 'dguv-v3', messgroesse: 'Auslösezeit RCD', einheit: 'ms', grenzwertMax: 200,
    vorherigeVersionId: v1.id, aenderungsgrund: 'Grenzwert verschärft gemäß neuer Herstellerangabe', callerUid: 'uid-a2', callerRole: 'admin',
  });
  assert(v2.version === 2, `neue Fassung muss Version 2 sein, war ${v2.version}`);
  assert(v2.vorherigeVersionId === v1.id, 'vorherigeVersionId muss verweisen');
  const v1NachUpdate = liesDoc('pruefnormenGrenzwerte', v1.id);
  assert(v1NachUpdate !== null, 'die alte Fassung darf NICHT gelöscht werden - sie muss als Dokument erhalten bleiben');
  assert(v1NachUpdate.aktuell === false, 'die alte Fassung muss aktuell:false sein, sobald sie abgelöst wurde');
  assert(v1NachUpdate.abgeloestDurchId === v2.id, 'die alte Fassung muss auf ihren Nachfolger verweisen');
  assert(v1NachUpdate.grenzwertMax === 300, 'der INHALT der alten Fassung darf sich NICHT nachträglich ändern (unverändert bei 300ms)');
});

await pruefe('A3: ein bereits mit der ALTEN Fassung erstelltes Prüfprotokoll bleibt unverändert, auch nachdem eine neue Fassung existiert', async () => {
  setDoc('anlagen', 'anl-a3', { bezeichnung: 'Verteilung A3', kundeId: 'kunde-a3' });
  const v1 = await W.erstelleJarvisPruefnorm({
    serviceAccount, pruefart: 'e-check', messgroesse: 'Schutzleiterwiderstand', einheit: 'Ω', grenzwertMax: 1,
    gueltigkeitsbereich: 'Fassung A', callerUid: 'uid-a3', callerRole: 'admin',
  });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-a3', kundeId: 'kunde-a3', pruefart: 'e-check',
    messwerte: [{ bezeichnung: 'Schutzleiterwiderstand', wert: '0.5', einheit: 'Ω', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-a3',
  });
  assert(protokoll.messwerte[0].grenzwertPruefung.normVersion === 1, 'Protokoll muss Version 1 referenzieren');
  // Jetzt eine neue Fassung mit GEÄNDERTEM Gültigkeitsbereich anlegen.
  await W.erstelleJarvisPruefnorm({
    serviceAccount, pruefart: 'e-check', messgroesse: 'Schutzleiterwiderstand', einheit: 'Ω', grenzwertMax: 0.5,
    gueltigkeitsbereich: 'Fassung B', vorherigeVersionId: v1.id, aenderungsgrund: 'Verschärfung', callerUid: 'uid-a3', callerRole: 'admin',
  });
  const protokollErneutGelesen = liesDoc('jarvisPruefprotokolle', protokoll.id);
  assert(protokollErneutGelesen.messwerte[0].grenzwertPruefung.normVersion === 1, 'bereits erstelltes Protokoll darf sich NICHT rückwirkend auf Version 2 beziehen');
  assert(protokollErneutGelesen.messwerte[0].grenzwertPruefung.gueltigkeitsbereich === 'Fassung A', 'der im Protokoll gespeicherte Gültigkeitsbereich darf sich NICHT nachträglich ändern');
});

await pruefe('A4: eine NEUE Prüfung nach Anlegen der neuen Fassung verwendet automatisch die neue, aktuelle Fassung', async () => {
  setDoc('anlagen', 'anl-a4', { bezeichnung: 'Verteilung A4', kundeId: 'kunde-a4' });
  const v1 = await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'sonstiges', messgroesse: 'Testgroesse A4', grenzwertMax: 10, callerUid: 'uid-a4', callerRole: 'admin' });
  await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'sonstiges', messgroesse: 'Testgroesse A4', grenzwertMax: 5, vorherigeVersionId: v1.id, aenderungsgrund: 'x', callerUid: 'uid-a4', callerRole: 'admin' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-a4', kundeId: 'kunde-a4', pruefart: 'sonstiges',
    messwerte: [{ bezeichnung: 'Testgroesse A4', wert: '7', einheit: '', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-a4',
  });
  assert(protokoll.messwerte[0].grenzwertPruefung.normVersion === 2, `neue Prüfung muss die aktuelle Version 2 verwenden, war ${protokoll.messwerte[0].grenzwertPruefung.normVersion}`);
  assert(protokoll.messwerte[0].grenzwertPruefung.status === 'auffaellig', '7 liegt über dem neuen Grenzwert 5, muss auffällig sein');
});

await pruefe('A5: eine zweite Fassung OHNE vorherigeVersionId für dieselbe Prüfart+Messgröße wird abgelehnt (keine zwei parallelen "aktuellen" Fassungen)', async () => {
  await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'dguv-v3', messgroesse: 'Testgroesse A5', grenzwertMax: 10, callerUid: 'uid-a5', callerRole: 'admin' });
  try {
    await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'dguv-v3', messgroesse: 'Testgroesse A5', grenzwertMax: 20, callerUid: 'uid-a5', callerRole: 'admin' });
    throw new Error('FEHLSCHLAG: zweite parallele Fassung hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 409, `muss mit 409 abgelehnt werden, war ${err.status}`);
  }
});

await pruefe('A6: setzeJarvisPruefnormAusserKraft setzt aktuell:false OHNE Löschung und OHNE Nachfolger', async () => {
  const norm = await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'sonstiges', messgroesse: 'Testgroesse A6', grenzwertMax: 10, callerUid: 'uid-a6', callerRole: 'admin' });
  const ergebnis = await W.setzeJarvisPruefnormAusserKraft({ serviceAccount, normId: norm.id, grund: 'Messgröße wird nicht mehr geprüft', callerUid: 'uid-pruefer-a6', callerRole: 'admin' });
  assert(ergebnis.aktuell === false, 'muss aktuell:false sein');
  assert(ergebnis.abgeloestDurchId === null, 'ohne Nachfolger darf abgeloestDurchId nicht gesetzt sein');
  assert(ergebnis.ausserKraftVonUid === 'uid-pruefer-a6', 'muss protokollieren, wer außer Kraft gesetzt hat');
  const gespeichert = liesDoc('pruefnormenGrenzwerte', norm.id);
  assert(gespeichert !== null, 'Dokument darf nicht gelöscht sein');
});

await pruefe('A7: eine außer Kraft gesetzte Fassung wird bei NEUEN Prüfungen nicht mehr angewendet (nicht_bewertbar statt falscher Grenzwert)', async () => {
  setDoc('anlagen', 'anl-a7', { bezeichnung: 'Verteilung A7', kundeId: 'kunde-a7' });
  const norm = await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'sonstiges', messgroesse: 'Testgroesse A7', grenzwertMax: 10, callerUid: 'uid-a7', callerRole: 'admin' });
  await W.setzeJarvisPruefnormAusserKraft({ serviceAccount, normId: norm.id, grund: 'nicht mehr relevant', callerUid: 'uid-a7', callerRole: 'admin' });
  const protokoll = await W.erstelleJarvisPruefprotokoll({
    serviceAccount, anlagenId: 'anl-a7', kundeId: 'kunde-a7', pruefart: 'sonstiges',
    messwerte: [{ bezeichnung: 'Testgroesse A7', wert: '5', einheit: '', pruefbedingungBestaetigt: true }],
    callerRole: 'admin', callerUid: 'uid-a7',
  });
  assert(protokoll.messwerte[0].grenzwertPruefung.status === 'nicht_bewertbar', 'außer Kraft gesetzte Fassung darf nicht mehr angewendet werden');
  assert(protokoll.messwerte[0].grenzwertPruefung.normId === null, 'normId muss null sein, wenn keine aktuelle Fassung existiert');
});

await pruefe('A8: erstelleJarvisPruefnorm/setzeJarvisPruefnormAusserKraft erzwingen die JARVIS-Rollenprüfung', async () => {
  try {
    await W.erstelleJarvisPruefnorm({ serviceAccount, pruefart: 'sonstiges', messgroesse: 'x', callerUid: 'x', callerRole: 'buero' });
    throw new Error('FEHLSCHLAG: nicht-admin hätte abgelehnt werden müssen');
  } catch (err) {
    assert(err.status === 403, `muss mit 403 abgelehnt werden, war ${err.status}`);
  }
});

// =============================================================================
// B) Sicherheitsprüfung: Prompt-Injection-Warnung + zeitkonstanter Vergleich.
// =============================================================================
await pruefe('B1: ASSISTENT_CHAT_SYSTEM_PROMPT enthält eine explizite Warnung, Tool-Ergebnisse/Freitextfelder NICHT als Anweisung zu behandeln', () => {
  assert(/NICHT als Anweisung/.test(W.ASSISTENT_CHAT_SYSTEM_PROMPT) || /niemals als Anweisung/i.test(W.ASSISTENT_CHAT_SYSTEM_PROMPT), 'der Systemprompt des werkzeug-fähigen Chats muss vor Prompt-Injection über Tool-Daten warnen');
  assert(/notes/.test(W.ASSISTENT_CHAT_SYSTEM_PROMPT), 'die Warnung muss konkret auf Freitextfelder wie "notes" eingehen, nicht nur allgemein bleiben');
});

await pruefe('B2: zeitkonstanterVergleich erkennt gleiche und unterschiedliche Geheimnisse korrekt', () => {
  assert(W.zeitkonstanterVergleich('gleichesGeheimnis123', 'gleichesGeheimnis123') === true, 'identische Strings müssen als gleich erkannt werden');
  assert(W.zeitkonstanterVergleich('geheimnisA', 'geheimnisB') === false, 'unterschiedliche Strings gleicher Länge müssen als ungleich erkannt werden');
  assert(W.zeitkonstanterVergleich('kurz', 'vielviellaenger') === false, 'unterschiedliche Längen müssen als ungleich erkannt werden');
  assert(W.zeitkonstanterVergleich('', '') === true, 'zwei leere Strings gelten als gleich (Aufrufer muss leeren APP_SECRET separat ablehnen)');
});

// =============================================================================
// C) Herstellerquellen-Verifizierung: erweiterte Nachweisfelder (Vorgabe Punkt 4).
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

await pruefe('C1: verifiziereHerstellerBefund speichert Dokumentname/Hersteller/Version/Fundstelle/prüfende Person/Prüfzeitpunkt', async () => {
  const analyse = await mitGefaketerClaudeAntwort(
    [{ aussage: 'Laut Anleitung max. Druck 3 bar.', herkunft: 'herstellertext_hochgeladen', quelle: 'x' }],
    () => W.fuehreJarvisTechAnalyseAus({
      serviceAccount, env: { ANTHROPIC_API_KEY: 'fake', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
      analyseTyp: 'wartungsvorschlag', herstellerquelleText: 'x', kontextText: 'Testfall C1', callerUid: 'uid-c1', callerRole: 'admin',
    }),
  );
  const ergebnis = await W.verifiziereHerstellerBefund({
    serviceAccount, analyseId: analyse.id, erwarteteVersion: analyse.version, befundIndex: 0, callerUid: 'uid-pruefer-c1', callerRole: 'admin',
    dokumentName: 'Montageanleitung WP-12', dokumentHersteller: 'Testhersteller', dokumentVersionOderDatum: '2024-05',
    fundstelle: 'Seite 7, Tabelle 2', pruefendePersonName: 'Max Mustermann',
  });
  const quelle = ergebnis.befunde[0].verifizierteQuelle;
  assert(quelle.dokumentName === 'Montageanleitung WP-12', 'dokumentName muss gespeichert werden');
  assert(quelle.dokumentHersteller === 'Testhersteller', 'dokumentHersteller muss gespeichert werden');
  assert(quelle.dokumentVersionOderDatum === '2024-05', 'dokumentVersionOderDatum muss gespeichert werden');
  assert(quelle.fundstelle === 'Seite 7, Tabelle 2', 'fundstelle muss gespeichert werden');
  assert(quelle.pruefendePersonName === 'Max Mustermann', 'pruefendePersonName muss gespeichert werden');
  assert(!!ergebnis.befunde[0].verifiziertAm, 'Prüfzeitpunkt (verifiziertAm) muss gesetzt sein');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
