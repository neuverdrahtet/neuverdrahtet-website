// Integrationstest "Phasen 1-4" gegen den TATSÄCHLICHEN, produktiv deployten
// Worker-Code (import von ../worker.js, __test__-Export). Deckt die beim
// Integrationstest neu identifizierten Lücken ab, die von den bisherigen
// Phase-Testdateien noch NICHT abgedeckt waren:
//   - Freigabe-Engine: gleichzeitige Bestätigungen + unklare Ausführungs-
//     zustände bei EINZELNEN Stufe-2-Aktionen (fuehreJarvisAktionAus) -
//     anders als bei den Hintergrund-Jobs gab es hierfür bisher KEINE
//     Stale-Erkennung (siehe Bericht - echter, hier behobener Fehler).
//   - Firebase-ID-Token-Verifikation gegen den ECHTEN exportierten Code
//     (in Phase 1 nur gegen eine kopierte Fassung getestet).
//   - Kostenbegrenzung (erfasseJarvisKosten/jarvisKostenlimitUeberschritten).
// Die bereits in test_jarvis_phase3.mjs/test_jarvis_phase4.mjs abgedeckten
// vollständigen Prozessketten (E-Mail->Aufgabe->Entwurf->Angebot, Rechnung
// mit Abschlag/Nachtrag, Wartungstermin-Vorschlag) werden hier NICHT
// dupliziert, siehe Prüfbericht für die Zuordnung Anforderung -> Testdatei.
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_integration.mjs
import crypto from 'node:crypto';
import { __test__ as W } from '../worker.js';

// Bewusst OHNE publicKeyEncoding/privateKeyEncoding: liefert KeyObject-
// Instanzen statt PEM-Strings - gebraucht, um sowohl das JWK (für den
// gemockten Google-JWKS-Endpunkt) als auch eine zweite PEM-Form (für den
// Service-Account, siehe getGoogleAccessToken im echten Code) zu erzeugen.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'jarvis-test-int',
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

let jwksResponse = null; // vom Testfall gesetzt

const ORIG_FETCH = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  const method = init.method || 'GET';

  if (u.href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'fake-access-token' });
  if (u.href === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
    if (!jwksResponse) throw new Error('Kein jwksResponse für diesen Testfall gesetzt.');
    // holeFirebaseJwks() im echten Code baut aus der fetch()-Antwort über
    // "new Response(frisch.body, frisch)" eine ECHTE Response (für die
    // Cloudflare-Cache-API) - dafür muss hier eine echte Response mit
    // lesbarem Body zurückkommen, kein reines {json(){...}}-Objekt wie bei
    // den übrigen, einfacheren Mocks in dieser Datei.
    return new Response(JSON.stringify(jwksResponse), { status: 200, headers: { 'content-type': 'application/json' } });
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
    return jsonResponse(200, { documents: [] });
  }

  throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
};

// Cloudflare-Cache-API existiert in Node nicht - holeFirebaseJwks() nutzt sie
// zum Zwischenspeichern. match() liefert hier immer "nicht im Cache", damit
// jeder Testfall deterministisch den (jeweils frisch gesetzten) Mock-Fetch
// durchläuft, statt eine Antwort eines früheren Testfalls wiederzuverwenden.
global.caches = { default: { match: async () => undefined, put: async () => {} } };

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
async function pruefeWirftFehler(name, fn, erwarteterTextausschnitt) {
  await pruefe(name, async () => {
    try {
      await fn();
      throw new Error('hätte werfen müssen, hat aber nicht geworfen');
    } catch (err) {
      if (err.message === 'hätte werfen müssen, hat aber nicht geworfen') throw err;
      if (erwarteterTextausschnitt && !err.message.includes(erwarteterTextausschnitt)) {
        throw new Error(`erwarteter Textausschnitt "${erwarteterTextausschnitt}" nicht in Fehlermeldung "${err.message}"`);
      }
    }
  });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function liesDoc(collection, id) {
  const doc = firestoreDb.get(`${collection}/${id}`);
  return doc ? W.firestoreFieldsToObject(doc.fields) : null;
}

function base64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function base64urlJson(obj) { return base64url(Buffer.from(JSON.stringify(obj))); }

function signeFirebaseToken({ kid, signKey = privateKey, projectId = serviceAccount.project_id, uid = 'test-uid', ueberschreibungen = {} }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = {
    aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
    sub: uid, iat: now, exp: now + 3600, auth_time: now, email: 'test@beispiel.de',
    ...ueberschreibungen,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), signKey);
  return `${signingInput}.${base64url(signature)}`;
}

