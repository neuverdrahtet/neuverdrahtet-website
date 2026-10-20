// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 5
// (JARVIS-Freigabecenter: Versionssicherung, konkrete Aktionstypen,
// Zentrale-Datenaggregation, Tagesbericht) ab.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase5.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p5',
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

const quotePatchAufrufe = [];

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

  if (u.href.startsWith('https://ki-buerokraft.test')) {
    if (/^\/quotes\/.+$/.test(u.pathname) && method === 'PATCH') {
      const body = JSON.parse(init.body);
      quotePatchAufrufe.push({ id: u.pathname.split('/')[2], body });
      return jsonResponse(200, { success: true, data: { id: u.pathname.split('/')[2], status: 'draft', items: body.items } });
    }
    return jsonResponse(404, { success: false, error: { message: `unbekannte KI-Bürokraft-Route im Mock: ${method} ${u.pathname}` } });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function envBasis(extra = {}) {
  return { KI_BUEROKRAFT_URL: 'https://ki-buerokraft.test', KI_BUEROKRAFT_API_KEY: 'fake-kib', ...extra };
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
// A) Versionssicherung: falsche Version wird abgelehnt, korrekte Version
//    funktioniert.
// =============================================================================
await pruefe('A1: Freigabe mit veralteter Version wird abgelehnt (409)', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-a', { status: 'verarbeitet', version: 2, freigabeStatus: 'offen' });
  try {
    await W.wendeFreigabeAn({ serviceAccount, collection: 'jarvisEmailVerarbeitung', id: 'mail-a', erwarteteVersion: 1, entscheidung: 'freigeben' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 409, `Status muss 409 sein, war ${err.status}`);
  }
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-a');
  assert(doc.freigabeStatus === 'offen', 'Status darf bei abgelehnter Freigabe unverändert bleiben');
});

await pruefe('A2: Freigabe mit korrekter Version funktioniert', async () => {
  const ergebnis = await W.wendeFreigabeAn({ serviceAccount, collection: 'jarvisEmailVerarbeitung', id: 'mail-a', erwarteteVersion: 2, entscheidung: 'freigeben' });
  assert(ergebnis.freigabeStatus === 'freigegeben', 'Ergebnis muss freigegeben melden');
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-a');
  assert(doc.freigabeStatus === 'freigegeben', 'Status muss freigegeben sein');
  assert(doc.status === 'verarbeitet', 'bestehende Felder (status) dürfen durch die Freigabe nicht verloren gehen');
});

// =============================================================================
// B) email.pruefen über die volle Orchestrierung (erstelleUndFuehreJarvisFreigabeAus)
// =============================================================================
await pruefe('B1: email.pruefen (ablehnen) über die volle Freigabe-Orchestrierung', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-b', { status: 'verarbeitet', version: 1, freigabeStatus: 'offen' });
  const ergebnis = await W.erstelleUndFuehreJarvisFreigabeAus({
    serviceAccount, env: envBasis(), typ: 'email.pruefen', entityId: 'mail-b',
    payload: { entscheidung: 'ablehnen', erwarteteVersion: 1 }, callerUid: 'admin-uid', callerRole: 'admin',
  });
  assert(ergebnis.freigabeStatus === 'abgelehnt', 'muss abgelehnt melden');
  const aktion = liesDoc('jarvisAktionen', 'email.pruefen-mail-b-v1');
  assert(aktion.status === 'executed', 'die jarvisAktion muss als executed markiert sein');
  assert(aktion.typ === 'email.pruefen', 'typ darf beim Abschluss nicht verlorengehen (siehe Bugfix)');
});

await pruefe('B2: doppelter Freigabe-Request (identische Version) führt NICHT zu doppelter/widersprüchlicher Ausführung', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-c', { status: 'verarbeitet', version: 1, freigabeStatus: 'offen' });
  const ersteAnfrage = () => W.erstelleUndFuehreJarvisFreigabeAus({
    serviceAccount, env: envBasis(), typ: 'email.pruefen', entityId: 'mail-c',
    payload: { entscheidung: 'freigeben', erwarteteVersion: 1 }, callerUid: 'admin-uid', callerRole: 'admin',
  });
  const [a, b] = await Promise.allSettled([ersteAnfrage(), ersteAnfrage()]);
  const erfolge = [a, b].filter((r) => r.status === 'fulfilled');
  assert(erfolge.length >= 1, 'mindestens einer der beiden gleichzeitigen Versuche muss gelingen');
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-c');
  assert(doc.freigabeStatus === 'freigegeben', 'Endzustand muss konsistent freigegeben sein');
});

