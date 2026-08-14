import { firebaseConfig } from '../js/firebase-config.js';
import { get, getAll } from '../js/db.js';
import { escapeHtml, formatDate, formatCurrency } from '../js/utils.js';

// Kundenportal: bewusst eine eigenständige, schlanke Seite (nicht Teil der
// verwaltung-SPA/main.js) - Kunden bekommen nie die interne
// Sidebar/Navigation zu sehen, und ein Bug hier kann nicht versehentlich
// interne Admin-Routen erreichbar machen. Rein lesend: Angebote/Rechnungen/
// Termine des eigenen Kunden. Sicherheit läuft über firestore.rules
// (myKundeId() == resource.data.kundeId je Dokument), nicht über UI-Logik.
const FIREBASE_ENABLED = !!firebaseConfig.projectId;

const STATUS_LABEL_ANGEBOT = { entwurf: 'Entwurf', versendet: 'Versendet', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt' };
const STATUS_BADGE_ANGEBOT = { entwurf: 'badge', versendet: 'badge-accent', angenommen: 'badge-success', abgelehnt: 'badge-danger' };
const STATUS_LABEL_RECHNUNG = { offen: 'Offen', teilbezahlt: 'Teilbezahlt', bezahlt: 'Bezahlt', storniert: 'Storniert' };
const STATUS_BADGE_RECHNUNG = { offen: 'badge-warn', teilbezahlt: 'badge-accent', bezahlt: 'badge-success', storniert: 'badge-danger' };

const AUTH_ERROR_MESSAGES = {
  'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
  'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
  'auth/user-not-found': 'E-Mail oder Passwort ist falsch.',
  'auth/email-already-in-use': 'Für diese E-Mail existiert bereits ein Konto – bitte stattdessen anmelden.',
  'auth/weak-password': 'Das Passwort muss mindestens 6 Zeichen lang sein.',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.',
};

let session = null; // { kundeId, email, name }

async function main() {
  session = FIREBASE_ENABLED ? await initFirebaseAuth() : await initFallbackAuth();
  await showPortal();
}

// ---------------------------------------------------------------------------
// Testmodus ohne echtes Firebase-Projekt: E-Mail + lokal am Kunden
// hinterlegter Zugangscode (kunde.portalZugangscode, siehe kunden.js).
// Kein echter Mehrbenutzer-Login - genau wie beim Mitarbeiter-PIN-Modus in
// auth.js ist das nur eine einfache Bedienungssperre für den lokalen Test.
// ---------------------------------------------------------------------------
async function initFallbackAuth() {
  return new Promise((resolve) => {
    const lockScreen = document.getElementById('lock-screen');
    const form = document.getElementById('auth-form');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const error = document.getElementById('auth-error');
    const hint = document.getElementById('auth-hint');
    const modeToggle = document.getElementById('auth-mode-toggle');
    modeToggle.hidden = true;
    hint.textContent = 'Testmodus (kein Firebase-Projekt verbunden): E-Mail + im Kunden hinterlegter Zugangscode.';
    lockScreen.hidden = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const email = emailInput.value.trim().toLowerCase();
      const code = passwordInput.value;
      const kunden = await getAll('kunden');
      const kunde = kunden.find((k) => (k.email || '').toLowerCase() === email && k.portalZugangscode && k.portalZugangscode === code);
      if (!kunde) {
        error.textContent = 'E-Mail oder Zugangscode ist falsch.';
        error.hidden = false;
        return;
      }
      lockScreen.hidden = true;
      resolve({ kundeId: kunde.id, email: kunde.email, name: kunde.firma });
    });
  });
}

