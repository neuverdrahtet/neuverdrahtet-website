/**
 * neuverdrahtet Werkora – Qonto-Zahlungsabgleich (Cloudflare Worker)
 *
 * Reiner Vermittler zur Qonto-Business-API: hält den Qonto-API-Schlüssel
 * server-seitig (NIEMALS im Browser), ruft eingehende Kontobewegungen ab und
 * liefert sie an die Werkora-Oberfläche zurück. Der eigentliche Abgleich mit
 * offenen Rechnungen (Betrag, Vorschlag, Bestätigen/Ablehnen) passiert bewusst
 * NICHT hier, sondern im Browser (siehe verwaltung/js/views/zahlungsabgleich.js)
 * - so laufen alle Schreibvorgänge (Rechnung als bezahlt markieren) über die
 * normale, bereits mit Firestore-Security-Rules abgesicherte App-Anmeldung,
 * statt dass dieser Worker mit einem Service-Account (voller Zugriff, umgeht
 * die Regeln) Geld-relevante Daten selbst verändert.
 *
 * Qonto bucht KEINE automatischen Zahlungen fest und kann das auch nicht -
 * dieser Worker liest nur, was Qonto an Kontobewegungen meldet.
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   QONTO_LOGIN         (Secret, erforderlich) – der "Login"-Teil aus Qonto
 *                        (App -> Einstellungen -> API -> "API-Schlüssel
 *                        erstellen"), sieht aus wie "firmenname-1234".
 *   QONTO_SECRET_KEY    (Secret, erforderlich) – der dazugehörige geheime
 *                        Schlüssel, wird bei der Erstellung nur einmal
 *                        angezeigt.
 *   APP_SECRET          (Secret, erforderlich) – frei wählbares Passwort,
 *                        das auch in Werkora (Einstellungen) hinterlegt wird.
 *   ALLOWED_ORIGINS      (Variable, optional) – Komma-getrennte Liste
 *                        erlaubter Herkünfte, Standard:
 *                        https://neuverdrahtet.com,https://www.neuverdrahtet.com
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
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
    'Vary': 'Origin',
  };
}

async function qontoFetch(env, path) {
  const res = await fetch(`https://thirdparty.qonto.com/v2${path}`, {
    headers: {
      Authorization: `${env.QONTO_LOGIN}:${env.QONTO_SECRET_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Qonto-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Liefert die Konto-IDs der Organisation (für den Transaktions-Filter). */
async function getBankAccountIds(env) {
  const data = await qontoFetch(env, '/organization');
  const konten = data.organization?.bank_accounts || [];
  return konten.map((k) => k.id).filter(Boolean);
}

/**
 * Holt eingehende (Gutschrift-)Transaktionen der letzten `tage` Tage über
 * alle Konten der Organisation, neueste zuerst. Qonto paginiert mit bis zu
 * 100 Einträgen pro Seite - für den Anwendungsfall (Zahlungsabgleich der
 * letzten paar Wochen) reicht die erste Seite je Konto in aller Regel aus.
 */
async function getEingehendeTransaktionen(env, tage) {
  const bankAccountIds = await getBankAccountIds(env);
  const von = new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString();
  const alle = [];
  for (const bankAccountId of bankAccountIds) {
    const params = new URLSearchParams({
      bank_account_id: bankAccountId,
      'status[]': 'completed',
      side: 'credit',
      settled_at_from: von,
      per_page: '100',
    });
    const data = await qontoFetch(env, `/transactions?${params.toString()}`);
    for (const t of data.transactions || []) {
      alle.push({
        transactionId: t.transaction_id,
        betrag: t.amount,
        waehrung: t.amount_currency,
        datum: t.settled_at,
        gegenpart: t.label || t.counterparty_name || '',
        referenz: t.reference || '',
      });
    }
  }
  alle.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  return alle;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers });
    }
    if (!getAllowedOrigins(env).includes(origin)) {
      return new Response(JSON.stringify({ error: 'Origin nicht erlaubt.' }), {
        status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!env.APP_SECRET || request.headers.get('X-App-Secret') !== env.APP_SECRET) {
      return new Response(JSON.stringify({ error: 'Nicht autorisiert.' }), {
        status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!env.QONTO_LOGIN || !env.QONTO_SECRET_KEY) {
      return new Response(JSON.stringify({ error: 'Worker ist nicht korrekt eingerichtet (QONTO_LOGIN/QONTO_SECRET_KEY fehlt).' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    try {
      const transaktionen = await getEingehendeTransaktionen(env, Math.min(Math.max(Number(body.tage) || 30, 1), 90));
      return new Response(JSON.stringify({ transaktionen }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
