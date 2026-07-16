import { getSettings, getAll } from './db.js';
import { setCurrentMitarbeiterId } from './utils.js';

const SESSION_KEY = 'nv-unlocked-session';

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function initLock() {
  return new Promise(async (resolve) => {
    const [settings, mitarbeiter] = await Promise.all([getSettings(), getAll('mitarbeiter')]);
    const hasProtection = !!settings.passcode || mitarbeiter.some((m) => m.zugangscode);
    if (!hasProtection) {
      resolve({ role: 'admin', mitarbeiterId: null });
      return;
    }
    const existing = getSession();
    if (existing) {
      resolve(existing);
      return;
    }

    const lockScreen = document.getElementById('lock-screen');
    const form = document.getElementById('lock-form');
    const input = document.getElementById('lock-input');
    const error = document.getElementById('lock-error');
    lockScreen.hidden = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value;
      let session = null;
      if (settings.passcode && code === settings.passcode) {
        session = { role: 'admin', mitarbeiterId: null };
      } else {
        const match = mitarbeiter.find((m) => m.zugangscode && m.zugangscode === code);
        if (match) session = { role: match.zugriffsrolle || 'mitarbeiter', mitarbeiterId: match.id, name: match.name };
      }
      if (session) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        if (session.mitarbeiterId) setCurrentMitarbeiterId(session.mitarbeiterId);
        lockScreen.hidden = true;
        resolve(session);
      } else {
        error.hidden = false;
        input.value = '';
        input.focus();
      }
    });
    input.focus();
  });
}

export function lockNow() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.reload();
}
