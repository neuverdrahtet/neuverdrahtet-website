// Facebook/Instagram-Verbindung für die direkte Veröffentlichung von
// Social-Media-Posts (verwaltung/js/views/social.js). Läuft nach exakt
// demselben Prinzip wie die bestehende Google-Verbindung (google.js):
// Anmeldung komplett im Browser über das offizielle SDK der Plattform, kein
// eigener Server hält ein App-Secret. Die Verbindung gilt nur für die
// aktuelle Browser-Sitzung - nach Ablauf des kurzlebigen Facebook-Tokens
// muss man sich erneut verbinden.

import { getSettings } from './db.js';
import { openModal } from './ui.js';

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',');

const GRAPH_API_VERSION = 'v21.0';

let fbSdkLoadPromise = null;
let cachedSettings = null;

// Verbindungszustand - bewusst NICHT in localStorage, da der Facebook-
// Seiten-Token ohnehin nur kurzlebig ist (siehe Kommentar oben) und ein
// Neuladen der Seite ohnehin eine erneute Anmeldung sinnvoll macht.
let state = null; // { pageId, pageName, pageAccessToken, expiresAt, instagramUserId, instagramUsername }

export function isConnected() {
  return !!state && Date.now() < state.expiresAt;
}

export function getConnection() {
  return isConnected() ? state : null;
}

export async function isConfigured() {
  const settings = cachedSettings || await getSettings();
  return !!(settings.metaAppId && settings.socialPublishWorkerUrl && settings.socialPublishAppSecret);
}

export function updateCachedSettings(patch) {
  cachedSettings = { ...(cachedSettings || {}), ...patch };
}

export function preload() {
  getSettings().then((settings) => {
    cachedSettings = settings;
    if (settings.metaAppId) loadFbSdk(settings.metaAppId).catch(() => { /* connect() versucht es beim Klick erneut */ });
  }).catch(() => { /* Vorladen ist ein Komfort-Feature, darf den Start nicht stören */ });
}

function loadFbSdk(appId) {
  if (fbSdkLoadPromise) return fbSdkLoadPromise;
  fbSdkLoadPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      resolve();
      return;
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId, version: GRAPH_API_VERSION, xfbml: false, cookie: false });
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/de_DE/sdk.js';
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Facebook-Anmeldeskript konnte nicht geladen werden.'));
    document.head.appendChild(script);
  });
  return fbSdkLoadPromise;
}

function fbLogin() {
  return new Promise((resolve, reject) => {
    window.FB.login((resp) => {
      if (resp.authResponse) {
        resolve(resp.authResponse);
      } else {
        reject(new Error('Facebook-Anmeldung abgebrochen oder abgelehnt.'));
      }
    }, { scope: SCOPES });
  });
}

function fbApi(path, params = {}) {
  return new Promise((resolve, reject) => {
    window.FB.api(path, params, (resp) => {
      if (!resp || resp.error) {
        reject(new Error(resp?.error?.message || 'Facebook-API-Fehler.'));
      } else {
        resolve(resp);
      }
    });
  });
}

/** Zeigt eine Auswahl, falls mehrere Facebook-Seiten verfügbar sind. */
function waehleSeite(pages) {
  if (pages.length <= 1) return Promise.resolve(pages[0] || null);
  return new Promise((resolve) => {
    const { body, close } = openModal({
      title: 'Facebook-Seite wählen',
      bodyHtml: `
        <p class="hint">Es sind mehrere Facebook-Seiten mit diesem Konto verknüpft - welche soll Werkora für Posts verwenden?</p>
        <div class="chip-picker-results">
          ${pages.map((p, i) => `<div class="chip-picker-result" data-i="${i}"><span class="chip-picker-result-label">${p.name}</span></div>`).join('')}
        </div>
      `,
    });
    body.querySelectorAll('.chip-picker-result').forEach((row) => {
      row.addEventListener('click', () => {
        resolve(pages[Number(row.dataset.i)]);
        close();
      });
    });
  });
}

/** Meldet an, wählt die Facebook-Seite und lädt das ggf. verknüpfte Instagram-Business-Konto. */
export async function connect() {
  let settings = cachedSettings;
  if (!settings?.metaAppId) {
    settings = await getSettings();
    cachedSettings = settings;
  }
  if (!settings.metaAppId) {
    throw new Error('Bitte zuerst in den Einstellungen die Meta App-ID hinterlegen.');
  }
  await loadFbSdk(settings.metaAppId);
  const auth = await fbLogin();
  const accountsResp = await fbApi('/me/accounts', { access_token: auth.accessToken, fields: 'id,name,access_token' });
  const pages = accountsResp.data || [];
  if (pages.length === 0) {
    throw new Error('Keine Facebook-Seite gefunden, für die dieses Konto Administrator ist.');
  }
  const seite = await waehleSeite(pages);
  if (!seite) throw new Error('Keine Seite ausgewählt.');

  let instagramUserId = '';
  let instagramUsername = '';
  try {
    const igResp = await fbApi(`/${seite.id}`, { fields: 'instagram_business_account{id,username}', access_token: seite.access_token });
    if (igResp.instagram_business_account) {
      instagramUserId = igResp.instagram_business_account.id;
      instagramUsername = igResp.instagram_business_account.username || '';
    }
  } catch {
    // Kein verknüpftes Instagram-Konto - Facebook-Veröffentlichung bleibt trotzdem nutzbar
  }

  state = {
    pageId: seite.id,
    pageName: seite.name,
    pageAccessToken: seite.access_token,
    expiresAt: Date.now() + (Number(auth.expiresIn) || 3600) * 1000 - 30000,
    instagramUserId,
    instagramUsername,
  };
  return state;
}

export function disconnect() {
  if (window.FB) {
    try { window.FB.logout(); } catch { /* SDK evtl. nie erfolgreich angemeldet */ }
  }
  state = null;
}
