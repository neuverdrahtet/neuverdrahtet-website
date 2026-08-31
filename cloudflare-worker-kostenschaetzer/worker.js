/**
 * neuverdrahtet Wallbox-Kostenschätzer + Kontaktformular – Lead-Erstellung (Cloudflare Worker)
 *
 * Nimmt zwei Arten von Anfragen entgegen und legt daraus jeweils automatisch
 * einen Kunden (Status "Lead") + ein Projekt in der Werkora-Lead-Pipeline an:
 *   1. Eine abgeschlossene Anfrage aus dem öffentlichen Wallbox-Kostenschätzer
 *      (wallbox-kostenschaetzer.html) - Standardfall, kein "formTyp"-Feld.
 *   2. Das allgemeine Kontaktformular auf index.html (assets/script.js,
 *      .ajax-form-Handler) - erkennbar am Feld "formTyp":"kontakt". Läuft
 *      parallel zur bestehenden Formspree-E-Mail-Zustellung, nicht als
 *      Ersatz dafür (falls der Worker/Firebase mal nicht erreichbar ist,
 *      kommt die Anfrage trotzdem per E-Mail an).
 * Läuft bewusst als eigener, dedizierter Worker getrennt
 * vom internen Admin-Worker (cloudflare-worker/) - dieser Endpunkt ist
 * absichtlich öffentlich ohne Secret erreichbar (die Anfrage kommt direkt
 * von unauthentifizierten Website-Besuchern), während der Admin-Worker
 * hinter X-App-Secret für die interne Verwaltungs-Software gedacht ist.
 *
 * Schreibt Firestore-Dokumente direkt per REST-API mit einem Firebase-
 * Service-Account (Admin-Zugriff, umgeht die normalen Sicherheitsregeln -
 * das ist beabsichtigt und das einzige bestehende Muster für privilegierte
 * Server-Schreibzugriffe in diesem Projekt, siehe cloudflare-worker/worker.js
 * push-send-Aktion).
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, erforderlich) – kompletter Inhalt
 *                        einer Firebase-Service-Account-JSON-Datei (Firebase-
 *                        Konsole -> Projekteinstellungen -> Dienstkonten ->
 *                        Neuen privaten Schlüssel generieren), als
 *                        einzeiliger String. Dasselbe Firebase-Projekt wie
 *                        die Verwaltungs-Software.
 *   ALLOWED_ORIGINS      (Variable, optional) – Komma-getrennte Liste
 *                        erlaubter Herkünfte, Standard:
 *                        https://neuverdrahtet.com,https://www.neuverdrahtet.com
 *   TWILIO_ACCOUNT_SID,  (Secrets, optional, alle vier zusammen) – für eine
 *   TWILIO_AUTH_TOKEN,     zusätzliche WhatsApp-Benachrichtigung an den
 *   TWILIO_WHATSAPP_FROM,  Geschäftsinhaber bei jedem neuen Lead, über Twilio.
 *   TWILIO_WHATSAPP_TO      FROM/TO im Twilio-Format "whatsapp:+49...".
 *                        Fehlt eines der vier, wird die Benachrichtigung
 *                        einfach übersprungen (kein Fehler) - die Lead-
 *                        Anlage selbst hängt nicht daran.
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://neuverdrahtet.com',
  'https://www.neuverdrahtet.com',
];

function getAllowedOrigins(env) {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(origin, env) {
  const allowed = getAllowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// --- Google-Service-Account-JWT-Flow (1:1 aus cloudflare-worker/worker.js
// übernommen, nur der OAuth-Scope unten ändert sich von FCM auf Firestore). ---

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

/** Signiert ein Google-OAuth2-Service-Account-JWT und tauscht es gegen einen Access-Token. */
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

// --- Firestore REST API: einfacher Wert-Encoder + Dokument-Schreiber ---
// (db.js in der Verwaltungs-Software nutzt das Firestore-Web-SDK, hier im
// Worker gibt es keinen SDK-Zugriff - daher der eigene, minimale Encoder.)

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