// ---------------------------------------------------------------------------
// Echtes Login: Firebase Auth (E-Mail + Passwort), gespiegelt von auth.js'
// initFirebaseLogin() - hier aber mit kundeId statt mitarbeiterId und ohne
// gemeinsame sessionStorage-Session (Portal ist eine eigene Seite).
// ---------------------------------------------------------------------------
async function initFirebaseAuth() {
  const [{ auth, firestore }, authMod, fsMod] = await Promise.all([
    import('../js/firebase.js'),
    import('../js/vendor/firebase/firebase-auth.js'),
    import('../js/vendor/firebase/firebase-firestore.js'),
  ]);
  const { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = authMod;
  const { doc, getDocFromServer, setDoc, deleteDoc } = fsMod;

  const lockScreen = document.getElementById('lock-screen');
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
    modeToggle.textContent = mode === 'login' ? 'Registrieren' : 'Bereits ein Konto? Anmelden';
    hint.textContent = mode === 'login'
      ? 'Bitte mit deiner E-Mail und deinem Passwort anmelden.'
      : 'Nur möglich, wenn neuverdrahtet dich per E-Mail-Adresse für das Portal eingeladen hat.';
  }
  setMode('login');

  return new Promise((resolve) => {
    let settled = false;

    async function loadSessionFor(uid, fallbackEmail) {
      const snap = await getDocFromServer(doc(firestore, 'users', uid));
      if (!snap.exists()) return null;
      const data = snap.data();
      if (data.role !== 'kunde' || !data.kundeId) return null;
      return { kundeId: data.kundeId, email: data.email || fallbackEmail, name: data.name || fallbackEmail };
    }

    function finish(s) {
      settled = true;
      lockScreen.hidden = true;
      resolve(s);
    }

    onAuthStateChanged(auth, async (user) => {
      if (settled) return;
      if (!user) { lockScreen.hidden = false; return; }
      const s = await loadSessionFor(user.uid, user.email);
      if (s) {
        finish(s);
      } else {
        await signOut(auth);
        lockScreen.hidden = false;
        error.textContent = 'Dieses Konto hat keinen Portal-Zugang. Bitte bei neuverdrahtet nachfragen.';
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
          const s = await loadSessionFor(cred.user.uid, cred.user.email);
          if (s) {
            finish(s);
          } else {
            await signOut(auth);
            error.textContent = 'Dieses Konto hat keinen Portal-Zugang. Bitte bei neuverdrahtet nachfragen.';
            error.hidden = false;
          }
        } else {
          const inviteRef = doc(firestore, 'invites', email);
          const inviteSnap = await getDocFromServer(inviteRef);
          if (!inviteSnap.exists() || inviteSnap.data().role !== 'kunde') {
            error.textContent = 'Keine Portal-Einladung für diese E-Mail-Adresse gefunden. Bitte bei neuverdrahtet nachfragen.';
            error.hidden = false;
            return;
          }
          const invite = inviteSnap.data();
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          const s = { kundeId: invite.kundeId, email, name: invite.name || email };
          await setDoc(doc(firestore, 'users', cred.user.uid), { role: 'kunde', kundeId: invite.kundeId, email, name: invite.name || '' });
          await deleteDoc(inviteRef);
          finish(s);
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

// Liest eine Collection gefiltert auf den eigenen Kunden. Im Firestore-Modus
// bewusst eine gezielte where()-Abfrage statt db.js' getAll() (das würde die
// GESAMTE Collection ungefiltert laden - das lehnen die firestore.rules für
// die Rolle 'kunde' ab, siehe die neuen kundeId-Regeln dort).
async function fetchKundenScoped(storeName, kundeId) {
  if (FIREBASE_ENABLED) {
    const { firestore } = await import('../js/firebase.js');
    const { collection, query, where, getDocs } = await import('../js/vendor/firebase/firebase-firestore.js');
    const snap = await getDocs(query(collection(firestore, storeName), where('kundeId', '==', kundeId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return (await getAll(storeName)).filter((r) => r.kundeId === kundeId);
}

function emptyState(msg) {
  return `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

function table(headers, rows) {
  return `
    <table class="data-table">
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
}

async function showPortal() {
  document.getElementById('portal-app').hidden = false;
  const kunde = await get('kunden', session.kundeId).catch(() => null);
  document.getElementById('portal-kunde-name').textContent = kunde?.firma ? `Willkommen, ${kunde.firma}` : 'Willkommen';

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (FIREBASE_ENABLED) {
      const { auth } = await import('../js/firebase.js');
      const { signOut } = await import('../js/vendor/firebase/firebase-auth.js');
      await signOut(auth);
    }
    window.location.reload();
  });

  const tabs = document.querySelectorAll('.portal-tabs button');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.tab);
    });
  });
  renderTab('angebote');
}

async function renderTab(tab) {
  const host = document.getElementById('portal-content');
  host.innerHTML = '<p class="text-mute">Lädt …</p>';

  if (tab === 'angebote') {
    const alle = await fetchKundenScoped('angebote', session.kundeId);
    // Entwürfe sind noch nicht versendet - dem Kunden nicht anzeigen.
    const sichtbar = alle.filter((a) => a.status !== 'entwurf').sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    host.innerHTML = sichtbar.length === 0 ? emptyState('Noch keine Angebote vorhanden.') : table(
      ['Nummer', 'Datum', 'Gültig bis', 'Betrag', 'Status'],
      sichtbar.map((a) => [
        escapeHtml(a.nummer || ''), formatDate(a.datum), formatDate(a.gueltigBis), formatCurrency(a.brutto || 0),
        `<span class="badge ${STATUS_BADGE_ANGEBOT[a.status] || ''}">${escapeHtml(STATUS_LABEL_ANGEBOT[a.status] || a.status || '')}</span>`,
      ]),
    );
  } else if (tab === 'rechnungen') {
    const alle = await fetchKundenScoped('rechnungen', session.kundeId);
    // Nicht versendete (Entwurfs-)Rechnungen sind noch nicht final - nicht anzeigen.
    const sichtbar = alle.filter((r) => r.versendet).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    host.innerHTML = sichtbar.length === 0 ? emptyState('Noch keine Rechnungen vorhanden.') : table(
      ['Nummer', 'Datum', 'Fällig', 'Betrag', 'Status'],
      sichtbar.map((r) => [
        escapeHtml(r.nummer || ''), formatDate(r.datum), formatDate(r.faelligAm), formatCurrency(r.brutto || 0),
        `<span class="badge ${STATUS_BADGE_RECHNUNG[r.status] || ''}">${escapeHtml(STATUS_LABEL_RECHNUNG[r.status] || r.status || '')}</span>`,
      ]),
    );
  } else if (tab === 'termine') {
    const alle = await fetchKundenScoped('termine', session.kundeId);
    const sichtbar = alle.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    host.innerHTML = sichtbar.length === 0 ? emptyState('Noch keine Termine vorhanden.') : table(
      ['Titel', 'Termin', 'Ende'],
      sichtbar.map((t) => [escapeHtml(t.titel || ''), formatDate((t.start || '').slice(0, 10)), formatDate(t.ende || '')]),
    );
  }
}

main();
