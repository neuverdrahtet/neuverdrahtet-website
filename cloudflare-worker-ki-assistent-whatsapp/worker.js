/**
 * neuverdrahtet WhatsApp-KI-Assistent (Cloudflare Worker)
 *
 * Webhook für eingehende WhatsApp-Nachrichten über die WhatsApp Cloud API
 * von Meta (direkt, kein Vermittler wie Twilio dazwischen). Beantwortet
 * Fragen von Kunden/Interessenten per Claude (Anthropic) - inhaltlich
 * derselbe Assistent wie das Chat-Widget auf der Website
 * (cloudflare-worker-ki-assistent/) - und kann nach Zustimmung automatisch
 * einen Lead (Kunde + Projekt) in der Werkora-Lead-Pipeline anlegen.
 *
 * WICHTIG - was DU noch selbst einrichten musst (kann dieser Worker nicht
 * für dich tun):
 *   1. Ein Meta-Geschäftskonto (business.facebook.com) und darin eine
 *      "App" mit dem Produkt "WhatsApp" (developers.facebook.com -> Meine
 *      Apps -> App erstellen -> Produkt "WhatsApp" hinzufügen). Kostenlos,
 *      Nutzung wird direkt von Meta abgerechnet (erste ca. 1000 Service-
 *      Konversationen/Monat kostenlos, siehe developers.facebook.com/docs/whatsapp/pricing).
 *   2. In der App unter "WhatsApp -> Konfiguration": die "Telefonnummer-ID"
 *      (META_PHONE_NUMBER_ID) und einen dauerhaften Zugriffstoken
 *      (META_ACCESS_TOKEN, unter "Systembenutzer" ein permanentes Token
 *      erzeugen - das temporäre 24-Stunden-Token aus der Schnellstart-
 *      Ansicht reicht NICHT für den Dauerbetrieb).
 *   3. Unter "WhatsApp -> Konfiguration -> Webhook": die Worker-URL dieses
 *      Projekts eintragen ("Rückruf-URL") sowie einen von dir frei
 *      gewählten "Verify Token" (muss identisch mit META_VERIFY_TOKEN
 *      unten sein), danach das Feld "messages" abonnieren.
 * Ohne diese drei Schritte empfängt dieser Worker nie eine Anfrage - er
 * kann selbst keine Telefonnummer bei Meta beantragen.
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
 *   META_ACCESS_TOKEN    (Secret, erforderlich) - permanentes Zugriffstoken der
 *                        Meta-App (siehe Schritt 2 oben), zum Versenden von
 *                        Antworten über die Graph API.
 *   META_PHONE_NUMBER_ID (Variable, erforderlich) - die "Telefonnummer-ID" aus
 *                        der App-Konfiguration (nicht die Telefonnummer selbst).
 *   META_VERIFY_TOKEN    (Secret, erforderlich) - ein von dir frei gewählter
 *                        Code (z.B. ein langes Zufallswort), den du 1:1 auch
 *                        beim Einrichten des Webhooks in der Meta-App einträgst.
 *                        Dient nur der einmaligen Webhook-Verifizierung.
 *   META_APP_SECRET      (Secret, empfohlen) - "App-Geheimcode" aus der
 *                        Meta-App (Einstellungen -> Grundlegendes). Wenn
 *                        gesetzt, prüft der Worker die Signatur jeder
 *                        Anfrage (X-Hub-Signature-256) und lehnt gefälschte
 *                        Anfragen ab. Ohne dieses Secret läuft der Worker
 *                        trotzdem, aber JEDER könnte vorgetäuschte
 *                        WhatsApp-Nachrichten einschicken (Kosten-/
 *                        Missbrauchsrisiko) - siehe Sicherheitshinweis in
 *                        der README.
 *   MODEL_ID             (Variable, optional) - Standard: claude-haiku-4-5
 *   CALENDLY_API_TOKEN   (Secret, optional) - "Personal Access Token" aus
 *                        Calendly (calendly.com -> Konto-Einstellungen ->
 *                        Integrations -> API and Webhooks -> "Get a token
 *                        now"). Ohne dieses Secret schlägt das Terminvorschlag-
 *                        Tool nicht fehl, sondern nennt dem Kunden direkt nur
 *                        den Buchungslink (CALENDLY_SCHEDULING_URL) ohne
 *                        konkrete Uhrzeiten.
 *   CALENDLY_EVENT_TYPE_URI (Variable, optional) - die "uri" des Calendly-
 *                        Termin-Typs, für den Zeiten vorgeschlagen werden
 *                        sollen. Standard: der Termin-Typ "30 Minute Meeting"
 *                        des Kontos calendly.com/neuverdrahtet.
 *   CALENDLY_SCHEDULING_URL (Variable, optional) - der öffentliche Buchungs-
 *                        link, den der Assistent dem Kunden zum finalen
 *                        Bestätigen schickt. Standard: calendly.com/neuverdrahtet/30min.
 *                        WICHTIG: Calendly kann Termine über die API nicht
 *                        automatisch fest buchen - der Assistent kann nur
 *                        freie Uhrzeiten VORSCHLAGEN, der Kunde muss den
 *                        Termin am Ende immer selbst über diesen Link
 *                        bestätigen.
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

const CALENDLY_STANDARD_EVENT_TYPE_URI = 'https://api.calendly.com/event_types/6f6a26b4-6f92-40b9-a784-1cd549c8b094';
const CALENDLY_STANDARD_SCHEDULING_URL = 'https://calendly.com/neuverdrahtet/30min';

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

/** Fragt bei Calendly freie Zeiten für den konfigurierten Termin-Typ ab (max. 6-Tage-Fenster, siehe Calendly-API-Doku). */
async function getCalendlyAvailableTimes({ apiToken, eventTypeUri, startTime, endTime }) {
  const url = `https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Calendly-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.collection || [];
}

/**
 * Liefert dem Assistenten ein paar echte freie Uhrzeiten plus den Buchungslink.
 * Bucht NICHTS fest - Calendly erlaubt Endkunden-Buchungen über die API auf
 * Standard-/Professional-Plänen nicht, der Kunde muss immer selbst über den
 * Link final bestätigen.
 */
async function termineVorschlagen({ env }) {
  const schedulingUrl = env.CALENDLY_SCHEDULING_URL || CALENDLY_STANDARD_SCHEDULING_URL;
  if (!env.CALENDLY_API_TOKEN) {
    return `Bitte hier direkt einen freien Termin auswählen und bestätigen: ${schedulingUrl}`;
  }

  const eventTypeUri = env.CALENDLY_EVENT_TYPE_URI || CALENDLY_STANDARD_EVENT_TYPE_URI;
  const start = new Date(Date.now() + 60 * 60 * 1000); // Calendly verlangt start_time in der Zukunft
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000); // Calendly erlaubt max. 1 Woche Zeitraum je Abfrage

  const slots = await getCalendlyAvailableTimes({
    apiToken: env.CALENDLY_API_TOKEN,
    eventTypeUri,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  });

  if (!slots.length) {
    return `In den nächsten Tagen sind laut Kalender keine freien Termine mehr frei. Bitte hier weitere Termine ansehen: ${schedulingUrl}`;
  }

  const formatter = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
  const auswahl = slots.slice(0, 5).map((s) => `- ${formatter.format(new Date(s.start_time))} Uhr`);

  return `Diese Termine sind aktuell frei:\n${auswahl.join('\n')}\n\nBitte hier den gewünschten Termin final auswählen und bestätigen: ${schedulingUrl}`;
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
- Wenn der Gesprächspartner einen Beratungstermin/Rückruf-Termin möchte, rufe das Tool "termine_vorschlagen" auf, um echte freie Uhrzeiten aus dem Kalender zu bekommen, und nenne davon ein paar zur Auswahl sowie den mitgelieferten Buchungslink. Der Termin ist erst final gebucht, wenn der Kunde ihn selbst über diesen Link bestätigt hat - sage niemals, ein Termin sei "fest gebucht" oder "eingetragen", bevor das geschehen ist.
- Erfinde keine Fakten, Preise, Verfügbarkeiten oder Termine - Uhrzeiten kommen ausschließlich aus dem Tool "termine_vorschlagen", niemals frei erfunden.
- Du bist ausschließlich für neuverdrahtet-Themen da.`;
}