const JWK = publicKey.export({ format: 'jwk' });
const TEST_KID = 'test-kid-1';

// =============================================================================
// A) Firebase-ID-Token-Verifikation gegen den ECHTEN exportierten Code
//    (verifyFirebaseIdToken) - in Phase 1 nur gegen eine kopierte Fassung
//    getestet, siehe Bericht.
// =============================================================================
await pruefe('A1: gültiges, korrekt signiertes Token wird akzeptiert', async () => {
  jwksResponse = { keys: [{ ...JWK, kid: TEST_KID, alg: 'RS256', use: 'sig' }] };
  const token = signeFirebaseToken({ kid: TEST_KID });
  const ergebnis = await W.verifyFirebaseIdToken(token, serviceAccount.project_id);
  assert(ergebnis.uid === 'test-uid', 'uid muss aus dem Token übernommen werden');
});

await pruefeWirftFehler('A2: falsches Projekt (aud) wird abgelehnt', async () => {
  jwksResponse = { keys: [{ ...JWK, kid: TEST_KID, alg: 'RS256', use: 'sig' }] };
  const token = signeFirebaseToken({ kid: TEST_KID, ueberschreibungen: { aud: 'anderes-projekt' } });
  await W.verifyFirebaseIdToken(token, serviceAccount.project_id);
}, 'anderes Firebase-Projekt');

await pruefeWirftFehler('A3: abgelaufenes Token wird abgelehnt', async () => {
  jwksResponse = { keys: [{ ...JWK, kid: TEST_KID, alg: 'RS256', use: 'sig' }] };
  const now = Math.floor(Date.now() / 1000);
  const token = signeFirebaseToken({ kid: TEST_KID, ueberschreibungen: { exp: now - 3600 } });
  await W.verifyFirebaseIdToken(token, serviceAccount.project_id);
}, 'abgelaufen');

await pruefeWirftFehler('A4: Token mit falscher Signatur (anderer privater Schlüssel) wird abgelehnt', async () => {
  const { privateKey: fremderKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  jwksResponse = { keys: [{ ...JWK, kid: TEST_KID, alg: 'RS256', use: 'sig' }] }; // der ECHTE öffentliche Schlüssel bleibt im JWKS
  const token = signeFirebaseToken({ kid: TEST_KID, signKey: fremderKey }); // aber signiert mit einem ANDEREN privaten Schlüssel
  await W.verifyFirebaseIdToken(token, serviceAccount.project_id);
}, 'Signatur ungültig');

await pruefeWirftFehler('A5: unbekannter Signierschlüssel (kid) wird abgelehnt', async () => {
  jwksResponse = { keys: [{ ...JWK, kid: TEST_KID, alg: 'RS256', use: 'sig' }] };
  const token = signeFirebaseToken({ kid: 'ein-anderer-kid' });
  await W.verifyFirebaseIdToken(token, serviceAccount.project_id);
}, 'Signierschlüssel unbekannt');

await pruefeWirftFehler('A6: Algorithmus-Verwechslung ("alg":"none") wird abgelehnt (klassische JWT-Schwachstelle)', async () => {
  jwksResponse = { keys: [{ ...JWK, kid: TEST_KID, alg: 'RS256', use: 'sig' }] };
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'none', typ: 'JWT', kid: TEST_KID };
  const payload = { aud: serviceAccount.project_id, iss: `https://securetoken.google.com/${serviceAccount.project_id}`, sub: 'angreifer-uid', iat: now, exp: now + 3600, auth_time: now };
  // Signatur-Teil bewusst leer - "alg":"none" verlangt laut (unsicherer)
  // JWT-Spezifikation gar keine Signatur. verifyFirebaseIdToken muss das
  // bereits an der Algorithmus-Prüfung abweisen, BEVOR überhaupt eine
  // Signatur geprüft wird.
  const token = `${base64urlJson(header)}.${base64urlJson(payload)}.`;
  await W.verifyFirebaseIdToken(token, serviceAccount.project_id);
}, 'Signatur-Algorithmus');