await pruefe('B3: unbekannter Aktionstyp wird abgelehnt (400), keine beliebige KI-Aktion ausführbar', async () => {
  try {
    await W.erstelleUndFuehreJarvisFreigabeAus({
      serviceAccount, env: envBasis(), typ: 'rechnung.versenden', entityId: 'irgendwas',
      payload: { entscheidung: 'freigeben', erwarteteVersion: 1 }, callerUid: 'admin-uid', callerRole: 'admin',
    });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 400, 'Status muss 400 sein');
    assert(err.message.includes('rechnung.versenden'), 'Fehlermeldung muss den abgelehnten Typ benennen');
  }
});

// =============================================================================
// C) rechnung.pruefen + rechnung.bearbeiten: Bearbeitung setzt Freigabe zurück
// =============================================================================
await pruefe('C1: rechnung.bearbeiten erhöht Version und setzt freigabeStatus zurück auf "offen"', async () => {
  setDoc('jarvisRechnungsEntwuerfe', 'proj-c', { status: 'entwurf_erstellt', version: 1, freigabeStatus: 'offen', positionen: [{ title: 'Alt', unit_price_net: 10 }] });
  const ergebnis = await W.bearbeiteRechnungsEntwurf({ serviceAccount, id: 'proj-c', erwarteteVersion: 1, neuePositionen: [{ title: 'Neu', unit_price_net: 20 }] });
  assert(ergebnis.version === 2, 'Version muss auf 2 erhöht werden');
  const doc = liesDoc('jarvisRechnungsEntwuerfe', 'proj-c');
  assert(doc.freigabeStatus === 'offen', 'nach Bearbeitung ist erneute Freigabe nötig (freigabeStatus zurückgesetzt)');
  assert(doc.positionen[0].title === 'Neu', 'Positionen müssen aktualisiert sein');
});

