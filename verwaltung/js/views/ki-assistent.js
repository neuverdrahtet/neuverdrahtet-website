import { chatMitAssistent } from '../ai.js';
import { escapeHtml, toast } from '../utils.js';
import { isVoiceRecordingSupported, getSpeechRecognitionCtor } from '../voicenote.js';

// Verlauf bleibt nur für die Dauer der Sitzung im Tab erhalten (kein
// Cloud-Sync, kein IndexedDB) - ein Neuladen der Seite startet ein neues
// Gespräch. Das ist bewusst so einfach gehalten wie beim Website-Widget.
let verlauf = [];

// Sprachausgabe ist eine Geräte-/Browsereinstellung, kein Werkora-Setting -
// deshalb bewusst nur in localStorage statt in den Firestore-Einstellungen
// (jeder Mitarbeiter könnte eine andere Vorliebe haben).
const SPRACHAUSGABE_KEY = 'nv-ki-assistent-sprachausgabe';

function sprich(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // laufende Ansage abbrechen, bevor die neue startet
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  window.speechSynthesis.speak(utterance);
}

export async function render(container) {
  const voiceInputSupported = isVoiceRecordingSupported();
  const voiceOutputSupported = !!window.speechSynthesis;
  let sprachausgabeAn = (() => { try { return localStorage.getItem(SPRACHAUSGABE_KEY) === '1'; } catch { return false; } })();

  container.innerHTML = `
    <div class="view-header">
      <h1>KI-Assistent</h1>
      ${voiceOutputSupported ? `<div class="actions"><button type="button" class="btn btn-sm" id="ka-voice-toggle">${sprachausgabeAn ? '🔊 Sprachausgabe an' : '🔇 Sprachausgabe aus'}</button></div>` : ''}
    </div>
    <p class="hint">Fragt live Kunden-, Projekt-, Aufgaben-, Termin- und Angebotsdaten über die KI-Bürokraft-API ab und kann auf Zuruf auch Einträge anlegen (z.B. eine Aufgabe oder einen Termin). Einrichtung/Details: <code>cloudflare-worker/worker.js</code> (Aktion "assistent-chat") + <code>cloudflare-worker-ki-buerokraft/README.md</code>.</p>
    <div class="card">
      <div class="ka-list" id="ka-list"></div>
      <form id="ka-form" class="tc-input-row">
        <textarea id="ka-input" placeholder="Frag den Assistenten, z.B. „Wie viele offene Aufgaben haben wir heute?“" rows="2"></textarea>
        ${voiceInputSupported ? `<button type="button" class="btn" id="ka-mic" title="Reinsprechen">🎤</button>` : ''}
        <button type="submit" class="btn btn-primary" id="ka-send">Senden</button>
      </form>
    </div>
  `;

  const listEl = container.querySelector('#ka-list');
  const formEl = container.querySelector('#ka-form');
  const inputEl = container.querySelector('#ka-input');
  const sendBtn = container.querySelector('#ka-send');
  const micBtn = container.querySelector('#ka-mic');
  const voiceToggleBtn = container.querySelector('#ka-voice-toggle');

  function renderZeile(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderListe() {
    if (verlauf.length === 0) {
      listEl.innerHTML = '<p class="text-mute">Noch kein Gespräch. Stell einfach eine Frage - z.B. zu offenen Aufgaben, Leads oder einem Kunden.</p>';
      return;
    }
    listEl.innerHTML = verlauf.map((m) => `
      <div class="ka-msg ka-msg-${m.role}">
        <div class="tc-msg-head"><strong>${m.role === 'user' ? 'Du' : 'KI-Assistent'}</strong></div>
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
      const result = await chatMitAssistent({ messages: verlauf });
      setDenktNach(false);
      if (result.error) {
        verlauf.push({ role: 'assistant', content: `Fehler: ${result.error}` });
      } else {
        const antwort = result.reply || '(keine Antwort)';
        verlauf.push({ role: 'assistant', content: antwort });
        // Eigener try/catch: ein Fehler bei der Sprachausgabe (z.B. Browser-
        // Bug) darf die bereits erfolgreich angezeigte Antwort nicht als
        // fehlgeschlagen überschreiben.
        if (sprachausgabeAn) {
          try { sprich(antwort); } catch { /* Sprachausgabe ist nur ein Zusatz */ }
        }
      }
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
      // Läuft gerade eine Ansage, würde das Mikrofon sonst die eigene
      // Sprachausgabe mit aufnehmen.
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
