// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, siehe __test__-Export am Ende von
// worker.js) - deckt die Service-/Techniker-/Personalverwaltung Phase 2
// (JARVIS SmartDispatch: Techniker-Zuweisungsvorschläge für offene
// Serviceaufträge) ab. NICHT zu verwechseln mit den "JARVIS Phase X"-
// Testdateien (test_jarvis_phase*.mjs), die die ursprüngliche JARVIS-
// Rollout-Reihenfolge abdecken.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_dispatch.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const serviceAccount = { client_email: 'test@test.iam.gserviceaccount.com', private_key: privateKey, project_id: 'jarvis-test-dispatch' };

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
    const rel = u.pathname.slice(u.pathname.indexOf(pathPrefix) + pathPrefix.length);
    const teile = rel.split('/').filter(Boolean);
    if (method === 'PATCH') {
      const [collection, id] = teile;
      const body = JSON.parse(init.body);
      firestoreDb.set(`${collection}/${id}`, { fields: body.fields, updateTime: naechsteUpdateTime() });
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

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function envBasis(extra = {}) {
  return { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), ...extra };
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

function setzeCollection(collection, eintraege) {
  for (const key of [...firestoreDb.keys()]) if (key.startsWith(`${collection}/`)) firestoreDb.delete(key);
  for (const e of eintraege) firestoreDb.set(`${collection}/${e.id}`, { fields: jsToFsFields(e), updateTime: naechsteUpdateTime() });
}
function liesDoc(collection, id) {
  const doc = firestoreDb.get(`${collection}/${id}`);
  return doc ? W.firestoreFieldsToObject(doc.fields) : null;
}
function loescheJob(typ, heute) { firestoreDb.delete(`jarvisJobs/${typ}-${heute}`); }

const HEUTE = new Date().toISOString().slice(0, 10);
function inTagen(n) { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); }

// =============================================================================
// A) findeEinsatzKandidaten (reine Funktion): Terminkonflikt-Ausschluss,
//    ganztägige Abwesenheit (Urlaub/Krank), Sortierung nach Auslastung,
//    Begrenzung auf JARVIS_DISPATCH_VORSCHLAEGE_ANZAHL.
// =============================================================================

await pruefe('A1: ohne Auftragsfrist gibt es keine Kandidaten (keine erfundene Annahme über den Zeitpunkt)', () => {
  const kandidaten = W.findeEinsatzKandidaten({ auftrag: { id: 'sa-1', auftragsfrist: '' }, techniker: [{ id: 'ma-1', name: 'Max' }], termine: [], serviceauftraege: [] });
  assert(kandidaten.length === 0);
});

await pruefe('A2: ein Techniker mit Terminkonflikt im geplanten Zeitfenster wird ausgeschlossen', () => {
  const auftrag = { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 };
  const termine = [{ id: 't1', mitarbeiterIds: ['ma-1'], typ: 'termin', start: `${inTagen(5)}T08:30`, ende: `${inTagen(5)}T09:30` }];
  const kandidaten = W.findeEinsatzKandidaten({ auftrag, techniker: [{ id: 'ma-1', name: 'Max' }], termine, serviceauftraege: [] });
  assert(kandidaten.length === 0, 'der einzige Techniker hat einen Konflikt (08:00-10:00 überlappt mit 08:30-09:30) und muss ausgeschlossen werden');
});

await pruefe('A3: ein Techniker im Urlaub/krank am Einsatztag wird GANZTÄGIG ausgeschlossen, auch außerhalb der genauen Uhrzeit', () => {
  const auftrag = { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 };
  const termine = [{ id: 'urlaub-1', mitarbeiterIds: ['ma-1'], typ: 'urlaub', start: inTagen(5), ende: inTagen(5) }];
  const kandidaten = W.findeEinsatzKandidaten({ auftrag, techniker: [{ id: 'ma-1', name: 'Max' }], termine, serviceauftraege: [] });
  assert(kandidaten.length === 0, 'Urlaub am Einsatztag muss unabhängig von der genauen Uhrzeit ausschließen');
});

await pruefe('A4: ein Urlaub an einem ANDEREN Tag hindert den Techniker nicht', () => {
  const auftrag = { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 };
  const termine = [{ id: 'urlaub-1', mitarbeiterIds: ['ma-1'], typ: 'urlaub', start: inTagen(10), ende: inTagen(12) }];
  const kandidaten = W.findeEinsatzKandidaten({ auftrag, techniker: [{ id: 'ma-1', name: 'Max' }], termine, serviceauftraege: [] });
  assert(kandidaten.length === 1);
});

