// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt die
// KI-Wartungsdisposition MVP Phase 1 ab (Screenshot-basierter Import von
// Partner-Wartungsaufträgen, siehe "Entwicklungsfreigabe MVP Phase 1").
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_partnerimport.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-partnerimport',
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

function envBasis(extra = {}) {
  return { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount), ANTHROPIC_API_KEY: 'fake-anthropic', ...extra };
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

// 1x1-Pixel-PNG als winziger, gültiger Bild-data-URL-Dummy - der Inhalt ist
// für den Mock irrelevant, nur das Format (data:image/png;base64,...) muss
// den Regex in callClaudePartnerImportAnalyse erfüllen.
const DUMMY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function anthropicZeilenAntwort(zeilen, lesbar = true) {
  return async () => jsonResponse(200, { content: [{ type: 'text', text: JSON.stringify({ lesbar, zeilen }) }] });
}

// =============================================================================
// A) Reine Funktionen: mergePartnerImportFeld, mergePartnerImportZeile,
//    gruppierePartnerImportRohzeilen, findePartnerAuftragsDublette,
//    formatierePartnerImportAdresse, istGueltigesIsoDatum.
// =============================================================================

pruefe('A1: mergePartnerImportFeld übernimmt einen neuen Wert, wenn noch nichts vorhanden ist', () => {
  const r = W.mergePartnerImportFeld('', 'neu');
  assert(r.wert === 'neu' && r.konflikt === false);
});

pruefe('A2: mergePartnerImportFeld behält den bestehenden Wert, wenn kein neuer Wert übergeben wird', () => {
  const r = W.mergePartnerImportFeld('alt', '');
  assert(r.wert === 'alt' && r.konflikt === false);
});

pruefe('A3: mergePartnerImportFeld erkennt einen Widerspruch bei abweichenden, aber beide vorhandenen Werten (überschreibt NIE)', () => {
  const r = W.mergePartnerImportFeld('Essen', 'Duisburg');
  assert(r.wert === 'Essen', 'der bestehende Wert darf nie stillschweigend ersetzt werden');
  assert(r.konflikt === true && r.abweichenderWert === 'Duisburg');
});

pruefe('A4: mergePartnerImportFeld erkennt GLEICHE Werte (Groß-/Kleinschreibung) nicht als Widerspruch', () => {
  const r = W.mergePartnerImportFeld('Essen', 'essen');
  assert(r.konflikt === false);
});

pruefe('A5: mergePartnerImportZeile führt zwei Screenshots zur selben Auftragsnummer zusammen (Listenübersicht + aufgeklappte Details)', () => {
  const zeile1 = W.mergePartnerImportZeile(null, {
    auftragsnummer: 'SE-100', partnerStatus: 'offen', faelligkeitsdatum: '2026-11-05', wartungsdauerText: '2 Std.',
    plz: null, stadt: null, strasse: null, telefonnummer: '0201123456', sachbearbeiter: 'Frau Müller', auftragsart: 'Jahreswartung',
    unsicherheitshinweis: 'Keine besonderen Unsicherheiten.',
  }, 0);
  const zeile2 = W.mergePartnerImportZeile(zeile1, {
    auftragsnummer: 'SE-100', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null,
    plz: '45141', stadt: 'Essen', strasse: 'Musterweg 12', telefonnummer: null, sachbearbeiter: null, auftragsart: null,
    unsicherheitshinweis: 'Keine besonderen Unsicherheiten.',
  }, 1);
  assert(zeile2.plz === '45141' && zeile2.stadt === 'Essen' && zeile2.strasse === 'Musterweg 12', 'Adressdaten aus der aufgeklappten Detailansicht müssen übernommen werden');
  assert(zeile2.partnerStatus === 'offen' && zeile2.wartungsdauerText === '2 Std.', 'bereits bekannte Felder aus Screenshot 1 dürfen nicht verloren gehen');
  assert(zeile2.quelleScreenshotIndices.length === 2 && zeile2.quelleScreenshotIndices.includes(0) && zeile2.quelleScreenshotIndices.includes(1));
  assert(zeile2.fehlendeFelder.length === 0, `erwartet keine fehlenden Felder mehr, war ${JSON.stringify(zeile2.fehlendeFelder)}`);
});