await pruefe('C2: Freigabe mit der ALTEN (vor der Bearbeitung gültigen) Version schlägt jetzt fehl', async () => {
  try {
    await W.wendeFreigabeAn({ serviceAccount, collection: 'jarvisRechnungsEntwuerfe', id: 'proj-c', erwarteteVersion: 1, entscheidung: 'freigeben' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 409, 'alte Version darf nach einer Bearbeitung nicht mehr freigebbar sein');
  }
});

// =============================================================================
// D) mahnung.pruefen (kein "bearbeiten" möglich, siehe Bericht)
// =============================================================================
await pruefe('D1: mahnung.pruefen freigeben/ablehnen', async () => {
  setDoc('jarvisMahnEntwuerfe', 'rech-1-stufe-1', { status: 'erstellt', version: 1, freigabeStatus: 'offen' });
  const ergebnis = await W.wendeFreigabeAn({ serviceAccount, collection: 'jarvisMahnEntwuerfe', id: 'rech-1-stufe-1', erwarteteVersion: 1, entscheidung: 'freigeben' });
  assert(ergebnis.freigabeStatus === 'freigegeben', 'Mahnentwurf muss freigebbar sein');
});

// =============================================================================
// E) termin.pruefen: Slot-Auswahl bucht NICHTS verbindlich, nur interne Auswahl.
// =============================================================================
await pruefe('E1: termin.pruefen freigeben wählt den angegebenen Slot aus', async () => {
  setDoc('jarvisTerminVorschlaege', 'anlage-1-2026-12-01', { status: 'vorschlag_erstellt', version: 1, freigabeStatus: 'offen', vorschlaege: [{ start: '2026-12-01T09:00:00Z', end: '2026-12-01T10:00:00Z' }, { start: '2026-12-02T09:00:00Z', end: '2026-12-02T10:00:00Z' }] });
  const ergebnis = await W.wendeTerminFreigabeAn({ serviceAccount, id: 'anlage-1-2026-12-01', erwarteteVersion: 1, entscheidung: 'freigeben', ausgewaehlterSlotIndex: 1 });
  assert(ergebnis.ausgewaehlterSlot.start === '2026-12-02T09:00:00Z', 'der ZWEITE (Index 1) Slot muss ausgewählt werden');
  const doc = liesDoc('jarvisTerminVorschlaege', 'anlage-1-2026-12-01');
  assert(doc.freigabeStatus === 'freigegeben', 'Status muss freigegeben sein');
});

await pruefe('E2: termin.pruefen mit ungültigem Slot-Index schlägt fehl', async () => {
  setDoc('jarvisTerminVorschlaege', 'anlage-2-2026-12-01', { status: 'vorschlag_erstellt', version: 1, freigabeStatus: 'offen', vorschlaege: [{ start: '2026-12-01T09:00:00Z', end: '2026-12-01T10:00:00Z' }] });
  try {
    await W.wendeTerminFreigabeAn({ serviceAccount, id: 'anlage-2-2026-12-01', erwarteteVersion: 1, entscheidung: 'freigeben', ausgewaehlterSlotIndex: 5 });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 400, 'ungültiger Index muss 400 liefern');
  }
});

// =============================================================================
// F) angebot.pruefen + angebot.bearbeiten: ruft ECHT PATCH /quotes auf,
//    Plausibilitätsprüfung greift auch bei der Bearbeitung.
// =============================================================================
await pruefe('F1: angebot.bearbeiten ruft PATCH /quotes auf, erhöht Version, setzt Freigabe zurück', async () => {
  setDoc('jarvisAngebotsPruefung', 'angebot-f1', { angebotId: 'angebot-f1', version: 1, freigabeStatus: 'offen' });
  const ergebnis = await W.wendeAngebotsFreigabeAn({
    serviceAccount, env: envBasis(), angebotId: 'angebot-f1', erwarteteVersion: 1, entscheidung: 'bearbeiten',
    neuePositionen: [{ article_id: 'a1', title: 'Steckdose', unit: 'Stk.', quantity: 3, unit_price_net: 45, vat_rate: 19 }],
  });
  assert(ergebnis.version === 2, 'Version muss erhöht werden');
  assert(quotePatchAufrufe.some((a) => a.id === 'angebot-f1'), 'PATCH /quotes muss tatsächlich aufgerufen worden sein');
  const doc = liesDoc('jarvisAngebotsPruefung', 'angebot-f1');
  assert(doc.freigabeStatus === 'offen', 'nach Bearbeitung erneute Freigabe nötig');
});

await pruefe('F2: angebot.bearbeiten verwirft ungültige Positionen auch hier (Plausibilitätsprüfung)', async () => {
  setDoc('jarvisAngebotsPruefung', 'angebot-f2', { angebotId: 'angebot-f2', version: 1, freigabeStatus: 'offen' });
  try {
    await W.wendeAngebotsFreigabeAn({
      serviceAccount, env: envBasis(), angebotId: 'angebot-f2', erwarteteVersion: 1, entscheidung: 'bearbeiten',
      neuePositionen: [{ article_id: 'a1', title: 'Kaputt', unit: 'Stk.', quantity: 1, unit_price_net: 0, vat_rate: 19 }],
    });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.message.includes('Plausibilitätsprüfung'), `unerwartete Fehlermeldung: ${err.message}`);
  }
});

