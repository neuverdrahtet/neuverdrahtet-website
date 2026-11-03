// Maßnahme 8 (MFA, November 2026): persönliche Konto-Sicherheitsseite, für
// JEDE Rolle erreichbar (bewusst KEIN Eintrag in db.js ROUTE_ROLLEN - siehe
// hasRouteAccess(): eine Route ohne Eintrag ist für alle Rollen erlaubt).
// Zwei-Faktor-Authentifizierung (TOTP, z.B. Google Authenticator) ist
// FREIWILLIG (opt-in) - jeder Nutzer aktiviert sie selbst für sein eigenes
// Konto, es gibt (bewusst, erste Ausbaustufe) keine Pflicht für bestimmte
// Rollen. Setzt voraus, dass TOTP-MFA im Firebase-Projekt selbst aktiviert
// ist (Firebase-Konsole -> Authentication -> Sign-in method) - ohne das
// schlägt generateSecret() mit einem Firebase-Fehler fehl, den wir dem
// Nutzer direkt anzeigen.
import { toast, escapeHtml, formatDateTime } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { renderQrPngDataUrl } from '../qrcode.js';

const MFA_FEHLER_MELDUNGEN = {
  'auth/invalid-verification-code': 'Der Code ist falsch oder abgelaufen. Bitte den aktuellen Code aus der App eingeben.',
  'auth/code-expired': 'Der Code ist abgelaufen. Bitte den aktuellen Code aus der App eingeben.',
  'auth/second-factor-already-in-use': 'Dieser Faktor ist bereits für dieses Konto aktiv.',
  'auth/maximum-second-factor-count-exceeded': 'Es ist bereits die maximale Anzahl an Zwei-Faktor-Methoden aktiv.',
};