pruefe('A6: mergePartnerImportZeile meldet einen Widerspruch bei zwei unterschiedlichen Telefonnummern für dieselbe Auftragsnummer', () => {
  const zeile1 = W.mergePartnerImportZeile(null, {
    auftragsnummer: 'SE-101', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null,
    plz: null, stadt: null, strasse: null, telefonnummer: '0201111111', sachbearbeiter: null, auftragsart: null,
    unsicherheitshinweis: 'x',
  }, 0);
  const zeile2 = W.mergePartnerImportZeile(zeile1, {
    auftragsnummer: 'SE-101', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null,
    plz: null, stadt: null, strasse: null, telefonnummer: '0201222222', sachbearbeiter: null, auftragsart: null,
    unsicherheitshinweis: 'x',
  }, 1);
  assert(zeile2.telefonnummer === '0201111111', 'der erste erkannte Wert bleibt bestehen');
  const widerspruch = zeile2.widersprueche.find((w) => w.feld === 'telefonnummer');
  assert(widerspruch && widerspruch.werte.includes('0201222222'), 'der widersprüchliche zweite Wert muss zur Prüfung vorgelegt werden, nicht verschwinden');
});

pruefe('A7: gruppierePartnerImportRohzeilen überspringt Zeilen ohne Auftragsnummer (nicht zuordenbar)', () => {
  const ergebnis = W.gruppierePartnerImportRohzeilen([], [
    { auftragsnummer: null, partnerStatus: 'offen', faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'Auftragsnummer nicht lesbar' },
    { auftragsnummer: 'SE-200', partnerStatus: 'offen', faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'x' },
  ], 0);
  assert(ergebnis.length === 1 && ergebnis[0].auftragsnummer === 'SE-200');
});

pruefe('A8: findePartnerAuftragsDublette findet nur bei GLEICHEM Partner UND GLEICHER Auftragsnummer', () => {
  const bestehende = [
    { id: 'sa-1', partnerId: 'wr-gruppe', externeAuftragsnummer: 'SE-300' },
    { id: 'sa-2', partnerId: 'anderer-partner', externeAuftragsnummer: 'SE-300' },
  ];
  assert(W.findePartnerAuftragsDublette(bestehende, 'wr-gruppe', 'SE-300')?.id === 'sa-1');
  assert(W.findePartnerAuftragsDublette(bestehende, 'wr-gruppe', 'se-300')?.id === 'sa-1', 'Groß-/Kleinschreibung darf keine Rolle spielen');
  assert(W.findePartnerAuftragsDublette(bestehende, 'wr-gruppe', 'SE-999') === null);
});

pruefe('A9: formatierePartnerImportAdresse baut "Straße, PLZ Stadt" und lässt fehlende Teile weg', () => {
  assert(W.formatierePartnerImportAdresse('Musterweg 12', '45141', 'Essen') === 'Musterweg 12, 45141 Essen');
  assert(W.formatierePartnerImportAdresse('', '45141', 'Essen') === '45141 Essen');
  assert(W.formatierePartnerImportAdresse('', '', '') === '');
});

pruefe('A10: istGueltigesIsoDatum akzeptiert nur JJJJ-MM-TT', () => {
  assert(W.istGueltigesIsoDatum('2026-11-05') === true);
  assert(W.istGueltigesIsoDatum('05.11.2026') === false);
  assert(W.istGueltigesIsoDatum(null) === false);
  assert(W.istGueltigesIsoDatum('') === false);
});

// =============================================================================
// B) baueServiceauftragAusPartnerImportZeile / baueServiceauftragAktualisierungAusPartnerImportZeile
//    - der Kern der "kein unkontrolliertes Überschreiben"-Vorgabe (Punkt 12).
// =============================================================================

pruefe('B1: ein neuer Serviceauftrag aus einer Importzeile hat status "offen" und KEINE Technikerzuweisung/Kundenzuordnung', () => {
  const zeile = { zeilenId: 'z1', auftragsnummer: 'SE-400', partnerStatus: 'offen', faelligkeitsdatum: '2026-11-10', wartungsdauerText: '2 Std.', plz: '45141', stadt: 'Essen', strasse: 'Musterweg 1', telefonnummer: '0201123', sachbearbeiter: 'Herr Schmidt', auftragsart: 'Jahreswartung' };
  const auftrag = W.baueServiceauftragAusPartnerImportZeile(zeile, 'wr-gruppe', 'batch-1');
  assert(auftrag.status === 'offen' && auftrag.technikerIds.length === 0);
  assert(auftrag.kundeId === '' && auftrag.kundenname === '', 'in dieser Phase keine automatische Kundenzuordnung');
  assert(auftrag.externeAuftragsnummer === 'SE-400' && auftrag.partnerId === 'wr-gruppe');
  assert(auftrag.einsatzadresse === 'Musterweg 1, 45141 Essen');
});

