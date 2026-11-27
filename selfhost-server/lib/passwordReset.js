// "Passwort vergessen" - Ersatz für Firebase Auth's sendPasswordResetEmail().
// Token liegt als normale Collection ('passwordResets') in derselben SQLite-
// Datenbank wie alles andere - kein separater Speicher nötig.
import { randomBytes } from 'node:crypto';

const TOKEN_GUELTIG_MS = 60 * 60 * 1000; // 1 Stunde

export function createResetToken(store, email) {
  const token = randomBytes(32).toString('hex');
  store.put('passwordResets', { id: token, email, expiresAt: Date.now() + TOKEN_GUELTIG_MS });
  return token;
}

// Einmal verwendbar: wird bei Erfolg UND bei einem abgelaufenen Fund gelöscht.
export function consumeResetToken(store, token) {
  const eintrag = store.get('passwordResets', token);
  if (!eintrag) return null;
  store.remove('passwordResets', token);
  if (eintrag.expiresAt < Date.now()) return null;
  return eintrag.email;
}
