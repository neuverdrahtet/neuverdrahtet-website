/**
 * neuverdrahtet Werkora – offene REST-API für Drittsysteme (Cloudflare Worker)
 *
 * Erlaubt Lesen/Schreiben von Kunden, Projekten und Terminen aus externen
 * Systemen (z.B. Zapier, Make, eigene Skripte) - über einen statischen API-
 * Schlüssel abgesichert, nicht über Browser-Login. Läuft als eigener,
 * dedizierter Worker getrennt vom internen Admin-Worker (cloudflare-worker/,
 * X-App-Secret + Origin-Allowlist für die Browser-App) und vom öffentlichen
 * Kostenschätzer-Worker (cloudflare-worker-kostenschaetzer/, keine Auth).
 * Dieser hier ist für Server-zu-Server-Aufrufe gedacht (kein Origin-Header
 * nötig), aber NICHT öffentlich - jeder Aufruf braucht den API-Schlüssel.
 *
 * Schreibt/liest Firestore-Dokumente direkt per REST-API mit einem Firebase-
 * Service-Account (Admin-Zugriff, umgeht die normalen Sicherheitsregeln -
 * gleiches, einzig bestehendes Muster für privilegierte Server-Zugriffe wie
 * in cloudflare-worker-kostenschaetzer/worker.js).
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   API_KEY                       (Secret, erforderlich) – frei gewählter,
 *                        langer zufälliger Schlüssel. Wird von Zapier/Make/
 *                        eigenen Skripten als "Authorization: Bearer <Schlüssel>"
 *                        mitgeschickt. Hat vollen Lese-/Schreibzugriff.
 *   API_KEY_READONLY              (Secret, optional) – P0-Sicherheitskorrektur
 *                        (Oktober 2026, Master-Audit Bericht 03: "1 Schlüssel
 *                        ohne Rollentrennung"): ein ZWEITER, unabhängiger
 *                        Schlüssel, der nur GET erlaubt (POST/PATCH liefern
 *                        damit 403). Für Drittsysteme gedacht, die nur lesen
 *                        müssen (z.B. ein Reporting-Zapier-Zap) - damit nicht
 *                        jede Integration zwangsläufig auch Schreibzugriff
 *                        bekommt. Rein additiv: ohne dieses Secret verhält
 *                        sich der Worker wie bisher (nur der volle API_KEY).
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, erforderlich) – kompletter Inhalt
 *                        einer Firebase-Service-Account-JSON-Datei, als
 *                        einzeiliger String. Dasselbe Firebase-Projekt wie
 *                        die Verwaltungs-Software.
 *   RATE_LIMITER                  (Binding, siehe wrangler.toml) – begrenzt
 *                        alle Aufrufe auf 30 Anfragen je IP und Minute
 *                        (P0-Sicherheitskorrektur: ohne dieses Binding, oder
 *                        bei dessen Ausfall, sperrt sich der Worker jetzt
 *                        bewusst FAIL-CLOSED, siehe pruefeRateLimit unten -
 *                        gleiches Muster wie in cloudflare-worker/worker.js).
 *
 * Endpunkte (jeweils unter https://<worker-url>/):
 *   GET    /kunden              Liste aller Kunden (max. 200, neueste zuerst nicht garantiert)
 *   GET    /kunden/{id}         Ein Kunde
 *   POST   /kunden              Neuen Kunden anlegen (Feld "id" optional, sonst automatisch)
 *   PATCH  /kunden/{id}         Kunde teilweise aktualisieren (nur gesendete Felder)
 *   GET    /projekte, /projekte/{id}, POST /projekte, PATCH /projekte/{id}  - analog (volles CRUD)
 *   GET    /termine,  /termine/{id},  POST /termine,  PATCH /termine/{id}   - analog (volles CRUD)
 *
 * Erweiterung (13.11.2026, "Werkora-Vereinfachung" Dashboard-Schritt "REST-API"):
 *   GET    /ausgaben, /ausgaben/{id}, POST /ausgaben   - Lesen + Anlegen, KEIN PATCH (kein
 *                        Foto-Upload über diesen Weg, nur die Datenfelder).
 *   GET    /rechnungen, /rechnungen/{id}               - NUR Lesen (GoBD-Sperre, wie überall
 *                        sonst im System - kein POST/PATCH, liefert 405).
 *   GET    /angebote, /angebote/{id}, POST /angebote, PATCH /angebote/{id}
 *                        - POST erzwingt serverseitig status "entwurf" (wird nie automatisch
 *                        versendet). PATCH nur erlaubt, solange das Angebot noch im Status
 *                        "entwurf" ist (409 sonst) - Versand/Freigabe bleibt Werkora
 *                        vorbehalten, "status" selbst ist über PATCH nicht änderbar.
 *   GET    /katalog, /katalog/{id}                     - normales, ungegatetes Lesen.
 *   POST   /katalog, PATCH /katalog/{id}               - FREIGABEPFLICHTIG: schreibt NICHT
 *                        direkt, sondern legt nur eine Freigabe-Anfrage an (Antwort 202 mit
 *                        freigabe.id) - Katalogpreise wirken sich auf jede künftige Angebots-/
 *                        Rechnungskalkulation aus, dieselbe Vorsicht wie beim KI-Bürokraft-
 *                        MCP-Server (werkora_create_article/werkora_update_article, siehe
 *                        dortiges README). Freigabe-Anfragen landen in derselben Firestore-
 *                        Collection ("mcpFinanzFreigaben") wie die des KI-Bürokraft-Workers -
 *                        bewusst KEIN separates Konzept, ein gemeinsamer Freigabe-Pool.
 *   GET    /freigaben                                  - Liste aller noch OFFENEN Freigaben.
 *   GET    /freigaben/{id}                             - Eine Freigabe-Anfrage.
 *   POST   /freigaben/{id}/freigeben                   - führt die ursprünglich angefragte
 *                        Anlage/Änderung jetzt tatsächlich aus (atomar, kein Doppel-Ausführen
 *                        bei zwei gleichzeitigen Aufrufen).
 *   POST   /freigaben/{id}/ablehnen                    - lehnt sie ab (optionaler JSON-Body
 *                        {"grund": "..."}), führt NICHTS aus.
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

// 'full'          - GET/POST/PATCH ungated, wie von Anfang an (kunden/projekte/termine).
// 'lesen-anlegen' - GET + POST, kein PATCH (ausgaben).
// 'nur-lesen'     - nur GET, POST/PATCH liefern 405 (rechnungen, GoBD-Sperre).
// 'entwurf'       - GET/POST/PATCH, aber POST erzwingt status:"entwurf" und PATCH nur erlaubt
//                   solange status==="entwurf" ist, "status" selbst über PATCH nicht änderbar
//                   (angebote - Versand/Freigabe bleibt Werkora vorbehalten).
// 'freigabe'      - GET ungated, POST/PATCH erzeugen nur eine Freigabe-Anfrage statt direkt
//                   zu schreiben (katalog - siehe Freigabe-Engine weiter unten).
const COLLECTION_MODUS = {
  kunden: 'full', projekte: 'full', termine: 'full',
  ausgaben: 'lesen-anlegen',
  rechnungen: 'nur-lesen',
  angebote: 'entwurf',
  katalog: 'freigabe',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// --- Google-Service-Account-JWT-Flow (1:1 aus cloudflare-worker-kostenschaetzer/worker.js) ---

function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemPrivateKeyToBinary(pem) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemPrivateKeyToBinary(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google-OAuth-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.access_token;
}

// --- Firestore REST API: Wert-Encoder/-Decoder + CRUD-Helfer ---

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    fields[k] = toFirestoreValue(val);
  }
  return fields;
}

/** Kehrt toFirestoreValue() um - wandelt einen Firestore-"Value" zurück in einen normalen JS-Wert. */
function fromFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromFirestoreValue(v);
  return obj;
}

