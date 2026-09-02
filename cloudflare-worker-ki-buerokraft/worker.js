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
 * Zusätzlich: "Automatischer Büroablauf" - drei Cron-Checkpoints Mo-Fr um
 * ca. 08/12/16 Uhr (Morgenroutine/Mittagscheck/Tagesabschluss), siehe
 * scheduled()-Handler ganz unten und README.md, Abschnitt "Automatischer
 * Büroablauf".
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
const AUSGABEN_KATEGORIEN = ['Material', 'Werkzeug/Maschinen', 'Fahrzeug/Sprit', 'Miete', 'Versicherung', 'Büro/Verwaltung', 'Werbung/Marketing', 'Personal', 'Sonstiges'];

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

/** Wandelt einen ArrayBuffer in Base64 um, in Chunks damit String.fromCharCode(...) bei größeren Fotos nicht am Call-Stack-Limit scheitert. */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function addDaysISO(iso, delta) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
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

/**
 * Antwortet mit 403 APPROVAL_REQUIRED, protokolliert den Versuch (Vorgabe
 * Abschnitt 5+31) UND legt einen Eintrag im "KI-Freigaben"-Bereich an
 * (Vorgabe Abschnitt 30), damit Danny die angefragte Aktion in Werkora sieht.
 * WICHTIG: "Freigeben" in Werkora führt die eigentliche Aktion NICHT
 * automatisch aus (siehe README.md, Abschnitt "Freigabezentrum") - Danny
 * macht Versand/Löschen weiterhin selbst in der jeweiligen Ansicht.
 */
async function blocked(ctx, action, message, entityType, entityId) {
  await logAction(ctx, { action, entityType, entityId, status: 'blocked', approvalRequired: true });
  const freigabeId = crypto.randomUUID();
  const freigabe = {
    id: freigabeId, timestamp: new Date().toISOString(), action, entity_type: entityType || '', entity_id: entityId || '',
    message, status: 'offen', bearbeitet_am: '', bearbeitet_von: '', kommentar: '',
  };
  try {
    await firestoreCreate({ accessToken: ctx.accessToken, projectId: ctx.projectId, collection: 'ki_freigaben', id: freigabeId, data: freigabe });
  } catch {
    // Freigabe-Eintrag ist ein Komfort-Feature (Sichtbarkeit in Werkora) - ein
    // Fehler hier darf die eigentliche 403-Antwort an die KI nicht verhindern.
  }
  return errorResponse('APPROVAL_REQUIRED', message, 403);
}

/**
 * Sendet (best effort, ohne den Aufrufer zu blockieren) ein Webhook-Event an
 * die in den Einstellungen hinterlegte URL (Vorgabe Abschnitt 32). Format:
 * { event, data, timestamp }. Ohne konfigurierte URL passiert nichts.
 */
async function fireWebhook(ctx, event, data) {
  try {
    const url = await getSettingValue({ accessToken: ctx.accessToken, projectId: ctx.projectId, key: 'kiWebhookUrl', fallback: '' });
    if (!url) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, timestamp: new Date().toISOString() }),
    });
  } catch {
    // Webhooks sind best effort - ein nicht erreichbarer Zielserver darf den
    // eigentlichen API-Aufruf nicht zum Scheitern bringen.
  }
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

// "Auftragsbestätigungen" haben in Werkora exakt dieselbe Feldform wie
// Angebote (nummer, kundeId, projektId, datum, status, betreff, positionen,
// ...) - deshalb wird hier bewusst dieselbe quoteToApi()-Logik wiederverwendet.
function orderToApi(a) {
  const q = quoteToApi(a);
  return { ...q, quote_id: a.angebotId || '' };
}

function workReportToApi(w) {
  return {
    id: w.id,
    customer_id: w.kundeId || '',
    project_id: w.projektId || '',
    employee_id: w.mitarbeiterId || '',
    date: w.datum || '',
    start_time: w.startzeit || '',
    end_time: w.endzeit || '',
    work_minutes: w.arbeitszeitMinuten || 0,
    travel_minutes: w.fahrtzeitMinuten || 0,
    work_done: w.arbeiten || '',
    material_used: w.material || '',
    additional_work: w.zusatzarbeiten || '',
    photos: w.fotos || [],
    customer_signature: w.unterschriftKunde || null,
    created_at: w.createdAt || '',
  };
}

function apiToWorkReport(body) {
  return {
    kundeId: body.customer_id || '', projektId: body.project_id || '', mitarbeiterId: body.employee_id || '',
    datum: body.date || todayISO(), startzeit: body.start_time || '', endzeit: body.end_time || '',
    arbeitszeitMinuten: Number(body.work_minutes) || 0, fahrtzeitMinuten: Number(body.travel_minutes) || 0,
    arbeiten: body.work_done || '', material: body.material_used || '', zusatzarbeiten: body.additional_work || '',
    fotos: [], unterschriftKunde: null,
  };
}

const DOKUMENT_TYPEN = ['photo', 'measurement_report', 'vde_report', 'dguv_report', 'acceptance', 'customer_signature', 'invoice_document', 'quote_document', 'plan', 'other'];

function documentToApi(d) {
  return { id: d.id, project_id: d.projektId || '', type: d.typ || 'other', title: d.titel || '', note: d.notiz || '', created_at: d.createdAt || '' };
}

function paymentToApi(b) {
  return {
    id: b.id, date: b.datum || '', amount: b.betrag || 0, purpose: b.verwendungszweck || '', payer: b.empfaenger || '',
    matched: !!b.matched, match_type: b.matchTyp || '', match_id: b.matchId || '',
  };
}

function reminderToApi(m) {
  return { id: m.id, invoice_id: m.rechnungId || '', level: m.stufe || 1, date: m.datum || '', new_due_date: m.neueFrist || '', fee: m.gebuehr || 0, text: m.text || '' };
}

function expenseToApi(a) {
  return {
    id: a.id,
    date: a.datum || '',
    category: a.kategorie || '',
    description: a.beschreibung || '',
    supplier: a.lieferant || '',
    amount_net: a.betragNetto || 0,
    vat_rate: a.steuersatz ?? 19,
    amount_gross: a.betragBrutto || 0,
    paid_with: a.bezahltMit || '',
    customer_id: a.kundeId || '',
    project_id: a.projektId || '',
    payment_status: a.bezahlstatus || 'bezahlt',
    due_date: a.faelligAm || '',
    // Belege werden weiterhin nur in Werkora selbst hochgeladen/gescannt (Foto/PDF) -
    // diese API kann einen bereits hochgeladenen Beleg lesen (URL + Dateityp), aber
    // keinen neuen hochladen.
    receipt_url: a.beleg?.url || null,
    receipt_mime: a.beleg?.mime || null,
    has_receipt: !!a.beleg,
    created_at: a.createdAt || '',
  };
}

// Liefert - wie apiToCustomer() - nur die im Body tatsächlich übergebenen Felder
// (Konvention für PATCH). Betrag netto/brutto werden dabei konsistent gehalten,
// falls nur eines von beiden zusammen mit dem Steuersatz mitgeschickt wird.
function apiToExpenseChanges(body, existing) {
  const out = {};
  if (body.date !== undefined) out.datum = body.date;
  if (body.category !== undefined) out.kategorie = body.category;
  if (body.description !== undefined) out.beschreibung = body.description;
  if (body.supplier !== undefined) out.lieferant = body.supplier;
  if (body.paid_with !== undefined) out.bezahltMit = body.paid_with;
  if (body.customer_id !== undefined) out.kundeId = body.customer_id;
  if (body.project_id !== undefined) out.projektId = body.project_id;
  if (body.vat_rate !== undefined) out.steuersatz = Number(body.vat_rate);
  if (body.amount_net !== undefined || body.amount_gross !== undefined) {
    const steuersatz = out.steuersatz ?? existing.steuersatz ?? 19;
    const netto = body.amount_net !== undefined ? Number(body.amount_net) : Number(existing.betragNetto || 0);
    const brutto = body.amount_gross !== undefined ? Number(body.amount_gross) : Math.round(netto * (1 + steuersatz / 100) * 100) / 100;
    out.betragNetto = netto;
    out.betragBrutto = brutto;
  }
  return out;
}