pruefe('B2: baueServiceauftragAktualisierungAusPartnerImportZeile füllt NUR leere Felder, überschreibt NIE einen bereits vorhandenen Wert', () => {
  const zeile = { auftragsnummer: 'SE-401', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null, plz: '45141', stadt: 'Essen', strasse: 'Neue Straße 9', telefonnummer: '0201999', sachbearbeiter: null, auftragsart: null };
  const bestehenderAuftrag = { id: 'sa-401', einsatzadresse: 'Alte Adresse 1, 45000 Essen', telefonnummer: '' };
  const { aktualisierteFelder, abweichungen } = W.baueServiceauftragAktualisierungAusPartnerImportZeile(zeile, bestehenderAuftrag);
  assert(aktualisierteFelder.telefonnummer === '0201999', 'ein leeres Feld darf befüllt werden');
  assert(aktualisierteFelder.einsatzadresse === undefined, 'ein bereits befülltes Feld darf NICHT automatisch überschrieben werden');
  const abweichung = abweichungen.find((a) => a.feld === 'einsatzadresse');
  assert(abweichung && abweichung.bestehenderWert === 'Alte Adresse 1, 45000 Essen' && abweichung.neuerWert === 'Neue Straße 9, 45141 Essen', 'die Abweichung muss zur manuellen Prüfung gemeldet werden');
});

pruefe('B3: baueServiceauftragAktualisierungAusPartnerImportZeile berührt NIE technikerIds/status/checklistenPunkte', () => {
  const zeile = { auftragsnummer: 'SE-402', partnerStatus: 'erledigt', faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null };
  const bestehenderAuftrag = { id: 'sa-402', status: 'in_bearbeitung', technikerIds: ['ma-1'], checklistenPunkte: [{ titel: 'x', erledigt: true }] };
  const { aktualisierteFelder } = W.baueServiceauftragAktualisierungAusPartnerImportZeile(zeile, bestehenderAuftrag);
  assert(aktualisierteFelder.status === undefined && aktualisierteFelder.technikerIds === undefined && aktualisierteFelder.checklistenPunkte === undefined, 'ein erneuter Partner-Import darf die laufende Technikerarbeit niemals berühren');
});

// =============================================================================
// C) Orchestrierung: fuehrePartnerImportAnalyseAus (inkl. Rollenprüfung,
//    Mehrfach-Screenshot-Zusammenführung über zwei Aufrufe hinweg).
// =============================================================================

await pruefe('C1: fuehrePartnerImportAnalyseAus lehnt eine nicht-admin-Rolle ab', async () => {
  global.__anthropicMock = anthropicZeilenAntwort([]);
  let fehler = null;
  try {
    await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-c1', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'buero' });
  } catch (err) { fehler = err; }
  assert(fehler && fehler.status === 403);
});

await pruefe('C2: fuehrePartnerImportAnalyseAus lehnt eine unbekannte partnerId ab', async () => {
  let fehler = null;
  try {
    await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-c2', partnerId: 'unbekannter-partner', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  } catch (err) { fehler = err; }
  assert(fehler && fehler.status === 400);
});

await pruefe('C3: zwei aufeinanderfolgende Screenshot-Analysen im selben Batch führen Zeilen zusammen statt sie zu duplizieren', async () => {
  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-500', partnerStatus: 'offen', faelligkeitsdatum: '2026-11-12', wartungsdauerText: '2 Std.', plz: null, stadt: null, strasse: null, telefonnummer: '0201555', sachbearbeiter: 'Frau Klein', auftragsart: 'Jahreswartung', unsicherheitshinweis: 'Keine besonderen Unsicherheiten.' },
  ]);
  const batch1 = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-c3', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  assert(batch1.zeilen.length === 1 && batch1.screenshotAnzahl === 1);

  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-500', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null, plz: '45141', stadt: 'Essen', strasse: 'Musterweg 3', telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'Keine besonderen Unsicherheiten.' },
  ]);
  const batch2 = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-c3', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 1, callerUid: 'uid-1', callerRole: 'admin' });
  assert(batch2.zeilen.length === 1, `erwartet weiterhin genau 1 zusammengeführte Zeile, war ${batch2.zeilen.length}`);
  assert(batch2.zeilen[0].strasse === 'Musterweg 3' && batch2.zeilen[0].partnerStatus === 'offen', 'Felder aus beiden Screenshots müssen in derselben Zeile vorliegen');
  assert(batch2.screenshotAnzahl === 2);
});

