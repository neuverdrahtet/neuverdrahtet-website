/**
 * neuverdrahtet-social-publish (Cloudflare Worker)
 *
 * Schlanker Proxy, der einen von Werkora bereits im Browser erzeugten
 * Facebook-Seiten-Zugriffstoken entgegennimmt und damit ein Foto + Text auf
 * einer Facebook-Seite bzw. dem verknüpften Instagram-Business-Konto
 * veröffentlicht (Graph API von Meta).
 *
 * WICHTIG: Dieser Worker kennt KEIN Meta-App-Secret und braucht auch keins -
 * die eigentliche Anmeldung (Facebook-Login, Seiten-/Instagram-Auswahl)
 * läuft komplett im Browser über das Facebook-JavaScript-SDK, genau wie die
 * bestehende Google-Verbindung (Kalender/Gmail) in Werkora. Der fertige
 * Seiten-Zugriffstoken kommt hier nur noch als ganz normaler Parameter mit -
 * dieser Worker existiert einzig, weil Meta's Graph-API-Schreibendpunkte
 * (Foto/Media veröffentlichen) aus dem Browser heraus nicht zuverlässig per
 * CORS erreichbar sind; ein serverseitiger Aufruf hat dieses Problem nicht.
 *
 * Instagram verlangt für den Medien-Upload zusätzlich eine ÖFFENTLICH
 * erreichbare Bild-URL (kein Datei-Upload direkt) - Werkora lädt das
 * gebrandete Bild dafür vorher nach Firebase Storage hoch und übergibt hier
 * nur die resultierende URL.
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   APP_SECRET       (Secret, erforderlich) - beliebiger, selbst gewählter
 *                     langer Zufallswert; muss exakt mit dem Feld
 *                     "App-Secret" bei Werkora -> Einstellungen ->
 *                     Social-Media-Veröffentlichung übereinstimmen.
 *   ALLOWED_ORIGINS  (Variable, optional) - Komma-getrennte Liste erlaubter
 *                     Herkünfte, Standard: https://neuverdrahtet.com,https://www.neuverdrahtet.com
 *
 * Deployment: siehe README.md in diesem Ordner.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://neuverdrahtet.com',
  'https://www.neuverdrahtet.com',
];

const GRAPH_API_VERSION = 'v21.0';

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

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

/** Veröffentlicht ein Foto (per öffentlicher URL) auf einer Facebook-Seite. */
async function publishFacebookPhoto({ pageId, pageAccessToken, imageUrl, message }) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`);
  url.searchParams.set('url', imageUrl);
  if (message) url.searchParams.set('caption', message);
  url.searchParams.set('access_token', pageAccessToken);
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Facebook-API-Fehler (${res.status})`);
  }
  return { postId: data.post_id || data.id, link: `https://www.facebook.com/${data.post_id || data.id}` };
}

/** Veröffentlicht ein Foto auf dem mit der Seite verknüpften Instagram-Business-Konto (zweistufig: Container erzeugen, dann veröffentlichen). */
async function publishInstagramPhoto({ igUserId, pageAccessToken, imageUrl, caption }) {
  const createUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media`);
  createUrl.searchParams.set('image_url', imageUrl);
  if (caption) createUrl.searchParams.set('caption', caption);
  createUrl.searchParams.set('access_token', pageAccessToken);
  const createRes = await fetch(createUrl, { method: 'POST' });
  const createData = await createRes.json();
  if (!createRes.ok || createData.error) {
    throw new Error(createData.error?.message || `Instagram-API-Fehler beim Erstellen (${createRes.status})`);
  }

  const publishUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media_publish`);
  publishUrl.searchParams.set('creation_id', createData.id);
  publishUrl.searchParams.set('access_token', pageAccessToken);
  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    throw new Error(publishData.error?.message || `Instagram-API-Fehler beim Veröffentlichen (${publishRes.status})`);
  }
  return { postId: publishData.id, link: null }; // Instagram liefert keinen direkten Web-Link zum Post zurück
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
      return jsonResponse({ error: 'Origin nicht erlaubt.' }, 403, headers);
    }
    if (!env.APP_SECRET || request.headers.get('X-App-Secret') !== env.APP_SECRET) {
      return jsonResponse({ error: 'Nicht autorisiert.' }, 401, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Ungültiger Request-Body.' }, 400, headers);
    }

    try {
      if (body.action === 'facebook-publish') {
        if (!body.pageId || !body.pageAccessToken || !body.imageUrl) {
          return jsonResponse({ error: 'pageId, pageAccessToken und imageUrl sind erforderlich.' }, 400, headers);
        }
        const result = await publishFacebookPhoto(body);
        return jsonResponse(result, 200, headers);
      }
      if (body.action === 'instagram-publish') {
        if (!body.igUserId || !body.pageAccessToken || !body.imageUrl) {
          return jsonResponse({ error: 'igUserId, pageAccessToken und imageUrl sind erforderlich.' }, 400, headers);
        }
        const result = await publishInstagramPhoto(body);
        return jsonResponse(result, 200, headers);
      }
      return jsonResponse({ error: 'Unbekannte Aktion.' }, 400, headers);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500, headers);
    }
  },
};
