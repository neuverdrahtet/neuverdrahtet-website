// Echter Integrationstest gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, siehe __test__-Export am Ende von
// worker.js) - deckt Phase 4 (Termin-/Wartungs-/Projektmanagement) sowie die
// Phase-3-Erweiterungen (Angebots-Plausibilität, Nachträge/Abschläge,
// Mahnungs-Mindestbetrag) ab. Eigene Datei statt Erweiterung von
// test_jarvis_phase3.mjs, damit beide Phasen unabhängig voneinander laufen
// und überprüfbar bleiben.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase4.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const serviceAccount = { client_email: 'test@test.iam.gserviceaccount.com', private_key: privateKey, project_id: 'jarvis-test-p4' };

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

const zaehler = { calendarAufrufe: 0, remindersErstellt: 0 };
let googleBueroHandler = null; // (pathname, searchParams) => data

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

  if (u.href.startsWith('https://google-buero.test')) {
    if (!googleBueroHandler) throw new Error('Kein googleBueroHandler für diesen Testfall gesetzt.');
    zaehler.calendarAufrufe++;
    return googleBueroHandler(u);
  }

  if (u.href.startsWith('https://ki-buerokraft.test')) {
    const kib = global.__testKiBuerokraft || {};
    if (u.pathname === '/tasks' && method === 'GET') return jsonResponse(200, { success: true, data: kib.tasks || [] });
    if (u.pathname === '/quotes' && method === 'GET') return jsonResponse(200, { success: true, data: kib.quotesFor?.(u.searchParams) ?? [] });
    if (u.pathname === '/projects' && method === 'GET') return jsonResponse(200, { success: true, data: kib.projects || [] });
    if (u.pathname === '/invoices' && method === 'GET') return jsonResponse(200, { success: true, data: kib.invoicesFor?.(u.searchParams) ?? [] });
    if (u.pathname === '/reminders' && method === 'GET') return jsonResponse(200, { success: true, data: kib.remindersFor?.(u.searchParams) ?? [] });
    if (u.pathname === '/reminders' && method === 'POST') {
      const body = JSON.parse(init.body);
      zaehler.remindersErstellt++;
      return jsonResponse(201, { success: true, data: { id: `reminder-${zaehler.remindersErstellt}`, ...body } });
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
function inTagenZeit(n, stunde) { const d = new Date(Date.now() + n * 86400000); d.setUTCHours(stunde, 0, 0, 0); return d.toISOString(); }

// =============================================================================
// A) Wartungsmanagement: Terminkonflikt wird ausgeschlossen, fehlende
//    Mitarbeiterverfügbarkeit (Urlaub) schließt ganze Tage aus, Duplikate
//    (gleiche Anlage zweimal) werden verhindert.
// =============================================================================
await pruefe('A1: Terminkonflikt mit bestehendem Termin wird ausgeschlossen', async () => {
  setzeCollection('anlagen', [{ id: 'anlage-1', kundeId: 'kunde-1', bezeichnung: 'E-Check Werkstatt', naechstePruefung: HEUTE }]);
  setzeCollection('termine', [
    // bestehender Termin am Tag +5, 09:00-10:00 Uhr
    { id: 't1', kundeId: 'anderer-kunde', typ: 'termin', start: inTagenZeit(5, 9), ende: inTagenZeit(5, 10) },
  ]);
  setzeCollection('mitarbeiterOeffentlich', [{ id: 'ma-1', name: 'Max' }]);
  loescheJob('wartung-check', HEUTE);

  googleBueroHandler = (u) => {
    assert(u.pathname === '/calendar/availability', 'erwartete Kalender-Route');
    // Freier Slot GENAU im Konflikt-Zeitfenster (09:30-10:30, überlappt mit
    // bestehendem Termin inkl. 30-Minuten-Puffer) + ein konfliktfreier Slot
    // am Tag +6.
    return jsonResponse(200, {
      success: true,
      data: {
        busy: [],
        free_slots: [
          { date: inTagen(5), start: inTagenZeit(5, 9).replace(':00:00', ':30:00'), end: inTagenZeit(5, 10).replace(':00:00', ':30:00') },
          { date: inTagen(6), start: inTagenZeit(6, 9), end: inTagenZeit(6, 11) },
        ],
      },
    });
  };

  await W.runJarvisWartungsCheck(envBasis({ JARVIS_WARTUNG_AKTIV: 'true' }));

  const vorschlag = liesDoc('jarvisTerminVorschlaege', `anlage-1-${HEUTE}`);
  assert(vorschlag.status === 'vorschlag_erstellt', 'Status muss vorschlag_erstellt sein');
  assert(vorschlag.vorschlaege.length === 1, 'nur der konfliktfreie Slot darf übrig bleiben');
  assert(vorschlag.vorschlaege[0].date === inTagen(6), 'der verbleibende Vorschlag muss der konfliktfreie Tag+6-Slot sein');
  assert(vorschlag.dauerIstAnnahme === true, 'die angenommene Dauer muss als Annahme gekennzeichnet sein');
});

await pruefe('A2: Tag mit kompletter Mitarbeiter-Abwesenheit wird komplett ausgeschlossen', async () => {
  setzeCollection('anlagen', [{ id: 'anlage-2', kundeId: 'kunde-2', bezeichnung: 'DGUV V3 Büro', naechstePruefung: HEUTE }]);
  setzeCollection('mitarbeiterOeffentlich', [{ id: 'ma-1', name: 'Max' }, { id: 'ma-2', name: 'Erika' }]);
  setzeCollection('termine', [
    { id: 'urlaub-1', typ: 'urlaub', mitarbeiterIds: ['ma-1'], start: inTagen(3), ende: inTagen(4) },
    { id: 'urlaub-2', typ: 'urlaub', mitarbeiterIds: ['ma-2'], start: inTagen(3), ende: inTagen(4) },
  ]);
  loescheJob('wartung-check', HEUTE);

  googleBueroHandler = () => jsonResponse(200, {
    success: true,
    data: {
      busy: [],
      free_slots: [
        { date: inTagen(3), start: inTagenZeit(3, 9), end: inTagenZeit(3, 11) }, // beide Mitarbeiter im Urlaub -> muss rausfallen
        { date: inTagen(10), start: inTagenZeit(10, 9), end: inTagenZeit(10, 11) },
      ],
    },
  });

  await W.runJarvisWartungsCheck(envBasis({ JARVIS_WARTUNG_AKTIV: 'true' }));
  const vorschlag = liesDoc('jarvisTerminVorschlaege', `anlage-2-${HEUTE}`);
  assert(vorschlag.vorschlaege.length === 1, 'nur der Tag ohne Komplettausfall darf übrig bleiben');
  assert(vorschlag.vorschlaege[0].date === inTagen(10), 'der verbleibende Vorschlag muss Tag+10 sein');
});

await pruefe('A3: doppelte Wartungsvorschläge/-aufträge werden verhindert (gleiche Anlage, zweiter Lauf)', async () => {
  let calendarAufrufeVorher = zaehler.calendarAufrufe;
  await W.runJarvisWartungsCheck(envBasis({ JARVIS_WARTUNG_AKTIV: 'true' })); // Job bereits "done" von A2 im selben Tagesdurchlauf -> No-Op
  assert(zaehler.calendarAufrufe === calendarAufrufeVorher, 'ein bereits abgeschlossener Tagesjob darf den Kalender nicht erneut abfragen');

  // Erzwinge einen simulierten zweiten/doppelten Cron-Lauf (Job zurückgesetzt).
  loescheJob('wartung-check', HEUTE);
  googleBueroHandler = () => jsonResponse(200, { success: true, data: { busy: [], free_slots: [{ date: inTagen(10), start: inTagenZeit(10, 9), end: inTagenZeit(10, 11) }] } });
  await W.runJarvisWartungsCheck(envBasis({ JARVIS_WARTUNG_AKTIV: 'true' }));
  // anlage-1 und anlage-2 sind bereits terminal (vorschlag_erstellt) -> werden übersprungen, kein zweiter Vorschlag/keine neue Aufgabe überschreibt sie mit anderen Daten.
  const vorschlag1 = liesDoc('jarvisTerminVorschlaege', `anlage-1-${HEUTE}`);
  assert(vorschlag1.vorschlaege[0].date === inTagen(6), 'der ursprüngliche Vorschlag für anlage-1 darf durch den zweiten Lauf nicht überschrieben werden');
});

await pruefe('A4: fehlerhafte Kalenderverbindung -> kein Absturz, "kein_vorschlag_moeglich", Job trotzdem "done"', async () => {
  setzeCollection('anlagen', [{ id: 'anlage-3', kundeId: 'kunde-3', bezeichnung: 'Blitzschutz Halle', naechstePruefung: HEUTE }]);
  loescheJob('wartung-check', HEUTE);
  firestoreDb.delete(`jarvisTerminVorschlaege/anlage-3-${HEUTE}`);
  googleBueroHandler = () => jsonResponse(503, { success: false, error: { message: 'Google-Konto nicht verbunden' } });

  await W.runJarvisWartungsCheck(envBasis({ JARVIS_WARTUNG_AKTIV: 'true' }));
  const vorschlag = liesDoc('jarvisTerminVorschlaege', `anlage-3-${HEUTE}`);
  assert(vorschlag.status === 'kein_vorschlag_moeglich', 'bei Kalenderfehler muss der Status kein_vorschlag_moeglich sein (retry-fähig)');
  assert(vorschlag.fehlendeInfos.some((f) => f.includes('Google-Kalender nicht erreichbar')), 'Fehlergrund muss benannt werden');
  const job = liesDoc('jarvisJobs', `wartung-check-${HEUTE}`);
  assert(job.status === 'done', 'der GESAMTE Job darf an einer einzelnen fehlerhaften Kalenderverbindung nicht scheitern');
});

await pruefe('A5: bereits geplanter Termin beim Kunden -> kein Vorschlag nötig', async () => {
  setzeCollection('anlagen', [{ id: 'anlage-4', kundeId: 'kunde-4', bezeichnung: 'Wartungsvertrag PV', naechstePruefung: HEUTE }]);
  setzeCollection('termine', [{ id: 't-geplant', kundeId: 'kunde-4', typ: 'termin', start: inTagenZeit(2, 9), ende: inTagenZeit(2, 10) }]);
  loescheJob('wartung-check', HEUTE);
  googleBueroHandler = () => jsonResponse(200, { success: true, data: { busy: [], free_slots: [] } });

  await W.runJarvisWartungsCheck(envBasis({ JARVIS_WARTUNG_AKTIV: 'true' }));
  const vorschlag = liesDoc('jarvisTerminVorschlaege', `anlage-4-${HEUTE}`);
  assert(vorschlag.status === 'bereits_geplant', 'ein bereits vorhandener Kundentermin muss als bereits_geplant erkannt werden');
});

// =============================================================================
// B) Projektmanagement: überfällige + hängengebliebene Aufgaben, idempotent,
//    eigene JARVIS-Aufgaben werden nicht mitgezählt.
// =============================================================================
await pruefe('B1: überfällige Projektaufgaben erzeugen genau EINEN Sammel-Hinweis, kein Duplikat bei zweitem Lauf', async () => {
  firestoreDb.delete('aufgaben/jarvis-projekt-hinweis-proj-9');
  loescheJob('projekt-check', HEUTE);
  global.__testKiBuerokraft = {
    tasks: [
      { id: 'task-1', project_id: 'proj-9', title: 'Material bestellen', due_date: inTagen(-3) },
      { id: 'task-2', project_id: 'proj-9', title: 'Abnahme vereinbaren', due_date: inTagen(5) }, // nicht überfällig
      { id: 'jarvis-rechnung-aufgabe-proj-9', project_id: 'proj-9', title: 'JARVIS-eigene Aufgabe', due_date: inTagen(-100) }, // darf NICHT mitgezählt werden
    ],
  };
  await W.runJarvisProjektCheck(envBasis({ JARVIS_PROJEKT_AKTIV: 'true' }));
  const hinweis = liesDoc('aufgaben', 'jarvis-projekt-hinweis-proj-9');
  assert(hinweis.beschreibung.includes('Material bestellen'), 'überfällige Aufgabe muss im Hinweis genannt werden');
  assert(!hinweis.beschreibung.includes('Abnahme vereinbaren'), 'nicht überfällige Aufgabe darf nicht genannt werden');
  assert(!hinweis.beschreibung.includes('JARVIS-eigene'), 'JARVIS-eigene Aufgaben dürfen nicht mitgezählt werden');

  loescheJob('projekt-check', HEUTE);
  await W.runJarvisProjektCheck(envBasis({ JARVIS_PROJEKT_AKTIV: 'true' }));
  const alleHinweise = [...firestoreDb.keys()].filter((k) => k.startsWith('aufgaben/jarvis-projekt-hinweis-proj-9'));
  assert(alleHinweise.length === 1, 'es darf weiterhin nur EIN Hinweis-Dokument für dieses Projekt existieren (Upsert, kein Duplikat)');
});

// =============================================================================
// C) Angebots-Plausibilitätsprüfung (reine Funktion)
// =============================================================================
await pruefe('C1: negativer/fehlender Preis wird hart verworfen', () => {
  const { items, warnungen } = W.pruefeAngebotsPlausibilitaet([
    { article_id: 'a1', title: 'Kaputte Position', unit: 'Stk.', quantity: 1, unit_price_net: 0, vat_rate: 19 },
  ]);
  assert(items.length === 0, 'Position mit Preis 0 muss verworfen werden');
  assert(warnungen.some((w) => w.includes('Kaputte Position')), 'Warnung muss die Position benennen');
});

await pruefe('C2: doppelte Position + ungewöhnlich hohe Menge erzeugen Warnungen, bleiben aber erhalten', () => {
  const { items, warnungen } = W.pruefeAngebotsPlausibilitaet([
    { article_id: 'a1', title: 'Steckdose', unit: 'Stk.', quantity: 5000, unit_price_net: 10, vat_rate: 19 },
    { article_id: 'a1', title: 'Steckdose', unit: 'Stk.', quantity: 2, unit_price_net: 10, vat_rate: 19 },
  ]);
  assert(items.length === 2, 'beide Positionen bleiben trotz Warnung erhalten (weiches Problem)');
  assert(warnungen.some((w) => w.includes('ungewöhnlich hohe Menge')), 'Mengen-Warnung muss vorhanden sein');
  assert(warnungen.some((w) => w.includes('doppelte Position')), 'Dubletten-Warnung muss vorhanden sein');
  assert(warnungen.some((w) => w.includes('Anfahrt')), 'fehlende Anfahrtsposition muss als Hinweis erscheinen');
});

// =============================================================================
// D) Rechnungsprüfung: Nachträge (mehrere angenommene Angebote desselben
//    Projekts werden summiert) und Abschlagszahlungen (Schlussrechnung trotz
//    bestehender Abschlagsrechnung vorbereitet, mit Hinweis).
// =============================================================================
await pruefe('D1: Nachtragsangebot wird zum Basis-Angebot addiert', async () => {
  global.__testKiBuerokraft = {
    quotesFor: (params) => (params.get('status') === 'accepted' && params.get('project_id') === 'proj-10'
      ? [
          { id: 'ang-basis', items: [{ article_id: 'a1', title: 'Hausanschluss', unit: 'Stk.', quantity: 1, unit_price_net: 500, vat_rate: 19 }] },
          { id: 'ang-nachtrag', items: [{ article_id: 'a2', title: 'Zusatzsteckdosen', unit: 'Stk.', quantity: 2, unit_price_net: 40, vat_rate: 19 }] },
        ]
      : []),
  };
  const ergebnis = await W.bauePositionenAusAngebot({ env: envBasis({}), projektId: 'proj-10' });
  assert(ergebnis.positionen.length === 2, 'Positionen aus Basis-Angebot UND Nachtrag müssen zusammengeführt werden');
  assert(ergebnis.angebotIds.length === 2, 'beide Angebots-IDs müssen vermerkt sein');
  assert(ergebnis.fehlendeInfos.some((f) => f.includes('Nachtrag')), 'Hinweis auf zusammengeführte Angebote muss vorhanden sein');
});

await pruefe('D2: nur Abschlagsrechnung vorhanden -> Schlussrechnungs-Entwurf wird trotzdem vorbereitet, mit Hinweis', async () => {
  setzeCollection('kanbanSpalten', [{ id: 'abgeschlossen', geschlossen: true }]);
  setzeCollection('rechnungen', [{ id: 'abschlag-1', projektId: 'proj-11', rechnungstyp: 'abschlag', status: 'offen', brutto: 300, nummer: 'AB-1' }]);
  global.__testKiBuerokraft = {
    projects: [{ id: 'proj-11', customer_id: 'kunde-11', title: 'Zählerschrank', status: 'abgeschlossen', bereich: 'Elektro' }],
    quotesFor: (params) => (params.get('project_id') === 'proj-11' ? [{ id: 'ang-11', items: [{ article_id: 'a1', title: 'Zählerschrank tauschen', unit: 'Stk.', quantity: 1, unit_price_net: 900, vat_rate: 19 }] }] : []),
  };
  firestoreDb.delete('jarvisRechnungsEntwuerfe/proj-11');
  loescheJob('rechnung-check', HEUTE);

  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' }));
  const entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-11');
  assert(entwurf.status === 'entwurf_erstellt', 'trotz bestehender Abschlagsrechnung muss ein Schlussrechnungs-Entwurf vorbereitet werden');
  assert(entwurf.bekannteAbschlaege.length === 1, 'die bestehende Abschlagsrechnung muss im Entwurf vermerkt sein');
  assert(entwurf.fehlendeInfos.some((f) => f.includes('Abschlagsrechnung')), 'Hinweis auf die Abschlagsrechnung muss enthalten sein');
});

await pruefe('D3: echte Schlussrechnung bereits vorhanden -> rechnung_vorhanden (keine Dopplung)', async () => {
  setzeCollection('rechnungen', [{ id: 'schlussrechnung-1', projektId: 'proj-11', rechnungstyp: 'rechnung', status: 'offen', brutto: 1000, nummer: 'RE-1' }]);
  firestoreDb.delete('jarvisRechnungsEntwuerfe/proj-11');
  loescheJob('rechnung-check', HEUTE);
  await W.runJarvisRechnungsCheck(envBasis({ JARVIS_RECHNUNG_AKTIV: 'true' }));
  const entwurf = liesDoc('jarvisRechnungsEntwuerfe', 'proj-11');
  assert(entwurf.status === 'rechnung_vorhanden', 'eine bereits gestellte Schlussrechnung darf keinen weiteren Entwurf auslösen');
});

// =============================================================================
// E) Mahnungsprüfung: Mindestrestbetrag verhindert Mahnung bei Bagatellbetrag
//    nach Teilzahlung.
// =============================================================================
await pruefe('E1: sehr geringer Restbetrag (Teilzahlung) loest KEINE Mahnstufe aus', async () => {
  const ergebnis = await W.naechsteFaelligeMahnstufe({
    env: envBasis({}), heute: HEUTE,
    rechnung: { id: 'r-teilbezahlt', due_date: inTagen(-20), open_value: 2.5, gross_total: 500 },
  });
  assert(ergebnis === null, 'bei einem Restbetrag von nur 2,50 € darf keine neue Mahnstufe vorgeschlagen werden');
});

await pruefe('E2: normaler offener Restbetrag loest weiterhin eine Mahnstufe aus', async () => {
  global.__testKiBuerokraft = { remindersFor: () => [] };
  const ergebnis = await W.naechsteFaelligeMahnstufe({
    env: envBasis({}), heute: HEUTE,
    rechnung: { id: 'r-offen', due_date: inTagen(-20), open_value: 450, gross_total: 500 },
  });
  assert(ergebnis && ergebnis.stufe === 1, 'ein nennenswerter Restbetrag muss weiterhin Stufe 1 auslösen');
});

global.fetch = ORIG_FETCH;
console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
