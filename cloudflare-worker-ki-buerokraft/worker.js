/**
 * neuverdrahtet Werkora – API für die KI-Bürokraft (Cloudflare Worker)
 *
 * Setzt die vom Nutzer vorgegebene "Technische Vorgabe: Werkora-API für
 * KI-Bürokraft" um - Phase 1 (Grundschnittstelle) plus die dort explizit
 * genannte Prioritätenliste für die "erste funktionsfähige Version"
 * (Abschnitt 39 der Vorgabe):
 *   1. Kunde suchen              -> GET /customers
 *   2. Kunde anlegen             -> POST /customers
 *   3. Lead anlegen              -> POST /leads
 *   4. Lead aktualisieren        -> PATCH /leads/{id}
 *   5. Projekte abrufen          -> GET /projects, GET /projects/{id}
 *   6. Aufgabe erstellen         -> POST /tasks
 *   7. Aufgaben abrufen          -> GET /tasks, GET /tasks/{id}
 *   8. Termine abrufen+erstellen -> GET/POST /appointments
 *   9. Angebote abrufen          -> GET /quotes, GET /quotes/{id}
 *  10. Angebotsentwurf erstellen -> POST /quotes (immer status "draft")
 *  11. Rechnungen abrufen        -> GET /invoices, GET /invoices/{id}
 *  12. offene Rechnungen erkennen-> GET /invoices?status=overdue
 *  13. Dashboard-Daten abrufen   -> GET /assistant/dashboard
 *  14. KI-Aktionen protokollieren-> jeder Aufruf schreibt einen Eintrag in
 *                                   die Firestore-Collection ai_action_log
 *
 * Zusätzlich (weil in der Vorgabe als "erlaubt" gelistet, aber nicht in der
 * 14er-Liste): PATCH /customers/{id}, GET/PATCH /leads, PATCH /tasks/{id}
 * (z.B. Status "completed").
 *
 * WICHTIGE ABWEICHUNGEN von der Vorgabe (bewusst, siehe README.md):
 *  - "Leads" sind in Werkora keine eigene Datenbank-Tabelle, sondern Kunden
 *    mit einem Status-Feld (Kanban "Lead-Pipeline", Status u.a. "lead").
 *    Die Lead-Endpunkte sind daher ein dünner Filter über /customers, nicht
 *    eine eigene Entität. Die von der Vorgabe vorgeschlagenen Lead-Status-
 *    Werte (new/contacted/qualification/...) existieren in Werkora nicht -
 *    gesendete Status-Werte, die keiner echten Werkora-Status-Spalte
 *    entsprechen, werden NICHT verworfen, sondern als Notiz am Kunden
 *    vermerkt (siehe leadStatusHinweis()).
 *  - Rechnungen (POST /invoices) werden von der KI in Phase 1 NICHT
 *    angelegt: Werkora sperrt Rechnungen nach GoBD-Vorgaben sofort nach dem
 *    Anlegen (fortlaufende Tagesnummer, Storno-Pflicht statt Löschen) - ein
 *    KI-Entwurf, der versehentlich eine echte Nummer verbraucht, wäre
 *    steuerlich unsauber. Angebote (POST /quotes) sind unkritisch (Status
 *    "entwurf", jederzeit änderbar) und daher erlaubt.
 *  - "Aufträge" (orders), Arbeitsberichte, Dokumentation, Zahlungen,
 *    Mahnungen, Artikel/Leistungen, Mitarbeiter, Webhooks, MCP-Server sowie
 *    das Freigabe-Center in der Werkora-Oberfläche selbst sind NICHT Teil
 *    dieses ersten Schritts (Phase 2-4 der Vorgabe) - siehe README.md für
 *    den weiteren Ausbau.
 *  - Sensible Aktionen werden nicht über ein Rollen-UI gesteuert, sondern
 *    fest im Code gesperrt (403 APPROVAL_REQUIRED): Versand/Freigabe von
 *    Angeboten/Rechnungen, jedes Löschen, Auftrags-Umwandlung. Jeder
 *    Versuch wird trotzdem protokolliert (status: "blocked").
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   API_KEY                       (Secret, erforderlich) - langer, zufälliger
 *                        Schlüssel, den die KI als "Authorization: Bearer
 *                        <Schlüssel>" mitschickt. Jederzeit hier neu
 *                        generierbar, macht den alten sofort ungültig.
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, erforderlich) - wie bei den
 *                        anderen Werkora-Workern (kompletter Inhalt einer
 *                        Firebase-Service-Account-JSON-Datei).
 *
 * Antwortformat exakt wie in der Vorgabe (Abschnitt 3):
 *   Erfolg: { "success": true,  "data": {...}, "message": null }
 *   Fehler: { "success": false, "error": { "code": "...", "message": "..." } }
 */

