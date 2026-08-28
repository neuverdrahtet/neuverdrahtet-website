/**
 * neuverdrahtet Website-KI-Assistent (Cloudflare Worker)
 *
 * Nimmt Chat-Nachrichten des Chat-Widgets auf der öffentlichen Website
 * (assets/ki-assistent.js) entgegen, lässt Claude (Anthropic Messages API)
 * darauf antworten (Firmenwissen als System-Prompt), und kann - wenn der
 * Besucher zustimmt und Kontaktdaten nennt - per Tool automatisch einen
 * Kunden (Status "Lead") + ein Projekt in der Werkora-Lead-Pipeline anlegen
 * (dieselbe Firebase-Datenbank wie die Verwaltungs-Software, dasselbe
 * Firestore-Schreibmuster wie cloudflare-worker-kostenschaetzer/worker.js).
 *
 * Ein eigener, dedizierter Worker - getrennt vom internen Admin-Worker
 * (cloudflare-worker/, per X-App-Secret gesichert) und vom KI-Bürokraft-
 * Worker (nur für die interne Verwaltung gedacht). Dieser hier ist
 * absichtlich öffentlich ohne Secret erreichbar (wird direkt vom Browser
 * unauthentifizierter Website-Besucher aufgerufen) - wie der
 * Kostenschätzer-Worker.
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   ANTHROPIC_API_KEY             (Secret, erforderlich) - dein Anthropic-API-Schlüssel.
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, erforderlich) - komplettes JSON einer
 *                        Firebase-Service-Account-Datei (Firebase-Konsole ->
 *                        Projekteinstellungen -> Dienstkonten -> Neuen privaten
 *                        Schlüssel generieren), als einzeiliger String. Dasselbe
 *                        Firebase-Projekt wie die Verwaltungs-Software.
 *   ALLOWED_ORIGINS      (Variable, optional) - Komma-getrennte Liste erlaubter
 *                        Herkünfte, Standard: https://neuverdrahtet.com,https://www.neuverdrahtet.com
 *   MODEL_ID             (Variable, optional) - Standard: claude-haiku-4-5
 *                        (schnell/günstig, für einen öffentlichen Chat-Bot mit
 *                        vielen Anfragen sinnvoll; teurere Alternative z.B.
 *                        claude-opus-4-8 für noch bessere Antworten).
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://neuverdrahtet.com',
  'https://www.neuverdrahtet.com',
];

// Grobe Kappung gegen Missbrauch/Kostenexplosion - kein Ersatz für ein echtes
// CAPTCHA (siehe "Spätere Ausbaustufen" in der README).
const MAX_MESSAGES = 40;
const MAX_MESSAGE_LEN = 4000;
const MAX_TOOL_ITERATIONS = 4;

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

// --- Google-Service-Account-JWT-Flow + Firestore-Schreibfunktionen (1:1 aus
// cloudflare-worker-kostenschaetzer/worker.js übernommen). ---

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

const KUNDEN_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

function farbeAusText(text, palette) {
  let hash = 0;
  const str = text || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/** Legt aus den vom Tool-Aufruf gelieferten Angaben einen Lead (Kunde + Projekt) in Werkora an. */
async function leadAnlegen({ env, input }) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

  const kundeId = crypto.randomUUID();
  const projektId = crypto.randomUUID();
  const name = (input.name || '').trim() || 'Website-Chat (kein Name angegeben)';

  const kunde = {
    firma: name,
    ansprechpartner: '',
    telefon: input.telefon || '',
    email: input.email || '',
    status: 'lead',
    farbe: farbeAusText(kundeId, KUNDEN_FARBEN),
    notizen: 'Angelegt über den KI-Assistenten auf der Website',
  };
  const projekt = {
    titel: `Website-Chat-Anfrage${input.leistung ? ': ' + input.leistung : ''}`,
    kundeId,
    status: 'neue-anfrage',
    bereich: 'auftrag',
    kategorieId: 'auftrag-elektroinstallation',
    gewerk: 'elektro',
    beschreibung: [
      `[KI-Assistent] Lead über den Website-Chat (${new Date().toLocaleDateString('de-DE')})`,
      '',
      `Leistung/Thema: ${input.leistung || '–'}`,
      `PLZ/Ort: ${input.plzOrt || '–'}`,
      `Dringlichkeit: ${input.dringlichkeit || '–'}`,
      '',
      `Zusammenfassung des Anliegens:`,
      input.zusammenfassung || '–',
    ].join('\n'),
    mitarbeiterIds: [],
    farbe: '',
    markeId: '',
    createdAt: new Date().toISOString(),
  };

  await firestoreWriteDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'kunden', id: kundeId, data: kunde });
  await firestoreWriteDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'projekte', id: projektId, data: projekt });
}