/** Wandelt ein Firestore-Dokument (mit vollem "name"-Pfad) in {id, ...felder}. */
function docToPlain(doc) {
  const id = (doc.name || '').split('/').pop();
  return { id, ...fromFirestoreFields(doc.fields) };
}

function firestoreBaseUrl(projectId, collection) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
}

async function firestoreList({ accessToken, projectId, collection, pageSize = 200 }) {
  const url = `${firestoreBaseUrl(projectId, collection)}?pageSize=${pageSize}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore-Fehler (${res.status}) beim Auflisten von ${collection}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.documents || []).map(docToPlain);
}

async function firestoreGet({ accessToken, projectId, collection, id }) {
  const url = `${firestoreBaseUrl(projectId, collection)}/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore-Fehler (${res.status}) bei ${collection}/${id}: ${text.slice(0, 300)}`);
  }
  return docToPlain(await res.json());
}

/** Legt ein Dokument komplett neu an (PATCH ohne updateMask = set()-Semantik). */
async function firestoreCreate({ accessToken, projectId, collection, id, data }) {
  const url = `${firestoreBaseUrl(projectId, collection)}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore-Fehler (${res.status}) beim Anlegen von ${collection}/${id}: ${text.slice(0, 300)}`);
  }
  return docToPlain(await res.json());
}

/** Aktualisiert nur die übergebenen Felder (updateMask = merge()-Semantik, überschreibt den Rest nicht). */
async function firestoreUpdate({ accessToken, projectId, collection, id, data }) {
  const maskParams = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `${firestoreBaseUrl(projectId, collection)}/${id}?${maskParams}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore-Fehler (${res.status}) beim Aktualisieren von ${collection}/${id}: ${text.slice(0, 300)}`);
  }
  return docToPlain(await res.json());
}

// P0-Sicherheitskorrektur (Oktober 2026, Master-Audit Bericht 03): normaler
// "!=="-Stringvergleich bricht beim ersten abweichenden Zeichen ab -
// theoretisch ein Timing-Seitenkanal für ein geteiltes Geheimnis wie
// API_KEY. Konstante Laufzeit unabhängig vom Inhalt (1:1 aus
// cloudflare-worker/worker.js übernommen, dort schon in Phase 9 gefixt).
function zeitkonstanterVergleich(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return unterschied === 0;
}

// P0-Sicherheitskorrektur: fehlt das RATE_LIMITER-Binding oder schlägt der
// Aufruf fehl, wird FAIL-CLOSED gesperrt statt ungebremst durchgelassen -
// 1:1 dasselbe Muster wie pruefeRateLimit() in cloudflare-worker/worker.js.
async function pruefeRateLimit(env, ip) {
  if (!env.RATE_LIMITER) {
    console.warn('pruefeRateLimit: RATE_LIMITER-Binding fehlt - Worker wird FAIL-CLOSED gesperrt (siehe P0-Sicherheitskorrektur).');
    return { erlaubt: false, grund: 'rate_limiter_fehlt' };
  }
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    return success ? { erlaubt: true } : { erlaubt: false, grund: 'limit_ueberschritten' };
  } catch (err) {
    console.warn('pruefeRateLimit: RATE_LIMITER-Aufruf fehlgeschlagen - Worker wird FAIL-CLOSED gesperrt:', err.message);
    return { erlaubt: false, grund: 'rate_limiter_fehler' };
  }
}

// --- Freigabe-Engine für "katalog" (siehe COLLECTION_MODUS.katalog oben) ---
//
// Dieselbe Firestore-Collection wie beim KI-Bürokraft-MCP-Server
// (mcpFinanzFreigaben, siehe dessen README) - bewusst ein gemeinsamer
// Freigabe-Pool statt zweier getrennter Konzepte für dieselbe Art
// Entscheidung (Katalogpreis anlegen/ändern). Atomare Ausführung über
// Firestores optimistische Nebenläufigkeitskontrolle (currentDocument.
// updateTime) - zwei gleichzeitige "freigeben"-Aufrufe für dieselbe
// Freigabe führen sie garantiert nur einmal aus, nicht doppelt.
const FINANZ_FREIGABE_COLLECTION = 'mcpFinanzFreigaben';
const FINANZ_FREIGABE_ABLAUF_STUNDEN = 24;

async function erstelleFreigabe({ ctx, aktion, collection, zielId, daten, zusammenfassung }) {
  const id = crypto.randomUUID();
  const jetzt = new Date();
  const ablaufAm = new Date(jetzt.getTime() + FINANZ_FREIGABE_ABLAUF_STUNDEN * 3600 * 1000).toISOString();
  const data = {
    id, aktion, collection, zielId: zielId || '', daten: JSON.stringify(daten), zusammenfassung,
    status: 'offen', quelle: 'rest-api', erstelltAm: jetzt.toISOString(), ablaufAm,
  };
  await firestoreCreate({ ...ctx, collection: FINANZ_FREIGABE_COLLECTION, id, data });
  return { id, status: 'offen', zusammenfassung, ablauf_am: ablaufAm, freigeben_url: `/freigaben/${id}/freigeben`, ablehnen_url: `/freigaben/${id}/ablehnen` };
}

/** Wie firestoreUpdate, aber mit einer Statusbedingung (optimistische Nebenläufigkeitskontrolle) - schlägt mit 409 fehl, wenn der Status zwischenzeitlich bereits geändert wurde. */
async function firestoreClaim({ ctx, collection, id, erwarteterStatus, neuerStatus, zusatzFelder = {} }) {
  const docName = `projects/${ctx.projectId}/databases/(default)/documents/${collection}/${id}`;
  const getRes = await fetch(`https://firestore.googleapis.com/v1/${docName}`, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
  if (getRes.status === 404) { const err = new Error('Freigabe wurde nicht gefunden.'); err.status = 404; throw err; }
  if (!getRes.ok) throw new Error(`Firestore-Fehler (${getRes.status}) beim Lesen von ${collection}/${id}.`);
  const doc = await getRes.json();
  const aktuellerStatus = doc.fields?.status?.stringValue;
  if (aktuellerStatus !== erwarteterStatus) {
    const err = new Error(`Freigabe hat bereits den Status "${aktuellerStatus}" - keine erneute Bearbeitung möglich.`);
    err.status = 409;
    throw err;
  }
  const geaenderteFelder = { status: { stringValue: neuerStatus }, ...toFirestoreFields(zusatzFelder) };
  const commitRes = await fetch(`https://firestore.googleapis.com/v1/projects/${ctx.projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.accessToken}` },
    body: JSON.stringify({
      writes: [{
        update: { name: docName, fields: geaenderteFelder },
        updateMask: { fieldPaths: Object.keys(geaenderteFelder) },
        currentDocument: { updateTime: doc.updateTime },
      }],
    }),
  });
  if (!commitRes.ok) {
    const err = new Error('Freigabe wurde gerade parallel bereits bearbeitet.');
    err.status = 409;
    throw err;
  }
  return docToPlain({ name: docName, fields: { ...doc.fields, ...geaenderteFelder } });
}

