// Sprachaufnahme direkt in der App: nutzt die Web Speech API (in Chrome/
// Android gut unterstützt, in Safari/iOS eingeschränkt) für Live-Diktat in
// ein Textfeld - kein Server, keine laufenden Kosten, kein zusätzliches
// Backend nötig. Ist die API im Browser nicht verfügbar, bleibt trotzdem ein
// normales, frei editierbares Textfeld übrig (kein Absturz, keine
// Funktionslücke, nur ohne automatisches Diktat).
import { openModal } from './ui.js';

export function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceRecordingSupported() {
  return !!getSpeechRecognitionCtor();
}

/**
 * Baut ein Aufnahme-Widget: Start/Stop-Button + Textfeld, das während der
 * Aufnahme live mit dem erkannten Text gefüllt wird. Der Text bleibt danach
 * frei editierbar - Diktat ist nur ein Ausgangspunkt, kein Zwang.
 */
export function mountVoiceRecorder(host, { placeholder = 'Sprachnotiz aufnehmen oder Text eingeben ...', initialText = '' } = {}) {
  const Ctor = getSpeechRecognitionCtor();
  let recognition = null;
  let recording = false;
  // Text, der VOR dem aktuellen Aufnahme-Abschnitt schon im Feld stand -
  // Zwischenergebnisse (interim results) werden dahinter angehängt und bei
  // jedem Zwischenstand komplett neu geschrieben, nicht dauerhaft angehängt.
  let textVorAufnahme = '';

  host.innerHTML = `
    <div class="voicenote">
      <div class="voicenote-controls">
        ${Ctor ? '<button type="button" class="btn btn-sm" id="vn-toggle">🎙️ Aufnahme starten</button><span class="voicenote-status text-mute" id="vn-status"></span>' : '<p class="hint">Automatisches Diktat wird von diesem Browser nicht unterstützt - Text bitte direkt eingeben.</p>'}
      </div>
      <textarea id="vn-text" placeholder="${placeholder}" style="min-height:160px">${initialText}</textarea>
    </div>
  `;
  const textarea = host.querySelector('#vn-text');
  const toggleBtn = host.querySelector('#vn-toggle');
  const statusEl = host.querySelector('#vn-status');

  if (Ctor) {
    recognition = new Ctor();
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.addEventListener('result', (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interimText += chunk;
      }
      if (finalText) {
        textVorAufnahme = (textVorAufnahme ? textVorAufnahme.replace(/\s+$/, '') + ' ' : '') + finalText.trim();
      }
      textarea.value = (textVorAufnahme + (interimText ? ' ' + interimText : '')).trim();
    });
    recognition.addEventListener('error', (e) => {
      // "no-speech"/"aborted" sind normale Pausen, keine echten Fehler - nur
      // bei anderen (z.B. "not-allowed" = Mikrofon-Berechtigung verweigert)
      // den Status sichtbar melden.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      statusEl.textContent = e.error === 'not-allowed' ? 'Mikrofon-Zugriff wurde verweigert.' : `Fehler: ${e.error}`;
    });
    // iOS Safari beendet die Erkennung nach kurzer Zeit von selbst (auch
    // mitten in einer laufenden Aufnahme) UND reagiert unzuverlässig, wenn
    // recognition.start() direkt synchron im 'end'-Handler erneut aufgerufen
    // wird (ein bekannter WebKit-Effekt: kein Fehler, aber die Erkennung
    // bleibt stumm, obwohl die UI noch "Aufnahme läuft" anzeigt) - ein
    // kurzer Tick (setTimeout) vor dem Neustart behebt das zuverlässig.
    // Zusätzlich: bricht die Erkennung mehrfach HINTEREINANDER sehr schnell
    // ab (Hinweis auf eine echte Fehlschleife statt einer normalen
    // Sprechpause), automatischen Neustart abbrechen und das dem Nutzer
    // sichtbar machen, statt endlos (und wirkungslos) weiterzuversuchen.
    let letzterNeustart = 0;
    let schnelleNeustartsInFolge = 0;
    recognition.addEventListener('end', () => {
      if (!recording) return;
      const jetzt = Date.now();
      schnelleNeustartsInFolge = (jetzt - letzterNeustart < 1500) ? schnelleNeustartsInFolge + 1 : 0;
      letzterNeustart = jetzt;
      if (schnelleNeustartsInFolge >= 5) {
        recording = false;
        toggleBtn.textContent = '🎙️ Aufnahme starten';
        toggleBtn.classList.remove('is-recording');
        statusEl.textContent = 'Spracherkennung wurde wiederholt unterbrochen - bitte erneut auf "Aufnahme starten" tippen.';
        return;
      }
      setTimeout(() => {
        if (!recording) return;
        try { recognition.start(); } catch { /* bereits gestartet */ }
      }, 250);
    });

    toggleBtn.addEventListener('click', () => {
      if (recording) {
        recording = false;
        recognition.stop();
        toggleBtn.textContent = '🎙️ Aufnahme starten';
        toggleBtn.classList.remove('is-recording');
        statusEl.textContent = '';
      } else {
        textVorAufnahme = textarea.value;
        recording = true;
        try {
          recognition.start();
          toggleBtn.textContent = '⏹️ Aufnahme stoppen';
          toggleBtn.classList.add('is-recording');
          statusEl.textContent = 'Hört zu ...';
        } catch (err) {
          recording = false;
          toggleBtn.classList.remove('is-recording');
          statusEl.textContent = `Aufnahme konnte nicht gestartet werden: ${err.message || err}`;
        }
      }
    });
  }

  return {
    getText: () => textarea.value.trim(),
    stop: () => { if (recording) { recording = false; recognition?.stop(); } },
  };
}

/**
 * Öffnet ein Modal mit Sprachaufnahme (+ frei editierbarem Textfeld) für
 * Stichpunkte, die danach an die KI übergeben werden (z.B. "Mit KI aus
 * Stichpunkten erstellen" bei Angebot/Rechnung/Auftragsbestätigung/
 * Formularen) - ersetzt dort ein einfaches window.prompt()-Textfenster.
 * onSubmit bekommt den eingesprochenen/eingegebenen Text; wird bei leerem
 * Text nicht aufgerufen (wie beim bisherigen window.prompt-Verhalten).
 */
export function openStichpunkteSprachModal({ title = 'Stichpunkte', placeholder, onSubmit }) {
  const { body, close } = openModal({
    title,
    bodyHtml: `
      <div id="sp-voice-host"></div>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn" id="sp-cancel">Abbrechen</button>
        <button type="button" class="btn btn-primary" id="sp-submit">Übernehmen</button>
      </div>
    `,
  });
  const recorder = mountVoiceRecorder(body.querySelector('#sp-voice-host'), { placeholder });
  body.querySelector('#sp-cancel').addEventListener('click', () => { recorder.stop(); close(); });
  body.querySelector('#sp-submit').addEventListener('click', () => {
    const text = recorder.getText();
    recorder.stop();
    close();
    if (text) onSubmit(text);
  });
}