const TERMIN_TOOL = {
  name: 'termine_vorschlagen',
  description: 'Ruft echte freie Termin-Slots aus dem Kalender ab und liefert eine Auswahl an Uhrzeiten plus den Buchungslink. Bucht NICHTS automatisch fest - der Kunde muss den Termin am Ende selbst über den Link bestätigen. Nur aufrufen, wenn der Gesprächspartner erkennbar einen Termin/Beratungsgespräch möchte.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

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
        tools: [LEAD_TOOL, TERMIN_TOOL],
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
      } else if (toolUse.name === 'termine_vorschlagen') {
        try {
          const antwortText = await termineVorschlagen({ env });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: antwortText });
        } catch (err) {
          const schedulingUrl = env.CALENDLY_SCHEDULING_URL || CALENDLY_STANDARD_SCHEDULING_URL;
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Kalender-Abruf fehlgeschlagen: ${err.message}. Nenne dem Gesprächspartner stattdessen nur den Buchungslink ${schedulingUrl}.`, is_error: true });
        }
      }
    }
    conversation = [...conversation, { role: 'user', content: toolResults }];
  }

  return 'Entschuldigung, das dauert gerade zu lange. Bitte rufen Sie uns direkt an: 01706398575.';
}

// --- Meta-Webhook-Signaturprüfung (siehe developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads) ---

async function validateMetaSignature({ appSecret, rawBody, signature }) {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const erwarteterHex = signature.slice('sha256='.length);

  const keyData = new TextEncoder().encode(appSecret);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(rawBody));
  const macHex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return macHex === erwarteterHex;
}

/** Extrahiert die eingehende Text-Nachricht aus einem Meta-Webhook-Payload, oder null bei anderen Ereignissen (Status-Updates etc.). */
function extrahiereEingehendeNachricht(payload) {
  try {
    const value = payload.entry?.[0]?.changes?.[0]?.value;
    const nachricht = value?.messages?.[0];
    if (!nachricht || nachricht.type !== 'text') return null;
    return {
      von: nachricht.from, // Ziffernfolge ohne "+", z.B. "4915888620339"
      text: (nachricht.text?.body || '').trim(),
      profilName: value.contacts?.[0]?.profile?.name || '',
    };
  } catch {
    return null;
  }
}

/** Sendet eine Textantwort über die WhatsApp Cloud API (Graph API) an die angegebene Nummer. */
async function sendeWhatsAppNachricht({ env, an, text }) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${env.META_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: an, type: 'text', text: { body: text } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`WhatsApp-Senden fehlgeschlagen (${res.status}): ${t.slice(0, 300)}`);
  }
}

/** Verarbeitet eine eingehende Nachricht komplett (Verlauf laden, Claude fragen, Verlauf speichern, Antwort senden). Läuft asynchron über ctx.waitUntil, damit der Webhook selbst sofort mit 200 antworten kann. */
async function verarbeiteEingehendeNachricht({ env, von, text, profilName }) {
  const telefonAnzeige = `+${von}`;
  const chatId = von.replace(/[^a-zA-Z0-9+]/g, '_');

  try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

    const bestehend = await firestoreGetDoc({ accessToken, projectId: serviceAccount.project_id, collection: 'whatsapp_chats', id: chatId });
    const verlauf = (bestehend && Array.isArray(bestehend.verlauf)) ? bestehend.verlauf : [];

    const conversation = [...verlauf, { role: 'user', content: text }];
    let antwort = await chatMitClaude({ env, messages: conversation, telefon: telefonAnzeige });
    if (antwort.length > MAX_ANTWORT_LAENGE) antwort = antwort.slice(0, MAX_ANTWORT_LAENGE - 1) + '…';

    const neuerVerlauf = [...conversation, { role: 'assistant', content: antwort }].slice(-MAX_VERLAUF_LAENGE);
    await firestoreWriteDoc({
      accessToken, projectId: serviceAccount.project_id, collection: 'whatsapp_chats', id: chatId,
      data: { verlauf: neuerVerlauf, telefon: telefonAnzeige, profilName: profilName || '', updatedAt: new Date().toISOString() },
    });

    await sendeWhatsAppNachricht({ env, an: von, text: antwort });
  } catch (err) {
    // Genaue Fehlerursache landet im Worker-Log (npx wrangler tail), nicht in der
    // Kunden-Antwort - dort nur ein freundlicher, generischer Hinweis.
    console.error('ki-assistent-whatsapp Fehler:', err);
    try {
      await sendeWhatsAppNachricht({ env, an: von, text: 'Es ist ein technisches Problem aufgetreten. Bitte rufen Sie uns direkt an: 01706398575.' });
    } catch (sendeErr) {
      console.error('ki-assistent-whatsapp Fehler beim Senden der Fehlermeldung:', sendeErr);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Einmalige Webhook-Verifizierung durch Meta beim Einrichten (GET mit hub.challenge).
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && env.META_VERIFY_TOKEN && token === env.META_VERIFY_TOKEN) {
        return new Response(challenge || '', { status: 200 });
      }
      return new Response('Verifizierung fehlgeschlagen.', { status: 403 });
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const rawBody = await request.text();

    if (env.META_APP_SECRET) {
      const signature = request.headers.get('X-Hub-Signature-256');
      const gueltig = await validateMetaSignature({ appSecret: env.META_APP_SECRET, rawBody, signature });
      if (!gueltig) return new Response('Ungültige Signatur.', { status: 403 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('OK', { status: 200 });
    }

    const eingehend = extrahiereEingehendeNachricht(payload);
    // Kein Text-Nachrichten-Ereignis (z.B. Zustellstatus "delivered"/"read") - trotzdem
    // mit 200 bestätigen, sonst wiederholt Meta den Webhook-Aufruf unnötig.
    if (!eingehend || !eingehend.text) return new Response('OK', { status: 200 });

    if (!env.ANTHROPIC_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT_JSON || !env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID) {
      console.error('ki-assistent-whatsapp: erforderliche Secrets/Variablen fehlen.');
      return new Response('OK', { status: 200 });
    }

    // Sofort mit 200 antworten (Meta erwartet eine schnelle Bestätigung), die eigentliche
    // Verarbeitung (Claude-Aufruf, Firestore, Antwort senden) läuft im Hintergrund weiter.
    ctx.waitUntil(verarbeiteEingehendeNachricht({ env, ...eingehend }));
    return new Response('OK', { status: 200 });
  },
};