const KUNDEN_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];
const AUFGABEN_STATUS_GESCHLOSSEN = ['erledigt'];
const KUNDEN_STATUS_GESCHLOSSEN = ['verloren', 'kunde'];
const RECHNUNG_OFFEN_STATUS = ['offen', 'teilbezahlt'];

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

function okResponse(data, status = 200) {
  return jsonResponse({ success: true, data, message: null }, status);
}

function errorResponse(code, message, status = 400, details) {
  return jsonResponse({ success: false, error: { code, message, ...(details ? { details } : {}) } }, status);
}

// --- Kleine reine Helfer (1:1 aus verwaltung/js/utils.js portiert) ---

function farbeAusText(text, palette) {
  let hash = 0;
  const str = text || '';
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function calcTotals(positionen) {
  let netto = 0;
  let steuer = 0;
  for (const pos of positionen || []) {
    const menge = Number(pos.menge) || 0;
    const preis = Number(pos.einzelpreis) || 0;
    const n = menge * preis;
    netto += n;
    steuer += n * ((Number(pos.steuersatz) || 0) / 100);
  }
  return { netto, steuer, brutto: netto + steuer };
}

function nextDailyNummer(prefix, state = {}) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const heute = `${yyyy}-${mm}-${dd}`;
  const zaehler = state.datum === heute ? (Number(state.zaehler) || 0) + 1 : 1;
  const nummer = `${prefix || ''}${yyyy}${dd}${mm}${String(zaehler).padStart(2, '0')}`;
  return { nummer, datum: heute, zaehler };
}

// --- Google-Service-Account-JWT-Flow (1:1 aus cloudflare-worker-kostenschaetzer/worker.js) ---

function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemPrivateKeyToBinary(pem) {
  const base64 = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: serviceAccount.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const cryptoKey = await crypto.subtle.importKey('pkcs8', pemPrivateKeyToBinary(serviceAccount.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google-OAuth-Fehler (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return (await res.json()).access_token;
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

function docToPlain(doc) {
  const id = (doc.name || '').split('/').pop();
  return { id, ...fromFirestoreFields(doc.fields) };
}

function firestoreBaseUrl(projectId, collection) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
}

async function firestoreList({ accessToken, projectId, collection, pageSize = 300 }) {
  const url = `${firestoreBaseUrl(projectId, collection)}?pageSize=${pageSize}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) beim Auflisten von ${collection}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json();
  return (data.documents || []).map(docToPlain);
}

async function firestoreGet({ accessToken, projectId, collection, id }) {
  const url = `${firestoreBaseUrl(projectId, collection)}/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) bei ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return docToPlain(await res.json());
}

async function firestoreCreate({ accessToken, projectId, collection, id, data }) {
  const url = `${firestoreBaseUrl(projectId, collection)}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) beim Anlegen von ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return docToPlain(await res.json());
}

async function firestoreUpdate({ accessToken, projectId, collection, id, data }) {
  const maskParams = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `${firestoreBaseUrl(projectId, collection)}/${id}?${maskParams}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) beim Aktualisieren von ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return docToPlain(await res.json());
}

async function getSettingValue({ accessToken, projectId, key, fallback }) {
  const doc = await firestoreGet({ accessToken, projectId, collection: 'einstellungen', id: key });
  return doc && doc.value !== undefined ? doc.value : fallback;
}

async function setSettingValue({ accessToken, projectId, key, value }) {
  await firestoreCreate({ accessToken, projectId, collection: 'einstellungen', id: key, data: { key, value } });
}

// --- KI-Aktionsprotokoll (Vorgabe Abschnitt 29) ---

async function logAction(ctx, { action, entityType, entityId, oldValue, newValue, status, approvalRequired }) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ai_user: 'ki-buerokraft',
    action,
    entity_type: entityType || '',
    entity_id: entityId || '',
    old_value: oldValue ? JSON.stringify(oldValue) : '',
    new_value: newValue ? JSON.stringify(newValue) : '',
    status,
    approval_required: !!approvalRequired,
    approved_by: '',
    ip_address: ctx.ip || '',
  };
  try {
    await firestoreCreate({ accessToken: ctx.accessToken, projectId: ctx.projectId, collection: 'ai_action_log', id: entry.id, data: entry });
  } catch {
    // Protokollierung darf einen echten Aufruf nicht zum Absturz bringen -
    // best effort, wie bei den anderen "Komfort"-Nebenwirkungen im Repo.
  }
}

/** Antwortet mit 403 APPROVAL_REQUIRED und protokolliert den Versuch (Vorgabe Abschnitt 5+30+31). */
async function blocked(ctx, action, message, entityType, entityId) {
  await logAction(ctx, { action, entityType, entityId, status: 'blocked', approvalRequired: true });
  return errorResponse('APPROVAL_REQUIRED', message, 403);
}

