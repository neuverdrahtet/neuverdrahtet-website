// Öffentliche Upload-Seite (upload.html) - lässt einen Kunden ohne Login
// Fotos/Dokumente an neuverdrahtet senden. Token + Ziel-Worker-URL kommen als
// Query-Parameter aus dem Link, den die Verwaltung erzeugt (siehe
// verwaltung/js/views/kunden.js openUploadLinkModal). Serverseitig validiert
// cloudflare-worker/worker.js (handleKundenUpload) den Token gegen die
// Firestore-Collection uploadLinks und legt die Datei direkt als normalen
// Dokumente-Eintrag des Kunden an.
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const workerUrl = params.get('w') || '';

  const card = document.getElementById('card');
  const intro = document.getElementById('intro');
  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const filelist = document.getElementById('filelist');
  const submitBtn = document.getElementById('submit-btn');
  const statusEl = document.getElementById('status');
  const beschreibungEl = document.getElementById('beschreibung');

  const MAX_BYTES = 25 * 1024 * 1024;

  function zeigeFehlerSeite(text) {
    card.innerHTML = `<h1>Link ungültig</h1><p class="sub">${text}</p>`;
  }

  if (!token || !workerUrl) {
    zeigeFehlerSeite('Dieser Link ist unvollständig. Bitte den Link erneut vom Betrieb anfordern.');
    return;
  }

  let workerOrigin;
  try {
    workerOrigin = new URL(workerUrl).origin;
    if (!/\.workers\.dev$/.test(new URL(workerUrl).hostname)) throw new Error('unexpected host');
  } catch {
    zeigeFehlerSeite('Dieser Link ist fehlerhaft. Bitte den Link erneut vom Betrieb anfordern.');
    return;
  }

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    filelist.innerHTML = files.map((f) => {
      const zuGross = f.size > MAX_BYTES;
      const groesse = f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`;
      return `<div style="${zuGross ? 'color:#e06060' : ''}">${escapeHtml(f.name)} <span>${groesse}${zuGross ? ' – zu groß (max. 25 MB)' : ''}</span></div>`;
    }).join('');
  });

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsDataURL(file);
    });
  }

  // Verkleinert Fotos clientseitig (max. 1600px Kante, JPEG ~80%) - mobile
  // Kamerafotos sind oft 10+ MB, das spart dem Kunden mobile Daten und der
  // Upload ist deutlich schneller. PDFs werden unverändert übernommen.
  function compressImageIfNeeded(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/webp') return fileToDataUrl(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.onerror = () => reject(new Error('Foto konnte nicht gelesen werden.'));
      img.onload = () => {
        const maxSeite = 1600;
        const skala = Math.min(1, maxSeite / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * skala);
        canvas.height = Math.round(img.naturalHeight * skala);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Foto konnte nicht verarbeitet werden.'));
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      statusEl.className = 'status err';
      statusEl.textContent = 'Bitte mindestens eine Datei auswählen.';
      return;
    }
    if (files.some((f) => f.size > MAX_BYTES)) {
      statusEl.className = 'status err';
      statusEl.textContent = 'Mindestens eine Datei ist zu groß (maximal 25 MB je Datei).';
      return;
    }
    submitBtn.disabled = true;
    fileInput.disabled = true;
    const beschreibung = beschreibungEl.value.trim();
    let fertig = 0;
    let fehler = 0;
    for (const file of files) {
      statusEl.className = 'status';
      statusEl.textContent = `Lädt hoch ... (${fertig + fehler + 1} / ${files.length})`;
      try {
        const fileDataUrl = await compressImageIfNeeded(file);
        const res = await fetch(`${workerOrigin}/kunde-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, dateiname: file.name, fileDataUrl, beschreibung }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Fehler (${res.status})`);
        fertig += 1;
      } catch (err) {
        fehler += 1;
        statusEl.className = 'status err';
        statusEl.textContent = `Fehler bei "${file.name}": ${err.message}`;
        if (/ungültig|abgelaufen/i.test(err.message)) break;
      }
    }
    submitBtn.disabled = false;
    fileInput.disabled = false;
    if (fehler === 0) {
      form.innerHTML = '';
      intro.textContent = '';
      statusEl.className = 'status ok';
      statusEl.textContent = `✓ ${fertig} Datei${fertig === 1 ? '' : 'en'} erfolgreich hochgeladen. Vielen Dank!`;
      card.appendChild(statusEl);
    } else if (fertig > 0) {
      statusEl.className = 'status err';
      statusEl.textContent = `${fertig} von ${files.length} Datei(en) hochgeladen, ${fehler} fehlgeschlagen.`;
    }
  });
})();