await pruefe('A5: Kandidaten werden aufsteigend nach aktueller Auslastung (Anzahl offener Serviceaufträge) sortiert', () => {
  const auftrag = { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 };
  const techniker = [{ id: 'ma-1', name: 'Viel beschäftigt' }, { id: 'ma-2', name: 'Wenig beschäftigt' }];
  const serviceauftraege = [
    { id: 'sa-alt-1', technikerIds: ['ma-1'], status: 'zugewiesen' },
    { id: 'sa-alt-2', technikerIds: ['ma-1'], status: 'in_bearbeitung' },
    { id: 'sa-alt-3', technikerIds: ['ma-2'], status: 'zugewiesen' },
  ];
  const kandidaten = W.findeEinsatzKandidaten({ auftrag, techniker, termine: [], serviceauftraege });
  assert(kandidaten[0].technikerId === 'ma-2', 'der weniger ausgelastete Techniker muss zuerst vorgeschlagen werden');
  assert(kandidaten[0].offeneAuftraegeAnzahl === 1 && kandidaten[1].offeneAuftraegeAnzahl === 2);
});

await pruefe('A6: ABGESCHLOSSENE/ABGEBROCHENE Serviceaufträge zählen NICHT zur Auslastung', () => {
  const auftrag = { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 };
  const techniker = [{ id: 'ma-1', name: 'Max' }];
  const serviceauftraege = [
    { id: 'sa-alt-1', technikerIds: ['ma-1'], status: 'abgeschlossen' },
    { id: 'sa-alt-2', technikerIds: ['ma-1'], status: 'abgebrochen' },
  ];
  const kandidaten = W.findeEinsatzKandidaten({ auftrag, techniker, termine: [], serviceauftraege });
  assert(kandidaten[0].offeneAuftraegeAnzahl === 0, 'abgeschlossene/abgebrochene Aufträge dürfen die Auslastung nicht erhöhen');
});

await pruefe('A7: ohne Mitarbeiter mit Zugriffsrolle "Techniker" gibt es keine Kandidaten', () => {
  const kandidaten = W.findeEinsatzKandidaten({ auftrag: { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 }, techniker: [], termine: [], serviceauftraege: [] });
  assert(kandidaten.length === 0);
});

await pruefe(`A8: die Vorschlagsliste wird auf JARVIS_DISPATCH_VORSCHLAEGE_ANZAHL (${W.JARVIS_DISPATCH_VORSCHLAEGE_ANZAHL}) begrenzt`, () => {
  const auftrag = { id: 'sa-1', auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 };
  const techniker = Array.from({ length: W.JARVIS_DISPATCH_VORSCHLAEGE_ANZAHL + 3 }, (_, i) => ({ id: `ma-${i}`, name: `Techniker ${i}` }));
  const kandidaten = W.findeEinsatzKandidaten({ auftrag, techniker, termine: [], serviceauftraege: [] });
  assert(kandidaten.length === W.JARVIS_DISPATCH_VORSCHLAEGE_ANZAHL);
});

// =============================================================================
// B) runJarvisDispatchCheck (Integration gegen den Firestore-Mock):
//    idempotent, überspringt bereits zugewiesene Aufträge, legt eine
//    Begleitaufgabe an, scheitert bei EINEM Fehlerfall nicht komplett.
// =============================================================================

await pruefe('B1: ein offener, unzugewiesener Serviceauftrag erhält einen Techniker-Vorschlag + Begleitaufgabe', async () => {
  setzeCollection('serviceauftraege', [{ id: 'sa-offen-1', status: 'offen', technikerIds: [], auftragsfrist: inTagen(5), geplanteWartungsdauer: 2, kundeId: 'kunde-1', einsatzadresse: 'Musterstr. 1', externeAuftragsnummer: 'SE-001' }]);
  setzeCollection('mitarbeiter', [{ id: 'ma-1', name: 'Max', zugriffsrolle: 'techniker' }]);
  setzeCollection('termine', []);
  loescheJob('dispatch-check', HEUTE);
  firestoreDb.delete('jarvisTechnikerVorschlaege/sa-offen-1');
  firestoreDb.delete('aufgaben/jarvis-dispatch-aufgabe-sa-offen-1');

  await W.runJarvisDispatchCheck(envBasis({ JARVIS_DISPATCH_AKTIV: 'true' }));

  const vorschlag = liesDoc('jarvisTechnikerVorschlaege', 'sa-offen-1');
  assert(vorschlag.status === 'vorschlag_erstellt', 'Status muss vorschlag_erstellt sein');
  assert(vorschlag.vorschlaege.length === 1 && vorschlag.vorschlaege[0].technikerId === 'ma-1');
  assert(vorschlag.freigabeStatus === 'offen', 'ein neuer Vorschlag braucht Büro-Freigabe, bevor irgendetwas angewendet wird');
  const aufgabe = liesDoc('aufgaben', 'jarvis-dispatch-aufgabe-sa-offen-1');
  assert(aufgabe && aufgabe.quelle === 'jarvis-dispatch', 'Begleitaufgabe muss angelegt werden (Sichtbarkeit auch für büro ohne Admin-Zugriff auf die JARVIS-Collection)');
});

