import { getSettings, getAll } from './db.js';
import { setCurrentMitarbeiterId } from './utils.js';
import { firebaseConfig } from './firebase-config.js';

// Solange kein echtes Firebase-Projekt konfiguriert ist, bleibt der bisherige
// PIN-Zugangscode-Screen aktiv (IndexedDB-Fallback). Erst mit echtem Firebase-
// Projekt gibt es echtes Mitarbeiter-Login per E-Mail+Passwort.
const FIREBASE_ENABLED = !!firebaseConfig.projectId;
const SESSION_KEY = 'nv-unlocked-session';

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function initLock() {
  return FIREBASE_ENABLED ? initFirebaseLogin() : initPinLock();
}

/** Ob eine Sperre auf diesem Gerät überhaupt etwas bewirkt - im Firebase-
 * Modus ist jeder Nutzer per E-Mail+Passwort eingeloggt, eine Sperre
 * verlangt also immer ein erneutes Login. Im PIN-Modus (IndexedDB-Fallback)
 * ohne gesetzten Zugangscode/Mitarbeiter-Code würde lockNow() dagegen sofort
 * wieder ohne jede Abfrage entsperrt (siehe initPinLock oben) - genutzt z.B.
 * um einen sinnlosen Auto-Lock-Timer in diesem Fall gar nicht erst zu
 * starten. */
export async function hasActiveProtection() {
  if (FIREBASE_ENABLED) return true;
  const [settings, mitarbeiter] = await Promise.all([getSettings(), getAll('mitarbeiter')]);
  return !!settings.passcode || mitarbeiter.some((m) => m.zugangscode);
}

export function lockNow() {
  sessionStorage.removeItem(SESSION_KEY);
  if (FIREBASE_ENABLED) {
    import('./firebase.js').then(async ({ auth }) => {
      const { signOut } = await import('./vendor/firebase/firebase-auth.js');
      await signOut(auth);
      window.location.reload();
    });
  } else {
    window.location.reload();
  }
}