// --- Ressourcen-Mapping: Werkora-Felder <-> API-Felder aus der Vorgabe ---

function customerToApi(k) {
  return {
    id: k.id,
    customer_number: k.kundennummer || '',
    type: k.istPrivatperson ? 'private' : 'company',
    company: k.istPrivatperson ? '' : (k.firma || ''),
    name: k.firma || '',
    contact_name: k.ansprechpartner || '',
    email: k.email || '',
    phone: k.telefon || '',
    street: k.strasse || '',
    postal_code: k.plz || '',
    city: k.ort || '',
    notes: k.notizen || '',
    status: k.status || '',
    created_at: k.createdAt || '',
    updated_at: k.updatedAt || '',
  };
}

function apiToCustomer(body, existing) {
  const out = { ...(existing || {}) };
  if (body.company !== undefined || body.name !== undefined) out.firma = body.company || body.name || out.firma || '';
  if (body.contact_name !== undefined) out.ansprechpartner = body.contact_name;
  if (body.phone !== undefined) out.telefon = body.phone;
  if (body.email !== undefined) out.email = body.email;
  if (body.street !== undefined) out.strasse = body.street;
  if (body.postal_code !== undefined) out.plz = body.postal_code;
  if (body.city !== undefined) out.ort = body.city;
  if (body.notes !== undefined) out.notizen = body.notes;
  if (body.customer_number !== undefined) out.kundennummer = body.customer_number;
  if (body.type !== undefined) out.istPrivatperson = body.type === 'private';
  return out;
}

function taskToApi(a) {
  return {
    id: a.id,
    title: a.titel || '',
    description: a.beschreibung || '',
    priority: a.prioritaet || 'normal',
    status: a.status || 'offen',
    due_date: a.faelligAm || '',
    customer_id: a.kundeId || '',
    project_id: a.projektId || '',
    assigned_to: a.zugewiesenAn || '',
    created_at: a.createdAt || '',
    completed_at: a.erledigtAm || '',
  };
}

function appointmentToApi(t) {
  return {
    id: t.id,
    title: t.titel || '',
    customer_id: t.kundeId || '',
    project_id: t.projektId || '',
    start: t.start || '',
    end: t.ende || '',
    address: t.ort || '',
    assigned_employee_ids: t.mitarbeiterIds || [],
    notes: t.notizen || '',
  };
}

function projectToApi(p) {
  return {
    id: p.id,
    customer_id: p.kundeId || '',
    title: p.titel || '',
    description: p.beschreibung || '',
    status: p.status || '',
    bereich: p.bereich || '',
    start_date: p.startDatum || '',
    planned_end_date: p.endDatum || '',
  };
}

function quoteToApi(q) {
  return {
    id: q.id,
    number: q.nummer || '',
    customer_id: q.kundeId || '',
    project_id: q.projektId || '',
    title: q.betreff || '',
    status: q.status === 'entwurf' ? 'draft' : q.status === 'versendet' ? 'sent' : q.status === 'angenommen' ? 'accepted' : q.status === 'abgelehnt' ? 'rejected' : (q.status || ''),
    date: q.datum || '',
    items: (q.positionen || []).map((p, i) => ({
      position: i + 1, article_id: p.katalogId || '', title: p.bezeichnung || '', description: p.beschreibung || '',
      quantity: p.menge || 0, unit: p.einheit || '', unit_price_net: p.einzelpreis || 0, vat_rate: p.steuersatz || 0,
    })),
    net_total: q.netto || 0,
    vat_total: q.steuer || 0,
    gross_total: q.brutto || 0,
  };
}

function invoiceToApi(r) {
  const overdue = RECHNUNG_OFFEN_STATUS.includes(r.status) && r.faelligAm && r.faelligAm < todayISO();
  return {
    id: r.id,
    number: r.nummer || '',
    customer_id: r.kundeId || '',
    project_id: r.projektId || '',
    quote_id: r.angebotId || '',
    status: overdue ? 'overdue' : (r.status === 'bezahlt' ? 'paid' : r.status === 'storniert' ? 'cancelled' : r.status || ''),
    date: r.datum || '',
    due_date: r.faelligAm || '',
    net_total: r.netto || 0,
    vat_total: r.steuer || 0,
    gross_total: r.brutto || 0,
    paid_at: r.bezahltAm || '',
  };
}

/** Prüft, ob ein von der KI gesendeter Lead-/Kunden-Status einer echten Werkora-Status-Spalte entspricht. */
function leadStatusHinweis(sentStatus, kundenStatusSpalten) {
  if (!sentStatus) return null;
  const bekannt = kundenStatusSpalten.some((s) => s.id === sentStatus);
  if (bekannt) return null;
  return `Hinweis: Status "${sentStatus}" existiert nicht als Werkora-Status-Spalte (vorhanden: ${kundenStatusSpalten.map((s) => s.id).join(', ')}). Wurde als Notiz vermerkt, der Kunden-Status wurde NICHT geändert.`;
}