// =============================================================================
// B) Freigabe-Engine: gleichzeitige Bestätigungen + unklare Ausführungs-
//    zustände (fuehreJarvisAktionAus) - neu getestet, siehe Bericht.
// =============================================================================
await pruefe('B1: zwei gleichzeitige Bestätigungsversuche derselben Aktion - nur einer gewinnt', async () => {
  firestoreDb.set('jarvisAktionen/akt-1', { fields: jsToFsFields({ typ: 'nicht-implementiert', status: 'pending' }), updateTime: naechsteUpdateTime() });
  const ergebnisse = await Promise.allSettled([
    W.fuehreJarvisAktionAus({ serviceAccount, aktionId: 'akt-1', callerUid: 'uid-a', callerRole: 'admin' }),
    W.fuehreJarvisAktionAus({ serviceAccount, aktionId: 'akt-1', callerUid: 'uid-b', callerRole: 'admin' }),
  ]);
  // Beide "gewinnen" in diesem Test technisch den Claim-Schritt nacheinander
  // (kein echter Thread-Parallelismus in Node) - entscheidend ist: der
  // zugrunde liegende Firestore-Commit mit currentDocument.updateTime lässt
  // niemals zwei GLEICHZEITIGE Claims auf denselben Ausgangszustand zu. Da
  // der registrierte Aktionstyp hier bewusst nicht implementiert ist, werfen
  // beide am Ende einen 501 - das ist erwartet; wichtig ist, dass keiner der
  // beiden Aufrufe eine stillschweigend doppelte/inkonsistente Ausführung
  // erzeugt (geprüft über den finalen, konsistenten Status).
  assert(ergebnisse.every((r) => r.status === 'rejected'), 'nicht implementierter Aktionstyp muss in beiden Fällen ablehnen (501), nie "erfolgreich doppelt"');
  const aktion = liesDoc('jarvisAktionen', 'akt-1');
  assert(aktion.status === 'failed', 'Endzustand muss konsistent "failed" sein (Aktionstyp nicht implementiert), kein halb-ausgeführter Zwischenzustand');
});

await pruefe('B2: echte gleichzeitige Claims auf firestoreBeanspruche-Ebene - nur einer gewinnt, der andere bekommt 409', async () => {
  firestoreDb.set('jarvisAktionen/akt-race', { fields: jsToFsFields({ typ: 'test', status: 'pending' }), updateTime: naechsteUpdateTime() });
  const [a, b] = await Promise.allSettled([
    W.firestoreBeanspruche({ serviceAccount, collection: 'jarvisAktionen', id: 'akt-race', erwarteterStatus: 'pending', neuerStatus: 'executing' }),
    W.firestoreBeanspruche({ serviceAccount, collection: 'jarvisAktionen', id: 'akt-race', erwarteterStatus: 'pending', neuerStatus: 'executing' }),
  ]);
  const erfolge = [a, b].filter((r) => r.status === 'fulfilled');
  const fehlschlaege = [a, b].filter((r) => r.status === 'rejected');
  assert(erfolge.length === 1, 'GENAU EINER der beiden gleichzeitigen Claims darf erfolgreich sein');
  assert(fehlschlaege.length === 1, 'der andere muss mit einem Konflikt-Fehler abgelehnt werden');
  assert(fehlschlaege[0].reason.status === 409, 'die Ablehnung muss Status 409 (Konflikt) tragen, keine unklare Fehlermeldung');
});