async function fuehreFreigabeAus({ ctx, id }) {
  let geklaimt;
  try {
    geklaimt = await firestoreClaim({ ctx, collection: FINANZ_FREIGABE_COLLECTION, id, erwarteterStatus: 'offen', neuerStatus: 'wird_ausgefuehrt' });
  } catch (err) {
    return jsonResponse({ error: err.message }, err.status || 500);
  }
  const { collection, zielId, daten, aktion } = geklaimt;
  const data = JSON.parse(daten);
  try {
    const ergebnis = aktion.startsWith('create_')
      ? await firestoreCreate({ ...ctx, collection, id: data.id || crypto.randomUUID(), data: { ...data, id: undefined } })
      : await firestoreUpdate({ ...ctx, collection, id: zielId, data });
    await firestoreUpdate({ ...ctx, collection: FINANZ_FREIGABE_COLLECTION, id, data: { status: 'ausgefuehrt', abgeschlossenAm: new Date().toISOString() } });
    return jsonResponse({ ok: true, data: ergebnis });
  } catch (err) {
    await firestoreUpdate({ ...ctx, collection: FINANZ_FREIGABE_COLLECTION, id, data: { status: 'fehlgeschlagen', fehler: err.message, abgeschlossenAm: new Date().toISOString() } });
    return jsonResponse({ error: `Freigabe-Ausführung fehlgeschlagen: ${err.message}` }, 500);
  }
}

