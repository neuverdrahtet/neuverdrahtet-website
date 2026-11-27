// Eigenständige Seite für den Link aus der "Passwort vergessen"-E-Mail
// (siehe selfhostClient.js forgotPassword()/resetPassword() und
// selfhost-server/server.js) - absichtlich ohne Abhängigkeit vom Rest der
// App (kein main.js, keine Sidebar), analog zu verwaltung/portal/portal.js.
import * as selfhost from './selfhostClient.js';

const form = document.getElementById('reset-form');
const passwordInput = document.getElementById('reset-password');
const confirmInput = document.getElementById('reset-password-confirm');
const error = document.getElementById('reset-error');
const hint = document.getElementById('reset-hint');
const submitBtn = document.getElementById('reset-submit');

const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
  form.hidden = true;
  error.textContent = 'Dieser Link ist unvollständig. Bitte den Link direkt aus der E-Mail öffnen.';
  error.hidden = false;
} else {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const password = passwordInput.value;
    if (password !== confirmInput.value) {
      error.textContent = 'Die beiden Passwörter stimmen nicht überein.';
      error.hidden = false;
      return;
    }
    submitBtn.disabled = true;
    try {
      await selfhost.resetPassword(token, password);
      form.hidden = true;
      hint.textContent = 'Passwort gesetzt - du kannst dich jetzt damit anmelden.';
      hint.hidden = false;
      const link = document.createElement('a');
      link.href = 'index.html';
      link.className = 'lock-toggle';
      link.textContent = 'Zur Anmeldung';
      hint.insertAdjacentElement('afterend', link);
    } catch (err) {
      error.textContent = err.message || 'Unbekannter Fehler.';
      error.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