function articleToApi(k) {
  return {
    id: k.id, type: k.typ === 'artikel' ? 'article' : 'service', name: k.bezeichnung || '', description: k.beschreibung || '',
    unit: k.einheit || '', purchase_price: k.einkaufspreis || 0, markup_percent: k.aufschlagProzent || 0,
    sales_price: k.preis || 0, vat_rate: k.steuersatz || 0, trade: k.gewerk || '',
    stock: k.bestandTracking ? (k.bestand ?? 0) : null, min_stock: k.bestandTracking ? (k.mindestbestand ?? 0) : null,
  };
}

function stockMovementToApi(b) {
  return { id: b.id, article_id: b.katalogId || '', delta: b.delta || 0, reason: b.grund || '', date: b.datum || '' };
}

function employeeToApi(m, onLeaveToday) {
  return { id: m.id, name: m.name || '', role: m.zugriffsrolle || '', trade: m.rolle || '', phone: m.telefon || '', email: m.email || '', on_leave_today: !!onLeaveToday };
}

/** Prüft, ob ein von der KI gesendeter Lead-/Kunden-Status einer echten Werkora-Status-Spalte entspricht. */
function leadStatusHinweis(sentStatus, kundenStatusSpalten) {
  if (!sentStatus) return null;
  const bekannt = kundenStatusSpalten.some((s) => s.id === sentStatus);
  if (bekannt) return null;
  return `Hinweis: Status "${sentStatus}" existiert nicht als Werkora-Status-Spalte (vorhanden: ${kundenStatusSpalten.map((s) => s.id).join(', ')}). Wurde als Notiz vermerkt, der Kunden-Status wurde NICHT geändert.`;
}

// ---------------------------------------------------------------------------
// Automatischer Büroablauf (Mo-Fr, 08/12/16 Uhr - siehe README.md)
//
// Drei tägliche Cron-Checkpoints, die NUR lesen (plus: legen eine Werkora-
// Aufgabe an/aktualisieren sie und schicken eine Push-Benachrichtigung -
// beides von der Erlaubt-Liste des Nutzers gedeckt). Kein automatischer
// Versand von E-Mails/Angeboten/Rechnungen/Mahnungen, keine Preisänderung,
// kein Löschen, kein automatisches Verschieben von Fälligkeitsdaten - alles
// wird nur AUFGELISTET, damit Danny selbst entscheidet.
//
// Phase A (dieser Schritt): nur Werkora-eigene Daten (Aufgaben/Termine/
// Baustellen/Dokumentation/Zeiterfassung/Angebote/Rechnungen). "Neue
// Kundenanfragen aus Gmail" und "echte Google-Kalender-Termine" fehlen noch -
// nicht weil kein Gmail-/Kalender-Zugriff existiert (der separate
// cloudflare-worker-google-buero/ läuft bereits), sondern weil dieser Cron
// ihn bisher nicht aufruft. Phase B: aus runBueroCheck() heraus dessen
// GET /emails bzw. GET /calendar/events abfragen (siehe README.md).
// ---------------------------------------------------------------------------

const BUEROABLAUF_TITEL = {
  morgen: '🌅 Morgenroutine: Aufgaben, Termine und Baustellen prüfen',
  mittag: '☀️ Mittagscheck: Zwischenstand Aufgaben, Baustellen und Rückfragen',
  abend: '🌇 Tagesabschluss 16 Uhr: Dokumentation und Zeiterfassung prüfen',
};

/** Baut den Checklisten-Text für einen Checkpoint aus den vorbereiteten Daten. Reine Funktion, kein Netzwerk. */
function buildBueroChecklist(checkpoint, daten) {
  const zeilen = [];
  const titelKurz = (x) => x.titel || '(ohne Titel)';
  const abschnitt = (titel, items) => {
    if (items.length === 0) return;
    zeilen.push(`${titel}:`);
    for (const i of items) zeilen.push(`- ${i}`);
    zeilen.push('');
  };

  if (checkpoint === 'morgen') {
    abschnitt('Überfällige Aufgaben', daten.ueberfaelligeAufgaben.map((a) => `${titelKurz(a)} (fällig ${a.faelligAm})`));
    if (daten.offeneAufgaben.length) zeilen.push(`Offene Aufgaben insgesamt: ${daten.offeneAufgaben.length}\n`);
    abschnitt('Heutige Baustellen', daten.heutigeBaustellen.map((t) => `${titelKurz(t)}${t.ort ? ' – ' + t.ort : ''}`));
    abschnitt('Heutige Termine', daten.heutigeTermine.map((t) => `${(t.start || '').slice(11, 16)} ${titelKurz(t)}`));
    abschnitt('Angebote zum Nachfassen', daten.angeboteNachfassen.map((a) => `${a.nummer || a.id} (versendet ${a.datum})`));
    abschnitt('Offene Rechnungen zur Übersicht', daten.offeneRechnungen.map((r) => `${r.nummer || r.id}, fällig ${r.faelligAm || '–'}`));
    abschnitt('Fehlende Dokumentation vom Vortag', daten.fehlendeDokuGestern.map(titelKurz));
    abschnitt('Fehlende Zeiterfassung vom Vortag', daten.fehlendeZeitGestern.map(titelKurz));
    if (zeilen.length === 0) zeilen.push('Alles im grünen Bereich - nichts Offenes gefunden.\n');
    zeilen.push('Hinweis: neue Kundenanfragen aus Gmail und offene Rückrufe prüft dieser Check noch nicht (Phase B - noch nicht verdrahtet).');
  } else if (checkpoint === 'mittag') {
    abschnitt('Laufende Baustellen heute', daten.heutigeBaustellen.map((t) => `${titelKurz(t)}${t.ort ? ' – ' + t.ort : ''}`));
    abschnitt('Termine am Nachmittag', daten.nachmittagsTermine.map((t) => `${(t.start || '').slice(11, 16)} ${titelKurz(t)}`));
    abschnitt('Noch keine Dokumentation heute begonnen', daten.baustellenOhneDokuHeute.map(titelKurz));
    abschnitt('Noch keine Zeiterfassung heute', daten.baustellenOhneZeitHeute.map(titelKurz));
    if (zeilen.length === 0) zeilen.push('Alles im grünen Bereich - nichts Offenes gefunden.\n');
    zeilen.push('Hinweis: neue/dringende E-Mails und Rückfragen von Kunden/Lieferanten prüft dieser Check noch nicht (Phase B - noch nicht verdrahtet).');
  } else if (checkpoint === 'abend') {
    abschnitt('Fehlende Zeiterfassung heute', daten.baustellenOhneZeitHeute.map(titelKurz));
    abschnitt('Fehlende Baustellendokumentation heute', daten.baustellenOhneDokuHeute.map(titelKurz));
    abschnitt('Heute noch offene Aufgaben', daten.heuteOffeneAufgaben.map(titelKurz));
    abschnitt('Morgen fällige Aufgaben', daten.morgenFaelligeAufgaben.map(titelKurz));
    abschnitt('Morgige Termine', daten.morgigeTermine.map((t) => `${(t.start || '').slice(11, 16)} ${titelKurz(t)}`));
    if (zeilen.length === 0) zeilen.push('Alles im grünen Bereich - nichts Offenes gefunden.\n');
    zeilen.push('Hinweis: unerledigte Aufgaben werden hier nur aufgelistet, NICHT automatisch auf morgen verschoben - das entscheidest du selbst.');
  }

  const text = zeilen.join('\n').trim();
  return text || 'Alles im grünen Bereich - nichts Offenes gefunden.';
}

