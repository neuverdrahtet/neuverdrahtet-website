import { chatMitJarvis } from '../ai.js';
import { escapeHtml, toast } from '../utils.js';
import { isVoiceRecordingSupported, getSpeechRecognitionCtor } from '../voicenote.js';
import { getSession } from '../auth.js';
import { FIREBASE_ENABLED } from '../employeeAuth.js';
import { get, put } from '../db.js';

// Sprachausgabe ist eine Geräte-/Browsereinstellung, kein Werkora-Setting -
// bewusst wie beim bisherigen KI-Assistenten nur in localStorage.
const SPRACHAUSGABE_KEY = 'nv-jarvis-sprachausgabe';

function sprich(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  window.speechSynthesis.speak(utterance);
}

export async function render(container) {
  const session = getSession();

  // Doppelte Absicherung: ROUTE_ROLLEN (db.js) verhindert bereits, dass die
  // Seite für andere Rollen überhaupt verlinkt/erreichbar ist - diese
  // Prüfung hier ist nur die freundliche Fehlermeldung für den (seltenen)
  // Fall eines direkten Hash-Aufrufs. Die ECHTE Durchsetzung passiert
  // serverseitig im Worker (Action "jarvis-chat") bei jedem einzelnen
  // Aufruf, nicht hier im Browser.
  if (session?.role !== 'admin') {
    container.innerHTML = `
      <div class="view-header"><h1>JARVIS</h1></div>
      <p class="hint">JARVIS ist aktuell nur für Administratoren freigegeben.</p>
    `;
    return;
  }
  if (!FIREBASE_ENABLED) {
    container.innerHTML = `
      <div class="view-header"><h1>JARVIS</h1></div>
      <p class="hint">JARVIS benötigt eine eingerichtete Firebase-Anmeldung (Einstellungen → Zugangscode/Mitarbeiter-Login) - im reinen Zugangscode-Modus ohne Firebase-Projekt nicht verfügbar.</p>
    `;
    return;
  }

  const { auth } = await import('../firebase.js');
  const uid = auth.currentUser?.uid;
  if (!uid) {
    container.innerHTML = `
      <div class="view-header"><h1>JARVIS</h1></div>
      <p class="hint">Keine aktive Firebase-Anmeldung gefunden - bitte neu einloggen.</p>
    `;
    return;
  }
  const voiceInputSupported = isVoiceRecordingSupported();
  const voiceOutputSupported = !!window.speechSynthesis;
  let sprachausgabeAn = (() => { try { return localStorage.getItem(SPRACHAUSGABE_KEY) === '1'; } catch { return false; } })();

  // Gesprächsverlauf: EIN fortlaufendes Dokument je Firebase-Nutzer (siehe
  // firestore.rules jarvisGespraeche - Dokument-ID = uid, damit "eigene
  // Unterhaltung lesen/schreiben" ein einfacher direkter get()/put() bleibt
  // statt einer Query mit Listenrecht. Bewusst uid statt mitarbeiterId, da
  // nicht jeder Nutzer - insbesondere ein admin ohne eigenen Mitarbeiter-
  // Datensatz - zwingend ein mitarbeiterId hat).
  let gespraech = await get('jarvisGespraeche', uid);
  let verlauf = gespraech?.nachrichten || [];

  async function speichereVerlauf() {
    await put('jarvisGespraeche', {
      id: uid, uid, nachrichten: verlauf,
      aktualisiertAm: new Date().toISOString(),
    });
  }

  container.innerHTML = `
    <div class="view-header">
      <h1>🧠 JARVIS</h1>
      <div class="actions">
        ${verlauf.length > 0 ? '<button type="button" class="btn btn-sm" id="jv-clear">Verlauf löschen</button>' : ''}
        ${voiceOutputSupported ? `<button type="button" class="btn btn-sm" id="jv-voice-toggle">${sprachausgabeAn ? '🔊 Sprachausgabe an' : '🔇 Sprachausgabe aus'}</button>` : ''}
      </div>
    </div>
    <p class="hint">JARVIS nutzt dieselbe KI-Bürokraft-Anbindung wie bisher der KI-Assistent, prüft jetzt aber bei jedem Aufruf serverseitig deinen Login und deine Rolle. Aktuell nur für admin freigegeben. Schreibende Aktionen mit Außenwirkung (Versand, verbindliche Termine) erfordern weiterhin eine ausdrückliche Freigabe in Werkora selbst.</p>
    <div class="card">
      <div class="ka-list" id="jv-list"></div>
      <form id="jv-form" class="tc-input-row">
        <textarea id="jv-input" placeholder="Frag JARVIS, z.B. „Erstelle mir eine Tagesübersicht“" rows="2"></textarea>
        ${voiceInputSupported ? `<button type="button" class="btn" id="jv-mic" title="Reinsprechen">🎤</button>` : ''}
        <button type="submit" class="btn btn-primary" id="jv-send">Senden</button>
      </form>
    </div>
  `;

  const listEl = container.querySelector('#jv-list');
  const formEl = container.querySelector('#jv-form');
  const inputEl = container.querySelector('#jv-input');
  const sendBtn = container.querySelector('#jv-send');
  const micBtn = container.querySelector('#jv-mic');
  const voiceToggleBtn = container.querySelector('#jv-voice-toggle');
  const clearBtn = container.querySelector('#jv-clear');

  function renderZeile(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderListe() {
    if (verlauf.length === 0) {
      listEl.innerHTML = '<p class="text-mute">Noch kein Gespräch. Stell einfach eine Frage oder gib einen Auftrag.</p>';
      return;
    }
    listEl.innerHTML = verlauf.map((m) => `
      <div class="ka-msg ka-msg-${m.role}">
        <div class="tc-msg-head"><strong>${m.role === 'user' ? 'Du' : 'JARVIS'}</strong></div>
        <div class="tc-msg-text">${renderZeile(m.content)}</div>
      </div>
    `).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  function setDenktNach(an) {
    let el = listEl.querySelector('.ka-thinking');
    if (an) {
      if (el) return;
      el = document.createElement('div');
      el.className = 'ka-msg ka-msg-assistant ka-thinking';
      el.innerHTML = '<div class="tc-msg-text text-mute">Denkt nach …</div>';
      listEl.appendChild(el);
      listEl.scrollTop = listEl.scrollHeight;
    } else if (el) {
      el.remove();
    }
  }

  renderListe();

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    verlauf.push({ role: 'user', content: text });
    renderListe();
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    setDenktNach(true);

    try {
      const result = await chatMitJarvis({ messages: verlauf });
      setDenktNach(false);
      if (result.error) {
        verlauf.push({ role: 'assistant', content: `Fehler: ${result.error}` });
      } else {
        const antwort = result.reply || '(keine Antwort)';
        verlauf.push({ role: 'assistant', content: antwort });
        if (sprachausgabeAn) {
          try { sprich(antwort); } catch { /* Sprachausgabe ist nur ein Zusatz */ }
        }
      }
      await speichereVerlauf();
    } catch (err) {
      setDenktNach(false);
      verlauf.push({ role: 'assistant', content: `Fehler: ${err.message}` });
    } finally {
      renderListe();
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  voiceToggleBtn?.addEventListener('click', () => {
    sprachausgabeAn = !sprachausgabeAn;
    try { localStorage.setItem(SPRACHAUSGABE_KEY, sprachausgabeAn ? '1' : '0'); } catch { /* Speicher evtl. nicht verfügbar */ }
    voiceToggleBtn.textContent = sprachausgabeAn ? '🔊 Sprachausgabe an' : '🔇 Sprachausgabe aus';
    if (!sprachausgabeAn) window.speechSynthesis?.cancel();
  });

  clearBtn?.addEventListener('click', async () => {
    verlauf = [];
    await speichereVerlauf();
    renderListe();
    toast('Verlauf gelöscht', 'success');
  });

  if (micBtn) {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'de-DE';
    recognition.continuous = false;
    recognition.interimResults = false;
    let laeuft = false;

    recognition.addEventListener('result', (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        inputEl.value = transcript;
        formEl.requestSubmit();
      }
    });
    recognition.addEventListener('error', (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        toast(`Spracherkennung fehlgeschlagen: ${e.error}`, 'danger');
      }
    });
    recognition.addEventListener('end', () => {
      laeuft = false;
      micBtn.classList.remove('is-recording');
      micBtn.textContent = '🎤';
    });

    micBtn.addEventListener('click', () => {
      if (laeuft) {
        recognition.stop();
        return;
      }
      window.speechSynthesis?.cancel();
      laeuft = true;
      micBtn.classList.add('is-recording');
      micBtn.textContent = '⏹️';
      try {
        recognition.start();
      } catch {
        laeuft = false;
        micBtn.classList.remove('is-recording');
        micBtn.textContent = '🎤';
      }
    });
  }
}