async function lehneFreigabeAb({ ctx, id, grund }) {
  try {
    await firestoreClaim({
      ctx, collection: FINANZ_FREIGABE_COLLECTION, id, erwarteterStatus: 'offen', neuerStatus: 'abgelehnt',
      zusatzFelder: { ablehnungsgrund: grund || '', abgeschlossenAm: new Date().toISOString() },
    });
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, err.status || 500);
  }
}

async function handleFreigaben({ ctx, teile, method, request }) {
  const [, id, aktionTeil] = teile;
  if (!id && method === 'GET') {
    const alle = await firestoreList({ ...ctx, collection: FINANZ_FREIGABE_COLLECTION });
    return jsonResponse({ ok: true, data: alle.filter((f) => f.status === 'offen') });
  }
  if (id && !aktionTeil && method === 'GET') {
    const freigabe = await firestoreGet({ ...ctx, collection: FINANZ_FREIGABE_COLLECTION, id });
    if (!freigabe) return jsonResponse({ error: 'Nicht gefunden.' }, 404);
    return jsonResponse({ ok: true, data: freigabe });
  }
  if (id && aktionTeil === 'freigeben' && method === 'POST') return fuehreFreigabeAus({ ctx, id });
  if (id && aktionTeil === 'ablehnen' && method === 'POST') {
    let grund = '';
    try { const body = await request.json(); grund = body.grund || ''; } catch { /* Body optional */ }
    return lehneFreigabeAb({ ctx, id, grund });
  }
  return jsonResponse({ error: 'Unbekannter Freigaben-Endpunkt.' }, 404);
}