// --- Firmenwissen für den System-Prompt. Bewusst kompakt gehalten (Kosten je
// Anfrage) - für Detailfragen/genaue Kostenschätzung verweist der Assistent
// auf die jeweilige Leistungsseite mit Kosten-Konfigurator, statt selbst
// verbindliche Preise zu nennen. ---

const SYSTEM_PROMPT = `Du bist der KI-Assistent auf der Website der Firma neuverdrahtet, einem Elektro-Fachbetrieb in Essen (Nordrhein-Westfalen). Geschäftsführer: Danny Berger. Slogan: "Smarte Elektrokonzepte für Alt & Neubau".

Kontakt: Donnerstr. 131, 45357 Essen · Telefon 01706398575 · E-Mail neuverdrahtet@gmail.com
Einsatzgebiet: Essen (alle Stadtteile) und Ruhrgebiet (u.a. Bochum, Mülheim an der Ruhr, Oberhausen, Gelsenkirchen, Bottrop, Duisburg).

Leistungen (12 unter einem Dach, ein Ansprechpartner fürs ganze Projekt):
Elektroinstallation (Neubau/Altbau/Sanierung), Beleuchtungstechnik (Lichtplanung, LED-Umrüstung, Einbaustrahler), Smart Home (Licht/Heizung/Sicherheit vernetzt), Photovoltaik (elektroseitiger Anschluss), Wallbox (privat/gewerblich), Wärmepumpe (Elektroanschluss), E-Check (VDE 0701-0702), DGUV-V3-Prüfung für Betriebe, Wartung (Störungsbehebung, Thermografie), Elektrosanierung (auch bewohnt), Zählerschrank (Erweiterung/Tausch nach VDE-AR-N 4100), Unterverteilung (Garage/Keller/Werkstatt/Gewerbe).

Deine Aufgabe:
- Beantworte Fragen zu diesen Leistungen freundlich, kompetent und knapp (wenige Sätze, keine Romane) auf Deutsch. Du bist kein Ersatz für eine Vor-Ort-Einschätzung durch den Elektromeister - mach das transparent.
- Nenne keine verbindlichen Festpreise. Für eine grobe Kosteneinschätzung verweise auf den passenden "Kosten-Konfigurator" auf der jeweiligen Leistungsseite (z.B. bei Wallbox-Fragen auf wallbox-kostenschaetzer.html bzw. die Wallbox-Seite) - der Nutzer sieht die Website ohnehin gerade, du musst keine vollständigen URLs nennen, ein Hinweis auf den Seitennamen reicht.
- Bei akuten Elektro-Gefahren (Brandgeruch, Funkenflug, Stromschlag, sichtbar beschädigte Leitungen) rätst du sofort zur Sicherheitsabschaltung (Sicherung/FI raus) und zum Anruf beim Notdienst/der Feuerwehr, nicht nur zum Chat.
- Wenn ein Besucher erkennbares Interesse an einem konkreten Auftrag hat (z.B. "ich brauche ein Angebot für...", "können Sie mich zurückrufen"), frage aktiv nach Name, Telefonnummer oder E-Mail und kurz worum es geht, damit sich das Team persönlich meldet.
- Lege einen Lead NUR an, wenn der Besucher ausdrücklich zugestimmt hat, kontaktiert zu werden, UND mindestens Name sowie (Telefonnummer oder E-Mail) genannt hat. Frage vorher explizit nach dieser Zustimmung, falls sie nicht klar erkennbar ist (z.B. "Darf ich Ihre Angaben an unser Team weiterleiten, damit sich jemand bei Ihnen meldet?"). Rufe das Tool "lead_anlegen" dann genau einmal pro Gespräch auf.
- Erfinde keine Fakten, Preise, Verfügbarkeiten oder Termine. Bei Unsicherheit ehrlich sagen, dass das Team das am besten telefonisch/persönlich klärt.
- Du bist ausschließlich für neuverdrahtet-Themen da - bei fachfremden Anfragen freundlich ablehnen und auf den direkten Kontakt verweisen.`;