// ---------------------------------------------------------------------------
// Legacy: gemeinsamer Zugangscode / Mitarbeiter-Zugangscode (IndexedDB-Modus)
// ---------------------------------------------------------------------------
function initPinLock() {
  return new Promise(async (resolve) => {
    const [settings, mitarbeiter] = await Promise.all([getSettings(), getAll('mitarbeiter')]);
    const hasProtection = !!settings.passcode || mitarbeiter.some((m) => m.zugangscode);
    if (!hasProtection) {
      const session = { role: 'admin', mitarbeiterId: null };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      resolve(session);
      return;
    }
    const existing = getSession();
    if (existing) {
      resolve(existing);
      return;
    }

    const lockScreen = document.getElementById('lock-screen');
    const pinBox = document.getElementById('lock-pin-box');
    const form = document.getElementById('lock-form');
    const input = document.getElementById('lock-input');
    const error = document.getElementById('lock-error');
    lockScreen.hidden = false;
    pinBox.hidden = false;

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

// ---------------------------------------------------------------------------
// Echtes Login: Firebase Auth (E-Mail + Passwort)
// ---------------------------------------------------------------------------
const AUTH_ERROR_MESSAGES = {
  'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
  'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
  'auth/user-not-found': 'E-Mail oder Passwort ist falsch.',
  'auth/email-already-in-use': 'Für diese E-Mail existiert bereits ein Konto – bitte stattdessen anmelden.',
  'auth/weak-password': 'Das Passwort muss mindestens 6 Zeichen lang sein.',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.',
};

// Maßnahme 8 (MFA, November 2026): eigene Fehlermeldungen für den
// Zwei-Faktor-Code-Schritt (getrennt von AUTH_ERROR_MESSAGES oben, da
// dieselben Codes dort eine andere, hier unpassende Meldung hätten).
const MFA_ERROR_MESSAGES = {
  'auth/invalid-verification-code': 'Der Code ist falsch oder abgelaufen. Bitte den aktuellen Code aus der App eingeben.',
  'auth/code-expired': 'Der Code ist abgelaufen. Bitte den aktuellen Code aus der App eingeben.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.',
};

async function initFirebaseLogin() {
  const [{ auth, firestore }, authMod, fsMod] = await Promise.all([
    import('./firebase.js'),
    import('./vendor/firebase/firebase-auth.js'),
    import('./vendor/firebase/firebase-firestore.js'),
  ]);
  const {
    onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    sendPasswordResetEmail, getMultiFactorResolver, TotpMultiFactorGenerator,
  } = authMod;
  const { doc, getDocFromServer, setDoc, deleteDoc } = fsMod;

  const lockScreen = document.getElementById('lock-screen');
  const authBox = document.getElementById('lock-auth-box');
  const pinBox = document.getElementById('lock-pin-box');
  pinBox.hidden = true;

  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const error = document.getElementById('auth-error');
  const title = document.getElementById('auth-title');
  const submitBtn = document.getElementById('auth-submit');
  const modeToggle = document.getElementById('auth-mode-toggle');
  const hint = document.getElementById('auth-hint');
  const forgotToggle = document.getElementById('auth-forgot-toggle');

  // --- Passwort vergessen (Maßnahme 8) ---
  const forgotBox = document.getElementById('lock-forgot-box');
  const forgotForm = document.getElementById('forgot-form');
  const forgotEmailInput = document.getElementById('forgot-email');
  const forgotError = document.getElementById('forgot-error');
  const forgotSubmitBtn = document.getElementById('forgot-submit');
  const forgotBack = document.getElementById('forgot-back');

  forgotToggle.addEventListener('click', (e) => {
    e.preventDefault();
    forgotEmailInput.value = emailInput.value.trim();
    authBox.hidden = true;
    forgotError.hidden = true;
    forgotBox.hidden = false;
  });
  forgotBack.addEventListener('click', (e) => {
    e.preventDefault();
    forgotBox.hidden = true;
    authBox.hidden = false;
  });
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    forgotError.hidden = true;
    const email = forgotEmailInput.value.trim();
    if (!email) return;
    forgotSubmitBtn.disabled = true;
    try {
      await sendPasswordResetEmail(auth, email);
      zeigeForgotErfolg();
    } catch (err) {
      // "auth/user-not-found" bewusst GENAUSO wie Erfolg behandeln - sonst
      // liesse sich über die Fehlermeldung ausprobieren, welche E-Mail-
      // Adressen überhaupt als Konto angelegt sind (Enumeration). Echte
      // andere Fehler (ungültige Adresse, zu viele Versuche) zeigen wir
      // dagegen normal an.
      if (err.code === 'auth/user-not-found') {
        zeigeForgotErfolg();
      } else {
        forgotError.className = 'lock-error';
        forgotError.textContent = err.code === 'auth/invalid-email' ? 'Ungültige E-Mail-Adresse.'
          : err.code === 'auth/too-many-requests' ? 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.'
          : err.message || 'Unbekannter Fehler.';
        forgotError.hidden = false;
      }
    } finally {
      forgotSubmitBtn.disabled = false;
    }
    function zeigeForgotErfolg() {
      forgotError.className = 'lock-hint';
      forgotError.textContent = 'Falls zu dieser E-Mail-Adresse ein Konto existiert, wurde gerade eine E-Mail zum Zurücksetzen versendet.';
      forgotError.hidden = false;
    }
  });

  // --- Zwei-Faktor-Code beim Login (Maßnahme 8) ---
  const mfaBox = document.getElementById('lock-mfa-box');
  const mfaForm = document.getElementById('mfa-form');
  const mfaCodeInput = document.getElementById('mfa-code');
  const mfaError = document.getElementById('mfa-error');
  const mfaSubmitBtn = document.getElementById('mfa-submit');
  const mfaBack = document.getElementById('mfa-back');
  let aktiverMfaResolver = null;

  mfaBack.addEventListener('click', (e) => {
    e.preventDefault();
    aktiverMfaResolver = null;
    mfaCodeInput.value = '';
    mfaBox.hidden = true;
    authBox.hidden = false;
  });

  let mode = 'login';
  function setMode(next) {
    mode = next;
    error.hidden = true;
    title.textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
    submitBtn.textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
    modeToggle.textContent = mode === 'login'
      ? 'Als eingeladener Mitarbeiter registrieren'
      : 'Bereits ein Konto? Anmelden';
    hint.textContent = mode === 'login'
      ? 'Bitte mit deiner E-Mail und deinem Passwort anmelden.'
      : 'Nur möglich, wenn dich ein Admin per E-Mail-Adresse eingeladen hat.';
  }

  return new Promise((resolve) => {
    let settled = false;

    async function loadSessionFor(uid, fallbackEmail) {
      // Bewusst vom Server lesen statt aus dem lokalen Offline-Cache: sonst
      // könnte ein Mitarbeiter, dem der Zugriff gerade entzogen wurde, nach
      // einem Reload kurzzeitig noch mit der alten (gecachten) Rolle
      // eingeloggt bleiben, bis der Cache sich von selbst aktualisiert.
      const snap = await getDocFromServer(doc(firestore, 'users', uid));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        role: data.role || 'mitarbeiter',
        mitarbeiterId: data.mitarbeiterId || null,
        name: data.name || fallbackEmail,
      };
    }

    function finish(session) {
      settled = true;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      if (session.mitarbeiterId) setCurrentMitarbeiterId(session.mitarbeiterId);
      lockScreen.hidden = true;
      resolve(session);
    }

    onAuthStateChanged(auth, async (user) => {
      if (settled) return;
      if (!user) {
        lockScreen.hidden = false;
        authBox.hidden = false;
        setMode('login');
        return;
      }
      const session = await loadSessionFor(user.uid, user.email);
      if (session) {
        finish(session);
      } else {
        await signOut(auth);
        lockScreen.hidden = false;
        authBox.hidden = false;
        setMode('login');
        error.textContent = 'Dieses Konto wurde noch nicht freigeschaltet. Bitte vom Admin einladen lassen.';
        error.hidden = false;
      }
    });

    modeToggle.addEventListener('click', (e) => {
      e.preventDefault();
      setMode(mode === 'login' ? 'register' : 'login');
    });

    // Zwei-Faktor-Code-Eingabe nach einem Login-Versuch, der von Firebase
    // mit "auth/multi-factor-auth-required" abgelehnt wurde (siehe unten) -
    // aktiverMfaResolver wird dabei gesetzt, bevor diese Box sichtbar wird.
    mfaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      mfaError.hidden = true;
      if (!aktiverMfaResolver) return;
      const code = mfaCodeInput.value.trim();
      if (!code) return;
      mfaSubmitBtn.disabled = true;
      try {
        const totpHint = aktiverMfaResolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (!totpHint) throw new Error('Für dieses Konto ist kein Authenticator-App-Faktor hinterlegt.');
        const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, code);
        const cred = await aktiverMfaResolver.resolveSignIn(assertion);
        const session = await loadSessionFor(cred.user.uid, cred.user.email);
        if (session) {
          aktiverMfaResolver = null;
          finish(session);
        } else {
          await signOut(auth);
          aktiverMfaResolver = null;
          mfaBox.hidden = true;
          authBox.hidden = false;
          error.textContent = 'Dieses Konto wurde noch nicht freigeschaltet. Bitte vom Admin einladen lassen.';
          error.hidden = false;
        }
      } catch (err) {
        mfaError.textContent = MFA_ERROR_MESSAGES[err.code] || err.message || 'Unbekannter Fehler.';
        mfaError.hidden = false;
        mfaCodeInput.value = '';
        mfaCodeInput.focus();
      } finally {
        mfaSubmitBtn.disabled = false;
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) return;
      submitBtn.disabled = true;
      try {
        if (mode === 'login') {
          let cred;
          try {
            cred = await signInWithEmailAndPassword(auth, email, password);
          } catch (err) {
            if (err.code === 'auth/multi-factor-auth-required') {
              aktiverMfaResolver = getMultiFactorResolver(auth, err);
              authBox.hidden = true;
              mfaError.hidden = true;
              mfaCodeInput.value = '';
              mfaBox.hidden = false;
              mfaCodeInput.focus();
              return;
            }
            throw err;
          }
          const session = await loadSessionFor(cred.user.uid, cred.user.email);
          if (session) {
            finish(session);
          } else {
            await signOut(auth);
            error.textContent = 'Dieses Konto wurde noch nicht freigeschaltet. Bitte vom Admin einladen lassen.';
            error.hidden = false;
          }
        } else {
          const inviteRef = doc(firestore, 'invites', email);
          const inviteSnap = await getDocFromServer(inviteRef);
          if (!inviteSnap.exists()) {
            error.textContent = 'Keine Einladung für diese E-Mail-Adresse gefunden. Bitte beim Admin nachfragen.';
            error.hidden = false;
            return;
          }
          const invite = inviteSnap.data();
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          const session = {
            role: invite.role || 'mitarbeiter',
            mitarbeiterId: invite.mitarbeiterId || null,
            name: invite.name || email,
          };
          await setDoc(doc(firestore, 'users', cred.user.uid), { ...session, email });
          await deleteDoc(inviteRef);
          finish(session);
        }
      } catch (err) {
        error.textContent = AUTH_ERROR_MESSAGES[err.code] || err.message || 'Unbekannter Fehler.';
        error.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
  });
}
