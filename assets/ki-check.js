/* =========================================================
   KI-Check Unterverteilung — Foto-Upload + Claude-Vision-Analyse
   Plain JS, kein Modul/Build-Schritt (wie assets/script.js).
   ========================================================= */

const KI_CHECK_WORKER_URL = 'https://neuverdrahtet-ki-check.neuverdrahtetworkersdev.workers.dev';

(() => {
  const dropzone = document.getElementById('kiDropzone');
  if (!dropzone) return; // Script wird nur auf der KI-Check-Seite eingebunden

  const fileInput = document.getElementById('ki-check-input');
  const previewWrap = document.getElementById('kiPreviewWrap');
  const previewImg = document.getElementById('kiPreviewImg');
  const resultEl = document.getElementById('kiResult');
  const resultDot = document.getElementById('kiResultDot');
  const resultLabel = document.getElementById('kiResultLabel');
  const resultBody = document.getElementById('kiResultBody');
  const anotherPhotoNote = document.getElementById('kiAnotherPhoto');
  const resetLink = document.getElementById('kiResetLink');
  const followUp = document.getElementById('kiFollowUp');
  const followUpMessage = document.getElementById('kiFollowUpMessage');
  const pageLoadedAt = Date.now();

  const EINSCHAETZUNG_LABEL = {
    unauffaellig: 'Unauffällig',
    pruefenswert: 'Prüfenswert',
    dringend_pruefen: 'Zeitnah prüfen lassen',
  };
  const EINSCHAETZUNG_DOT = {
    unauffaellig: '',
    pruefenswert: 'is-yellow',
    dringend_pruefen: 'is-red',
  };

  /** Verkleinert ein Bild client-seitig (max. 1280px Kante, JPEG ~80%) - hält
   *  den Upload klein/schnell und begrenzt die Anthropic-API-Kosten pro Anfrage. */
  function compressImage(file, maxDimension = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  function resetUi() {
    previewWrap.classList.remove('is-visible');
    resultEl.classList.remove('is-visible');
    anotherPhotoNote.hidden = true;
    followUp.hidden = true;
    fileInput.value = '';
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    resultEl.classList.remove('is-visible');
    followUp.hidden = true;

    let dataUrl;
    try {
      dataUrl = await compressImage(file);
    } catch (err) {
      showError(err.message);
      return;
    }
    previewImg.src = dataUrl;
    previewWrap.classList.add('is-visible');
    anotherPhotoNote.hidden = false;

    resultEl.classList.add('is-visible');
    resultDot.className = 'dot';
    resultLabel.textContent = 'Analysiere Foto ...';
    resultBody.innerHTML = '';

    try {
      const res = await fetch(KI_CHECK_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: dataUrl, ladezeitMs: Date.now() - pageLoadedAt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analyse fehlgeschlagen.');
      renderResult(data);
    } catch (err) {
      showError(err.message || 'Die Analyse konnte nicht durchgeführt werden. Bitte später erneut versuchen oder direkt Kontakt aufnehmen.');
    }
  }

  function showError(msg) {
    resultDot.className = 'dot is-red';
    resultLabel.textContent = 'Fehler';
    resultBody.innerHTML = `<p class="ai-error">${escHtml(msg)}</p>`;
  }

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function renderResult(data) {
    if (!data.lesbar) {
      resultDot.className = 'dot is-yellow';
      resultLabel.textContent = 'Foto nicht eindeutig auswertbar';
      resultBody.innerHTML = `<p>${escHtml(data.empfehlung || 'Bitte ein deutlicheres Foto der geöffneten Unterverteilung hochladen, oder direkt einen Vor-Ort-Termin anfragen.')}</p>`;
      showFollowUp(data);
      return;
    }
    resultDot.className = `dot ${EINSCHAETZUNG_DOT[data.einschaetzung] || ''}`;
    resultLabel.textContent = EINSCHAETZUNG_LABEL[data.einschaetzung] || data.einschaetzung;
    const beobachtungen = Array.isArray(data.beobachtungen) ? data.beobachtungen : [];
    resultBody.innerHTML = `
      ${beobachtungen.length ? `<ul class="beobachtungen">${beobachtungen.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>` : ''}
      <p><strong>Alterseindruck:</strong> ${escHtml(data.alterEindruck || '–')}</p>
      <p>${escHtml(data.empfehlung || '')}</p>
      <p class="form-note" style="margin-top:12px">Unverbindliche KI-Ersteinschätzung anhand des Fotos — kein Ersatz für eine Prüfung durch eine Elektrofachkraft vor Ort.</p>
    `;
    showFollowUp(data);
  }

  function showFollowUp(data) {
    const zeilen = [
      'Anfrage über den KI-Check Unterverteilung.',
      `Einschätzung: ${EINSCHAETZUNG_LABEL[data.einschaetzung] || (data.lesbar ? '–' : 'Foto nicht eindeutig auswertbar')}`,
    ];
    if (Array.isArray(data.beobachtungen) && data.beobachtungen.length) zeilen.push(`Beobachtungen: ${data.beobachtungen.join('; ')}`);
    if (data.alterEindruck) zeilen.push(`Alterseindruck: ${data.alterEindruck}`);
    followUpMessage.value = zeilen.join('\n');
    followUp.hidden = false;
  }

  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-drag');
  }));
  ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag');
  }));
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  resetLink.addEventListener('click', (e) => {
    e.preventDefault();
    resetUi();
  });
})();
