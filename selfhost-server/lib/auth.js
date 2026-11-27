// Eigene, schlanke Session-Auth als Ersatz für Firebase Auth - bewusst ohne
// externe Abhängigkeit (nur node:crypto). Deckt das ab, was die App bisher
// wirklich nutzt (siehe verwaltung/js/auth.js + employeeAuth.js): Login per
// E-Mail+Passwort, Einladungs-basierte Registrierung für Mitarbeiter/Kunden,
// Rolle+mitarbeiterId/kundeId in der Session.
//
// NICHT portiert (siehe README.md "Bekannte Lücken"): Zwei-Faktor/TOTP und
// "Passwort vergessen"-E-Mail - beides ließe sich nachrüsten, war für die
// erste lauffähige Version aber bewusst zurückgestellt.
import { scryptSync, randomBytes, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAuth(secret) {
  function createSessionCookie(session) {
    const payload = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + SESSION_MAX_AGE_MS })).toString('base64url');
    const sig = sign(payload, secret);
    return `${payload}.${sig}`;
  }

  function readSessionCookie(cookieValue) {
    if (!cookieValue) return null;
    const [payload, sig] = cookieValue.split('.');
    if (!payload || !sig) return null;
    // timingSafeEqual statt !==: ein normaler String-Vergleich bricht beim
    // ersten abweichenden Byte ab und lässt sich über die Antwortzeit als
    // Seitenkanal ausnutzen, um die Signatur Byte für Byte zu erraten - wie
    // beim Passwort-Hash oben wird deshalb auch hier zeitkonstant verglichen.
    const erwartet = Buffer.from(sign(payload, secret));
    const erhalten = Buffer.from(sig);
    if (erwartet.length !== erhalten.length || !timingSafeEqual(erwartet, erhalten)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!session.exp || session.exp < Date.now()) return null;
      return session;
    } catch {
      return null;
    }
  }

  return { createSessionCookie, readSessionCookie };
}

export function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export { randomUUID };
