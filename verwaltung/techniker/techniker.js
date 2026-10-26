import { firebaseConfig } from '../js/firebase-config.js';
import { put, getAll } from '../js/db.js';
import { uid, escapeHtml, formatDate, formatCurrency, todayISO, toast } from '../js/utils.js';
import { openModal } from '../js/ui.js';
import { REISEKOSTEN_STATUS, berechneVerpflegungspauschale, berechneKilometergeld } from '../js/reisekosten.js';

const REISEKOSTEN_STATUS_LABEL = Object.fromEntries(REISEKOSTEN_STATUS.map((s) => [s.id, s.titel]));
const REISEKOSTEN_STATUS_BADGE = { entwurf: '', eingereicht: 'badge-warn', genehmigt: 'badge-success', abgelehnt: 'badge-danger' };

// Techniker-Ansicht: bewusst eine eigenständige, schlanke Seite (nicht Teil
// der verwaltung-SPA/main.js), genau wie das Kundenportal (verwaltung/portal/)
// - Techniker bekommen nie die interne Sidebar/Navigation zu sehen, und ein
// Bug hier kann nicht versehentlich interne Admin-Routen erreichbar machen.
// Sicherheit läuft über firestore.rules (myMitarbeiterId() in
// resource.data.technikerIds je Dokument, eingeschränktes Feld-Update), nicht
// über UI-Logik - siehe firestore.rules match /serviceauftraege/{docId}.
const FIREBASE_ENABLED = !!firebaseConfig.projectId;

const STATUS_LABEL = {
  offen: 'Offen', zugewiesen: 'Zugewiesen', in_bearbeitung: 'In Bearbeitung',
  abgeschlossen: 'Abgeschlossen', abgebrochen: 'Abgebrochen',
};
const STATUS_BADGE = {
  zugewiesen: 'badge-accent', in_bearbeitung: 'badge-accent',
  abgeschlossen: 'badge-success', abgebrochen: 'badge-danger',
};

const AUTH_ERROR_MESSAGES = {
  'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
  'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
  'auth/user-not-found': 'E-Mail oder Passwort ist falsch.',
  'auth/email-already-in-use': 'Für diese E-Mail existiert bereits ein Konto – bitte stattdessen anmelden.',
  'auth/weak-password': 'Das Passwort muss mindestens 6 Zeichen lang sein.',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.',
};

let session = null; // { mitarbeiterId, email, name }

async function main() {
  session = FIREBASE_ENABLED ? await initFirebaseAuth() : await initFallbackAuth();
  await showApp();
}

// ---------------------------------------------------------------------------
// Testmodus ohne echtes Firebase-Projekt: E-Mail + am Mitarbeiter
// hinterlegter Zugangscode (dasselbe Feld wie beim PIN-Login der
// Haupt-App, siehe auth.js) - kein echter Mehrbenutzer-Login, nur eine
// einfache Bedienungssperre für den lokalen Test.
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
    hint.textContent = 'Testmodus (kein Firebase-Projekt verbunden): E-Mail + im Mitarbeiter hinterlegter Zugangscode.';
    lockScreen.hidden = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const email = emailInput.value.trim().toLowerCase();
      const code = passwordInput.value;
      const mitarbeiter = await getAll('mitarbeiter');
      const match = mitarbeiter.find((m) => m.zugriffsrolle === 'techniker' && (m.email || '').toLowerCase() === email && m.zugangscode && m.zugangscode === code);
      if (!match) {
        error.textContent = 'E-Mail oder Zugangscode ist falsch.';
        error.hidden = false;
        return;
      }
      lockScreen.hidden = true;
      resolve({ mitarbeiterId: match.id, email: match.email, name: match.name });
    });
  });
}