const LEAD_TOOL = {
  name: 'lead_anlegen',
  description: 'Legt einen Lead (Kontaktanfrage) im internen System von neuverdrahtet an, damit sich das Team beim Besucher meldet. Nur aufrufen, nachdem der Besucher ausdrücklich zugestimmt hat, kontaktiert zu werden, und Name sowie Telefonnummer oder E-Mail genannt hat.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name des Besuchers, wie angegeben.' },
      telefon: { type: 'string', description: 'Telefonnummer, falls genannt, sonst leer lassen.' },
      email: { type: 'string', description: 'E-Mail-Adresse, falls genannt, sonst leer lassen.' },
      leistung: { type: 'string', description: 'Kurzes Stichwort zur gewünschten Leistung, z.B. "Wallbox", "Elektrosanierung".' },
      plzOrt: { type: 'string', description: 'PLZ und/oder Ort, falls genannt.' },
      dringlichkeit: { type: 'string', description: 'Grobe Dringlichkeit, z.B. "sofort", "in den nächsten Wochen", "noch offen".' },
      zusammenfassung: { type: 'string', description: 'Kurze Zusammenfassung (2-4 Sätze) des Anliegens aus dem Gespräch, für das Team.' },
    },
    required: ['name', 'zusammenfassung'],
    additionalProperties: false,
  },
};

/** Führt den Claude-Tool-Use-Loop aus und gibt die finale Textantwort zurück. */
async function chatMitClaude({ env, messages }) {
  let conversation = messages;
  let leadErfasst = false;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.MODEL_ID || 'claude-haiku-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: conversation,
        tools: [LEAD_TOOL],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('Die Anfrage wurde aus Sicherheitsgründen abgelehnt.');
    }

    const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0 || data.stop_reason !== 'tool_use') {
      const textBlock = (data.content || []).find((b) => b.type === 'text');
      return { reply: textBlock ? textBlock.text : 'Entschuldigung, dazu kann ich gerade nichts sagen.', leadErfasst };
    }

    conversation = [...conversation, { role: 'assistant', content: data.content }];

    const toolResults = [];
    for (const toolUse of toolUses) {
      if (toolUse.name === 'lead_anlegen' && !leadErfasst) {
        try {
          await leadAnlegen({ env, input: toolUse.input || {} });
          leadErfasst = true;
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Lead wurde erfolgreich angelegt. Bedanke dich beim Besucher und bestätige, dass sich das Team meldet.' });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Fehler beim Anlegen: ${err.message}. Bitte den Besucher stattdessen bitten, direkt anzurufen oder eine E-Mail zu schreiben.`, is_error: true });
        }
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Lead wurde in diesem Gespräch bereits angelegt - kein erneuter Aufruf nötig.' });
      }
    }
    conversation = [...conversation, { role: 'user', content: toolResults }];
  }

  return { reply: 'Entschuldigung, das dauert gerade zu lange. Bitte kontaktieren Sie uns direkt telefonisch oder per E-Mail.', leadErfasst };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 'Feld "messages" fehlt oder ist leer.';
  if (messages.length > MAX_MESSAGES) return 'Diese Unterhaltung ist zu lang geworden. Bitte laden Sie die Seite neu oder kontaktieren Sie uns direkt.';
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'Ungültige Nachricht im Gesprächsverlauf.';
    if (typeof m.content !== 'string') return 'Ungültige Nachricht im Gesprächsverlauf.';
    if (m.content.length > MAX_MESSAGE_LEN) return 'Eine Nachricht ist zu lang.';
  }
  if (messages[messages.length - 1].role !== 'user') return 'Die letzte Nachricht muss vom Besucher stammen.';
  return null;
}

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

    const fehler = validateMessages(body.messages);
    if (fehler) return jsonResponse({ error: fehler }, 400, headers);

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'Worker ist nicht korrekt eingerichtet (ANTHROPIC_API_KEY fehlt).' }, 500, headers);
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return jsonResponse({ error: 'Worker ist nicht korrekt eingerichtet (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).' }, 500, headers);
    }

    try {
      const messages = body.messages.map((m) => ({ role: m.role, content: m.content }));
      const result = await chatMitClaude({ env, messages });
      return jsonResponse(result, 200, headers);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500, headers);
    }
  },
};