/** Überschreibt ein Firestore-Dokument vollständig (PATCH ohne updateMask = set()-Semantik). */
async function firestoreWriteDoc({ accessToken, projectId, collection, id, data }) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore-Fehler (${res.status}) bei ${collection}/${id}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// --- Kunden-Farbe (1:1 Logik aus verwaltung/js/utils.js farbeAusText() +
// die KUNDEN_FARBEN-Palette aus kunden.js/leadpipeline.js übernommen). ---

const KUNDEN_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

function farbeAusText(text, palette) {
  let hash = 0;
  const str = text || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

// --- Wallbox-Anfrage: lesbare Zusammenfassung + grobe Lead-Klassifizierung ---

const LABELS = {
  nutzung: { privat: 'Privat', gewerblich: 'Gewerblich' },
  stellplatz: { garage: 'Garage', carport: 'Carport', aussen: 'Außenstellplatz', tiefgarage: 'Tiefgarage', mfh: 'Mehrfamilienhaus' },
  erdarbeiten: { ja: 'Ja', nein: 'Nein', unbekannt: 'Weiß nicht' },
  leistung: { '11kw': '11 kW', '22kw': '22 kW', offen: 'Noch offen' },
  zaehlerschrankAlter: { neu: 'Unter 10 Jahre', mittel: '10–30 Jahre', alt: 'Über 30 Jahre', unbekannt: 'Weiß nicht' },
  freierPlatz: { ja: 'Ja', nein: 'Nein', unbekannt: 'Weiß nicht' },
  objektart: { efh: 'Einfamilienhaus', dhh: 'Doppelhaushälfte', rh: 'Reihenhaus', mfh: 'Mehrfamilienhaus', gewerbe: 'Gewerbeobjekt' },
  zeitraum: { sofort: 'Sofort', '4wochen': 'Innerhalb 4 Wochen', '3monate': 'Innerhalb 3 Monate', offen: 'Noch offen' },
};

function fmtEUR(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
}

/** Grobe Lead-Qualitäts-Einstufung (A-D) nach Dringlichkeit + Klarheit der Angaben. */
function klassifiziereLead(payload) {
  const zeitraum = payload.antworten?.zeitraum;
  const dringend = zeitraum === 'sofort' || zeitraum === '4wochen';
  const klar = payload.kostenspanne?.ampel === 'gruen';
  if (dringend && klar) return 'A';
  if (dringend || klar) return 'B';
  if (zeitraum === '3monate') return 'C';
  return 'D';
}

function buildBeschreibung(payload) {
  const a = payload.antworten || {};
  const ks = payload.kostenspanne || {};
  const leadKlasse = klassifiziereLead(payload);
  const zeilen = [
    `[Lead ${leadKlasse}] Wallbox-Anfrage über den Online-Kostenschätzer (${new Date().toLocaleDateString('de-DE')})`,
    '',
    `Kostenspanne: ${fmtEUR(ks.von)} – ${fmtEUR(ks.bis)} (${ks.ampel === 'gruen' ? 'gute Datenlage' : 'einige Angaben noch unklar'})`,
    '',
    `Nutzung: ${LABELS.nutzung[a.nutzung] || a.nutzung || '–'}`,
    `Anzahl Ladepunkte: ${a.anzahlLadepunkte ?? '–'}`,
    `Stellplatz: ${LABELS.stellplatz[a.stellplatz] || a.stellplatz || '–'}`,
    `Entfernung zum Zählerschrank: ${a.entfernungUnbekannt ? 'unbekannt' : (a.entfernungM != null ? a.entfernungM + ' m' : '–')}`,
    `Erdarbeiten nötig: ${LABELS.erdarbeiten[a.erdarbeiten] || a.erdarbeiten || '–'}`,
    `Ladeleistung: ${LABELS.leistung[a.leistung] || a.leistung || '–'}`,
    `Lastmanagement gewünscht: ${a.lastmanagement ? 'Ja' : 'Nein'}`,
    `PV-Überschussladen gewünscht: ${a.pvUeberschuss ? 'Ja' : 'Nein'}`,
    `Zählerschrank-Alter: ${LABELS.zaehlerschrankAlter[a.zaehlerschrankAlter] || a.zaehlerschrankAlter || '–'}`,
    `Freier Platz im Zählerschrank: ${LABELS.freierPlatz[a.freierPlatz] || a.freierPlatz || '–'}`,
    `Photovoltaik vorhanden: ${a.photovoltaikVorhanden ? 'Ja' : 'Nein'}`,
    `Objektart: ${LABELS.objektart[a.objektart] || a.objektart || '–'}`,
    `Gewünschter Zeitraum: ${LABELS.zeitraum[a.zeitraum] || a.zeitraum || '–'}`,
    `PLZ/Ort: ${[a.plz, a.ort].filter(Boolean).join(' ') || '–'}`,
  ];
  if (payload.kontakt?.nachricht) zeilen.push('', `Nachricht: ${payload.kontakt.nachricht}`);
  return zeilen.join('\n');
}

// --- Allgemeines Kontaktformular (index.html) ---

function buildKontaktBeschreibung(payload) {
  const zeilen = [
    `Anfrage über das Kontaktformular auf der Website (${new Date().toLocaleDateString('de-DE')})`,
    '',
    `Leistung: ${payload.service || '–'}`,
    '',
    'Nachricht:',
    payload.nachricht || '–',
  ];
  return zeilen.join('\n');
}

/**
 * Sendet eine Best-Effort-WhatsApp-Benachrichtigung an den Geschäftsinhaber
 * über Twilio, sobald ein neuer Lead angelegt wurde. Rein informativ - ohne
 * gesetzte Twilio-Secrets passiert einfach nichts (kein Fehler), und ein
 * fehlgeschlagener Versand lässt die eigentliche Lead-Anlage unangetastet
 * (dieselbe additive Best-Effort-Philosophie wie sendeWerkoraLead in
 * assets/script.js für die Formspree/Werkora-Parallelität).
 */
async function sendeLeadBenachrichtigung(env, text) {
  const fehlendeSecrets = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WHATSAPP_TO'].filter((k) => !env[k]);
  if (fehlendeSecrets.length) {
    console.error(`WhatsApp-Benachrichtigung übersprungen - fehlende Secrets: ${fehlendeSecrets.join(', ')}`);
    return;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: env.TWILIO_WHATSAPP_FROM, To: env.TWILIO_WHATSAPP_TO, Body: text }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`Twilio-WhatsApp-Benachrichtigung fehlgeschlagen (${res.status}): ${errText.slice(0, 300)}`);
    } else {
      console.log('WhatsApp-Benachrichtigung erfolgreich an Twilio übergeben.');
    }
  } catch (err) {
    console.error('Twilio-WhatsApp-Benachrichtigung: Netzwerkfehler', err);
  }
}