// =============================================================================
// D) Orchestrierung: fuehrePartnerImportUebernahmeAus - Dublettenprüfung
//    gegen echte serviceauftraege, nicht-destruktiver Merge, Versionssicherung.
// =============================================================================

await pruefe('D1: Übernahme einer neuen Auftragsnummer legt einen neuen Serviceauftrag an', async () => {
  setzeCollection('serviceauftraege', []);
  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-600', partnerStatus: 'offen', faelligkeitsdatum: '2026-11-20', wartungsdauerText: '2 Std.', plz: '45141', stadt: 'Essen', strasse: 'Musterweg 5', telefonnummer: '0201600', sachbearbeiter: 'Herr Fischer', auftragsart: 'Jahreswartung', unsicherheitshinweis: 'Keine besonderen Unsicherheiten.' },
  ]);
  const batch = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-d1', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  const zeileId = batch.zeilen[0].zeilenId;
  const ergebnis = await W.fuehrePartnerImportUebernahmeAus({ serviceAccount, batchId: 'batch-d1', erwarteteVersion: batch.version, zeilenIds: [zeileId], callerRole: 'admin' });
  assert(ergebnis.neu === 1 && ergebnis.aktualisiert === 0);
  const neuerBatch = liesDoc('jarvisPartnerImportEntwuerfe', 'batch-d1');
  const serviceauftragId = neuerBatch.zeilen[0].uebernommenAlsServiceauftragId;
  const auftrag = liesDoc('serviceauftraege', serviceauftragId);
  assert(auftrag && auftrag.externeAuftragsnummer === 'SE-600' && auftrag.status === 'offen');
});

await pruefe('D2: Übernahme einer bereits vorhandenen Auftragsnummer (gleicher Partner) aktualisiert statt zu duplizieren, und überschreibt KEIN bereits befülltes Feld', async () => {
  setzeCollection('serviceauftraege', [
    { id: 'sa-vorhanden', partnerId: 'wr-gruppe', externeAuftragsnummer: 'SE-601', einsatzadresse: 'Alte Adresse', telefonnummer: '', status: 'zugewiesen', technikerIds: ['ma-9'] },
  ]);
  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-601', partnerStatus: 'offen', faelligkeitsdatum: null, wartungsdauerText: null, plz: '45141', stadt: 'Essen', strasse: 'Ganz neue Straße', telefonnummer: '0201601', sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'Keine besonderen Unsicherheiten.' },
  ]);
  const batch = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-d2', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  const zeileId = batch.zeilen[0].zeilenId;
  const ergebnis = await W.fuehrePartnerImportUebernahmeAus({ serviceAccount, batchId: 'batch-d2', erwarteteVersion: batch.version, zeilenIds: [zeileId], callerRole: 'admin' });
  assert(ergebnis.neu === 0 && ergebnis.aktualisiert === 1, 'darf keinen zweiten Serviceauftrag für dieselbe Auftragsnummer anlegen');
  assert(ergebnis.abweichungen.length === 1 && ergebnis.abweichungen[0].abweichungen.some((a) => a.feld === 'einsatzadresse'));
  const auftrag = liesDoc('serviceauftraege', 'sa-vorhanden');
  assert(auftrag.einsatzadresse === 'Alte Adresse', 'die bereits vorhandene Adresse darf nicht überschrieben worden sein');
  assert(auftrag.telefonnummer === '0201601', 'das vorher leere Telefonnummer-Feld darf befüllt worden sein');
  assert(auftrag.status === 'zugewiesen' && auftrag.technikerIds.length === 1, 'Status/Technikerzuweisung dürfen durch den Import nicht verändert werden');
});