// ---------------------------------------------------------------------------
// Echtes Login: Firebase Auth (E-Mail + Passwort), gespiegelt von
// verwaltung/portal/portal.js - hier aber mit mitarbeiterId statt kundeId
// und role==='techniker' statt 'kunde'.
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
      : 'Nur möglich, wenn das Büro dich per E-Mail-Adresse als Techniker eingeladen hat.';
  }
  setMode('login');

  return new Promise((resolve) => {
    let settled = false;

    async function loadSessionFor(uid, fallbackEmail) {
      const snap = await getDocFromServer(doc(firestore, 'users', uid));
      if (!snap.exists()) return null;
      const data = snap.data();
      if (data.role !== 'techniker' || !data.mitarbeiterId) return null;
      return { mitarbeiterId: data.mitarbeiterId, email: data.email || fallbackEmail, name: data.name || fallbackEmail };
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
        error.textContent = 'Dieses Konto hat keinen Techniker-Zugang. Bitte beim Büro nachfragen.';
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
            error.textContent = 'Dieses Konto hat keinen Techniker-Zugang. Bitte beim Büro nachfragen.';
            error.hidden = false;
          }
        } else {
          const inviteRef = doc(firestore, 'invites', email);
          const inviteSnap = await getDocFromServer(inviteRef);
          if (!inviteSnap.exists() || inviteSnap.data().role !== 'techniker') {
            error.textContent = 'Keine Techniker-Einladung für diese E-Mail-Adresse gefunden. Bitte beim Büro nachfragen.';
            error.hidden = false;
            return;
          }
          const invite = inviteSnap.data();
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          const s = { mitarbeiterId: invite.mitarbeiterId, email, name: invite.name || email };
          await setDoc(doc(firestore, 'users', cred.user.uid), { role: 'techniker', mitarbeiterId: invite.mitarbeiterId, email, name: invite.name || '' });
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

// Liest die eigenen Serviceaufträge. Im Firestore-Modus bewusst eine
// gezielte where()-Abfrage statt db.js' getAll() (das würde die GESAMTE
// Collection ungefiltert laden - das lehnen die firestore.rules für die
// Rolle "techniker" ab, siehe die technikerIds-Regel dort; eine
// ungefilterte list-Abfrage wird komplett abgelehnt, nicht etwa still
// gefiltert, siehe genau dasselbe Muster in verwaltung/portal/portal.js).
async function fetchEigeneServiceauftraege() {
  if (FIREBASE_ENABLED) {
    const { firestore } = await import('../js/firebase.js');
    const { collection, query, where, getDocs } = await import('../js/vendor/firebase/firebase-firestore.js');
    const snap = await getDocs(query(collection(firestore, 'serviceauftraege'), where('technikerIds', 'array-contains', session.mitarbeiterId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return (await getAll('serviceauftraege')).filter((a) => (a.technikerIds || []).includes(session.mitarbeiterId));
}

// Dasselbe Prinzip wie fetchEigeneServiceauftraege: gezielte where()-Abfrage
// statt ungefiltertem getAll(), da firestore.rules für reisekostenabrechnungen
// den Lesezugriff auf die eigene mitarbeiterId beschränkt.
async function fetchEigeneReisekosten() {
  if (FIREBASE_ENABLED) {
    const { firestore } = await import('../js/firebase.js');
    const { collection, query, where, getDocs } = await import('../js/vendor/firebase/firebase-firestore.js');
    const snap = await getDocs(query(collection(firestore, 'reisekostenabrechnungen'), where('mitarbeiterId', '==', session.mitarbeiterId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return (await getAll('reisekostenabrechnungen')).filter((a) => a.mitarbeiterId === session.mitarbeiterId);
}

function istUeberfaellig(auftrag, heute = todayISO()) {
  if (!auftrag.auftragsfrist) return false;
  if (auftrag.status === 'abgeschlossen' || auftrag.status === 'abgebrochen') return false;
  return auftrag.auftragsfrist < heute;
}

function emptyState(msg) {
  return `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

async function showApp() {
  document.getElementById('techniker-app').hidden = false;
  document.getElementById('techniker-name').textContent = session.name ? `Hallo, ${session.name}` : 'Meine Serviceaufträge';

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (FIREBASE_ENABLED) {
      const { auth } = await import('../js/firebase.js');
      const { signOut } = await import('../js/vendor/firebase/firebase-auth.js');
      await signOut(auth);
    }
    window.location.reload();
  });

  document.getElementById('tab-auftraege').addEventListener('click', () => wechsleTab('auftraege'));
  document.getElementById('tab-reisekosten').addEventListener('click', () => wechsleTab('reisekosten'));

  await renderListe();
}

async function wechsleTab(tab) {
  document.getElementById('tab-auftraege').classList.toggle('active', tab === 'auftraege');
  document.getElementById('tab-reisekosten').classList.toggle('active', tab === 'reisekosten');
  if (tab === 'auftraege') await renderListe();
  else await renderReisekosten();
}

async function renderListe() {
  const host = document.getElementById('techniker-content');
  host.innerHTML = '<p class="text-mute">Lädt …</p>';
  const auftraege = (await fetchEigeneServiceauftraege())
    .filter((a) => a.status !== 'abgebrochen')
    .sort((a, b) => {
      // Überfällige und offene Aufträge zuerst, danach nach Frist, zuletzt Abgeschlossene.
      if ((a.status === 'abgeschlossen') !== (b.status === 'abgeschlossen')) return a.status === 'abgeschlossen' ? 1 : -1;
      return (a.auftragsfrist || '9999').localeCompare(b.auftragsfrist || '9999');
    });

  if (auftraege.length === 0) { host.innerHTML = emptyState('Dir sind aktuell keine Serviceaufträge zugewiesen.'); return; }

  host.innerHTML = auftraege.map((a) => `
    <div class="sa-card" data-id="${a.id}">
      <h3>${escapeHtml(a.externeAuftragsnummer || 'Serviceauftrag')} <span class="badge ${STATUS_BADGE[a.status] || ''}">${STATUS_LABEL[a.status] || a.status}</span></h3>
      <div class="sa-meta">${escapeHtml(a.kundenname || '')}${a.einsatzadresse ? ' · ' + escapeHtml(a.einsatzadresse) : ''}</div>
      ${a.auftragsfrist ? `<div class="sa-meta">Frist: ${formatDate(a.auftragsfrist)}${istUeberfaellig(a) ? ' <span class="badge badge-danger">überfällig</span>' : ''}</div>` : ''}
    </div>
  `).join('');

  host.querySelectorAll('.sa-card').forEach((card) => {
    card.addEventListener('click', () => openDetail(auftraege.find((a) => a.id === card.dataset.id)));
  });
}

function checklisteHtml(punkte) {
  if (!punkte || punkte.length === 0) return '<p class="hint">Keine Checkliste hinterlegt.</p>';
  return punkte.map((p, i) => `
    <label class="checklisten-zeile">
      <input type="checkbox" name="punkt-${i}" ${p.erledigt ? 'checked' : ''}>
      <span>${escapeHtml(p.titel)}</span>
    </label>
  `).join('');
}

function openDetail(auftrag) {
  const { body, close } = openModal({
    // externeAuftragsnummer stammt vom Hersteller/Auftraggeber (E-Mail/
    // Portal), nicht aus einer intern erzeugten Sequenz - openModal() setzt
    // den title ungeprüft als innerHTML (siehe ui.js), deshalb hier
    // explizit escapeHtml().
    title: escapeHtml(auftrag.externeAuftragsnummer || 'Serviceauftrag'),
    fullscreen: true,
    bodyHtml: `
      <div class="form-grid">
        <p class="hint" style="margin:0 0 4px">
          ${auftrag.kundenname ? `<strong>${escapeHtml(auftrag.kundenname)}</strong><br>` : ''}
          ${auftrag.einsatzadresse ? `${escapeHtml(auftrag.einsatzadresse)}<br>` : ''}
          ${auftrag.telefonnummer ? `📞 ${escapeHtml(auftrag.telefonnummer)}<br>` : ''}
          ${auftrag.herstellerUndAnlagentyp ? `Anlage: ${escapeHtml(auftrag.herstellerUndAnlagentyp)}${auftrag.seriennummer ? ' · Seriennr. ' + escapeHtml(auftrag.seriennummer) : ''}<br>` : ''}
          ${auftrag.wartungsart ? `Art: ${escapeHtml(auftrag.wartungsart)}<br>` : ''}
          ${auftrag.hinweise ? `Hinweis vom Büro: ${escapeHtml(auftrag.hinweise)}` : ''}
        </p>

        <div class="field col-span-2">
          <label>Checkliste</label>
          <div id="checkliste-host">${checklisteHtml(auftrag.checklistenPunkte)}</div>
        </div>

        <div class="field col-span-2"><label>Mängel (an das Büro)</label><textarea name="maengel" placeholder="z.B. Dichtung porös">${escapeHtml(auftrag.maengel || '')}</textarea></div>
        <div class="field col-span-2"><label>Zusatzarbeit-Vorschlag (an das Büro)</label><textarea name="zusatzarbeitVorschlag" placeholder="z.B. Austausch empfohlen">${escapeHtml(auftrag.zusatzarbeitVorschlag || '')}</textarea></div>
        <div class="field col-span-2"><label>Berichtsentwurf (Rohtext für das Büro)</label><textarea name="berichtsentwurf" rows="4">${escapeHtml(auftrag.berichtsentwurf || '')}</textarea></div>
        <div class="field col-span-2"><label>Eigene Notizen</label><textarea name="technikerNotizen">${escapeHtml(auftrag.technikerNotizen || '')}</textarea></div>

        <p class="hint col-span-2">Der fertige Wartungsbericht und der Versand an den Kunden laufen ausschließlich über das Büro - hier wird nur gespeichert, was du vor Ort erfasst hast.</p>
      </div>
      <div class="modal-actions">
        <span class="spacer"></span>
        ${auftrag.status !== 'abgeschlossen' ? '<button type="button" class="btn" id="btn-abschliessen">Als abgeschlossen melden</button>' : ''}
        <button type="button" class="btn btn-primary" id="btn-speichern">Speichern</button>
      </div>
    `,
  });

  function sammleAenderungen() {
    const punkte = (auftrag.checklistenPunkte || []).map((p, i) => ({
      ...p, erledigt: !!body.querySelector(`input[name="punkt-${i}"]`)?.checked,
    }));
    return {
      checklistenPunkte: punkte,
      maengel: body.querySelector('textarea[name="maengel"]').value.trim(),
      zusatzarbeitVorschlag: body.querySelector('textarea[name="zusatzarbeitVorschlag"]').value.trim(),
      berichtsentwurf: body.querySelector('textarea[name="berichtsentwurf"]').value.trim(),
      technikerNotizen: body.querySelector('textarea[name="technikerNotizen"]').value.trim(),
    };
  }

  async function speichern(abschliessen) {
    const aenderungen = sammleAenderungen();
    const status = abschliessen ? 'abgeschlossen' : (auftrag.status === 'abgeschlossen' ? 'abgeschlossen' : 'in_bearbeitung');
    await put('serviceauftraege', { ...auftrag, ...aenderungen, status, aktualisiertAm: new Date().toISOString() });
    toast(abschliessen ? 'Als abgeschlossen gemeldet' : 'Gespeichert', 'success');
    close();
    renderListe();
  }

  body.querySelector('#btn-speichern').addEventListener('click', () => speichern(false));
  body.querySelector('#btn-abschliessen')?.addEventListener('click', () => {
    if (confirm('Diesen Serviceauftrag wirklich als abgeschlossen melden?')) speichern(true);
  });
}

// =============================================================================
// Meine Reisekosten (Phase 9) - WICHTIG: reine Simulation/Orientierungshilfe,
// siehe Kopfkommentar in verwaltung/js/reisekosten.js. Kein Versand, keine
// Auszahlung - "Einreichen" setzt nur den Prüfstatus, das Büro entscheidet.
// =============================================================================

async function renderReisekosten() {
  const host = document.getElementById('techniker-content');
  host.innerHTML = '<p class="text-mute">Lädt …</p>';
  const [abrechnungen, saetze] = await Promise.all([fetchEigeneReisekosten(), getAll('reisekostensaetze')]);
  abrechnungen.sort((a, b) => (b.von || '').localeCompare(a.von || ''));

  const neuBtn = '<button type="button" class="btn btn-primary btn-sm" id="btn-rk-neu" style="margin-bottom:10px">+ Neue Reisekostenabrechnung</button>';
  if (abrechnungen.length === 0) {
    host.innerHTML = `${neuBtn}${emptyState('Noch keine Reisekostenabrechnungen erfasst.')}`;
  } else {
    host.innerHTML = neuBtn + abrechnungen.map((a) => {
      const v = berechneVerpflegungspauschale(a.von, a.bis, saetze);
      const km = berechneKilometergeld(a.kilometer, a.von, saetze);
      return `
        <div class="sa-card" data-id="${a.id}">
          <h3>${escapeHtml(a.anlass || 'Reisekostenabrechnung')} <span class="badge ${REISEKOSTEN_STATUS_BADGE[a.status] || ''}">${REISEKOSTEN_STATUS_LABEL[a.status] || a.status}</span></h3>
          <div class="sa-meta">${formatDate((a.von || '').slice(0, 10))}${(a.bis || '').slice(0, 10) !== (a.von || '').slice(0, 10) ? ' – ' + formatDate((a.bis || '').slice(0, 10)) : ''} · ${formatCurrency(v.gesamtBetrag + km)}</div>
        </div>
      `;
    }).join('');
  }
  document.getElementById('btn-rk-neu').addEventListener('click', () => openReisekostenForm(abrechnungen, saetze));
  host.querySelectorAll('.sa-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => openReisekostenForm(abrechnungen, saetze, abrechnungen.find((a) => a.id === card.dataset.id)));
  });
}

function openReisekostenForm(abrechnungen, saetze, vorhanden) {
  const isEdit = !!vorhanden;
  const darfBearbeiten = !isEdit || ['entwurf', 'eingereicht'].includes(vorhanden.status);
  const data = vorhanden || { id: uid(), mitarbeiterId: session.mitarbeiterId, anlass: '', von: '', bis: '', kilometer: '', status: 'entwurf' };

  const { body, close } = openModal({
    // openModal() setzt den title ungeprüft als innerHTML (siehe ui.js) -
    // "anlass" ist freier Text, deshalb explizit escapeHtml().
    title: isEdit ? escapeHtml(data.anlass || 'Reisekostenabrechnung') : 'Neue Reisekostenabrechnung',
    fullscreen: true,
    bodyHtml: `
      <form id="rk-form">
        <div class="form-grid">
          <div class="field col-span-2"><label>Anlass *</label><input name="anlass" required value="${escapeHtml(data.anlass || '')}" ${darfBearbeiten ? '' : 'disabled'}></div>
          <div class="field"><label>Von *</label><input type="datetime-local" name="von" required value="${escapeHtml(data.von || '')}" ${darfBearbeiten ? '' : 'disabled'}></div>
          <div class="field"><label>Bis *</label><input type="datetime-local" name="bis" required value="${escapeHtml(data.bis || '')}" ${darfBearbeiten ? '' : 'disabled'}></div>
          <div class="field col-span-2"><label>Gefahrene Kilometer (eigener Pkw, optional)</label><input type="number" step="1" min="0" name="kilometer" value="${escapeHtml(String(data.kilometer ?? ''))}" ${darfBearbeiten ? '' : 'disabled'}></div>
        </div>
        <div id="rk-vorschau" class="card" style="margin-top:10px"></div>
        <p class="hint" style="margin-top:8px">⚠️ Orientierungswert nach §9 Abs. 4a EStG - keine Auszahlung, das Büro prüft und entscheidet.</p>
        ${isEdit && data.ablehnungsgrund ? `<p class="hint">Ablehnungsgrund: ${escapeHtml(data.ablehnungsgrund)}</p>` : ''}
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="rk-cancel">Schließen</button>
          ${darfBearbeiten ? `
            <button type="submit" class="btn btn-primary">Als Entwurf speichern</button>
            ${data.status === 'entwurf' ? '<button type="button" class="btn btn-primary" id="rk-einreichen">Einreichen</button>' : ''}
          ` : ''}
        </div>
      </form>
    `,
  });

  function aktualisiereVorschau() {
    const fd = new FormData(body.querySelector('#rk-form'));
    const v = berechneVerpflegungspauschale(fd.get('von'), fd.get('bis'), saetze);
    const km = berechneKilometergeld(fd.get('kilometer'), fd.get('von'), saetze);
    body.querySelector('#rk-vorschau').innerHTML = `<strong>Berechnete Verpflegungspauschale + Kilometergeld: ${formatCurrency(v.gesamtBetrag + km)}</strong>`;
  }
  body.querySelectorAll('input[name="von"], input[name="bis"], input[name="kilometer"]').forEach((inp) => inp.addEventListener('input', aktualisiereVorschau));
  aktualisiereVorschau();
  body.querySelector('#rk-cancel').addEventListener('click', close);

  async function speichern(status) {
    const fd = new FormData(body.querySelector('#rk-form'));
    const updated = {
      ...data, status,
      anlass: (fd.get('anlass') || '').toString().trim(),
      von: (fd.get('von') || '').toString(), bis: (fd.get('bis') || '').toString(),
      kilometer: fd.get('kilometer') ? Number(fd.get('kilometer')) : '',
      erstelltAm: data.erstelltAm || new Date().toISOString(),
    };
    if (!updated.anlass || !updated.von || !updated.bis) { toast('Bitte Anlass, Von und Bis ausfüllen', 'error'); return; }
    await put('reisekostenabrechnungen', updated);
    const idx = abrechnungen.findIndex((a) => a.id === updated.id);
    if (idx === -1) abrechnungen.unshift(updated); else abrechnungen[idx] = updated;
    toast(status === 'eingereicht' ? 'Eingereicht' : 'Als Entwurf gespeichert', 'success');
    close();
    renderReisekosten();
  }

  if (darfBearbeiten) {
    body.querySelector('#rk-form').addEventListener('submit', (e) => { e.preventDefault(); speichern('entwurf'); });
    body.querySelector('#rk-einreichen')?.addEventListener('click', () => speichern('eingereicht'));
  }
}

main();