/** Sammelt alle für die Checklisten benötigten Werkora-Daten (Firestore-Reads, keine Schreibvorgänge). */
async function gatherBueroDaten(accessToken, projectId) {
  const heute = todayISO();
  const gestern = addDaysISO(heute, -1);
  const morgen = addDaysISO(heute, 1);

  const [aufgaben, termine, angebote, rechnungen, arbeitsberichte, dokumente, zeiterfassung, einstellungenGlobal] = await Promise.all([
    firestoreList({ accessToken, projectId, collection: 'aufgaben' }),
    firestoreList({ accessToken, projectId, collection: 'termine' }),
    firestoreList({ accessToken, projectId, collection: 'angebote' }),
    firestoreList({ accessToken, projectId, collection: 'rechnungen' }),
    firestoreList({ accessToken, projectId, collection: 'arbeitsberichte' }),
    firestoreList({ accessToken, projectId, collection: 'dokumente' }),
    firestoreList({ accessToken, projectId, collection: 'zeiterfassung' }),
    firestoreGet({ accessToken, projectId, collection: 'einstellungen', id: 'global' }),
  ]);

  const offeneAufgaben = aufgaben.filter((a) => !AUFGABEN_STATUS_GESCHLOSSEN.includes(a.status));
  const ueberfaelligeAufgaben = offeneAufgaben.filter((a) => a.faelligAm && a.faelligAm < heute);
  const heuteOffeneAufgaben = offeneAufgaben.filter((a) => a.faelligAm === heute);
  const morgenFaelligeAufgaben = offeneAufgaben.filter((a) => a.faelligAm === morgen);

  const heutigeTermine = termine.filter((t) => (t.start || '').slice(0, 10) === heute);
  const heutigeBaustellen = heutigeTermine.filter((t) => t.typ === 'baustelle');
  const gestrigeBaustellen = termine.filter((t) => t.typ === 'baustelle' && (t.start || '').slice(0, 10) === gestern);
  const morgigeTermine = termine.filter((t) => (t.start || '').slice(0, 10) === morgen);
  const nachmittagsTermine = heutigeTermine.filter((t) => (t.start || '').slice(11, 13) >= '12');

  const angebotNachfassTage = Number(einstellungenGlobal?.angebotNachfassTage) || 7;
  const nachfassGrenze = addDaysISO(heute, -angebotNachfassTage);
  const angeboteNachfassen = angebote.filter((a) => a.status === 'versendet' && a.datum && a.datum <= nachfassGrenze);

  const offeneRechnungen = rechnungen.filter((r) => RECHNUNG_OFFEN_STATUS.includes(r.status));

  const hatDokumentationFuer = (termin, datum) => {
    const hatBericht = arbeitsberichte.some((w) => w.datum === datum && ((termin.projektId && w.projektId === termin.projektId) || (termin.kundeId && w.kundeId === termin.kundeId)));
    const hatDokument = termin.projektId && dokumente.some((d) => d.bezugTyp === 'projekt' && d.bezugId === termin.projektId && (d.createdAt || '').slice(0, 10) === datum);
    return hatBericht || hatDokument;
  };
  const hatZeiterfassungFuer = (termin, datum) => zeiterfassung.some((z) => z.datum === datum && ((termin.projektId && z.projektId === termin.projektId) || (termin.mitarbeiterIds || []).includes(z.mitarbeiterId)));

  return {
    offeneAufgaben, ueberfaelligeAufgaben, heuteOffeneAufgaben, morgenFaelligeAufgaben,
    heutigeTermine, heutigeBaustellen, morgigeTermine, nachmittagsTermine,
    angeboteNachfassen, offeneRechnungen,
    fehlendeDokuGestern: gestrigeBaustellen.filter((t) => !hatDokumentationFuer(t, gestern)),
    fehlendeZeitGestern: gestrigeBaustellen.filter((t) => !hatZeiterfassungFuer(t, gestern)),
    baustellenOhneDokuHeute: heutigeBaustellen.filter((t) => !hatDokumentationFuer(t, heute)),
    baustellenOhneZeitHeute: heutigeBaustellen.filter((t) => !hatZeiterfassungFuer(t, heute)),
  };
}

/**
 * Push-Versand (Firebase Cloud Messaging HTTP v1) direkt aus dem Cron heraus,
 * an alle admin/buero-Geräte - 1:1 dasselbe Muster wie der bestehende
 * client-ausgelöste "push-send" im generischen cloudflare-worker/worker.js,
 * hier aber serverseitig ohne Client-Trigger. Best effort: ein Fehler hier
 * darf den eigentlichen Cron-Lauf (Aufgabe anlegen) nicht verhindern.
 */