export async function render(container) {
  const [{ auth }, authMod] = await Promise.all([
    import('../firebase.js'),
    import('../vendor/firebase/firebase-auth.js'),
  ]);
  const {
    multiFactor, TotpMultiFactorGenerator, EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification,
  } = authMod;
  const user = auth.currentUser;

  if (!user) {
    container.innerHTML = '<div class="empty-state">Nicht angemeldet.</div>';
    return;
  }

  // Sensible Aktionen (enroll/unenroll) verlangt Firebase nur bei einer
  // nicht mehr ganz frischen Sitzung erneut ein Passwort (auth/requires-
  // recent-login) - fängt das genau EINMAL ab und fragt dann nach, statt
  // dass der Nutzer selbst neu einloggen müsste.
  async function mitReauthBeiBedarf(aktion) {
    try {
      return await aktion();
    } catch (err) {
      if (err.code !== 'auth/requires-recent-login') throw err;
      await fordereErneuteAnmeldungAn();
      return await aktion();
    }
  }

  function fordereErneuteAnmeldungAn() {
    return new Promise((resolve, reject) => {
      const { body, close } = openModal({
        title: 'Bitte erneut anmelden',
        bodyHtml: `
          <p class="hint">Diese sicherheitsrelevante Aktion erfordert eine kürzliche Anmeldung. Bitte dein Passwort zur Bestätigung erneut eingeben.</p>
          <form id="reauth-form">
            <div class="field"><label>Passwort</label><input type="password" name="password" required minlength="6" autocomplete="current-password"></div>
            <div class="modal-actions">
              <span class="spacer"></span>
              <button type="button" class="btn" id="reauth-cancel">Abbrechen</button>
              <button type="submit" class="btn btn-primary">Bestätigen</button>
            </div>
          </form>
        `,
      });
      body.querySelector('#reauth-cancel').addEventListener('click', () => { close(); reject(new Error('Abgebrochen')); });
      body.querySelector('#reauth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = (new FormData(e.target).get('password') || '').toString();
        const submitBtn = e.target.querySelector('button[type=submit]');
        submitBtn.disabled = true;
        try {
          const cred = EmailAuthProvider.credential(user.email, password);
          await reauthenticateWithCredential(user, cred);
          close();
          resolve();
        } catch (err) {
          toast(`Anmeldung fehlgeschlagen: ${err.message || err}`, 'danger');
          submitBtn.disabled = false;
        }
      });
    });
  }

  function findeTotpFaktor() {
    return multiFactor(user).enrolledFactors.find((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  }

  async function openEnrollModal() {
    // Firebase verlangt eine BESTÄTIGTE E-Mail-Adresse, bevor überhaupt ein
    // zweiter Faktor eingeschrieben werden darf (auth/unverified-email) -
    // das gilt genauso in echten Produktionsprojekten, nicht nur hier.
    // Werkora hatte bisher gar keine E-Mail-Bestätigung - renderStatus()
    // zeigt den Bestätigen-Button stattdessen an und ruft diese Funktion
    // dann gar nicht erst auf (siehe unten), das hier ist nur ein zweites
    // Sicherheitsnetz gegen einen veralteten user.emailVerified-Stand.
    if (!user.emailVerified) {
      toast('Bitte zuerst die E-Mail-Adresse bestätigen (siehe Hinweis oben).', 'danger');
      return;
    }
    let secret;
    try {
      const session = await multiFactor(user).getSession();
      secret = await mitReauthBeiBedarf(() => TotpMultiFactorGenerator.generateSecret(session));
    } catch (err) {
      if (err.message !== 'Abgebrochen') toast(`Einrichtung fehlgeschlagen: ${err.message || err}`, 'danger');
      return;
    }
    const otpauthUri = secret.generateQrCodeUrl(user.email || 'Werkora-Konto', 'Werkora');
    const qrPng = await renderQrPngDataUrl(otpauthUri, 220);

    const { body, close } = openModal({
      title: 'Zwei-Faktor-Authentifizierung aktivieren',
      bodyHtml: `
        <ol class="hint" style="padding-left:18px;margin-top:0">
          <li>Authenticator-App öffnen (z.B. Google Authenticator, Microsoft Authenticator).</li>
          <li>QR-Code scannen - oder den Schlüssel unten manuell eingeben.</li>
          <li>Den 6-stelligen Code aus der App unten eingeben.</li>
        </ol>
        ${qrPng ? `<img src="${qrPng}" alt="QR-Code für Authenticator-App" style="display:block;margin:0 auto 10px;width:220px;height:220px">` : '<p class="hint">QR-Code konnte nicht erzeugt werden - bitte den Schlüssel manuell eingeben.</p>'}
        <p class="hint" style="text-align:center;word-break:break-all">Schlüssel zur manuellen Eingabe: <code>${escapeHtml(secret.secretKey)}</code></p>
        <form id="enroll-form">
          <div class="field"><label>Code aus der App</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="one-time-code"></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="enroll-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Aktivieren</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#enroll-cancel').addEventListener('click', close);
    body.querySelector('#enroll-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (new FormData(e.target).get('code') || '').toString().trim();
      const submitBtn = e.target.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
        await multiFactor(user).enroll(assertion, 'Authenticator-App');
        toast('Zwei-Faktor-Authentifizierung aktiviert', 'success');
        close();
        renderStatus();
      } catch (err) {
        toast(`Aktivieren fehlgeschlagen: ${MFA_FEHLER_MELDUNGEN[err.code] || err.message || err}`, 'danger');
        submitBtn.disabled = false;
      }
    });
  }

  async function deaktiviere(faktor) {
    if (!confirmDelete('Zwei-Faktor-Authentifizierung wirklich deaktivieren? Dein Konto ist danach nur noch durch das Passwort geschützt.')) return;
    try {
      await mitReauthBeiBedarf(() => multiFactor(user).unenroll(faktor.uid));
      toast('Zwei-Faktor-Authentifizierung deaktiviert', 'success');
      renderStatus();
    } catch (err) {
      if (err.message !== 'Abgebrochen') toast(`Deaktivieren fehlgeschlagen: ${err.message || err}`, 'danger');
    }
  }

  function renderStatus() {
    const faktor = findeTotpFaktor();
    container.innerHTML = `
      <div class="view-header"><h1>🔐 Sicherheit</h1></div>
      ${!user.emailVerified ? `
        <div class="card">
          <h2>E-Mail-Adresse bestätigen</h2>
          <p class="hint">Bevor du die Zwei-Faktor-Authentifizierung aktivieren kannst, muss deine E-Mail-Adresse (${escapeHtml(user.email || '')}) bestätigt sein - das verlangt Firebase aus Sicherheitsgründen.</p>
          <button class="btn" id="btn-verify-senden">Bestätigungs-E-Mail senden</button>
          <button class="btn btn-ghost" id="btn-verify-aktualisieren">Ich habe bestätigt - aktualisieren</button>
        </div>
      ` : ''}
      <div class="card">
        <h2>Zwei-Faktor-Authentifizierung (Authenticator-App)</h2>
        <p class="hint">Schützt dein Konto zusätzlich zum Passwort mit einem Code aus einer Authenticator-App (z.B. Google Authenticator, Microsoft Authenticator) - freiwillig, jeder richtet es für sein eigenes Konto selbst ein.</p>
        ${faktor ? `
          <p><span class="badge badge-success">✅ Aktiviert</span> seit ${escapeHtml(formatDateTime(faktor.enrollmentTime) || faktor.enrollmentTime || '')}</p>
          <button class="btn btn-danger" id="btn-mfa-deaktivieren">Deaktivieren</button>
        ` : `
          <p><span class="badge">Nicht aktiviert</span></p>
          <button class="btn btn-primary" id="btn-mfa-aktivieren" ${user.emailVerified ? '' : 'disabled title="Zuerst E-Mail-Adresse bestätigen"'}>Aktivieren</button>
        `}
      </div>
    `;
    container.querySelector('#btn-verify-senden')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await sendEmailVerification(user);
        toast('Bestätigungs-E-Mail gesendet - bitte den Link darin öffnen, dann hier "aktualisieren" klicken.', 'success');
      } catch (err) {
        toast(`Senden fehlgeschlagen: ${err.message || err}`, 'danger');
      } finally {
        e.target.disabled = false;
      }
    });
    container.querySelector('#btn-verify-aktualisieren')?.addEventListener('click', async () => {
      await user.reload();
      renderStatus();
      if (user.emailVerified) toast('E-Mail-Adresse ist bestätigt.', 'success');
      else toast('Noch nicht bestätigt - bitte zuerst den Link in der E-Mail öffnen.', 'danger');
    });
    container.querySelector('#btn-mfa-aktivieren')?.addEventListener('click', openEnrollModal);
    container.querySelector('#btn-mfa-deaktivieren')?.addEventListener('click', () => deaktiviere(faktor));
  }

  renderStatus();
}