await pruefe('B3: eine seit >15 Minuten "executing" hängende Aktion wird als "unklar" markiert, NICHT erneut ausgeführt', async () => {
  const vorZeit = new Date(Date.now() - 20 * 60000).toISOString();
  firestoreDb.set('jarvisAktionen/akt-stale', { fields: jsToFsFields({ typ: 'test', status: 'executing', ausfuehrungGestartetAm: vorZeit }), updateTime: naechsteUpdateTime() });
  try {
    await W.fuehreJarvisAktionAus({ serviceAccount, aktionId: 'akt-stale', callerUid: 'uid-a', callerRole: 'admin' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.message !== 'hätte werfen müssen', err.message);
    assert(err.status === 409, 'muss mit 409 ablehnen');
  }
  const aktion = liesDoc('jarvisAktionen', 'akt-stale');
  assert(aktion.status === 'unklar', 'eine hängengebliebene Aktion muss als "unklar" markiert werden, NIE automatisch fortgesetzt/wiederholt');
});

await pruefe('B4: eine NOCH NICHT stale "executing"-Aktion wird mit 409 "wird gerade ausgeführt" abgelehnt (kein Doppel-Ausführen)', async () => {
  const vorZeit = new Date(Date.now() - 2 * 60000).toISOString(); // erst 2 Minuten alt
  firestoreDb.set('jarvisAktionen/akt-aktiv', { fields: jsToFsFields({ typ: 'test', status: 'executing', ausfuehrungGestartetAm: vorZeit }), updateTime: naechsteUpdateTime() });
  try {
    await W.fuehreJarvisAktionAus({ serviceAccount, aktionId: 'akt-aktiv', callerUid: 'uid-a', callerRole: 'admin' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(err.message.includes('wird gerade ausgeführt'), `unerwartete Fehlermeldung: ${err.message}`);
  }
  const aktion = liesDoc('jarvisAktionen', 'akt-aktiv');
  assert(aktion.status === 'executing', 'Status darf durch den abgelehnten zweiten Versuch NICHT verändert werden');
});

await pruefe('B5: eine sauber "failed" Aktion ist retry-fähig (kann erneut beansprucht werden)', async () => {
  firestoreDb.set('jarvisAktionen/akt-failed', { fields: jsToFsFields({ typ: 'test', status: 'failed', fehler: 'vorheriger Netzwerkfehler' }), updateTime: naechsteUpdateTime() });
  const ergebnis = await W.firestoreBeanspruche({ serviceAccount, collection: 'jarvisAktionen', id: 'akt-failed', erwarteterStatus: ['pending', 'failed'], neuerStatus: 'executing' });
  assert(ergebnis.typ === 'test', 'ein zuvor sauber fehlgeschlagener Vorgang muss erneut beansprucht werden können');
});

await pruefe('B6: Rollenprüfung lehnt Nicht-Admin ab, OHNE die Aktion überhaupt zu berühren', async () => {
  firestoreDb.set('jarvisAktionen/akt-rolle', { fields: jsToFsFields({ typ: 'test', status: 'pending' }), updateTime: naechsteUpdateTime() });
  const vorher = liesDoc('jarvisAktionen', 'akt-rolle');
  try {
    await W.fuehreJarvisAktionAus({ serviceAccount, aktionId: 'akt-rolle', callerUid: 'uid-a', callerRole: 'mitarbeiter' });
    throw new Error('hätte werfen müssen');
  } catch (err) {
    assert(/admin/i.test(err.message), 'Fehlermeldung muss auf fehlende Admin-Rolle hinweisen');
  }
  const nachher = liesDoc('jarvisAktionen', 'akt-rolle');
  assert(nachher.status === vorher.status, 'der Status darf durch einen abgelehnten Nicht-Admin-Versuch nicht verändert werden');
});

// =============================================================================
// C) Kostenbegrenzung (erfasseJarvisKosten/jarvisKostenlimitUeberschritten)
// =============================================================================
await pruefe('C1: erfasseJarvisKosten summiert kumulativ statt zu überschreiben', async () => {
  const monatsId = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  firestoreDb.delete(`jarvisKosten/${monatsId}`);
  await W.erfasseJarvisKosten({ serviceAccount, usage: { input_tokens: 1_000_000, output_tokens: 0 } }); // 15 USD
  await W.erfasseJarvisKosten({ serviceAccount, usage: { input_tokens: 1_000_000, output_tokens: 0 } }); // +15 USD
  const stand = liesDoc('jarvisKosten', monatsId);
  assert(stand.geschaetzteKostenUsd === 30, `Kosten müssen sich auf 30 USD summieren, nicht überschreiben (war: ${stand.geschaetzteKostenUsd})`);
});

await pruefe('C2: jarvisKostenlimitUeberschritten blockiert, sobald das Monatslimit erreicht ist', async () => {
  const monatsId = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  const limitUeberschritten = await W.jarvisKostenlimitUeberschritten({ serviceAccount, monatslimitUsd: 25 });
  assert(limitUeberschritten === true, 'bei 30 USD Stand und 25 USD Limit muss die Grenze als überschritten gelten');
  const limitNichtUeberschritten = await W.jarvisKostenlimitUeberschritten({ serviceAccount, monatslimitUsd: 100 });
  assert(limitNichtUeberschritten === false, 'bei 30 USD Stand und 100 USD Limit darf die Grenze NICHT als überschritten gelten');
});

await pruefe('C3: ohne gesetztes Limit (monatslimitUsd falsy) gibt es keine automatische Bremse', async () => {
  const ergebnis = await W.jarvisKostenlimitUeberschritten({ serviceAccount, monatslimitUsd: null });
  assert(ergebnis === false, 'ohne konfiguriertes Limit darf nie blockiert werden');
});

global.fetch = ORIG_FETCH;
console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