async function sendBueroPush(serviceAccount, projectId, datastoreAccessToken, { title, body }) {
  try {
    const tokens = (await firestoreList({ accessToken: datastoreAccessToken, projectId, collection: 'pushTokens' }))
      .filter((t) => t.role === 'admin' || t.role === 'buero')
      .map((t) => t.id);
    if (tokens.length === 0) return;
    const fcmAccessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/firebase.messaging');
    for (const token of tokens) {
      await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fcmAccessToken}` },
        body: JSON.stringify({ message: { token, notification: { title, body } } }),
      }).catch(() => {});
    }
  } catch {
    // Push ist ein Komfort-Feature - ein Fehler hier darf den Cron-Lauf nicht kippen.
  }
}

/**
 * Führt einen der drei täglichen Checkpoints aus: sammelt Daten, legt eine
 * Werkora-Aufgabe mit der Checkliste an und schickt eine Push-
 * Benachrichtigung. Deterministische Aufgaben-ID (bueroablauf-{checkpoint}-
 * {datum}) statt crypto.randomUUID(): falls der Cron am selben Tag erneut
 * feuert, wird NICHT dupliziert - und falls Danny die Aufgabe zwischendurch
 * schon bearbeitet/erledigt hat, wird sie hier bewusst NICHT überschrieben
 * (sonst würde ein erneuter Lauf einen bereits erledigten Status
 * zurücksetzen).
 */
async function runBueroCheck(env, checkpoint) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
  const projectId = serviceAccount.project_id;
  const heute = todayISO();
  const aufgabeId = `bueroablauf-${checkpoint}-${heute}`;

  const bereitsAngelegt = await firestoreGet({ accessToken, projectId, collection: 'aufgaben', id: aufgabeId });
  if (bereitsAngelegt) return;

  const daten = await gatherBueroDaten(accessToken, projectId);
  const beschreibung = buildBueroChecklist(checkpoint, daten);
  const titel = BUEROABLAUF_TITEL[checkpoint];

  await firestoreCreate({
    accessToken, projectId, collection: 'aufgaben', id: aufgabeId,
    data: {
      id: aufgabeId, titel, beschreibung, prioritaet: 'hoch', status: 'offen',
      faelligAm: heute, kundeId: '', projektId: '', zugewiesenAn: '',
      createdAt: new Date().toISOString(), erledigtAm: '',
    },
  });

  await sendBueroPush(serviceAccount, projectId, accessToken, {
    title: titel,
    body: beschreibung.length > 180 ? `${beschreibung.slice(0, 177)}...` : beschreibung,
  });
}

// Zusätzliche benannte Exporte rein für lokale Unit-Tests (reine Funktionen, kein Netzwerk).
export {
  toFirestoreValue, toFirestoreFields, fromFirestoreValue, fromFirestoreFields, docToPlain,
  customerToApi, apiToCustomer, taskToApi, appointmentToApi, projectToApi, quoteToApi, invoiceToApi,
  nextDailyNummer, calcTotals, leadStatusHinweis, addDaysISO, buildBueroChecklist,
  orderToApi, workReportToApi, apiToWorkReport, documentToApi, paymentToApi, reminderToApi, articleToApi, employeeToApi,
  stockMovementToApi,
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
          await fireWebhook(ctx, 'customer.created', customerToApi(created));
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
            await fireWebhook(ctx, 'lead.created', customerToApi(updated));
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
          await fireWebhook(ctx, 'lead.created', customerToApi(created));
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
          if (changes.status && changes.status !== existing.status) await fireWebhook(ctx, 'lead.status_changed', { id: teile[1], old_status: existing.status || '', new_status: changes.status });
          return okResponse({ ...customerToApi(updated), lead_note: hinweis || undefined });
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Projekte (Vorgabe Abschnitt 9 - nur Lesen in Phase 1) ---
      if (teile[0] === 'projects') {
        // --- Projekt-Dokumente (Vorgabe Abschnitt 19-20) ---
        if (teile[1] && teile[2] === 'documents') {
          if (request.method === 'GET') {
            const dokumente = (await firestoreList({ accessToken, projectId, collection: 'dokumente' })).filter((d) => d.projektId === teile[1]);
            await logAction(ctx, { action: 'documents.search', entityType: 'projekte', entityId: teile[1], status: 'success' });
            return okResponse(dokumente.map(documentToApi));
          }
          if (request.method === 'POST') {
            let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
            if (!body.type || !DOKUMENT_TYPEN.includes(body.type)) return errorResponse('VALIDATION_ERROR', `Feld "type" muss einer von ${DOKUMENT_TYPEN.join(', ')} sein.`, 400);
            const id = crypto.randomUUID();
            const data = { id, projektId: teile[1], typ: body.type, titel: body.title || '', notiz: body.note || '', createdAt: new Date().toISOString() };
            const created = await firestoreCreate({ accessToken, projectId, collection: 'dokumente', id, data });
            await logAction(ctx, { action: 'documents.create', entityType: 'dokumente', entityId: id, newValue: data, status: 'success' });
            return okResponse(documentToApi(created), 201);
          }
          return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
        }
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
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'projekte', id: teile[1] });
          if (!existing) return errorResponse('PROJECT_NOT_FOUND', 'Projekt wurde nicht gefunden.', 404);
          const changes = {};
          if (body.title !== undefined) changes.titel = body.title;
          if (body.description !== undefined) changes.beschreibung = body.description;
          if (body.bereich !== undefined) changes.bereich = body.bereich;
          if (body.start_date !== undefined) changes.startDatum = body.start_date;
          if (body.planned_end_date !== undefined) changes.endDatum = body.planned_end_date;
          if (body.status !== undefined) {
            const spalten = await firestoreList({ accessToken, projectId, collection: 'kanbanSpalten' });
            if (!spalten.some((s) => s.id === body.status)) return errorResponse('VALIDATION_ERROR', `Unbekannter Projekt-Status "${body.status}" - erst mit searchProjects oder in Werkora die gültigen Status-IDs prüfen.`, 400);
            changes.status = body.status;
          }
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'projekte', id: teile[1], data: changes });
          await logAction(ctx, { action: 'projects.update', entityType: 'projekte', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(projectToApi(updated));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Anlegen neuer Projekte ist über diese API noch nicht freigeschaltet - Projekte entstehen in Werkora aus angenommenen Angeboten.', 405);
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
          if (q.get('count') === 'true') return okResponse({ count: aufgaben.length });
          const taskLimit = Math.min(Number(q.get('limit')) || 100, 100);
          return okResponse(aufgaben.slice(0, taskLimit).map(taskToApi));
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
          // Idempotenz-Prüfung: doppelte Aufrufe (Netzwerk-Retry, doppelt
          // ausgelöster Webhook, versehentlich zweimal übermittelter Auftrag)
          // dürfen nicht zu doppelten Terminen führen - bei exakt gleichem
          // Titel+Startzeit (und, falls angegeben, gleichem Kunden) wird der
          // bereits vorhandene Termin zurückgegeben statt ein neuer angelegt.
          const bestehende = await firestoreList({ accessToken, projectId, collection: 'termine' });
          const dupe = bestehende.find((t) => (t.titel || '').trim().toLowerCase() === (body.title || '').trim().toLowerCase()
            && t.start === body.start && (!body.customer_id || t.kundeId === body.customer_id));
          if (dupe) {
            await logAction(ctx, { action: 'appointments.create.deduped', entityType: 'termine', entityId: dupe.id, status: 'success' });
            return okResponse(appointmentToApi(dupe), 200);
          }
          const id = crypto.randomUUID();
          const data = {
            id, titel: body.title, typ: 'termin', kundeId: body.customer_id || '', projektId: body.project_id || '',
            start: body.start, ende: body.end || '', ort: body.address || '',
            mitarbeiterIds: Array.isArray(body.assigned_employee_ids) ? body.assigned_employee_ids : [], notizen: body.notes || '',
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'termine', id, data });
          await logAction(ctx, { action: 'appointments.create', entityType: 'termine', entityId: id, newValue: data, status: 'success' });
          await fireWebhook(ctx, 'appointment.created', appointmentToApi(created));
          return okResponse(appointmentToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'termine', id: teile[1] });
          if (!existing) return errorResponse('APPOINTMENT_NOT_FOUND', 'Termin wurde nicht gefunden.', 404);
          const changes = {};
          if (body.title !== undefined) changes.titel = body.title;
          if (body.start !== undefined) changes.start = body.start;
          if (body.end !== undefined) changes.ende = body.end;
          if (body.address !== undefined) changes.ort = body.address;
          if (body.customer_id !== undefined) changes.kundeId = body.customer_id;
          if (body.project_id !== undefined) changes.projektId = body.project_id;
          if (body.assigned_employee_ids !== undefined) changes.mitarbeiterIds = Array.isArray(body.assigned_employee_ids) ? body.assigned_employee_ids : [];
          if (body.notes !== undefined) changes.notizen = body.notes;
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'termine', id: teile[1], data: changes });
          await logAction(ctx, { action: 'appointments.update', entityType: 'termine', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(appointmentToApi(updated));
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
          if (q.get('count') === 'true') return okResponse({ count: angebote.length });
          const quoteLimit = Math.min(Number(q.get('limit')) || 100, 100);
          return okResponse(angebote.slice(0, quoteLimit).map(quoteToApi));
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
          await fireWebhook(ctx, 'quote.created', quoteToApi(created));
          return okResponse(quoteToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          const existing = await firestoreGet({ accessToken, projectId, collection: 'angebote', id: teile[1] });
          if (!existing) return errorResponse('QUOTE_NOT_FOUND', 'Angebot wurde nicht gefunden.', 404);
          // Nur Entwürfe sind bearbeitbar - ein versendetes/angenommenes Angebot nachträglich
          // per KI zu ändern würde vom Kunden nicht mehr abgeglichen werden können.
          if (existing.status !== 'entwurf') return errorResponse('QUOTE_NOT_EDITABLE', 'Nur Angebote im Status Entwurf können bearbeitet werden - dieses wurde bereits versendet/beantwortet.', 409);
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const changes = {};
          if (body.title !== undefined) changes.betreff = body.title;
          if (body.project_id !== undefined) changes.projektId = body.project_id;
          if (Array.isArray(body.items)) {
            const positionen = body.items.map((it) => ({
              id: crypto.randomUUID(), katalogId: it.article_id || '', bezeichnung: it.title || '', beschreibung: it.description || '',
              einheit: it.unit || 'Stk.', menge: Number(it.quantity) || 0, einzelpreis: Number(it.unit_price_net) || 0, steuersatz: it.vat_rate ?? 19,
            }));
            const totals = calcTotals(positionen);
            changes.positionen = positionen;
            changes.netto = totals.netto;
            changes.steuer = totals.steuer;
            changes.brutto = totals.brutto;
          }
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'angebote', id: teile[1], data: changes });
          await logAction(ctx, { action: 'quotes.update', entityType: 'angebote', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(quoteToApi(updated));
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
          if (q.get('count') === 'true') return okResponse({ count: rechnungen.length });
          const invoiceLimit = Math.min(Number(q.get('limit')) || 100, 100);
          return okResponse(rechnungen.slice(0, invoiceLimit).map(invoiceToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const r = await firestoreGet({ accessToken, projectId, collection: 'rechnungen', id: teile[1] });
          if (!r) return errorResponse('INVOICE_NOT_FOUND', 'Rechnung wurde nicht gefunden.', 404);
          return okResponse(invoiceToApi(r));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Aufträge (Vorgabe Abschnitt 17 - nur Lesen, entstehen aus angenommenen Angeboten in Werkora selbst) ---
      if (teile[0] === 'orders') {
        if (request.method === 'GET' && !teile[1]) {
          let auftraege = await firestoreList({ accessToken, projectId, collection: 'auftragsbestaetigungen' });
          const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id'); const status = q.get('status');
          if (customerId) auftraege = auftraege.filter((a) => a.kundeId === customerId);
          if (projectIdFilter) auftraege = auftraege.filter((a) => a.projektId === projectIdFilter);
          if (status) auftraege = auftraege.filter((a) => orderToApi(a).status === status);
          await logAction(ctx, { action: 'orders.search', status: 'success' });
          return okResponse(auftraege.map(orderToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const a = await firestoreGet({ accessToken, projectId, collection: 'auftragsbestaetigungen', id: teile[1] });
          if (!a) return errorResponse('ORDER_NOT_FOUND', 'Auftrag wurde nicht gefunden.', 404);
          return okResponse(orderToApi(a));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Aufträge entstehen in Werkora aus angenommenen Angeboten - Anlegen/Ändern über diese API ist noch nicht freigeschaltet.', 405);
      }

      // --- Arbeitsberichte (Vorgabe Abschnitt 18) ---
      if (teile[0] === 'work-reports') {
        if (request.method === 'GET' && !teile[1]) {
          let berichte = await firestoreList({ accessToken, projectId, collection: 'arbeitsberichte' });
          const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id'); const employeeId = q.get('employee_id');
          if (customerId) berichte = berichte.filter((w) => w.kundeId === customerId);
          if (projectIdFilter) berichte = berichte.filter((w) => w.projektId === projectIdFilter);
          if (employeeId) berichte = berichte.filter((w) => w.mitarbeiterId === employeeId);
          await logAction(ctx, { action: 'work-reports.search', status: 'success' });
          return okResponse(berichte.map(workReportToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const w = await firestoreGet({ accessToken, projectId, collection: 'arbeitsberichte', id: teile[1] });
          if (!w) return errorResponse('WORK_REPORT_NOT_FOUND', 'Arbeitsbericht wurde nicht gefunden.', 404);
          return okResponse(workReportToApi(w));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.customer_id && !body.project_id) return errorResponse('VALIDATION_ERROR', 'Mindestens "customer_id" oder "project_id" ist erforderlich.', 400);
          const id = crypto.randomUUID();
          const data = { id, ...apiToWorkReport(body), createdAt: new Date().toISOString() };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'arbeitsberichte', id, data });
          await logAction(ctx, { action: 'work-reports.create', entityType: 'arbeitsberichte', entityId: id, newValue: data, status: 'success' });
          return okResponse(workReportToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'arbeitsberichte', id: teile[1] });
          if (!existing) return errorResponse('WORK_REPORT_NOT_FOUND', 'Arbeitsbericht wurde nicht gefunden.', 404);
          const changes = apiToWorkReport({ ...workReportToApi(existing), ...body });
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'arbeitsberichte', id: teile[1], data: changes });
          await logAction(ctx, { action: 'work-reports.update', entityType: 'arbeitsberichte', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(workReportToApi(updated));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Zahlungen (Vorgabe Abschnitt 23 - nur Lesen, Werkora bildet das über Kontoauszug-Abgleich ab) ---
      if (teile[0] === 'payments') {
        if (request.method === 'GET' && !teile[1]) {
          const zahlungen = await firestoreList({ accessToken, projectId, collection: 'bankbuchungen' });
          await logAction(ctx, { action: 'payments.search', status: 'success' });
          return okResponse(zahlungen.map(paymentToApi));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Zahlungen werden über den Kontoauszug-Abgleich in Werkora gepflegt und können über diese API nur gelesen werden.', 405);
      }

      // --- Ausgaben/Belege (bisher komplett gefehlt - Belege werden weiterhin nur in
      // Werkora selbst hochgeladen/gescannt; hier: lesen inkl. Beleg-URL, Betrag/Datum/
      // Lieferant/MwSt. erfassen und Kategorie zuordnen+speichern) ---
      if (teile[0] === 'expenses') {
        // --- Beleg wirklich auslesen (Foto/PDF-Inhalt, nicht nur die gespeicherten Felder) ---
        // Nutzt dieselbe KI-Belegerkennung wie "Beleg scannen" in Werkora selbst
        // (Einstellungen -> KI-Angebotserstellung -> aiWorkerUrl), damit die KI-Bürokraft
        // fehlerhaft importierte Belege (0-Euro-Beträge, falsches Datum, "Sonstiges" statt
        // echter Kategorie) gegen den tatsächlichen Belegbild-Inhalt prüfen kann, statt auf
        // Verdacht zu raten. Ändert NICHTS automatisch - liefert nur den erkannten Inhalt
        // zurück, die eigentliche Korrektur läuft weiterhin über updateExpense.
        if (teile[1] && teile[2] === 'analyze-receipt' && request.method === 'POST') {
          const ausgabe = await firestoreGet({ accessToken, projectId, collection: 'ausgaben', id: teile[1] });
          if (!ausgabe) return errorResponse('EXPENSE_NOT_FOUND', 'Ausgabe wurde nicht gefunden.', 404);
          if (!ausgabe.beleg?.url) return errorResponse('NO_RECEIPT', 'Zu dieser Ausgabe ist kein Beleg (Foto/PDF) hinterlegt.', 404);
          const mime = ausgabe.beleg.mime || '';
          if (!/^image\/(png|jpe?g|webp)$/i.test(mime)) {
            return errorResponse('UNSUPPORTED_RECEIPT_FORMAT', `Dieser Beleg (${mime || 'unbekanntes Format'}) kann automatisch nicht ausgelesen werden - nur fotografierte Belege (JPEG/PNG/WebP) werden unterstützt, keine PDFs.`, 422);
          }
          const einstellungen = await firestoreGet({ accessToken, projectId, collection: 'einstellungen', id: 'global' });
          if (!einstellungen?.aiWorkerUrl || !einstellungen?.aiAppSecret) {
            return errorResponse('AI_NOT_CONFIGURED', 'Die KI-Belegerkennung ist in Werkora nicht eingerichtet (Einstellungen → KI-Angebotserstellung).', 409);
          }
          // Zwei Cloudflare-Worker dürfen sich NICHT direkt über ihre workers.dev-Adresse
          // gegenseitig per fetch() aufrufen (Cloudflare blockiert das mit Fehler 1042,
          // schon bevor die Anfrage den Ziel-Worker erreicht) - deshalb läuft dieser Aufruf
          // über eine Service-Bindung, die in den Worker-Einstellungen bei Cloudflare
          // eingerichtet werden muss (siehe README.md). Cloudflares Dashboard übersetzt den
          // eingetragenen Variablennamen an manchen Stellen der Oberfläche (z.B. "AI_WORKER"
          // wird dort als "KI-ARBEITER" angezeigt) - der tatsächlich im Code ankommende
          // env-Schlüssel bleibt aber der eingetragene Variablenname. Beide Schreibweisen
          // werden hier akzeptiert, damit es unabhängig von der Anzeige funktioniert.
          // Statt auf einen exakten Bindungsnamen zu bestehen (das Cloudflare-Dashboard zeigt
          // ihn an manchen Stellen übersetzt/anders an, z.B. "AI_WORKER" als "KI-ARBEITER"):
          // eine Service-Bindung ist im env-Objekt ein Wert mit einer eigenen .fetch()-Methode
          // (ein "Fetcher") - das reicht als Erkennungsmerkmal, unabhängig vom gewählten Namen.
          const aiWorkerBinding = env.AI_WORKER || env['KI-ARBEITER'] || env.KI_ARBEITER
            || Object.values(env || {}).find((v) => v && typeof v.fetch === 'function');
          if (!aiWorkerBinding) {
            // Diagnose-Info mitgeben (nur Namen der vorhandenen env-Bindings, keine Werte/
            // Geheimnisse), damit sich das ohne weitere Rateversuche direkt einordnen lässt.
            return errorResponse('AI_WORKER_NOT_BOUND', 'Service-Bindung zum KI-Worker fehlt in den Cloudflare-Worker-Einstellungen - siehe README.md, Abschnitt "Beleg-Analyse einrichten".', 409, { vorhandene_env_schluessel: Object.keys(env || {}) });
          }
          let imageDataUrl;
          try {
            const imgRes = await fetch(ausgabe.beleg.url);
            if (!imgRes.ok) throw new Error(`Beleg-Download fehlgeschlagen (${imgRes.status}).`);
            const buffer = await imgRes.arrayBuffer();
            imageDataUrl = `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
          } catch (err) {
            return errorResponse('RECEIPT_DOWNLOAD_FAILED', err.message || 'Beleg konnte nicht geladen werden.', 502);
          }
          let analyse;
          try {
            const aiRes = await aiWorkerBinding.fetch('https://ai-worker.internal/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-App-Secret': einstellungen.aiAppSecret,
                // Der KI-Worker prüft den Origin-Header gegen ALLOWED_ORIGINS (normalerweise
                // nur für Aufrufe aus dem Browser gedacht) - bei einem Worker-zu-Worker-Aufruf
                // gibt es keinen echten Origin, deshalb hier explizit einen erlaubten setzen.
                Origin: 'https://neuverdrahtet.com',
              },
              body: JSON.stringify({ action: 'beleg-scan', imageDataUrl, kategorien: AUSGABEN_KATEGORIEN }),
            });
            if (!aiRes.ok) {
              const t = await aiRes.text().catch(() => '');
              throw new Error(`KI-Worker-Fehler (${aiRes.status}): ${t.slice(0, 200)}`);
            }
            analyse = await aiRes.json();
            if (analyse.error) throw new Error(analyse.error);
          } catch (err) {
            return errorResponse('AI_ANALYSIS_FAILED', err.message || 'Beleg-Analyse fehlgeschlagen.', 502);
          }
          await logAction(ctx, { action: 'expenses.analyze_receipt', entityType: 'ausgaben', entityId: teile[1], newValue: analyse, status: 'success' });
          return okResponse({
            current: expenseToApi(ausgabe),
            detected: {
              supplier: analyse.haendler || '',
              date: analyse.datum || '',
              amount_net: analyse.betragNetto ?? null,
              amount_gross: analyse.betragBrutto ?? null,
              vat_rate: analyse.steuersatz ?? null,
              category: AUSGABEN_KATEGORIEN.includes(analyse.kategorie) ? analyse.kategorie : 'Sonstiges',
              description: analyse.beschreibung || '',
              readable: !!analyse.lesbar,
              category_confident: !!analyse.kategorieSicher,
            },
          });
        }
        if (request.method === 'GET' && !teile[1]) {
          let ausgaben = await firestoreList({ accessToken, projectId, collection: 'ausgaben' });
          const customerId = q.get('customer_id'); const projectIdFilter = q.get('project_id');
          const category = q.get('category'); const supplier = q.get('supplier');
          const dateFrom = q.get('date_from'); const dateTo = q.get('date_to'); const status = q.get('status');
          if (customerId) ausgaben = ausgaben.filter((a) => a.kundeId === customerId);
          if (projectIdFilter) ausgaben = ausgaben.filter((a) => a.projektId === projectIdFilter);
          if (category) ausgaben = ausgaben.filter((a) => a.kategorie === category);
          if (supplier) ausgaben = ausgaben.filter((a) => (a.lieferant || '').toLowerCase().includes(supplier.toLowerCase()));
          if (dateFrom) ausgaben = ausgaben.filter((a) => (a.datum || '') >= dateFrom);
          if (dateTo) ausgaben = ausgaben.filter((a) => (a.datum || '') <= dateTo);
          if (status) ausgaben = ausgaben.filter((a) => (a.bezahlstatus || 'bezahlt') === status);
          ausgaben.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
          await logAction(ctx, { action: 'expenses.search', status: 'success' });
          if (q.get('count') === 'true') return okResponse({ count: ausgaben.length });
          const expenseLimit = Math.min(Number(q.get('limit')) || 100, 100);
          return okResponse(ausgaben.slice(0, expenseLimit).map(expenseToApi));
        }
        if (request.method === 'GET' && teile[1]) {
          const a = await firestoreGet({ accessToken, projectId, collection: 'ausgaben', id: teile[1] });
          if (!a) return errorResponse('EXPENSE_NOT_FOUND', 'Ausgabe wurde nicht gefunden.', 404);
          return okResponse(expenseToApi(a));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.date || !body.category) return errorResponse('VALIDATION_ERROR', 'Felder "date" und "category" sind erforderlich.', 400);
          if (!AUSGABEN_KATEGORIEN.includes(body.category)) return errorResponse('VALIDATION_ERROR', `Feld "category" muss einer von ${AUSGABEN_KATEGORIEN.join(', ')} sein.`, 400);
          if (body.amount_net === undefined && body.amount_gross === undefined) return errorResponse('VALIDATION_ERROR', 'Feld "amount_net" oder "amount_gross" ist erforderlich.', 400);
          const steuersatz = body.vat_rate !== undefined ? Number(body.vat_rate) : 19;
          const betragNetto = body.amount_net !== undefined ? Number(body.amount_net) : Math.round((Number(body.amount_gross) / (1 + steuersatz / 100)) * 100) / 100;
          const betragBrutto = body.amount_gross !== undefined ? Number(body.amount_gross) : Math.round(betragNetto * (1 + steuersatz / 100) * 100) / 100;
          const id = crypto.randomUUID();
          const data = {
            id, datum: body.date, kategorie: body.category, beschreibung: body.description || '', lieferant: body.supplier || '',
            betragNetto, steuersatz, betragBrutto, bezahltMit: body.paid_with || 'überweisung',
            kundeId: body.customer_id || '', projektId: body.project_id || '', beleg: null,
            bezahlstatus: 'bezahlt', faelligAm: '', bezahltAm: '', istInvestition: false, kalkKategorie: '',
            createdAt: new Date().toISOString(),
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'ausgaben', id, data });
          await logAction(ctx, { action: 'expenses.create', entityType: 'ausgaben', entityId: id, newValue: data, status: 'success' });
          return okResponse(expenseToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const existing = await firestoreGet({ accessToken, projectId, collection: 'ausgaben', id: teile[1] });
          if (!existing) return errorResponse('EXPENSE_NOT_FOUND', 'Ausgabe wurde nicht gefunden.', 404);
          if (body.category !== undefined && !AUSGABEN_KATEGORIEN.includes(body.category)) return errorResponse('VALIDATION_ERROR', `Feld "category" muss einer von ${AUSGABEN_KATEGORIEN.join(', ')} sein.`, 400);
          const changes = apiToExpenseChanges(body, existing);
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'ausgaben', id: teile[1], data: changes });
          await logAction(ctx, { action: 'expenses.update', entityType: 'ausgaben', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(expenseToApi(updated));
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Mahnungen (Vorgabe Abschnitt 24) ---
      if (teile[0] === 'reminders') {
        if (request.method === 'GET' && !teile[1]) {
          let mahnungen = await firestoreList({ accessToken, projectId, collection: 'mahnungen' });
          const invoiceId = q.get('invoice_id');
          if (invoiceId) mahnungen = mahnungen.filter((m) => m.rechnungId === invoiceId);
          await logAction(ctx, { action: 'reminders.search', status: 'success' });
          return okResponse(mahnungen.map(reminderToApi));
        }
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.invoice_id || !body.level) return errorResponse('VALIDATION_ERROR', 'Felder "invoice_id" und "level" sind erforderlich.', 400);
          const rechnung = await firestoreGet({ accessToken, projectId, collection: 'rechnungen', id: body.invoice_id });
          if (!rechnung) return errorResponse('INVOICE_NOT_FOUND', 'invoice_id verweist auf keine vorhandene Rechnung.', 404);
          const id = crypto.randomUUID();
          const data = { id, rechnungId: body.invoice_id, stufe: body.level, datum: todayISO(), neueFrist: body.new_due_date || '', gebuehr: body.fee || 0, text: body.text || '', createdAt: new Date().toISOString() };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'mahnungen', id, data });
          await logAction(ctx, { action: 'reminders.create', entityType: 'mahnungen', entityId: id, newValue: data, status: 'success' });
          return okResponse(reminderToApi(created), 201);
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Lagerbewegungen artikelübergreifend (z.B. "was waren die letzten Zu-/Abgänge?"
      // ohne dass die KI vorher eine bestimmte Artikel-ID kennen muss). ---
      if (teile[0] === 'stock-movements' && !teile[1]) {
        if (request.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
        const [bewegungen, katalog] = await Promise.all([
          firestoreList({ accessToken, projectId, collection: 'lagerbewegungen' }),
          firestoreList({ accessToken, projectId, collection: 'katalog' }),
        ]);
        const artikelNamen = new Map(katalog.map((k) => [k.id, k.bezeichnung || '']));
        const articleId = q.get('article_id');
        let liste = articleId ? bewegungen.filter((b) => b.katalogId === articleId) : bewegungen;
        liste = liste.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
        await logAction(ctx, { action: 'stock-movements.search', status: 'success' });
        if (q.get('count') === 'true') return okResponse({ count: liste.length });
        const limit = Math.min(Number(q.get('limit')) || 50, 100);
        return okResponse(liste.slice(0, limit).map((b) => ({ ...stockMovementToApi(b), article_name: artikelNamen.get(b.katalogId) || '' })));
      }

      // --- Lagerbestand (Materialwirtschaft, Artikel mit bestandTracking=true) - lesen + Zu-/Abgänge buchen ---
      if (teile[0] === 'articles' && teile[1] && teile[2] === 'stock-movements') {
        const artikel = await firestoreGet({ accessToken, projectId, collection: 'katalog', id: teile[1] });
        if (!artikel || artikel.typ !== 'artikel') return errorResponse('ARTICLE_NOT_FOUND', 'Artikel wurde nicht gefunden.', 404);
        if (request.method === 'GET') {
          let bewegungen = await firestoreList({ accessToken, projectId, collection: 'lagerbewegungen' });
          bewegungen = bewegungen.filter((b) => b.katalogId === teile[1]).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
          await logAction(ctx, { action: 'articles.stock-movements.search', entityType: 'katalog', entityId: teile[1], status: 'success' });
          return okResponse(bewegungen.map(stockMovementToApi));
        }
        if (request.method === 'POST') {
          if (!artikel.bestandTracking) return errorResponse('STOCK_NOT_TRACKED', 'Für diesen Artikel ist keine Bestandsführung aktiviert - in Werkora unter Katalog je Artikel einschaltbar.', 409);
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const delta = Number(body.delta);
          if (!delta || Number.isNaN(delta)) return errorResponse('VALIDATION_ERROR', 'Feld "delta" ist erforderlich (Zahl ungleich 0; positiv = Zugang, negativ = Entnahme).', 400);
          const neuerBestand = Math.max(0, Number(artikel.bestand ?? 0) + delta);
          const updatedArtikel = await firestoreUpdate({ accessToken, projectId, collection: 'katalog', id: teile[1], data: { bestand: neuerBestand } });
          const movementId = crypto.randomUUID();
          const movement = { id: movementId, katalogId: teile[1], delta, grund: body.reason || '', datum: new Date().toISOString() };
          await firestoreCreate({ accessToken, projectId, collection: 'lagerbewegungen', id: movementId, data: movement });
          await logAction(ctx, { action: 'articles.stock-movements.create', entityType: 'katalog', entityId: teile[1], newValue: movement, status: 'success' });
          return okResponse({ ...articleToApi(updatedArtikel), movement: stockMovementToApi(movement) }, 201);
        }
        return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
      }

      // --- Artikel/Leistungen/Preisliste (Vorgabe Abschnitt 25-26 - Preise/Stammdaten nur Lesen, Bestand siehe stock-movements oben) ---
      if (teile[0] === 'articles' || teile[0] === 'services' || teile[0] === 'price-list') {
        if (request.method === 'POST' && !teile[1]) {
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          if (!body.name) return errorResponse('VALIDATION_ERROR', 'Feld "name" ist erforderlich.', 400);
          const typ = body.type === 'service' ? 'leistung' : 'artikel';
          const id = crypto.randomUUID();
          const data = {
            id, typ, bezeichnung: body.name, beschreibung: body.description || '', einheit: body.unit || 'Stk.',
            einkaufspreis: Number(body.purchase_price) || 0, aufschlagProzent: Number(body.markup_percent) || 0,
            preis: Number(body.sales_price) || 0, steuersatz: body.vat_rate ?? 19, gewerk: body.trade || '',
            bestandTracking: false, bestand: 0, mindestbestand: Number(body.min_stock) || 0, createdAt: new Date().toISOString(),
          };
          const created = await firestoreCreate({ accessToken, projectId, collection: 'katalog', id, data });
          await logAction(ctx, { action: 'articles.create', entityType: 'katalog', entityId: id, newValue: data, status: 'success' });
          return okResponse(articleToApi(created), 201);
        }
        if (request.method === 'PATCH' && teile[1]) {
          const existing = await firestoreGet({ accessToken, projectId, collection: 'katalog', id: teile[1] });
          if (!existing) return errorResponse('ARTICLE_NOT_FOUND', 'Artikel/Leistung wurde nicht gefunden.', 404);
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          const changes = {};
          if (body.name !== undefined) changes.bezeichnung = body.name;
          if (body.description !== undefined) changes.beschreibung = body.description;
          if (body.unit !== undefined) changes.einheit = body.unit;
          if (body.purchase_price !== undefined) changes.einkaufspreis = Number(body.purchase_price);
          if (body.markup_percent !== undefined) changes.aufschlagProzent = Number(body.markup_percent);
          if (body.sales_price !== undefined) changes.preis = Number(body.sales_price);
          if (body.vat_rate !== undefined) changes.steuersatz = Number(body.vat_rate);
          if (body.trade !== undefined) changes.gewerk = body.trade;
          if (body.min_stock !== undefined) changes.mindestbestand = Number(body.min_stock);
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben.', 400);
          // bestand/bestandTracking bewusst nicht über diesen generischen Katalog-PATCH
          // änderbar - Bestandsänderungen laufen ausschließlich über den eigenen
          // stock-movements-Endpunkt, damit jede Änderung eine nachvollziehbare
          // Lagerbewegung erzeugt statt den Bestand kommentarlos zu überschreiben.
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'katalog', id: teile[1], data: changes });
          await logAction(ctx, { action: 'articles.update', entityType: 'katalog', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(articleToApi(updated));
        }
        if (request.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'Methode nicht unterstützt.', 405);
        if (teile[1]) {
          const artikel = await firestoreGet({ accessToken, projectId, collection: 'katalog', id: teile[1] });
          if (!artikel) return errorResponse('ARTICLE_NOT_FOUND', 'Artikel/Leistung wurde nicht gefunden.', 404);
          await logAction(ctx, { action: 'articles.get', entityType: 'katalog', entityId: teile[1], status: 'success' });
          return okResponse(articleToApi(artikel));
        }
        let katalog = await firestoreList({ accessToken, projectId, collection: 'katalog' });
        if (teile[0] === 'articles') katalog = katalog.filter((k) => k.typ === 'artikel');
        if (teile[0] === 'services') katalog = katalog.filter((k) => k.typ === 'leistung');
        const gewerk = q.get('trade');
        if (gewerk) katalog = katalog.filter((k) => k.gewerk === gewerk);
        if (q.get('low_stock') === 'true') katalog = katalog.filter((k) => k.bestandTracking && Number(k.bestand ?? 0) <= Number(k.mindestbestand ?? 0));
        await logAction(ctx, { action: `${teile[0]}.search`, status: 'success' });
        // Bei count=true nur die Anzahl liefern statt der vollen Liste - eine simple
        // "Wie viele Artikel haben wir?"-Frage soll nicht am ChatGPT-Antwortlimit
        // scheitern, wenn der Katalog groß ist. limit begrenzt aus demselben Grund
        // auch die normale Listenausgabe (Default/Maximum 100).
        if (q.get('count') === 'true') return okResponse({ count: katalog.length });
        const limit = Math.min(Number(q.get('limit')) || 100, 100);
        return okResponse(katalog.slice(0, limit).map(articleToApi));
      }

      // --- Mitarbeiter (Vorgabe Abschnitt 27 - eingeschränkte Felder, keine sensiblen Personaldaten) ---
      if (teile[0] === 'employees') {
        if (request.method === 'PATCH' && teile[1]) {
          const existing = await firestoreGet({ accessToken, projectId, collection: 'mitarbeiter', id: teile[1] });
          if (!existing) return errorResponse('EMPLOYEE_NOT_FOUND', 'Mitarbeiter wurde nicht gefunden.', 404);
          let body; try { body = await request.json(); } catch { return errorResponse('INVALID_BODY', 'Ungültiger JSON-Body.', 400); }
          // Bewusst nur unkritische Stammdaten - keine Gehalts-/Steuer-/SV-Felder, keine
          // Zugriffsrolle (Berechtigungen bleiben Admin-Sache, nicht per KI änderbar).
          const changes = {};
          if (body.name !== undefined) changes.name = body.name;
          if (body.trade !== undefined) changes.rolle = body.trade;
          if (body.phone !== undefined) changes.telefon = body.phone;
          if (body.email !== undefined) changes.email = body.email;
          if (Object.keys(changes).length === 0) return errorResponse('VALIDATION_ERROR', 'Keine bekannten Felder zum Aktualisieren übergeben (erlaubt: name, trade, phone, email).', 400);
          const updated = await firestoreUpdate({ accessToken, projectId, collection: 'mitarbeiter', id: teile[1], data: changes });
          await logAction(ctx, { action: 'employees.update', entityType: 'mitarbeiter', entityId: teile[1], oldValue: existing, newValue: changes, status: 'success' });
          return okResponse(employeeToApi(updated, false));
        }
        if (request.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'Nur unkritische Stammdaten (name, trade, phone, email) sind änderbar - Gehalts-/Steuer-/SV-Daten und Berechtigungen nur direkt in Werkora.', 405);
        const [mitarbeiter, termine] = await Promise.all([
          firestoreList({ accessToken, projectId, collection: 'mitarbeiter' }),
          firestoreList({ accessToken, projectId, collection: 'termine' }),
        ]);
        const heute = todayISO();
        const onLeaveIds = new Set(termine.filter((t) => t.typ === 'urlaub' && (t.start || '').slice(0, 10) <= heute && (t.ende || t.start || '').slice(0, 10) >= heute).flatMap((t) => t.mitarbeiterIds || []));
        let liste = mitarbeiter.map((m) => employeeToApi(m, onLeaveIds.has(m.id)));
        if (teile[1]) {
          const one = liste.find((m) => m.id === teile[1]);
          if (!one) return errorResponse('EMPLOYEE_NOT_FOUND', 'Mitarbeiter wurde nicht gefunden.', 404);
          await logAction(ctx, { action: 'employees.get', entityType: 'mitarbeiter', entityId: teile[1], status: 'success' });
          return okResponse(one);
        }
        await logAction(ctx, { action: 'employees.search', status: 'success' });
        return okResponse(liste);
      }

      return errorResponse('NOT_FOUND', `Unbekannter Endpunkt: ${request.method} ${url.pathname}`, 404);
    } catch (err) {
      return errorResponse('SERVER_ERROR', err.message || 'Unbekannter Fehler', 500);
    }
  },

  /**
   * Cron-Jobs (siehe README.md für die Einrichtung im Cloudflare Dashboard).
   * Vier unabhängige Cron-Ausdrücke laufen auf denselben Handler, unter-
   * schieden über event.cron:
   *  - "0 6 * * *"     (alle Tage, 06:00 UTC): bestehende überfällige-
   *                     Rechnungen/Aufgaben-Webhooks (unverändert).
   *  - "0 6 * * 1-5"   (Mo-Fr, 06:00 UTC = 08:00 CEST/07:00 CET): Morgenroutine.
   *  - "0 10 * * 1-5"  (Mo-Fr, 10:00 UTC = 12:00 CEST/11:00 CET): Mittagscheck.
   *  - "0 14 * * 1-5"  (Mo-Fr, 14:00 UTC = 16:00 CEST/15:00 CET): Tagesabschluss.
   * Die UTC-Zeiten sind bewusst fix gewählt (wie beim bestehenden 06:00-Cron)
   * und weichen daher in der Winterzeit ca. 1 Stunde von der genannten
   * deutschen Uhrzeit ab.
   */
  async scheduled(event, env) {
    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return;
    try {
      if (event.cron === '0 6 * * 1-5') { await runBueroCheck(env, 'morgen'); return; }
      if (event.cron === '0 10 * * 1-5') { await runBueroCheck(env, 'mittag'); return; }
      if (event.cron === '0 14 * * 1-5') { await runBueroCheck(env, 'abend'); return; }

      // "0 6 * * *" (Standard, falls im Dashboard kein Trigger-Text ankommt) -
      // bestehende überfällige-Rechnungen/Aufgaben-Webhooks.
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
      const projectId = serviceAccount.project_id;
      const ctx = { accessToken, projectId, ip: '' };
      const heute = todayISO();

      const rechnungen = await firestoreList({ accessToken, projectId, collection: 'rechnungen' });
      for (const r of rechnungen) {
        const ueberfaellig = RECHNUNG_OFFEN_STATUS.includes(r.status) && r.faelligAm && r.faelligAm < heute;
        if (ueberfaellig && !r.kiWebhookOverdueSentAt) {
          await fireWebhook(ctx, 'invoice.overdue', invoiceToApi(r));
          await firestoreUpdate({ accessToken, projectId, collection: 'rechnungen', id: r.id, data: { kiWebhookOverdueSentAt: new Date().toISOString() } });
        }
      }

      const aufgaben = await firestoreList({ accessToken, projectId, collection: 'aufgaben' });
      for (const a of aufgaben) {
        const ueberfaellig = !AUFGABEN_STATUS_GESCHLOSSEN.includes(a.status) && a.faelligAm && a.faelligAm < heute;
        if (ueberfaellig && !a.kiWebhookOverdueSentAt) {
          await fireWebhook(ctx, 'task.overdue', taskToApi(a));
          await firestoreUpdate({ accessToken, projectId, collection: 'aufgaben', id: a.id, data: { kiWebhookOverdueSentAt: new Date().toISOString() } });
        }
      }
    } catch {
      // Cron darf nicht laut fehlschlagen - beim nächsten Lauf wird es erneut versucht.
    }
  },
};

/** Hilfsfunktion nur für den GET-/invoices-Filter (nutzt dieselbe Status-Übersetzung wie invoiceToApi). */
function quoteToApiInvoiceStatus(r) {
  return invoiceToApi(r).status;
}
