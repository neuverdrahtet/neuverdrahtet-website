// Sprachaufnahme direkt in der App: nutzt die Web Speech API (in Chrome/
// Android gut unterstützt, in Safari/iOS eingeschränkt) für Live-Diktat in
// ein Textfeld - kein Server, keine laufenden Kosten, kein zusätzliches
// Backend nötig. Ist die API im Browser nicht verfügbar, bleibt trotzdem ein
// normales, frei editierbares Textfeld übrig (kein Absturz, keine
// Funktionslücke, nur ohne automatisches Diktat).
function getSpeechRecognitionCtor() {
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
    recognition.addEventListener('end', () => {
      // Manche Browser (v.a. iOS Safari) beenden die Erkennung nach kurzer
      // Zeit von selbst, auch mitten in einer laufenden Aufnahme - solange
      // der Nutzer nicht selbst gestoppt hat, automatisch neu starten.
      if (recording) {
        try { recognition.start(); } catch { /* bereits gestartet */ }
      }
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