// Zusätzliche benannte Exporte rein für lokale Unit-Tests (reine Funktionen,
// ohne Netzwerkzugriff) - der Cloudflare-Worker-Laufzeit stört das nicht,
// die Plattform ruft ausschließlich den default-Export auf.
export { toFirestoreValue, toFirestoreFields, fromFirestoreValue, fromFirestoreFields, docToPlain, zeitkonstanterVergleich };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return jsonResponse(null, 204);

    if (!env.API_KEY) {
      return jsonResponse({ error: 'Worker ist nicht korrekt eingerichtet (API_KEY fehlt).' }, 500);
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimit = await pruefeRateLimit(env, ip);
    if (!rateLimit.erlaubt) {
      const istKonfigurationsproblem = rateLimit.grund !== 'limit_ueberschritten';
      return jsonResponse({
        error: istKonfigurationsproblem
          ? 'API vorübergehend nicht erreichbar (Rate-Limiter nicht eingerichtet).'
          : 'Zu viele Anfragen - bitte kurz warten.',
      }, istKonfigurationsproblem ? 503 : 429);
    }
    const authHeader = request.headers.get('Authorization') || '';
    const gesendeterSchluessel = authHeader.replace(/^Bearer\s+/i, '');
    const istVollzugriff = zeitkonstanterVergleich(gesendeterSchluessel, env.API_KEY);
    const istNurLesend = !istVollzugriff && !!env.API_KEY_READONLY && zeitkonstanterVergleich(gesendeterSchluessel, env.API_KEY_READONLY);
    if (!istVollzugriff && !istNurLesend) {
      return jsonResponse({ error: 'Ungültiger oder fehlender API-Schlüssel (Authorization: Bearer <Schlüssel>).' }, 401);
    }
    if (istNurLesend && request.method !== 'GET') {
      return jsonResponse({ error: 'Dieser API-Schlüssel ist nur lesend (API_KEY_READONLY) - Schreibzugriff erfordert den vollen API_KEY.' }, 403);
    }

    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return jsonResponse({ error: 'Worker ist nicht korrekt eingerichtet (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).' }, 500);
    }

    const url = new URL(request.url);
    const teile = url.pathname.split('/').filter(Boolean);

    try {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
      const projectId = serviceAccount.project_id;
      const ctx = { accessToken, projectId };

      if (teile[0] === 'freigaben') {
        return await handleFreigaben({ ctx, teile, method: request.method, request });
      }

      const [collection, id] = teile;
      const modus = COLLECTION_MODUS[collection];
      if (!modus) {
        return jsonResponse({ error: `Unbekannter Endpunkt. Erlaubt: ${Object.keys(COLLECTION_MODUS).map((c) => '/' + c).join(', ')}, /freigaben` }, 404);
      }
      // id landet unvalidiert direkt in der Firestore-REST-URL (siehe
      // firestoreGet/firestoreCreate/firestoreUpdate oben) - nur das in Werkora
      // tatsächlich verwendete ID-Format zulassen (crypto.randomUUID() oder der
      // "id-<base36>-<base36>"-Fallback, siehe uid() in utils.js), damit kein
      // ungültiger/manipulierter Pfadabschnitt an Firestore durchgereicht wird.
      if (id !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
        return jsonResponse({ error: 'Ungültige ID.' }, 400);
      }

      if (request.method === 'GET' && !id) {
        const list = await firestoreList({ ...ctx, collection });
        return jsonResponse({ ok: true, data: list });
      }
      if (request.method === 'GET' && id) {
        const doc = await firestoreGet({ ...ctx, collection, id });
        if (!doc) return jsonResponse({ error: 'Nicht gefunden.' }, 404);
        return jsonResponse({ ok: true, data: doc });
      }

      if (modus === 'nur-lesen') {
        return jsonResponse({ error: `"${collection}" ist nur lesend (gesetzlich gesperrt) - kein POST/PATCH möglich.` }, 405);
      }

      if (request.method === 'POST' && !id) {
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: 'Ungültiger JSON-Body.' }, 400); }
        const { id: _ignored, ...data } = body;

        if (modus === 'freigabe') {
          const freigabe = await erstelleFreigabe({
            ctx, aktion: `create_${collection}`, collection, zielId: null, daten: body,
            zusammenfassung: `Neuen Eintrag in "${collection}" anlegen: ${body.bezeichnung || body.id || '(ohne Namen)'}.`,
          });
          return jsonResponse({ ok: true, freigabe_erforderlich: true, freigabe }, 202);
        }

        if (modus === 'entwurf') data.status = 'entwurf'; // server-seitig erzwungen, egal was im Body stand
        const neueId = body.id || crypto.randomUUID();
        const doc = await firestoreCreate({ ...ctx, collection, id: neueId, data });
        return jsonResponse({ ok: true, data: doc }, 201);
      }

      if (request.method === 'PATCH' && id) {
        if (modus === 'lesen-anlegen') {
          return jsonResponse({ error: `"${collection}" erlaubt nur Lesen/Anlegen, kein Aktualisieren.` }, 405);
        }

        if (modus === 'freigabe') {
          const bestehend = await firestoreGet({ ...ctx, collection, id });
          if (!bestehend) return jsonResponse({ error: 'Nicht gefunden.' }, 404);
          let body;
          try { body = await request.json(); } catch { return jsonResponse({ error: 'Ungültiger JSON-Body.' }, 400); }
          const { id: _ignored, ...data } = body;
          if (Object.keys(data).length === 0) return jsonResponse({ error: 'Keine Felder zum Aktualisieren übergeben.' }, 400);
          const freigabe = await erstelleFreigabe({
            ctx, aktion: `update_${collection}`, collection, zielId: id, daten: data,
            zusammenfassung: `Eintrag "${bestehend.bezeichnung || id}" in "${collection}" ändern.`,
          });
          return jsonResponse({ ok: true, freigabe_erforderlich: true, freigabe }, 202);
        }

        if (modus === 'entwurf') {
          const bestehend = await firestoreGet({ ...ctx, collection, id });
          if (!bestehend) return jsonResponse({ error: 'Nicht gefunden.' }, 404);
          if (bestehend.status !== 'entwurf') {
            return jsonResponse({ error: 'Nur Angebote im Status "entwurf" können über die API geändert werden - Versand/Freigabe bleibt Werkora vorbehalten.' }, 409);
          }
          let body;
          try { body = await request.json(); } catch { return jsonResponse({ error: 'Ungültiger JSON-Body.' }, 400); }
          const { id: _ignored, status: _statusIgnored, ...data } = body; // status selbst bleibt über diesen Weg unveränderbar
          if (Object.keys(data).length === 0) return jsonResponse({ error: 'Keine Felder zum Aktualisieren übergeben.' }, 400);
          const doc = await firestoreUpdate({ ...ctx, collection, id, data });
          return jsonResponse({ ok: true, data: doc });
        }

        // modus === 'full'
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: 'Ungültiger JSON-Body.' }, 400); }
        const { id: _ignored, ...data } = body;
        if (Object.keys(data).length === 0) return jsonResponse({ error: 'Keine Felder zum Aktualisieren übergeben.' }, 400);
        const doc = await firestoreUpdate({ ...ctx, collection, id, data });
        if (!doc) return jsonResponse({ error: 'Nicht gefunden.' }, 404);
        return jsonResponse({ ok: true, data: doc });
      }

      return jsonResponse({ error: 'Methode nicht unterstützt.' }, 405);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500);
    }
  },
};