await pruefe('D3: eine veraltete erwarteteVersion wird abgelehnt (Versionssicherung wie bei allen anderen JARVIS-Freigaben)', async () => {
  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-602', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'x' },
  ]);
  const batch = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-d3', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  let fehler = null;
  try {
    await W.fuehrePartnerImportUebernahmeAus({ serviceAccount, batchId: 'batch-d3', erwarteteVersion: batch.version - 1, zeilenIds: [batch.zeilen[0].zeilenId], callerRole: 'admin' });
  } catch (err) { fehler = err; }
  assert(fehler && fehler.status === 409);
});

await pruefe('D4: eine bereits übernommene Zeile wird bei erneuter Auswahl nicht nochmal verarbeitet (kein doppeltes Anlegen)', async () => {
  setzeCollection('serviceauftraege', []);
  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-603', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'x' },
  ]);
  const batch = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-d4', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  const zeileId = batch.zeilen[0].zeilenId;
  const ergebnis1 = await W.fuehrePartnerImportUebernahmeAus({ serviceAccount, batchId: 'batch-d4', erwarteteVersion: batch.version, zeilenIds: [zeileId], callerRole: 'admin' });
  assert(ergebnis1.neu === 1);
  const zwischenstand = liesDoc('jarvisPartnerImportEntwuerfe', 'batch-d4');
  const ergebnis2 = await W.fuehrePartnerImportUebernahmeAus({ serviceAccount, batchId: 'batch-d4', erwarteteVersion: zwischenstand.version, zeilenIds: [zeileId], callerRole: 'admin' });
  assert(ergebnis2.neu === 0 && ergebnis2.aktualisiert === 0, 'eine bereits übernommene Zeile darf kein zweites Mal verarbeitet werden');
  const alleAuftraege = [...firestoreDb.keys()].filter((k) => k.startsWith('serviceauftraege/'));
  assert(alleAuftraege.length === 1, 'es darf nur EIN Serviceauftrag für diese Importzeile entstanden sein');
});

// =============================================================================
// E) Orchestrierung: fuehrePartnerImportVerwerfAus
// =============================================================================

await pruefe('E1: Verwerfen markiert nur die ausgewählte Zeile, nicht den ganzen Batch, und legt NIE einen Serviceauftrag an', async () => {
  setzeCollection('serviceauftraege', []);
  global.__anthropicMock = anthropicZeilenAntwort([
    { auftragsnummer: 'SE-700', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'x' },
    { auftragsnummer: 'SE-701', partnerStatus: null, faelligkeitsdatum: null, wartungsdauerText: null, plz: null, stadt: null, strasse: null, telefonnummer: null, sachbearbeiter: null, auftragsart: null, unsicherheitshinweis: 'x' },
  ]);
  const batch = await W.fuehrePartnerImportAnalyseAus({ serviceAccount, env: envBasis(), batchId: 'batch-e1', partnerId: 'wr-gruppe', bildDataUrl: DUMMY_PNG, screenshotIndex: 0, callerUid: 'uid-1', callerRole: 'admin' });
  const zeileZuVerwerfen = batch.zeilen.find((z) => z.auftragsnummer === 'SE-700');
  await W.fuehrePartnerImportVerwerfAus({ serviceAccount, batchId: 'batch-e1', erwarteteVersion: batch.version, zeilenIds: [zeileZuVerwerfen.zeilenId], callerRole: 'admin' });
  const aktualisierterBatch = liesDoc('jarvisPartnerImportEntwuerfe', 'batch-e1');
  const verworfen = aktualisierterBatch.zeilen.find((z) => z.auftragsnummer === 'SE-700');
  const uebrige = aktualisierterBatch.zeilen.find((z) => z.auftragsnummer === 'SE-701');
  assert(verworfen.uebernahmeStatus === 'verworfen');
  assert(uebrige.uebernahmeStatus === 'offen', 'die zweite Zeile darf vom Verwerfen der ersten nicht betroffen sein');
  const alleAuftraege = [...firestoreDb.keys()].filter((k) => k.startsWith('serviceauftraege/'));
  assert(alleAuftraege.length === 0, 'Verwerfen darf niemals einen Serviceauftrag anlegen');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