await pruefe('B2: ein bereits zugewiesener Serviceauftrag (technikerIds nicht leer) wird NICHT geprüft', async () => {
  setzeCollection('serviceauftraege', [{ id: 'sa-zugewiesen-1', status: 'offen', technikerIds: ['ma-1'], auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 }]);
  setzeCollection('mitarbeiter', [{ id: 'ma-1', name: 'Max', zugriffsrolle: 'techniker' }]);
  loescheJob('dispatch-check', HEUTE);
  firestoreDb.delete('jarvisTechnikerVorschlaege/sa-zugewiesen-1');

  await W.runJarvisDispatchCheck(envBasis({ JARVIS_DISPATCH_AKTIV: 'true' }));
  assert(liesDoc('jarvisTechnikerVorschlaege', 'sa-zugewiesen-1') === null, 'ein bereits zugewiesener Auftrag darf keinen Vorschlag erzeugen');
});

await pruefe('B3: ohne verfügbaren Techniker wird "kein_techniker_verfuegbar" gesetzt, der Job trotzdem "done"', async () => {
  setzeCollection('serviceauftraege', [{ id: 'sa-offen-2', status: 'offen', technikerIds: [], auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 }]);
  setzeCollection('mitarbeiter', []);
  loescheJob('dispatch-check', HEUTE);
  firestoreDb.delete('jarvisTechnikerVorschlaege/sa-offen-2');

  await W.runJarvisDispatchCheck(envBasis({ JARVIS_DISPATCH_AKTIV: 'true' }));
  const vorschlag = liesDoc('jarvisTechnikerVorschlaege', 'sa-offen-2');
  assert(vorschlag.status === 'kein_techniker_verfuegbar');
  assert(vorschlag.fehlendeInfos.some((f) => f.includes('Techniker')));
  const job = liesDoc('jarvisJobs', `dispatch-check-${HEUTE}`);
  assert(job.status === 'done', 'kein Techniker verfügbar ist kein Fehlerfall - der Job muss trotzdem erfolgreich abschließen');
});

await pruefe('B4: ein bereits abgeschlossener Tagesjob ist ein No-Op (kein erneutes Überschreiben bei doppeltem Lauf)', async () => {
  setzeCollection('serviceauftraege', [{ id: 'sa-offen-3', status: 'offen', technikerIds: [], auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 }]);
  setzeCollection('mitarbeiter', [{ id: 'ma-1', name: 'Max', zugriffsrolle: 'techniker' }]);
  loescheJob('dispatch-check', HEUTE);
  firestoreDb.delete('jarvisTechnikerVorschlaege/sa-offen-3');
  await W.runJarvisDispatchCheck(envBasis({ JARVIS_DISPATCH_AKTIV: 'true' }));
  const ersterVorschlag = liesDoc('jarvisTechnikerVorschlaege', 'sa-offen-3');

  // Zweiter Lauf OHNE den Tagesjob zurückzusetzen - muss ein reiner No-Op sein.
  setzeCollection('mitarbeiter', [{ id: 'ma-1', name: 'Max', zugriffsrolle: 'techniker' }, { id: 'ma-2', name: 'Erika', zugriffsrolle: 'techniker' }]);
  await W.runJarvisDispatchCheck(envBasis({ JARVIS_DISPATCH_AKTIV: 'true' }));
  const vorschlagNachZweitemLauf = liesDoc('jarvisTechnikerVorschlaege', 'sa-offen-3');
  assert(vorschlagNachZweitemLauf.version === ersterVorschlag.version, 'ein bereits "done" markierter Tagesjob darf nicht erneut laufen');
});

