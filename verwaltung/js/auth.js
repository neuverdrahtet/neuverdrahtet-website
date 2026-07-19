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
      resolve({ role: 'admin', mitarbeiterId: null });
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

async function initFirebaseLogin() {
  const [{ auth, firestore }, authMod, fsMod] = await Promise.all([
    import('./firebase.js'),
    import('./vendor/firebase/firebase-auth.js'),
    import('./vendor/firebase/firebase-firestore.js'),
  ]);
  const { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = authMod;
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) return;
      submitBtn.disabled = true;
      try {
        if (mode === 'login') {
          const cred = await signInWithEmailAndPassword(auth, email, password);
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