// Zusätzliche benannte Exporte rein für lokale Unit-Tests (reine Funktionen, kein Netzwerk).
export {
  toFirestoreValue, toFirestoreFields, fromFirestoreValue, fromFirestoreFields, docToPlain,
  customerToApi, apiToCustomer, taskToApi, appointmentToApi, projectToApi, quoteToApi, invoiceToApi,
  nextDailyNummer, calcTotals, leadStatusHinweis,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return jsonResponse(null, 204);

    if (!env.API_KEY) return errorResponse('SERVER_MISCONFIGURED', 'Worker ist nicht korrekt eingerichtet (API_KEY fehlt).', 500);
    const authHeader = request.headers.get('Authorization') || '';
    const gesendeterSchluessel = authHeader.replace(/^Bearer\s+/i, '');
    if (gesendeterSchluessel !== env.API_KEY) {
      return errorResponse('UNAUTHORIZED', 'Ungültiger oder fehlender API-Schlüssel (Authorization: Bearer <Schlüssel>).', 401);
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return errorResponse('SERVER_MISCONFIGURED', 'Worker ist nicht korrekt eingerichtet (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).', 500);

    const url = new URL(request.url);
    const teile = url.pathname.split('/').filter(Boolean);
    const q = url.searchParams;

    let ctx;
    try {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
      ctx = { accessToken, projectId: serviceAccount.project_id, ip: request.headers.get('CF-Connecting-IP') || '' };
    } catch (err) {
      return errorResponse('SERVER_ERROR', err.message || 'Unbekannter Fehler bei der Firebase-Authentifizierung.', 500);
    }
    const { accessToken, projectId } = ctx;

    if (request.method === 'DELETE') {
      return blocked(ctx, `${teile[0] || 'unknown'}.delete`, 'Löschen ist über diese API grundsätzlich nicht erlaubt (siehe Sicherheitsregeln in der Vorgabe, Abschnitt 31).', teile[0], teile[1]);
    }

    try {
      // --- Dashboard (Vorgabe Abschnitt 28) ---
      if (teile[0] === 'assistant' && teile[1] === 'dashboard' && request.method === 'GET') {
        const [kunden, aufgaben, termine, angebote, rechnungen] = await Promise.all([
          firestoreList({ accessToken, projectId, collection: 'kunden' }),
          firestoreList({ accessToken, projectId, collection: 'aufgaben' }),
          firestoreList({ accessToken, projectId, collection: 'termine' }),
          firestoreList({ accessToken, projectId, collection: 'angebote' }),
          firestoreList({ accessToken, projectId, collection: 'rechnungen' }),
        ]);
        const heute = todayISO();
        const offeneAufgaben = aufgaben.filter((a) => !AUFGABEN_STATUS_GESCHLOSSEN.includes(a.status));
        const offeneAngebote = angebote.filter((a) => a.status === 'versendet' || a.status === 'entwurf');
        const offeneRechnungen = rechnungen.filter((r) => RECHNUNG_OFFEN_STATUS.includes(r.status));
        const dashboard = {
          new_leads: kunden.filter((k) => (k.status || '') === 'lead').length,
          open_tasks: offeneAufgaben.length,
          overdue_tasks: offeneAufgaben.filter((a) => a.faelligAm && a.faelligAm < heute).length,
          appointments_today: termine.filter((t) => (t.start || '').slice(0, 10) === heute).length,
          quotes_open: offeneAngebote.length,
          quotes_total_value: Math.round(offeneAngebote.reduce((s, a) => s + (a.brutto || 0), 0) * 100) / 100,
          invoices_open: offeneRechnungen.length,
          invoices_open_value: Math.round(offeneRechnungen.reduce((s, r) => s + (r.brutto || 0), 0) * 100) / 100,
          invoices_overdue: offeneRechnungen.filter((r) => r.faelligAm && r.faelligAm < heute).length,
          projects_missing_documents: 0, // Pflichtdokumente-Prüfung (Vorgabe Abschnitt 20) ist noch nicht gebaut (Phase 3)
        };
        await logAction(ctx, { action: 'assistant.dashboard', status: 'success' });
        return okResponse(dashboard);
      }

      // --- Kunden (Vorgabe Abschnitt 6) ---
      if (teile[0] === 'customers') {
        if (request.method === 'GET' && !teile[1]) {
          let kunden = await firestoreList({ accessToken, projectId, collection: 'kunden' });
          const email = q.get('email'); const phone = q.get('phone'); const name = q.get('name');
          const plz = q.get('postal_code'); const city = q.get('city');
          if (email) kunden = kunden.filter((k) => (k.email || '').toLowerCase().includes(email.toLowerCase()));
          if (phone) kunden = kunden.filter((k) => (k.telefon || '').replace(/\s+/g, '').includes(phone.replace(/\s+/g, '')));
          if (name) kunden = kunden.filter((k) => (k.firma || '').toLowerCase().includes(name.toLowerCase()) || (k.ansprechpartner || '').toLowerCase().includes(name.toLowerCase()));
          if (plz) kunden = kunden.filter((k) => (k.plz || '') === plz);
          if (city) kunden = kunden.filter((k) => (k.ort || '').toLowerCase().includes(city.toLowerCase()));
          await logAction(ctx, { action: 'customers.search', status: 'success' });
          return okResponse(kunden.map(customerToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const k = await firestoreGet({ accessToken, projectId, collection: 'kunden', id: teile[1] });
          if (!k) return errorResponse('CUSTOMER_NOT_FOUND', 'Kunde wurde nicht gefunden.', 404);
          return okResponse(customerToApi(k));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.company && !body.name) return errorResponse('VALIDATION_ERROR', 'Feld "company" oder "name" ist erforderlich.', 400);
          if (body.email || body.phone) {
            const alle = await firestoreList({ accessToken, projectId, collection: 'kunden' });
            const treffer = alle.find((k) => (body.email && k.email && k.email.toLowerCase() === body.email.toLowerCase()) || (body.phone && k.telefon && k.telefon.replace(/\s+/g, '') === body.phone.replace(/\s+/g, '')));
            if (treffer) return errorResponse('CUSTOMER_ALREADY_EXISTS', 'Ein Kunde mit dieser E-Mail/Telefonnummer existiert bereits.', 409, { customer: customerToApi(treffer) });
          }
          const id = crypto.randomUUID();
          const data = apiToCustomer(body, {});
          data.id = id;
          data.status = data.status || 'lead';
          data.farbe = farbeAusText(id, KUNDEN_FARBEN);
          data.createdAt = new Date().toISOString();
          const created = await firestoreCreate({ accessToken, projectId, collection: 'kunden', id, data });
          await logAction(ctx, { action: 'customers.create', entityType: 'kunden', entityId: id, newValue: data, status: 'success' });
          return okResponse(customerToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'kunden', id: teile[1] });
          if (!existing) return errorResponse('CUSTOMER_NOT_FOUND', 'Kunde wurde nicht gefunden.', 404);
          const changes = apiToCustomer(body, {});
          delete changes.id;
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'kunden', id: teile[1], data: changes });
          await logAction(ctx, { action: 'customers.update', entityType: 'kunden', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(customerToApi(updated));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Leads (Vorgabe Abschnitt 7+8 - in Werkora: Kunden mit Status, siehe Kopf-Kommentar) ---
      if (teile[0] === 'leads') {
        if (request.method === 'GET' && !teile[1]) {
          let kunden = await firestoreList({ accessToken, projectId, collection: 'kunden' });
          const status = q.get('status');
          kunden = kunden.filter((k) => status ? (k.status || '') === status : (k.status || '') === 'lead');
          await logAction(ctx, { action: 'leads.search', status: 'success' });
          return okResponse(kunden.map(customerToApi));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const kundenStatusSpalten = await firestoreList({ accessToken, projectId, collection: 'kundenStatus' });
          let kunde;
          if (body.customer_id) {
            kunde = await firestoreGet({ accessToken, projectId, collection: 'kunden', id: body.customer_id });
            if (!kunde) return errorResponse('CUSTOMER_NOT_FOUND', 'customer_id verweist auf keinen vorhandenen Kunden.', 404);
          }
          const leadInfoZeilen = [
            body.title ? `Lead: ${body.title}` : null,
            body.description || null,
            body.trade ? `Gewerk: ${body.trade}` : null,
            body.source ? `Quelle: ${body.source}` : null,
            body.priority ? `Priorität: ${body.priority}` : null,
            body.estimated_value ? `Geschätzter Wert: ${body.estimated_value} €` : null,
            body.next_action ? `Nächster Schritt: ${body.next_action}${body.next_action_date ? ' (' + body.next_action_date + ')' : ''}` : null,
          ].filter(Boolean).join('\n');
          const gewuenschterStatus = body.status && kundenStatusSpalten.some((s) => s.id === body.status) ? body.status : 'lead';
          const hinweis = leadStatusHinweis(body.status, kundenStatusSpalten);
          const notizZusatz = [leadInfoZeilen, hinweis].filter(Boolean).join('\n');
          if (kunde) {
            const changes = { status: gewuenschterStatus, notizen: [kunde.notizen, notizZusatz].filter(Boolean).join('\n\n') };
            const updated = await firestoreUpdate({ accessToken, projectId, collection: 'kunden', id: kunde.id, data: changes });
            await logAction(ctx, { action: 'leads.create', entityType: 'kunden', entityId: kunde.id, newValue: changes, status: 'success' });
            return okResponse({ ...customerToApi(updated), lead_note: hinweis || undefined }, 201);
          }
          if (!body.title && !leadInfoZeilen) return errorResponse('VALIDATION_ERROR', 'Ohne customer_id wird mindestens "title" benötigt, um einen neuen Kunden für den Lead anzulegen.', 400);
          const id = crypto.randomUUID();
          const data = {
            id, firma: body.title || 'Neuer Lead', ansprechpartner: '', telefon: '', email: '',
            status: gewuenschterStatus, notizen: notizZusatz, farbe: farbeAusText(id, KUNDEN_FARBEN), createdAt: new Date().toISOString(),
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'kunden', id, data });
          await logAction(ctx, { action: 'leads.create', entityType: 'kunden', entityId: id, newValue: data, status: 'success' });
          return okResponse({ ...customerToApi(created), lead_note: hinweis || undefined }, 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'kunden', id: teile[1] });
          if (!existing) return errorResponse('LEAD_NOT_FOUND', 'Lead (Kunde) wurde nicht gefunden.', 404);
          const kundenStatusSpalten = await firestoreList({ accessToken, projectId, collection: 'kundenStatus' });
          const hinweis = leadStatusHinweis(body.status, kundenStatusSpalten);
          const changes = {};
          if (body.status && !hinweis) changes.status = body.status;
          const notizZeilen = [body.next_action ? `Nächster Schritt: ${body.next_action}${body.next_action_date ? ' (' + body.next_action_date + ')' : ''}` : null, body.notes || null, hinweis].filter(Boolean).join('\n');
          if (notizZeilen) changes.notizen = [existing.notizen, notizZeilen].filter(Boolean).join('\n\n');
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'kunden', id: teile[1], data: changes });
          await logAction(ctx, { action: 'leads.update', entityType: 'kunden', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse({ ...customerToApi(updated), lead_note: hinweis || undefined });
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Projekte (Vorgabe Abschnitt 9 - nur Lesen in Phase 1) ---
      if (teile[0] === 'projects') {
        if (request.method === 'GET' && !teile[1]) {
          let projekte = await firestoreList({ accessToken, projectId, collection: 'projekte' });
          const customerId = q.get('customer_id'); const status = q.get('status');
          if (customerId) projekte = projekte.filter((p) => p.kundeId === customerId);
          if (status) projekte = projekte.filter((p) => p.status === status);
          await logAction(ctx, { action: 'projects.search', status: 'success' });
          return okResponse(projekte.map(projectToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const p = await firestoreGet({ accessToken, projectId, collection: 'projekte', id: teile[1] });
          if (!p) return errorResponse('PROJECT_NOT_FOUND', 'Projekt wurde nicht gefunden.', 404);
          return okResponse(projectToApi(p));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Anlegen/Ändern von Projekten ist über diese API noch nicht freigeschaltet (Phase 2).', 405);
      }

      // --- Aufgaben (Vorgabe Abschnitt 10) ---
      if (teile[0] === 'tasks') {
        if (request.method === 'GET' && !teile[1]) {
          let aufgaben = await firestoreList({ accessToken, projectId, collection: 'aufgaben' });
          const status = q.get('status'); const priority = q.get('priority'); const dueDate = q.get('due_date');
          const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id'); const assignedTo = q.get('assigned_to');
          if (status) aufgaben = aufgaben.filter((a) => a.status === status);
          if (priority) aufgaben = aufgaben.filter((a) => a.prioritaet === priority);
          if (dueDate) aufgaben = aufgaben.filter((a) => a.faelligAm === dueDate);
          if (customerId) aufgaben = aufgaben.filter((a) => a.kundeId === customerId);
          if (projectIdFilter) aufgaben = aufgaben.filter((a) => a.projektId === projectIdFilter);
          if (assignedTo) aufgaben = aufgaben.filter((a) => a.zugewiesenAn === assignedTo);
          await logAction(ctx, { action: 'tasks.search', status: 'success' });
          return okResponse(aufgaben.map(taskToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const a = await firestoreGet({ accessToken, projectId, collection: 'aufgaben', id: teile[1] });
          if (!a) return errorResponse('TASK_NOT_FOUND', 'Aufgabe wurde nicht gefunden.', 404);
          return okResponse(taskToApi(a));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.title) return errorResponse('VALIDATION_ERROR', 'Feld "title" ist erforderlich.', 400);
          const id = crypto.randomUUID();
          const data = {
            id, titel: body.title, beschreibung: body.description || '', prioritaet: body.priority || 'normal',
            status: 'offen', faelligAm: body.due_date || '', kundeId: body.customer_id || '', projektId: body.project_id || '',
            zugewiesenAn: body.assigned_to || '', createdAt: new Date().toISOString(), erledigtAm: '',
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'aufgaben', id, data });
          await logAction(ctx, { action: 'tasks.create', entityType: 'aufgaben', entityId: id, newValue: data, status: 'success' });
          return okResponse(taskToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'aufgaben', id: teile[1] });
          if (!existing) return errorResponse('TASK_NOT_FOUND', 'Aufgabe wurde nicht gefunden.', 404);
          const changes = {};
          if (body.status === 'completed') { changes.status = 'erledigt'; changes.erledigtAm = todayISO(); }
          else if (body.status) changes.status = body.status;
          if (body.title !== undefined) changes.titel = body.title;
          if (body.description !== undefined) changes.beschreibung = body.description;
          if (body.priority !== undefined) changes.prioritaet = body.priority;
          if (body.due_date !== undefined) changes.faelligAm = body.due_date;
          if (body.assigned_to !== undefined) changes.zugewiesenAn = body.assigned_to;
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'aufgaben', id: teile[1], data: changes });
          await logAction(ctx, { action: 'tasks.update', entityType: 'aufgaben', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(taskToApi(updated));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Termine (Vorgabe Abschnitt 11) ---
      if (teile[0] === 'appointments') {
        if (request.method === 'GET' && !teile[1]) {
          let termine = await firestoreList({ accessToken, projectId, collection: 'termine' });
          const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id');
          const dateFrom = q.get('date_from'); const dateTo = q.get('date_to');
          if (customerId) termine = termine.filter((t) => t.kundeId === customerId);
          if (projectIdFilter) termine = termine.filter((t) => t.projektId === projectIdFilter);
          if (dateFrom) termine = termine.filter((t) => (t.start || '') >= dateFrom);
          if (dateTo) termine = termine.filter((t) => (t.start || '') <= dateTo);
          await logAction(ctx, { action: 'appointments.search', status: 'success' });
          return okResponse(termine.map(appointmentToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const t = await firestoreGet({ accessToken, projectId, collection: 'termine', id: teile[1] });
          if (!t) return errorResponse('APPOINTMENT_NOT_FOUND', 'Termin wurde nicht gefunden.', 404);
          return okResponse(appointmentToApi(t));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.title || !body.start) return errorResponse('VALIDATION_ERROR', 'Felder "title" und "start" sind erforderlich.', 400);
          const id = crypto.randomUUID();
          const data = {
            id, titel: body.title, typ: 'termin', kundeId: body.customer_id || '', projektId: body.project_id || '',
            start: body.start, ende: body.end || '', ort: body.address || '',
            mitarbeiterIds: Array.isArray(body.assigned_employee_ids) ? body.assigned_employee_ids : [], notizen: body.notes || '',
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'termine', id, data });
          await logAction(ctx, { action: 'appointments.create', entityType: 'termine', entityId: id, newValue: data, status: 'success' });
          return okResponse(appointmentToApi(created), 201);
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Angebote / Quotes (Vorgabe Abschnitt 13-16) ---
      if (teile[0] === 'quotes') {
        if (teile[2] === 'send') return blocked(ctx, 'quotes.send', 'Angebotsversand erfordert eine Freigabe durch Danny (noch nicht automatisiert).', 'angebote', teile[1]);
        if (teile[2] === 'approve') return blocked(ctx, 'quotes.approve', 'Angebotsfreigabe erfordert eine Freigabe durch Danny (noch nicht automatisiert).', 'angebote', teile[1]);
        if (teile[2] === 'convert-to-order') return blocked(ctx, 'quotes.convert-to-order', 'Auftrags-Umwandlung ist in dieser API-Version noch nicht freigeschaltet (Phase 2).', 'angebote', teile[1]);
        if (request.method === 'GET' && !teile[1]) {
          let angebote = await firestoreList({ accessToken, projectId, collection: 'angebote' });
          const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id'); const status = q.get('status');
          const dateFrom = q.get('date_from'); const dateTo = q.get('date_to');
          if (customerId) angebote = angebote.filter((a) => a.kundeId === customerId);
          if (projectIdFilter) angebote = angebote.filter((a) => a.projektId === projectIdFilter);
          if (status) angebote = angebote.filter((a) => quoteToApi(a).status === status);
          if (dateFrom) angebote = angebote.filter((a) => (a.datum || '') >= dateFrom);
          if (dateTo) angebote = angebote.filter((a) => (a.datum || '') <= dateTo);
          await logAction(ctx, { action: 'quotes.search', status: 'success' });
          return okResponse(angebote.map(quoteToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const a = await firestoreGet({ accessToken, projectId, collection: 'angebote', id: teile[1] });
          if (!a) return errorResponse('QUOTE_NOT_FOUND', 'Angebot wurde nicht gefunden.', 404);
          return okResponse(quoteToApi(a));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.customer_id) return errorResponse('VALIDATION_ERROR', 'Feld "customer_id" ist erforderlich.', 400);
          const kunde = await firestoreGet({ accessToken, projectId, collection: 'kunden', id: body.customer_id });
          if (!kunde) return errorResponse('CUSTOMER_NOT_FOUND', 'customer_id verweist auf keinen vorhandenen Kunden.', 404);
          const positionen = (Array.isArray(body.items) ? body.items : []).map((it) => ({
            id: crypto.randomUUID(), katalogId: it.article_id || '', bezeichnung: it.title || '', beschreibung: it.description || '',
            einheit: it.unit || 'Stk.', menge: Number(it.quantity) || 0, einzelpreis: Number(it.unit_price_net) || 0, steuersatz: it.vat_rate ?? 19,
          }));
          const totals = calcTotals(positionen);
          const [prefix, datum, zaehler] = await Promise.all([
            getSettingValue({ accessToken, projectId, key: 'angebotPrefix', fallback: 'AN-' }),
            getSettingValue({ accessToken, projectId, key: 'angebotNummerDatum', fallback: '' }),
            getSettingValue({ accessToken, projectId, key: 'angebotNummerZaehler', fallback: 0 }),
          ]);
          const { nummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(prefix, { datum, zaehler });
          await Promise.all([
            setSettingValue({ accessToken, projectId, key: 'angebotNummerDatum', value: nDatum }),
            setSettingValue({ accessToken, projectId, key: 'angebotNummerZaehler', value: nZaehler }),
          ]);
          const id = crypto.randomUUID();
          const data = {
            id, nummer, kundeId: body.customer_id, projektId: body.project_id || '', datum: todayISO(),
            status: 'entwurf', betreff: body.title || '', notizen: 'Von der KI-Bürokraft als Entwurf angelegt.', positionen,
            netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto, createdAt: new Date().toISOString(),
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'angebote', id, data });
          await logAction(ctx, { action: 'quotes.create', entityType: 'angebote', entityId: id, newValue: data, status: 'success' });
          return okResponse(quoteToApi(created), 201);
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Rechnungen / Invoices (Vorgabe Abschnitt 21-22 - nur Lesen in Phase 1, siehe Kopf-Kommentar) ---
      if (teile[0] === 'invoices') {
        if (teile[2] === 'send') return blocked(ctx, 'invoices.send', 'Rechnungsversand erfordert eine Freigabe durch Danny (noch nicht automatisiert).', 'rechnungen', teile[1]);
        if (teile[2] === 'approve') return blocked(ctx, 'invoices.approve', 'Rechnungsfreigabe erfordert eine Freigabe durch Danny (noch nicht automatisiert).', 'rechnungen', teile[1]);
        if (request.method === 'POST' && !teile[1]) {
          return blocked(ctx, 'invoices.create', 'Rechnungen anlegen ist über diese API noch nicht freigeschaltet (GoBD-Sperre nach Anlegen - siehe README.md). Bitte Angebot als Entwurf anlegen, Danny erstellt die Rechnung final in Werkora.', 'rechnungen');
        }
        if (request.method === 'GET' && !teile[1]) {
          let rechnungen = await firestoreList({ accessToken, projectId, collection: 'rechnungen' });
          const status = q.get('status'); const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id');
          const dateFrom = q.get('date_from'); const dateTo = q.get('date_to');
          if (status) rechnungen = rechnungen.filter((r) => quoteToApiInvoiceStatus(r) === status);
          if (customerId) rechnungen = rechnungen.filter((r) => r.kundeId === customerId);
          if (projectIdFilter) rechnungen = rechnungen.filter((r) => r.projektId === projectIdFilter);
          if (dateFrom) rechnungen = rechnungen.filter((r) => (r.datum || '') >= dateFrom);
          if (dateTo) rechnungen = rechnungen.filter((r) => (r.datum || '') <= dateTo);
          await logAction(ctx, { action: 'invoices.search', status: 'success' });
          return okResponse(rechnungen.map(invoiceToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const r = await firestoreGet({ accessToken, projectId, collection: 'rechnungen', id: teile[1] });
          if (!r) return errorResponse('INVOICE_NOT_FOUND', 'Rechnung wurde nicht gefunden.', 404);
          return okResponse(invoiceToApi(r));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      return errorResponse('NOT_FOUND', `Unbekannter Endpunkt: ${request.method} ${url.pathname}`, 404);
    } catch (err) {
      return errorResponse('SERVER_ERROR', err.message || 'Unbekannter Fehler', 500);
    }
  },
};

/** Hilfsfunktion nur für den GET-/invoices-Filter (nutzt dieselbe Status-Übersetzung wie invoiceToApi). */
function quoteToApiInvoiceStatus(r) {
  return invoiceToApi(r).status;
}
