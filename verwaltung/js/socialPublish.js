import { getSettings } from './db.js';

async function callWorker(action, payload) {
  const settings = await getSettings();
  if (!settings.socialPublishWorkerUrl || !settings.socialPublishAppSecret) {
    throw new Error('Direktes Veröffentlichen ist noch nicht eingerichtet (Einstellungen → Social-Media-Veröffentlichung).');
  }
  const res = await fetch(settings.socialPublishWorkerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': settings.socialPublishAppSecret,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}

/** Veröffentlicht ein Foto (per öffentlicher URL) auf einer Facebook-Seite. Gibt { postId, link } zurück. */
export function publishToFacebook({ pageId, pageAccessToken, imageUrl, message }) {
  return callWorker('facebook-publish', { pageId, pageAccessToken, imageUrl, message });
}

/** Veröffentlicht ein Foto auf dem verknüpften Instagram-Business-Konto. Gibt { postId } zurück (kein direkter Web-Link von Instagram geliefert). */
export function publishToInstagram({ igUserId, pageAccessToken, imageUrl, caption }) {
  return callWorker('instagram-publish', { igUserId, pageAccessToken, imageUrl, caption });
}
