/**
 * neuverdrahtet WhatsApp-KI-Assistent (Cloudflare Worker)
 *
 * Webhook für eingehende WhatsApp-Nachrichten über Twilio (WhatsApp-Sandbox
 * oder ein freigegebener WhatsApp-Business-Absender). Beantwortet Fragen von
 * Kunden/Interessenten per Claude (Anthropic) - inhaltlich derselbe
 * Assistent wie das Chat-Widget auf der Website
 * (cloudflare-worker-ki-assistent/) - und kann nach Zustimmung automatisch
 * einen Lead (Kunde + Projekt) in der Werkora-Lead-Pipeline anlegen.
 *
 * WICHTIG - was DU noch selbst einrichten musst (kann dieser Worker nicht
 * für dich tun):
 *   1. Ein Twilio-Konto (twilio.com) - kostenlos anlegbar, Nutzung ist
 *      kostenpflichtig (pro WhatsApp-Nachricht, siehe twilio.com/pricing).
 *   2. Entweder die kostenlose "WhatsApp Sandbox" für Tests (Twilio Console
 *      -> Messaging -> Try it out -> Send a WhatsApp message) oder einen
 *      echten, für WhatsApp Business freigegebenen Absender (dauert je nach
 *      Meta-Prüfung mehrere Tage, siehe Twilio-Doku "WhatsApp Business API").
 *   3. In der Twilio Console unter dem WhatsApp-Absender das Feld
 *      "WHEN A MESSAGE COMES IN" auf diese Worker-URL setzen (HTTP POST).
 * Ohne diese drei Schritte empfängt dieser Worker nie eine Anfrage - er
 * kann selbst keine Telefonnummer/Absender bei WhatsApp/Meta beantragen.
 *
 * Konversationsverlauf wird - anders als beim Website-Widget - serverseitig
 * in Firestore gespeichert (Collection "whatsapp_chats", Dokument-ID = die
 * WhatsApp-Telefonnummer), weil ein Webhook pro Nachricht zustandslos
 * aufgerufen wird und der Verlauf sonst nicht über mehrere Nachrichten
 * hinweg erhalten bliebe.
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   ANTHROPIC_API_KEY             (Secret, erforderlich) - dein Anthropic-API-Schlüssel
 *                        (kann derselbe wie beim Website-Widget-Worker sein).
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, erforderlich) - komplettes JSON einer
 *                        Firebase-Service-Account-Datei, als einzeiliger String.
 *                        Dasselbe Firebase-Projekt wie die Verwaltungs-Software.
 *   TWILIO_AUTH_TOKEN   (Secret, empfohlen) - der "Auth Token" aus der
 *                        Twilio Console (Account-Übersicht). Wenn gesetzt,
 *                        prüft der Worker die Twilio-Signatur jeder Anfrage
 *                        (X-Twilio-Signature) und lehnt gefälschte Anfragen ab.
 *                        Ohne dieses Secret läuft der Worker trotzdem, aber
 *                        JEDER könnte vorgetäuschte WhatsApp-Nachrichten
 *                        einschicken (Kosten-/Missbrauchsrisiko) - siehe
 *                        Sicherheitshinweis in der README.
 *   MODEL_ID             (Variable, optional) - Standard: claude-haiku-4-5
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

const MAX_VERLAUF_LAENGE = 20; // gespeicherte Nachrichten pro Nummer (Firestore-Dokument)
const MAX_ANTWORT_LAENGE = 1500; // grobe WhatsApp-Lesbarkeitsgrenze
const MAX_TOOL_ITERATIONS = 4;

// --- Google-Service-Account-JWT-Flow + Firestore-Helfer (1:1 aus
// cloudflare-worker-ki-buerokraft/worker.js übernommen). ---

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

async function firestoreGetDoc({ accessToken, projectId, collection, id }) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore-Fehler (${res.status}) bei ${collection}/${id}: ${text.slice(0, 300)}`);
  }
  const doc = await res.json();
  return fromFirestoreFields(doc.fields);
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
async function leadAnlegen({ env, input, telefon }) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

  const kundeId = crypto.randomUUID();
  const projektId = crypto.randomUUID();
  const name = (input.name || '').trim() || 'WhatsApp-Chat (kein Name angegeben)';

  const beschreibung = [
    `[KI-Assistent] Lead über WhatsApp (${new Date().toLocaleDateString('de-DE')})`,
    '',
    `Telefonnummer (WhatsApp): ${telefon || '–'}`,
    `Leistung/Thema: ${input.leistung || '–'}`,
    `PLZ/Ort: ${input.plzOrt || '–'}`,
    `Dringlichkeit: ${input.dringlichkeit || '–'}`,
    '',
    `Zusammenfassung des Anliegens:`,
    input.zusammenfassung || '–',
  ].join('\n');

  const kunde = {
    firma: name,
    ansprechpartner: '',
    telefon: telefon || '',
    email: '',
    status: 'lead',
    farbe: farbeAusText(kundeId, KUNDEN_FARBEN),
    // Dieselbe Beschreibung wie im Projekt auch hier im Kunden-Notizfeld,
    // damit das Anliegen direkt in der Lead-Pipeline (Kunden-Ansicht)
    // sichtbar ist, statt nur im separaten Projekte-Board.
    notizen: beschreibung,
  };
  const projekt = {
    titel: `WhatsApp-Anfrage${input.leistung ? ': ' + input.leistung : ''}`,
    kundeId,
    status: 'neue-anfrage',
    bereich: 'auftrag',
    kategorieId: 'auftrag-elektroinstallation',
    gewerk: 'elektro',
    beschreibung,
    mitarbeiterIds: [],
    farbe: '',
    markeId: '',
    createdAt: new Date().toISOString(),
  };

  await firestoreWriteDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'kunden', id: kundeId, data: kunde });
  await firestoreWriteDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'projekte', id: projektId, data: projekt });
}

function buildSystemPrompt(telefon) {
  return `Du bist der KI-Assistent der Firma neuverdrahtet, einem Elektro-Fachbetrieb in Essen (Nordrhein-Westfalen), und antwortest gerade per WhatsApp. Geschäftsführer: Danny Berger. Slogan: "Smarte Elektrokonzepte für Alt & Neubau".

Kontakt: Donnerstr. 131, 45357 Essen · Telefon 01706398575 · E-Mail neuverdrahtet@gmail.com
Einsatzgebiet: Essen (alle Stadtteile) und Ruhrgebiet (u.a. Bochum, Mülheim an der Ruhr, Oberhausen, Gelsenkirchen, Bottrop, Duisburg).

Leistungen (12 unter einem Dach): Elektroinstallation, Beleuchtungstechnik, Smart Home, Photovoltaik (Elektroanschluss), Wallbox, Wärmepumpe (Elektroanschluss), E-Check, DGUV-V3-Prüfung, Wartung, Elektrosanierung, Zählerschrank, Unterverteilung.

Die WhatsApp-Telefonnummer deines Gesprächspartners ist bereits bekannt: ${telefon}. Du musst NICHT danach fragen.

Deine Aufgabe:
- Antworte kurz und klar (WhatsApp-Stil, keine langen Absätze, keine Markdown-Formatierung wie ** oder #, da WhatsApp das nicht anzeigt) auf Deutsch.
- Nenne keine verbindlichen Festpreise, sondern grobe Richtwerte falls gefragt, und verweise für eine genaue Einschätzung auf ein persönliches Gespräch bzw. die Kosten-Konfiguratoren auf neuverdrahtet.com.
- Bei akuten Elektro-Gefahren (Brandgeruch, Funkenflug, Stromschlag, sichtbar beschädigte Leitungen) rätst du sofort zur Sicherheitsabschaltung (Sicherung/FI raus) und zum Anruf beim Notdienst/der Feuerwehr.
- Wenn erkennbares Interesse an einem Auftrag besteht, frage nach Name und kurz worum es geht, und danach ausdrücklich, ob du die Anfrage ans Team weiterleiten darfst. Erst NACH dieser Zustimmung rufst du das Tool "lead_anlegen" auf (genau einmal pro Gespräch) - die Telefonnummer ergänzt das System automatisch, du musst nur Name und Anliegen erfragen.
- Erfinde keine Fakten, Preise, Verfügbarkeiten oder Termine.
- Du bist ausschließlich für neuverdrahtet-Themen da.`;
}

const LEAD_TOOL = {
  name: 'lead_anlegen',
  description: 'Legt einen Lead (Kontaktanfrage) im internen System von neuverdrahtet an. Nur aufrufen, nachdem der Gesprächspartner ausdrücklich zugestimmt hat, dass die Anfrage weitergeleitet wird, und einen Namen genannt hat.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name des Gesprächspartners, wie angegeben.' },
      leistung: { type: 'string', description: 'Kurzes Stichwort zur gewünschten Leistung, z.B. "Wallbox", "Elektrosanierung".' },
      plzOrt: { type: 'string', description: 'PLZ und/oder Ort, falls genannt.' },
      dringlichkeit: { type: 'string', description: 'Grobe Dringlichkeit, z.B. "sofort", "in den nächsten Wochen", "noch offen".' },
      zusammenfassung: { type: 'string', description: 'Kurze Zusammenfassung (2-4 Sätze) des Anliegens aus dem Gespräch, für das Team.' },
    },
    required: ['name', 'zusammenfassung'],
    additionalProperties: false,
  },
};

async function chatMitClaude({ env, messages, telefon }) {
  let conversation = messages;

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
        system: buildSystemPrompt(telefon),
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
      return 'Entschuldigung, dazu kann ich nichts sagen. Bitte rufen Sie uns direkt an: 01706398575.';
    }

    const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0 || data.stop_reason !== 'tool_use') {
      const textBlock = (data.content || []).find((b) => b.type === 'text');
      return textBlock ? textBlock.text : 'Entschuldigung, dazu kann ich gerade nichts sagen.';
    }

    conversation = [...conversation, { role: 'assistant', content: data.content }];

    const toolResults = [];
    for (const toolUse of toolUses) {
      if (toolUse.name === 'lead_anlegen') {
        try {
          await leadAnlegen({ env, input: toolUse.input || {}, telefon });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Lead wurde erfolgreich angelegt. Bedanke dich und bestätige, dass sich das Team meldet.' });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Fehler beim Anlegen: ${err.message}. Bitte den Gesprächspartner bitten, stattdessen direkt anzurufen.`, is_error: true });
        }
      }
    }
    conversation = [...conversation, { role: 'user', content: toolResults }];
  }

  return 'Entschuldigung, das dauert gerade zu lange. Bitte rufen Sie uns direkt an: 01706398575.';
}

// --- Twilio-Signaturprüfung (siehe twilio.com/docs/usage/security#validating-requests) ---

async function validateTwilioSignature({ authToken, url, params, signature }) {
  if (!signature) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];

  const keyData = new TextEncoder().encode(authToken);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

function twiml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

function xmlResponse(text, status = 200) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const rawBody = await request.text();
    const params = Object.fromEntries(new URLSearchParams(rawBody));

    if (env.TWILIO_AUTH_TOKEN) {
      const signature = request.headers.get('X-Twilio-Signature');
      const gueltig = await validateTwilioSignature({
        authToken: env.TWILIO_AUTH_TOKEN,
        url: request.url,
        params,
        signature,
      });
      if (!gueltig) return new Response('Ungültige Signatur.', { status: 403 });
    }

    const von = params.From || '';
    const nachricht = (params.Body || '').trim();
    if (!von || !nachricht) return xmlResponse(twiml('Nachricht nicht verstanden.'));

    if (!env.ANTHROPIC_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return xmlResponse(twiml('Der Assistent ist gerade nicht verfügbar. Bitte rufen Sie uns an: 01706398575.'));
    }

    // Firestore-Dokument-ID: nur alphanumerisch/+ - (WhatsApp-Präfix "whatsapp:" enthält
    // ein für Firestore-IDs problematisches Zeichen ":", daher ersetzt).
    const chatId = von.replace(/[^a-zA-Z0-9+]/g, '_');
    const telefonAnzeige = von.replace(/^whatsapp:/, '');

    try {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

      const bestehend = await firestoreGetDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'whatsapp_chats', id: chatId });
      const verlauf = (bestehend && Array.isArray(bestehend.verlauf)) ? bestehend.verlauf : [];

      const conversation = [...verlauf, { role: 'user', content: nachricht }];
      let antwort = await chatMitClaude({ env, messages: conversation, telefon: telefonAnzeige });
      if (antwort.length > MAX_ANTWORT_LAENGE) antwort = antwort.slice(0, MAX_ANTWORT_LAENGE - 1) + '…';

      const neuerVerlauf = [...conversation, { role: 'assistant', content: antwort }].slice(-MAX_VERLAUF_LAENGE);
      await firestoreWriteDoc({
        accessToken, projectId: serviceAccount.project_id, collection: 'whatsapp_chats', id: chatId,
        data: { verlauf: neuerVerlauf, telefon: telefonAnzeige, profilName: params.ProfileName || '', updatedAt: new Date().toISOString() },
      });

      return xmlResponse(twiml(antwort));
    } catch (err) {
      // Genaue Fehlerursache landet im Worker-Log (npx wrangler tail), nicht in der
      // Kunden-Antwort - dort nur ein freundlicher, generischer Hinweis.
      console.error('ki-assistent-whatsapp Fehler:', err);
      return xmlResponse(twiml('Es ist ein technisches Problem aufgetreten. Bitte rufen Sie uns direkt an: 01706398575.'));
    }
  },
};