/**
 * Schreibt Kunde + Projekt für einen Lead nach Firestore (gemeinsam für beide
 * Formular-Arten). "kunde" wird ohne "farbe" übergeben - die wird hier aus
 * der frisch vergebenen kundeId berechnet (wie im ursprünglichen
 * Wallbox-Pfad).
 */
async function legeLeadAn({ env, kunde, projekt }) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
  const kundeId = crypto.randomUUID();
  const projektId = crypto.randomUUID();
  await firestoreWriteDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'kunden', id: kundeId, data: { ...kunde, farbe: farbeAusText(kundeId, KUNDEN_FARBEN) } });
  await firestoreWriteDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'projekte', id: projektId, data: { ...projekt, kundeId } });
  await sendeLeadBenachrichtigung(env, [
    `📩 Neuer Lead: ${kunde.firma}`,
    projekt.titel,
    kunde.telefon ? `Tel: ${kunde.telefon}` : '',
    kunde.email ? `E-Mail: ${kunde.email}` : '',
  ].filter(Boolean).join('\n'));
}

// Zusätzliche benannte Exporte rein für lokale Unit-Tests (reine Funktionen,
// ohne Netzwerkzugriff) - der Cloudflare-Worker-Laufzeit stört das nicht,
// die Plattform ruft ausschließlich den default-Export auf.
export { toFirestoreValue, toFirestoreFields, buildBeschreibung, klassifiziereLead, farbeAusText };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
    if (!getAllowedOrigins(env).includes(origin)) {
      return jsonResponse({ error: 'Origin nicht erlaubt.' }, 403, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Ungültiger Request-Body.' }, 400, headers);
    }

    // Anti-Spam: verdächtig schnell abgesendet (ein Mensch braucht für den
    // 7-Schritte-Assistenten bzw. das Kontaktformular realistisch mehrere
    // Sekunden). Bot nicht warnen, dass er erkannt wurde - einfach "ok" ohne
    // wirklich etwas anzulegen.
    //
    // Das Honeypot-Feld (body.website) fließt bewusst NICHT mehr allein in
    // diese Entscheidung ein: Browser-Autofill befüllt es bei echten Nutzern
    // gelegentlich fälschlich (beobachtet mit Chrome, das das Feld anhand
    // des - für Menschen unsichtbaren - Labels "Firma" erkennt und trotz
    // autocomplete="off" aus dem gespeicherten Profil ausfüllt). Ein allein
    // darauf gestütztes Verwerfen hätte damit echte Leads stillschweigend
    // verschluckt. Nur in Kombination mit einer zu schnellen Absendezeit
    // gilt ein befülltes Honeypot-Feld als zusätzliches Bot-Indiz.
    const ladezeitMs = typeof body.ladezeitMs === 'number' ? body.ladezeitMs : 0;
    const zuSchnell = ladezeitMs < 3000;
    if (zuSchnell || (body.website && ladezeitMs < 10000)) {
      return jsonResponse({ ok: true }, 200, headers);
    }

    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return jsonResponse({ error: 'Worker ist nicht korrekt eingerichtet (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).' }, 500, headers);
    }

    if (body.formTyp === 'kontakt') {
      if (!body.name || !body.email) {
        return jsonResponse({ error: 'Bitte Name und E-Mail angeben.' }, 400, headers);
      }
      try {
        await legeLeadAn({
          env,
          kunde: {
            firma: body.name,
            ansprechpartner: '',
            telefon: body.telefon || '',
            email: body.email,
            status: 'lead',
            // Dieselbe Beschreibung wie im Projekt auch hier im Kunden-Notizfeld,
            // damit Leistung + Nachricht direkt in der Lead-Pipeline (Kunden-Ansicht)
            // sichtbar sind, statt nur im separaten Projekte-Board.
            notizen: buildKontaktBeschreibung(body),
          },
          projekt: {
            titel: `Kontaktanfrage${body.service ? ': ' + body.service : ''} (Website)`,
            status: 'neue-anfrage',
            bereich: 'auftrag',
            kategorieId: 'auftrag-elektroinstallation',
            gewerk: 'elektro',
            beschreibung: buildKontaktBeschreibung(body),
            mitarbeiterIds: [],
            farbe: '',
            markeId: '',
            createdAt: new Date().toISOString(),
          },
        });
        return jsonResponse({ ok: true }, 200, headers);
      } catch (err) {
        return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500, headers);
      }
    }

    const kontakt = body.kontakt || {};
    if (!kontakt.vorname || !kontakt.nachname || !kontakt.email) {
      return jsonResponse({ error: 'Bitte Vorname, Nachname und E-Mail angeben.' }, 400, headers);
    }
    if (!body.datenschutzEinwilligung) {
      return jsonResponse({ error: 'Einwilligung zur Datenverarbeitung erforderlich.' }, 400, headers);
    }

    try {
      const vollerName = `${kontakt.vorname} ${kontakt.nachname}`.trim();
      await legeLeadAn({
        env,
        kunde: {
          firma: vollerName,
          ansprechpartner: '',
          telefon: kontakt.telefon || '',
          email: kontakt.email,
          status: 'lead',
          // s. Kommentar im "kontakt"-Zweig oben - dieselbe Beschreibung wie im
          // Projekt auch hier im Kunden-Notizfeld für die Lead-Pipeline-Ansicht.
          notizen: buildBeschreibung(body),
        },
        projekt: {
          titel: 'Wallbox-Anfrage (Website)',
          status: 'neue-anfrage',
          bereich: 'auftrag',
          kategorieId: 'auftrag-elektroinstallation',
          gewerk: 'elektro',
          beschreibung: buildBeschreibung(body),
          mitarbeiterIds: [],
          farbe: '',
          markeId: '',
          createdAt: new Date().toISOString(),
        },
      });
      return jsonResponse({ ok: true }, 200, headers);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500, headers);
    }
  },
};
