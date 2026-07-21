import { getSettings } from './db.js';

// lexoffice (Lexware Office) Public API: Auth läuft über einen persönlichen
// API-Key (Bearer-Token), den der Nutzer einmalig in seinem lexoffice-Konto
// unter "Einstellungen -> Öffentliche API" erzeugt - kein OAuth2-Flow nötig,
// da es sich um eine reine Ein-Konto-Anbindung handelt (kein Multi-Tenant-
// Marktplatz-Produkt). Der Key wird wie andere Verbindungsdaten (Google
// Client-ID, KI-Worker-Secret) direkt in den Settings gespeichert.
const API_BASE = 'https://api.lexoffice.io/v1';

export async function isConfigured() {
  const settings = await getSettings();
  return !!settings.lexofficeApiKey;
}

async function apiFetch(path, options = {}) {
  const settings = await getSettings();
  if (!settings.lexofficeApiKey) {
    throw new Error('Bitte zuerst in den Einstellungen den lexoffice-API-Key hinterlegen.');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${settings.lexofficeApiKey}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 401) {
    throw new Error('lexoffice-API-Key ungültig oder abgelaufen. Bitte in den Einstellungen prüfen.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`lexoffice-API-Fehler (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Leichter Testaufruf für den "Verbindung testen"-Button in den Einstellungen. */
export async function testConnection() {
  return apiFetch('/profile');
}

/** Lädt alle Artikel (Material/Leistungen mit Preisen) aus lexoffice, paginiert. */
export async function fetchArtikel() {
  const all = [];
  let page = 0;
  for (;;) {
    const data = await apiFetch(`/articles?page=${page}&size=100`);
    all.push(...(data.content || []));
    if (data.last !== false || !data.content?.length) break;
    page += 1;
  }
  return all;
}

/** Sucht Kontakte in lexoffice per Name (für den Kunden-Abgleich beim Rechnungsentwurf). */
export async function searchContacts(name) {
  const params = new URLSearchParams({ name });
  const data = await apiFetch(`/contacts?${params}`);
  return data.content || [];
}

/**
 * Erstellt einen Rechnungsentwurf (nicht finalisiert/versendet) in lexoffice.
 * lineItems: [{ type: 'material', id: lexofficeArtikelId, quantity, unitName }]
 *   oder [{ type: 'text', name, description }] für reine Hinweiszeilen.
 * Preise werden NICHT mitgeschickt - bei type "material" zieht lexoffice den
 * Preis automatisch aus dem eigenen Artikelstamm.
 */
export async function createInvoiceDraft({ contactId, lineItems, remark }) {
  return apiFetch('/invoices?finalize=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      archived: false,
      voucherDate: new Date().toISOString(),
      address: { contactId },
      lineItems,
      totalPrice: { currency: 'EUR' },
      taxConditions: { taxType: 'net' },
      remark: remark || '',
    }),
  });
}