await pruefe('F3: angebot.pruefen freigeben ohne Bearbeitung', async () => {
  setDoc('jarvisAngebotsPruefung', 'angebot-f3', { angebotId: 'angebot-f3', version: 1, freigabeStatus: 'offen' });
  const ergebnis = await W.wendeAngebotsFreigabeAn({ serviceAccount, env: envBasis(), angebotId: 'angebot-f3', erwarteteVersion: 1, entscheidung: 'freigeben' });
  assert(ergebnis.freigabeStatus === 'freigegeben', 'muss freigegeben melden');
});

// =============================================================================
// G) Zentrale-Datenaggregation + Tagesbericht
// =============================================================================
await pruefe('G1: holeJarvisZentraleDaten listet nur NOCH OFFENE Entwürfe, freigegebene fallen raus', async () => {
  // mail-a/mail-b/mail-c wurden oben bereits freigegeben/abgelehnt - dürfen
  // NICHT mehr in "neueKundenanfragen" auftauchen. Eine frische, offene E-Mail:
  setDoc('jarvisEmailVerarbeitung', 'mail-offen', { status: 'verarbeitet', version: 1, freigabeStatus: 'offen', entwurfErstellt: true });
  const daten = await W.holeJarvisZentraleDaten({ serviceAccount });
  assert(daten.neueKundenanfragen.some((e) => e.id === 'mail-offen'), 'die offene E-Mail muss gelistet sein');
  assert(!daten.neueKundenanfragen.some((e) => e.id === 'mail-a'), 'die bereits freigegebene mail-a darf NICHT mehr als offen gelistet sein');
  // angebot-f1 wurde bearbeitet (setzt freigabeStatus bewusst zurück auf
  // "offen" - erneute Prüfung nötig), angebot-f2's Bearbeitung ist an der
  // Plausibilitätsprüfung gescheitert (blieb unverändert "offen"),
  // angebot-f3 wurde freigegeben (fällt raus). Erwartung: genau 2 offen.
  assert(daten.angebotsentwuerfe.some((a) => a.angebotId === 'angebot-f1'), 'angebot-f1 muss nach der Bearbeitung wieder als offen gelten');
  assert(daten.angebotsentwuerfe.some((a) => a.angebotId === 'angebot-f2'), 'angebot-f2 (gescheiterte Bearbeitung) muss weiterhin offen sein');
  assert(!daten.angebotsentwuerfe.some((a) => a.angebotId === 'angebot-f3'), 'angebot-f3 wurde freigegeben und darf nicht mehr als offen gelten');
  assert(daten.jobsNachStatus, 'jobsNachStatus muss vorhanden sein');
});

await pruefe('G2: erzeugeJarvisTagesbericht liefert konsistente Zahlen zur Zentrale', async () => {
  const daten = await W.holeJarvisZentraleDaten({ serviceAccount });
  const bericht = await W.erzeugeJarvisTagesbericht({ serviceAccount });
  assert(bericht.neueKundenanfragen === daten.neueKundenanfragen.length, 'Tagesbericht und Zentrale müssen dieselbe Zahl zeigen');
  assert(typeof bericht.kiKostenMonatUsd === 'number', 'KI-Kosten müssen als Zahl geliefert werden');
});

// =============================================================================
// H) Rollenprüfung bleibt auch über den neuen Orchestrator durchgesetzt.
// =============================================================================
await pruefe('H1: erstelleUndFuehreJarvisFreigabeAus lehnt Nicht-Admin ab', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-h', { status: 'verarbeitet', version: 1, freigabeStatus: 'offen' });
  try {
    await W.erstelleUndFuehreJarvisFreigabeAus({
      serviceAccount, env: envBasis(), typ: 'email.pruefen', entityId: 'mail-h',
      payload: { entscheidung: 'freigeben', erwarteteVersion: 1 }, callerUid: 'uid', callerRole: 'mitarbeiter',
    });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(/admin/i.test(err.message), 'Fehlermeldung muss auf fehlende Admin-Rolle hinweisen');
  }
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-h');
  assert(doc.freigabeStatus === 'offen', 'ein abgelehnter Nicht-Admin-Versuch darf den Status nicht verändern');
});

global.fetch = ORIG_FETCH;
console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
