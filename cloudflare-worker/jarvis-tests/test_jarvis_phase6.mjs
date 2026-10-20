// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export) - deckt Phase 6 ab:
// sichere Bearbeitung von E-Mail-/Mahnentwürfen (firestoreMergeFelder) sowie
// JARVIS CONTROL (Kennzahlen, proaktive Überwachung), inkl. unvollständiger
// und widersprüchlicher Finanzdaten (Vorgabe Punkt 6).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase6.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-p6',
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

let googleBueroAufrufe = 0;

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
    // PATCH mit updateMask.fieldPaths-Query-Parametern (firestoreMergeFelder)
    // ODER ohne (firestoreSetDoc, voller Überschreib-Vorgang) - entscheidend
    // unterscheidet sich das Mock-Verhalten genau hier.
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
    googleBueroAufrufe++;
    return jsonResponse(200, { success: true, data: { id: 'draft-x' } });
  }

  if (u.href.startsWith('https://ki-buerokraft.test')) {
    if (u.pathname === '/quotes/angebot-anreicherung-1' && method === 'GET') {
      return jsonResponse(200, { success: true, data: { id: 'angebot-anreicherung-1', items: [{ article_id: 'a1', title: 'Testposition', unit: 'Stk.', quantity: 2, unit_price_net: 50, vat_rate: 19 }] } });
    }
    return jsonResponse(404, { success: false, error: { message: `unbekannte KI-Bürokraft-Route im Mock: ${method} ${u.pathname}` } });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function envBasis(extra = {}) {
  return { GOOGLE_BUERO_URL: 'https://google-buero.test', GOOGLE_BUERO_API_KEY: 'fake-google', ...extra };
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
function setzeCollection(collection, eintraege) {
  for (const key of [...firestoreDb.keys()]) if (key.startsWith(`${collection}/`)) firestoreDb.delete(key);
  for (const e of eintraege) setDoc(collection, e.id, e);
}
function loescheJob(typ, heute) { firestoreDb.delete(`jarvisJobs/${typ}-${heute}`); }

const HEUTE = new Date().toISOString().slice(0, 10);

// =============================================================================
// A) firestoreMergeFelder: ändert NUR die genannten Felder, der Rest bleibt
//    unberührt (Sicherheitsgarantie für mahnung.bearbeiten).
// =============================================================================
await pruefe('A1: firestoreMergeFelder lässt nicht genannte Felder unangetastet', async () => {
  setDoc('mahnungen', 'mahnung-a', { rechnungId: 'rech-a', stufe: 1, gebuehr: 5, text: 'alt' });
  await W.firestoreMergeFelder({ serviceAccount, collection: 'mahnungen', id: 'mahnung-a', felder: { text: 'neu' } });
  const doc = liesDoc('mahnungen', 'mahnung-a');
  assert(doc.text === 'neu', 'text muss geändert sein');
  assert(doc.rechnungId === 'rech-a', 'rechnungId darf NICHT verloren gehen');
  assert(doc.stufe === 1, 'stufe darf NICHT verloren gehen');
  assert(doc.gebuehr === 5, 'gebuehr darf unverändert bleiben, wenn nicht mitgegeben');
});

// =============================================================================
// B) email.bearbeiten: Text wird sicher gespeichert, Version erhöht,
//    Freigabe zurückgesetzt, bester Versuch eines aktualisierten Gmail-Entwurfs.
// =============================================================================
await pruefe('B1: bearbeiteEmailAntwortentwurf aktualisiert Text, Version, Freigabestatus', async () => {
  setDoc('jarvisEmailVerarbeitung', 'mail-b1', { status: 'verarbeitet', version: 1, freigabeStatus: 'offen', antwortentwurfText: 'alt', emailVon: 'Kunde <kunde@beispiel.de>' });
  const vorherAufrufe = googleBueroAufrufe;
  const ergebnis = await W.bearbeiteEmailAntwortentwurf({ serviceAccount, env: envBasis(), id: 'mail-b1', erwarteteVersion: 1, antwortentwurfBetreff: 'Neuer Betreff', antwortentwurfText: 'Neuer Text' });
  assert(ergebnis.version === 2, 'Version muss erhöht werden');
  assert(googleBueroAufrufe === vorherAufrufe + 1, 'es muss versucht werden, einen aktualisierten Gmail-Entwurf anzulegen');
  const doc = liesDoc('jarvisEmailVerarbeitung', 'mail-b1');
  assert(doc.antwortentwurfText === 'Neuer Text', 'Text muss gespeichert sein');
  assert(doc.freigabeStatus === 'offen', 'nach Bearbeitung erneute Freigabe nötig');
});

await pruefe('B2: Freigabe mit veralteter Version (vor der Bearbeitung) schlägt danach fehl', async () => {
  try {
    await W.wendeFreigabeAn({ serviceAccount, collection: 'jarvisEmailVerarbeitung', id: 'mail-b1', erwarteteVersion: 1, entscheidung: 'freigeben' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.status === 409, 'alte Version darf nach Bearbeitung nicht mehr gültig sein');
  }
});

// =============================================================================
// C) mahnung.bearbeiten: ändert NUR text/gebuehr der ECHTEN mahnungen-
//    Collection, OHNE rechnungId/stufe zu gefährden.
// =============================================================================
await pruefe('C1: bearbeiteMahnEntwurf ändert echten Mahntext sicher, erhöht JARVIS-Version', async () => {
  setDoc('mahnungen', 'mahnung-c1', { rechnungId: 'rech-c1', stufe: 2, datum: HEUTE, neueFrist: '2026-12-01', gebuehr: 5, text: '' });
  setDoc('jarvisMahnEntwuerfe', 'rech-c1-stufe-2', { status: 'erstellt', rechnungId: 'rech-c1', stufe: 2, mahnungId: 'mahnung-c1', version: 1, freigabeStatus: 'offen' });
  const ergebnis = await W.bearbeiteMahnEntwurf({ serviceAccount, id: 'rech-c1-stufe-2', erwarteteVersion: 1, text: 'Bitte zahlen Sie den Betrag umgehend.', gebuehr: 7.5 });
  assert(ergebnis.version === 2, 'JARVIS-Version muss erhöht werden');
  const mahnung = liesDoc('mahnungen', 'mahnung-c1');
  assert(mahnung.text === 'Bitte zahlen Sie den Betrag umgehend.', 'Mahntext muss aktualisiert sein');
  assert(mahnung.gebuehr === 7.5, 'Gebühr muss aktualisiert sein');
  assert(mahnung.rechnungId === 'rech-c1', 'rechnungId darf NICHT verloren gehen');
  assert(mahnung.stufe === 2, 'stufe darf NICHT verloren gehen');
  assert(mahnung.neueFrist === '2026-12-01', 'neueFrist darf NICHT verloren gehen');
  const entwurf = liesDoc('jarvisMahnEntwuerfe', 'rech-c1-stufe-2');
  assert(entwurf.freigabeStatus === 'offen', 'nach Bearbeitung erneute Freigabe nötig');
});

// =============================================================================
// C2) Bei der Vorbereitung des interaktiven Browsertests (Phase 6, Punkt 1)
//    aufgefallene Lücke: jarvisAngebotsPruefung speichert NIE die Positionen
//    selbst (siehe Kommentar bei dessen firestoreSetDoc in worker.js) - ohne
//    Anreicherung hätte "sicheres Bearbeiten" eines Angebotsentwurfs in der
//    Zentrale IMMER mit einer leeren Positionsliste begonnen, Danny hätte vor
//    dem Überschreiben nie die echten aktuellen Positionen gesehen. Behoben
//    durch einen zusätzlichen GET /quotes/{id}-Aufruf in
//    holeJarvisZentraleDaten, der fehlschlagen darf, ohne die Zentrale
//    abstürzen zu lassen (siehe C3).
// =============================================================================
await pruefe('C2: holeJarvisZentraleDaten reichert Angebotsentwürfe mit den echten aktuellen Positionen an (GET /quotes/{id})', async () => {
  setDoc('jarvisAngebotsPruefung', 'angebot-anreicherung-1', { angebotId: 'angebot-anreicherung-1', kundeId: 'kunde-1', version: 1, freigabeStatus: 'offen' });
  const env = { ...envBasis(), KI_BUEROKRAFT_URL: 'https://ki-buerokraft.test', KI_BUEROKRAFT_API_KEY: 'fake-kib' };
  const daten = await W.holeJarvisZentraleDaten({ serviceAccount, env });
  const angereichert = daten.angebotsentwuerfe.find((a) => a.angebotId === 'angebot-anreicherung-1');
  assert(angereichert, 'Angebotsentwurf muss weiterhin gelistet sein');
  assert(Array.isArray(angereichert.items) && angereichert.items.length === 1, 'die echten aktuellen Positionen müssen angehängt sein');
  assert(angereichert.items[0].title === 'Testposition', 'Positionsdaten müssen vom echten Angebot stammen, nicht erfunden sein');
});

await pruefe('C3: holeJarvisZentraleDaten stürzt NICHT ab, wenn die Positions-Anreicherung fehlschlägt (KI-Bürokraft nicht erreichbar)', async () => {
  setDoc('jarvisAngebotsPruefung', 'angebot-ohne-verbindung', { angebotId: 'angebot-ohne-verbindung', kundeId: 'kunde-1', version: 1, freigabeStatus: 'offen' });
  const daten = await W.holeJarvisZentraleDaten({ serviceAccount, env: {} });
  const eintrag = daten.angebotsentwuerfe.find((a) => a.angebotId === 'angebot-ohne-verbindung');
  assert(eintrag, 'Angebotsentwurf muss trotz fehlgeschlagener Anreicherung weiterhin gelistet sein');
  assert(!eintrag.items, 'ohne erreichbare KI-Bürokraft dürfen KEINE erfundenen Positionen auftauchen');
});

// =============================================================================
// D) CONTROL-Kennzahlen (reine Funktionen) - inkl. unvollständiger/
//    widersprüchlicher Finanzdaten (Vorgabe Punkt 6).
// =============================================================================
await pruefe('D1: berechneUmsatzverlauf trennt Rechnungsumsatz von Zahlungseingang, ignoriert Stornos', async () => {
  const heuteMonat = HEUTE.slice(0, 7);
  const rechnungen = [
    { datum: `${heuteMonat}-05`, netto: 100, brutto: 119, status: 'offen' },
    { datum: `${heuteMonat}-10`, netto: 200, brutto: 238, status: 'bezahlt', bezahltAm: `${heuteMonat}-15` },
    { datum: `${heuteMonat}-12`, netto: 999, brutto: 999, status: 'storniert' }, // muss ignoriert werden
  ];
  const verlauf = W.berechneUmsatzverlauf(rechnungen, 2);
  const aktuellerMonat = verlauf[verlauf.length - 1];
  assert(aktuellerMonat.rechnungsumsatzNetto === 300, `Rechnungsumsatz (ohne Storno) muss 300 sein, war ${aktuellerMonat.rechnungsumsatzNetto}`);
  assert(aktuellerMonat.zahlungseingang === 238, `Zahlungseingang muss nur die bezahlte Rechnung umfassen, war ${aktuellerMonat.zahlungseingang}`);
  assert(aktuellerMonat.anzahlRechnungen === 2, 'Storno darf nicht mitgezählt werden');
});

await pruefe('D2: berechneForderungen berücksichtigt Teilzahlungen und Überfälligkeit', async () => {
  const rechnungen = [
    { status: 'offen', brutto: 500, faelligAm: '2020-01-01' }, // überfällig
    { status: 'teilbezahlt', brutto: 500, teilzahlungBetrag: 300, faelligAm: '2099-01-01' }, // Rest 200, nicht überfällig
    { status: 'bezahlt', brutto: 1000, faelligAm: '2020-01-01' }, // darf NICHT als offen zählen
    { status: 'storniert', brutto: 1000, faelligAm: '2020-01-01' }, // darf NICHT zählen
  ];
  const ergebnis = W.berechneForderungen(rechnungen, HEUTE);
  assert(ergebnis.offenBrutto === 700, `offenBrutto muss 500+200=700 sein, war ${ergebnis.offenBrutto}`);
  assert(ergebnis.ueberfaelligBrutto === 500, `ueberfaelligBrutto muss nur die erste Rechnung (500) umfassen, war ${ergebnis.ueberfaelligBrutto}`);
  assert(ergebnis.anzahlOffen === 2, 'anzahlOffen muss 2 sein');
});

await pruefe('D3: berechneAngeboteUndAuftragsbestand erkennt "ohne Rückmeldung" und schließt bereits abgerechnete Projekte aus dem Auftragsbestand aus', async () => {
  const altesDatum = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const angebote = [
    { id: 'ang-1', status: 'versendet', datum: altesDatum, kundeId: 'k1' }, // > 14 Tage -> ohne Rückmeldung
    { id: 'ang-2', status: 'versendet', datum: HEUTE, kundeId: 'k2' }, // frisch, keine Rückmeldung nötig
    { id: 'ang-3', status: 'angenommen', netto: 1000, projektId: 'proj-3' }, // keine Schlussrechnung -> Auftragsbestand
    { id: 'ang-4', status: 'angenommen', netto: 2000, projektId: 'proj-4' }, // HAT Schlussrechnung -> NICHT im Auftragsbestand
  ];
  const rechnungen = [{ projektId: 'proj-4', rechnungstyp: 'rechnung', status: 'offen' }];
  const ergebnis = W.berechneAngeboteUndAuftragsbestand(angebote, rechnungen, HEUTE);
  assert(ergebnis.ohneRueckmeldung.length === 1 && ergebnis.ohneRueckmeldung[0].id === 'ang-1', 'nur das alte versendete Angebot gilt als ohne Rückmeldung');
  assert(ergebnis.auftragsbestandNetto === 1000, `Auftragsbestand darf proj-4 (bereits abgerechnet) nicht enthalten, war ${ergebnis.auftragsbestandNetto}`);
});

await pruefe('D4: berechneProjektDeckungsbeitraege markiert fehlende Daten statt zu raten (unvollständige/widersprüchliche Finanzdaten)', async () => {
  const projekte = [
    { id: 'proj-ohne-angebot', titel: 'Ohne Angebot' },
    { id: 'proj-ohne-lohn', titel: 'Ohne Stundenlohn' },
    { id: 'proj-vollstaendig', titel: 'Vollständig' },
  ];
  const angebote = [
    { status: 'angenommen', projektId: 'proj-ohne-lohn', netto: 1000 },
    { status: 'angenommen', projektId: 'proj-vollstaendig', netto: 1000 },
  ];
  const ausgaben = [{ projektId: 'proj-vollstaendig', betragNetto: 200 }];
  const zeiterfassung = [
    { projektId: 'proj-ohne-lohn', mitarbeiterId: 'ma-ohne-lohn', dauerMinuten: 60 },
    { projektId: 'proj-vollstaendig', mitarbeiterId: 'ma-1', dauerMinuten: 120 },
  ];
  const mitarbeiter = [{ id: 'ma-1', stundenlohn: 25 }, { id: 'ma-ohne-lohn' }]; // ma-ohne-lohn hat KEINEN Stundenlohn hinterlegt
  const ergebnisse = W.berechneProjektDeckungsbeitraege({ projekte, angebote, ausgaben, zeiterfassung, mitarbeiter });

  const ohneAngebot = ergebnisse.find((e) => e.projektId === 'proj-ohne-angebot');
  assert(ohneAngebot.unvollstaendig === true, 'Projekt ohne angenommenes Angebot muss als unvollständig markiert werden, NICHT als 0');

  const ohneLohn = ergebnisse.find((e) => e.projektId === 'proj-ohne-lohn');
  assert(ohneLohn.unvollstaendig === true, 'Projekt mit fehlendem Stundenlohn muss als unvollständig markiert werden, NICHT mit falschen Kosten gerechnet');

  const vollstaendig = ergebnisse.find((e) => e.projektId === 'proj-vollstaendig');
  assert(vollstaendig.unvollstaendig === false, 'vollständiges Projekt muss berechnet werden');
  assert(vollstaendig.arbeitskosten === 50, `Arbeitskosten müssen 2 Std. x 25 € = 50 € sein, war ${vollstaendig.arbeitskosten}`);
  assert(vollstaendig.deckungsbeitrag === 1000 - 200 - 50, `Deckungsbeitrag muss 750 sein, war ${vollstaendig.deckungsbeitrag}`);
});

await pruefe('D5: berechneMitarbeiterAuslastung berechnet Ist/Soll-Stunden nur für Mitarbeiter mit hinterlegter Wochenstundenzahl', async () => {
  const heuteMonat = HEUTE.slice(0, 7);
  const mitarbeiter = [{ id: 'ma-1', name: 'Max', wochenstunden: 40 }, { id: 'ma-2', name: 'Ohne Soll' }];
  const zeiterfassung = [{ mitarbeiterId: 'ma-1', datum: `${heuteMonat}-05`, dauerMinuten: 480 }];
  const ergebnis = W.berechneMitarbeiterAuslastung(mitarbeiter, zeiterfassung);
  assert(ergebnis.length === 1, 'nur Mitarbeiter MIT hinterlegter Wochenstundenzahl dürfen eine Auslastung bekommen');
  assert(ergebnis[0].istStunden === 8, 'Ist-Stunden müssen 8 sein (480 Minuten)');
});

await pruefe('D6: berechneWartungsvertraege erfindet NIE einen wiederkehrenden Umsatzwert', () => {
  const ergebnis = W.berechneWartungsvertraege([{ kategorie: 'wartungsvertrag', naechstePruefung: HEUTE }], HEUTE);
  assert(ergebnis.wiederkehrenderUmsatz === null, 'wiederkehrenderUmsatz muss explizit null sein (keine Datengrundlage), nicht 0 oder geraten');
  assert(ergebnis.hinweis.length > 0, 'die fehlende Datengrundlage muss als Hinweis sichtbar sein');
});

await pruefe('D7: vergleicheMitVormonat erkennt nur Abweichungen über der Schwelle', () => {
  assert(W.vergleicheMitVormonat(1000, 950) === null, 'kleine Abweichung (5%) darf nicht als auffällig gelten');
  const auffaellig = W.vergleicheMitVormonat(500, 1000);
  assert(auffaellig && auffaellig.abweichungProzent === -50, 'eine Halbierung muss als auffällig erkannt werden');
});

// =============================================================================
// E) runJarvisControlCheck: proaktive Hinweise (Upsert, idempotent),
//    Veränderungserkennung über jarvisKennzahlenVerlauf.
// =============================================================================
await pruefe('E1: runJarvisControlCheck erstellt Hinweise aus echten Daten, idempotent bei zweitem Lauf', async () => {
  setzeCollection('rechnungen', [{ id: 'r1', status: 'offen', brutto: 500, faelligAm: '2020-01-01', datum: `${HEUTE.slice(0, 7)}-01` }]);
  setzeCollection('angebote', []);
  setzeCollection('projekte', []);
  setzeCollection('kanbanSpalten', [{ id: 'abgeschlossen', geschlossen: true }]);
  setzeCollection('aufgaben', []);
  setzeCollection('zeiterfassung', []);
  setzeCollection('mitarbeiter', []);
  setzeCollection('anlagen', []);
  setzeCollection('ausgaben', []);
  firestoreDb.delete('aufgaben/jarvis-control-forderungen');
  loescheJob('control-check', HEUTE);

  await W.runJarvisControlCheck(envBasis({ JARVIS_CONTROL_AKTIV: 'true', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }));
  const hinweis = liesDoc('aufgaben', 'jarvis-control-forderungen');
  assert(hinweis && hinweis.beschreibung.includes('500.00'), 'Hinweis zu überfälligen Forderungen muss den Betrag nennen');

  const jobVorher = liesDoc('jarvisJobs', `control-check-${HEUTE}`);
  assert(jobVorher.status === 'done', 'Job muss erfolgreich abgeschlossen sein');

  // Zweiter Lauf am selben Tag: Job ist bereits "done" -> No-Op, kein zweiter Hinweis/Duplikat.
  const inhaltVorher = JSON.stringify(liesDoc('aufgaben', 'jarvis-control-forderungen'));
  await W.runJarvisControlCheck(envBasis({ JARVIS_CONTROL_AKTIV: 'true', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }));
  const inhaltNachher = JSON.stringify(liesDoc('aufgaben', 'jarvis-control-forderungen'));
  assert(inhaltVorher === inhaltNachher, 'ein bereits abgeschlossener Tagesjob darf den Hinweis nicht erneut (ggf. mit anderem Zeitstempel) schreiben');
});

await pruefe('E2: runJarvisControlCheck schlägt ohne Absturz fehl, wenn Firestore-Zugriff bricht, und markiert den Job als failed', async () => {
  loescheJob('control-check', HEUTE);
  const originalGet = W.firestoreListDocuments;
  // Simuliert einen Datenzugriffsfehler (z.B. Firestore kurzzeitig nicht
  // erreichbar) - darf NICHT zum unbehandelten Absturz führen.
  const kaputterFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    if (u.pathname.includes('/rechnungen')) throw new Error('Simulierter Netzwerkfehler');
    return kaputterFetch(url, init);
  };
  try {
    await W.runJarvisControlCheck(envBasis({ JARVIS_CONTROL_AKTIV: 'true', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }));
  } finally {
    global.fetch = kaputterFetch;
  }
  const job = liesDoc('jarvisJobs', `control-check-${HEUTE}`);
  assert(job.status === 'failed', 'Job muss bei einem Datenzugriffsfehler als failed markiert werden, kein Absturz des Workers');
  void originalGet;
});

global.fetch = ORIG_FETCH;
console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