await pruefe('B5: ohne env.JARVIS_DISPATCH_AKTIV passiert nichts (Standard aus)', async () => {
  setzeCollection('serviceauftraege', [{ id: 'sa-offen-4', status: 'offen', technikerIds: [], auftragsfrist: inTagen(5), geplanteWartungsdauer: 2 }]);
  setzeCollection('mitarbeiter', [{ id: 'ma-1', name: 'Max', zugriffsrolle: 'techniker' }]);
  loescheJob('dispatch-check', HEUTE);
  firestoreDb.delete('jarvisTechnikerVorschlaege/sa-offen-4');
  await W.runJarvisDispatchCheck(envBasis({}));
  assert(liesDoc('jarvisTechnikerVorschlaege', 'sa-offen-4') === null, 'ohne explizit gesetzten Flag darf absolut nichts passieren');
  assert(liesDoc('jarvisJobs', `dispatch-check-${HEUTE}`) === null, 'nicht einmal ein Job-Dokument darf angelegt werden');
});

// =============================================================================
// C) wendeEinsatzFreigabeAn: markiert NUR die Auswahl innerhalb von JARVIS,
//    schreibt NIE technikerIds auf den echten serviceauftraege-Datensatz.
// =============================================================================

await pruefe('C1: Freigeben wählt den angegebenen Vorschlag aus und setzt freigabeStatus', async () => {
  setzeCollection('jarvisTechnikerVorschlaege', [{
    id: 'sa-freigabe-1', version: 1, freigabeStatus: 'offen',
    vorschlaege: [{ technikerId: 'ma-1', name: 'Max' }, { technikerId: 'ma-2', name: 'Erika' }],
  }]);
  const ergebnis = await W.wendeEinsatzFreigabeAn({ serviceAccount, id: 'sa-freigabe-1', erwarteteVersion: 1, entscheidung: 'freigeben', ausgewaehlterSlotIndex: 1 });
  assert(ergebnis.freigabeStatus === 'freigegeben');
  assert(ergebnis.ausgewaehlterSlot.technikerId === 'ma-2', 'der per Index ausgewählte Techniker-Vorschlag muss übernommen werden');
  assert(liesDoc('serviceauftraege', 'sa-freigabe-1') === null, 'die Freigabe darf NIEMALS direkt den echten serviceauftraege-Datensatz schreiben');
});

await pruefe('C2: Ablehnen setzt freigabeStatus auf abgelehnt, ohne einen Vorschlag auszuwählen', async () => {
  setzeCollection('jarvisTechnikerVorschlaege', [{ id: 'sa-freigabe-2', version: 1, freigabeStatus: 'offen', vorschlaege: [{ technikerId: 'ma-1', name: 'Max' }] }]);
  const ergebnis = await W.wendeEinsatzFreigabeAn({ serviceAccount, id: 'sa-freigabe-2', erwarteteVersion: 1, entscheidung: 'ablehnen' });
  assert(ergebnis.freigabeStatus === 'abgelehnt');
});

await pruefe('C3: eine veraltete Version wird mit 409 abgelehnt (Versions-Sicherung wie bei allen übrigen Freigabe-Typen)', async () => {
  setzeCollection('jarvisTechnikerVorschlaege', [{ id: 'sa-freigabe-3', version: 2, freigabeStatus: 'offen', vorschlaege: [{ technikerId: 'ma-1', name: 'Max' }] }]);
  let fehlerStatus = null;
  try { await W.wendeEinsatzFreigabeAn({ serviceAccount, id: 'sa-freigabe-3', erwarteteVersion: 1, entscheidung: 'freigeben', ausgewaehlterSlotIndex: 0 }); }
  catch (err) { fehlerStatus = err.status; }
  assert(fehlerStatus === 409, 'eine zwischenzeitlich aktualisierte Version muss mit 409 abgelehnt werden');
});

await pruefe('C4: ein ungültiger Vorschlag-Index wird mit 400 abgelehnt', async () => {
  setzeCollection('jarvisTechnikerVorschlaege', [{ id: 'sa-freigabe-4', version: 1, freigabeStatus: 'offen', vorschlaege: [{ technikerId: 'ma-1', name: 'Max' }] }]);
  let fehlerStatus = null;
  try { await W.wendeEinsatzFreigabeAn({ serviceAccount, id: 'sa-freigabe-4', erwarteteVersion: 1, entscheidung: 'freigeben', ausgewaehlterSlotIndex: 5 }); }
  catch (err) { fehlerStatus = err.status; }
  assert(fehlerStatus === 400);
});

global.fetch = ORIG_FETCH;
console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
