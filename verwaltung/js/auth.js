import { getSettings } from './db.js';

export function initLock() {
  return new Promise(async (resolve) => {
    const settings = await getSettings();
    const passcode = settings.passcode;
    if (!passcode) return resolve();
    if (sessionStorage.getItem('nv-unlocked') === '1') return resolve();

    const lockScreen = document.getElementById('lock-screen');
    const form = document.getElementById('lock-form');
    const input = document.getElementById('lock-input');
    const error = document.getElementById('lock-error');
    lockScreen.hidden = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value === passcode) {
        sessionStorage.setItem('nv-unlocked', '1');
        lockScreen.hidden = true;
        resolve();
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
  sessionStorage.removeItem('nv-unlocked');
  window.location.reload();
}
