import { getSettings, getAll, put, remove, GEWERKE } from '../db.js';
import { uid, escapeHtml, toast, compressImage } from '../utils.js';
import { confirmDelete } from '../ui.js';
import { generateSocialPost } from '../ai.js';

// width/height je Kanal orientiert an den jeweils empfohlenen Bildformaten
// (Instagram-Feed quadratisch, Facebook/LinkedIn Link-Vorschau ca. 1.91:1,
// Google Unternehmensprofil-Beitrag ca. 4:3). "key" ist das Feld im
// KI-Ergebnis (siehe callClaudeSocialPost im Worker), "hashtags" steuert, ob
// die separat gelieferten Hashtags für diesen Kanal angezeigt/mitkopiert werden.
const CHANNELS = [
  { id: 'instagram', label: 'Instagram', icon: '📸', width: 1080, height: 1080, hashtags: true },
  { id: 'facebook', label: 'Facebook', icon: '👍', width: 1200, height: 630, hashtags: true },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼', width: 1200, height: 627, hashtags: false },
  { id: 'google', label: 'Google Unternehmensprofil', icon: '📍', width: 1200, height: 900, hashtags: false },
];

function ortAusPlzOrt(plzOrt) {
  return (plzOrt || '').replace(/^\s*\d{4,5}\s*/, '').trim();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Füllt das Zielformat komplett aus (wie CSS object-fit: cover) statt das
// Foto zu verzerren oder Ränder freizulassen - Mittelteil des Fotos bleibt
// dabei erhalten, überschüssige Ränder werden abgeschnitten.
function drawCover(ctx, img, w, h) {
  const ir = img.width / img.height;
  const cr = w / h;
  let sw, sh, sx, sy;
  if (ir > cr) {
    sh = img.height;
    sw = sh * cr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / cr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

/** Erzeugt aus einem Foto ein gebranntes Canvas im Zielformat: Foto + abgedunkelter Boden + Firmenname/Ort + Logo-Chip unten rechts. */
function brandCanvas({ img, logoImg, width, height, firmenname, ort }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawCover(ctx, img, width, height);

  const grad = ctx.createLinearGradient(0, height * 0.7, 0, height);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, height * 0.7, width, height * 0.3);

  const pad = height * 0.028;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#fff';
  const nameSize = Math.round(height * 0.044);
  ctx.font = `700 ${nameSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(firmenname || '', pad, height - pad - (ort ? nameSize * 0.85 : 0));
  if (ort) {
    const ortSize = Math.round(height * 0.03);
    ctx.font = `400 ${ortSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(ort, pad, height - pad);
  }
  ctx.restore();

  if (logoImg) {
    const maxLogoH = height * 0.12;
    const maxLogoW = width * 0.32;
    const scale = Math.min(maxLogoH / logoImg.height, maxLogoW / logoImg.width);
    const lw = logoImg.width * scale;
    const lh = logoImg.height * scale;
    const chipPad = height * 0.016;
    const chipW = lw + chipPad * 2;
    const chipH = lh + chipPad * 2;
    const chipX = width - chipW - pad;
    const chipY = height - chipH - pad;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, chipX, chipY, chipW, chipH, chipH * 0.16);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(logoImg, chipX + chipPad, chipY + chipPad, lw, lh);
    ctx.restore();
  }

  return canvas;
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) { toast('Bild konnte nicht erzeugt werden.', 'danger'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/jpeg', 0.92);
}

function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => toast('Text kopiert', 'success'))
    .catch(() => toast('Kopieren nicht möglich – bitte manuell markieren.', 'danger'));
}

function renderHistory(posts) {
  if (!posts.length) return '<p class="text-mute">Noch keine Posts erstellt.</p>';
  return `<div class="foto-grid">
    ${posts.map((p) => `
      <div class="foto-thumb" data-history-id="${p.id}" title="${escapeHtml([p.gewerk, p.leistung, p.ort].filter(Boolean).join(' – ') || 'Post')}">
        <img src="${p.thumbDataUrl || ''}" alt="">
        <button type="button" class="foto-del" data-history-del="${p.id}" title="Löschen">✕</button>
      </div>
    `).join('')}
  </div>`;
}

export async function render(container) {
  const settings = await getSettings();
  let posts = await getAll('socialPosts');
  posts.sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));

  let logoImg = null;
  try {
    logoImg = await loadImage(settings.logoDataUrl || '../assets/logo/logo-full.png');
  } catch {
    logoImg = null; // Branding funktioniert auch ohne Logo weiter (nur ohne Logo-Chip)
  }

  let photoFile = null;
  let brandSourceImg = null;
  let aiImageDataUrl = null;

  container.innerHTML = `
    <div class="view-header">
      <h1>Social-Media-Post</h1>
    </div>

    <div class="card">
      <h2>Neuer Post aus Foto</h2>
      <p class="hint">
        Foto hochladen – die KI schlägt passende, lokal optimierte Texte je Kanal vor, das Foto wird automatisch mit eurem Logo gebrandet.
        Veröffentlicht wird bewusst nicht automatisch: Bild herunterladen bzw. Text kopieren und selbst auf Instagram/Facebook/LinkedIn/Google posten.
      </p>
      <div class="form-grid">
        <div class="field col-span-2">
          <label>Foto</label>
          <input type="file" id="social-foto-input" accept="image/*">
        </div>
        <div class="field">
          <label>Gewerk</label>
          <select id="social-gewerk">
            <option value="">Kein bestimmtes Gewerk</option>
            ${GEWERKE.map((g) => `<option value="${escapeHtml(g.titel)}">${escapeHtml(g.titel)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Ort</label><input id="social-ort" value="${escapeHtml(ortAusPlzOrt(settings.plzOrt))}" placeholder="z.B. Essen"></div>
        <div class="field col-span-2"><label>Leistung / Anlass</label><input id="social-leistung" placeholder="z.B. Wallbox-Installation, Badsanierung, Fliesenverlegung ..."></div>
        <div class="field col-span-2"><label>Kontext / Stichpunkte (optional)</label><textarea id="social-kontext" rows="2" placeholder="z.B. Neubau-Einfamilienhaus, komplette Elektroinstallation, Fertigstellung diese Woche"></textarea></div>
      </div>
      <div id="social-preview" style="margin:10px 0"></div>
      <div class="modal-actions" style="border:none;padding-top:4px">
        <button type="button" class="btn btn-primary" id="btn-generate" disabled>✨ KI-Post generieren</button>
      </div>
    </div>

    <div id="social-result"></div>

    <div class="card">
      <h2>Frühere Posts</h2>
      <div id="social-history">${renderHistory(posts)}</div>
    </div>
  `;

  const fotoInput = container.querySelector('#social-foto-input');
  const previewHost = container.querySelector('#social-preview');
  const generateBtn = container.querySelector('#btn-generate');
  const resultHost = container.querySelector('#social-result');
  const historyHost = container.querySelector('#social-history');

  function renderResult(record, img, { fromHistory = false } = {}) {
    resultHost.innerHTML = `
      <div class="card">
        <h2>Vorschau je Kanal</h2>
        ${fromHistory ? '<p class="hint">Aus dem Verlauf geöffnet – das Bild liegt hier nur in reduzierter Auflösung vor.</p>' : ''}
        ${record.altText ? `<p class="hint">Alt-Text fürs Bild (Barrierefreiheit &amp; Bild-SEO, beim Hochladen auf der Plattform eintragen): „${escapeHtml(record.altText)}“</p>` : ''}
        <div class="social-channel-grid">
          ${CHANNELS.map((ch) => `
            <div class="social-channel-card">
              <h3>${ch.icon} ${escapeHtml(ch.label)}</h3>
              <div class="social-canvas-host" data-canvas-host="${ch.id}"></div>
              <textarea data-text="${ch.id}" rows="5">${escapeHtml(record.kanaele[ch.id]?.text || '')}</textarea>
              ${ch.hashtags && record.hashtags?.length ? `<p class="hint">${escapeHtml(record.hashtags.join(' '))}</p>` : ''}
              <div class="flex-row flex-wrap" style="margin-top:8px;gap:8px">
                <button type="button" class="btn btn-sm" data-dl="${ch.id}">⬇️ Bild herunterladen</button>
                <button type="button" class="btn btn-sm" data-copy="${ch.id}">📋 Text kopieren</button>
                <label class="btn btn-sm btn-ghost" style="cursor:pointer">
                  <input type="checkbox" data-posted="${ch.id}" ${record.kanaele[ch.id]?.veroeffentlicht ? 'checked' : ''} style="margin-right:6px">Veröffentlicht
                </label>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const canvases = {};
    for (const ch of CHANNELS) {
      const canvas = brandCanvas({ img, logoImg, width: ch.width, height: ch.height, firmenname: settings.firmenname, ort: record.ort });
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.borderRadius = '8px';
      canvas.style.border = '1px solid var(--border)';
      canvases[ch.id] = canvas;
      resultHost.querySelector(`[data-canvas-host="${ch.id}"]`).appendChild(canvas);
    }

    resultHost.querySelectorAll('[data-dl]').forEach((btn) => {
      btn.addEventListener('click', () => downloadCanvas(canvases[btn.dataset.dl], `${btn.dataset.dl}-post-${record.id}.jpg`));
    });
    resultHost.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.copy;
        const ch = CHANNELS.find((c) => c.id === id);
        const text = resultHost.querySelector(`[data-text="${id}"]`).value;
        const hashtagLine = ch.hashtags && record.hashtags?.length ? `\n\n${record.hashtags.join(' ')}` : '';
        copyText(text + hashtagLine);
      });
    });
    resultHost.querySelectorAll('[data-text]').forEach((ta) => {
      ta.addEventListener('change', async () => {
        record.kanaele[ta.dataset.text] = { ...record.kanaele[ta.dataset.text], text: ta.value };
        await put('socialPosts', record);
      });
    });
    resultHost.querySelectorAll('[data-posted]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.posted;
        record.kanaele[id] = { ...record.kanaele[id], veroeffentlicht: cb.checked, veroeffentlichtAm: cb.checked ? new Date().toISOString() : '' };
        await put('socialPosts', record);
        posts = posts.map((p) => (p.id === record.id ? record : p));
      });
    });
  }

  function attachHistoryHandlers() {
    historyHost.querySelectorAll('[data-history-id]').forEach((thumb) => {
      thumb.addEventListener('click', async (e) => {
        if (e.target.closest('[data-history-del]')) return;
        const record = posts.find((p) => p.id === thumb.dataset.historyId);
        if (!record?.thumbDataUrl) return;
        try {
          const img = await loadImage(record.thumbDataUrl);
          renderResult(record, img, { fromHistory: true });
          resultHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
          toast(err.message, 'danger');
        }
      });
    });
    historyHost.querySelectorAll('[data-history-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirmDelete('Post wirklich löschen?')) return;
        await remove('socialPosts', btn.dataset.historyDel);
        posts = posts.filter((p) => p.id !== btn.dataset.historyDel);
        historyHost.innerHTML = renderHistory(posts);
        attachHistoryHandlers();
      });
    });
  }
  attachHistoryHandlers();

  fotoInput.addEventListener('change', async () => {
    const file = fotoInput.files?.[0];
    if (!file) return;
    previewHost.innerHTML = '<p class="text-mute">Foto wird vorbereitet ...</p>';
    generateBtn.disabled = true;
    try {
      photoFile = file;
      const brandBlob = await compressImage(file, { maxWidth: 1600, quality: 0.85 });
      brandSourceImg = await loadImage(URL.createObjectURL(brandBlob));
      aiImageDataUrl = await blobToDataUrl(await compressImage(file, { maxWidth: 1000, quality: 0.7 }));
      previewHost.innerHTML = `<img src="${brandSourceImg.src}" alt="" style="max-width:220px;max-height:220px;border-radius:8px;border:1px solid var(--border);display:block;object-fit:cover">`;
      generateBtn.disabled = false;
    } catch (err) {
      previewHost.innerHTML = '';
      toast(err.message, 'danger');
    }
  });

  generateBtn.addEventListener('click', async () => {
    if (!brandSourceImg || !aiImageDataUrl || !photoFile) return;
    const originalLabel = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.textContent = 'Wird generiert ...';
    try {
      const gewerk = container.querySelector('#social-gewerk').value.trim();
      const ort = container.querySelector('#social-ort').value.trim();
      const leistung = container.querySelector('#social-leistung').value.trim();
      const kontext = container.querySelector('#social-kontext').value.trim();
      const result = await generateSocialPost({
        imageDataUrl: aiImageDataUrl,
        firmenname: settings.firmenname,
        ort, gewerk, leistung, kontext,
      });
      const thumbBlob = await compressImage(photoFile, { maxWidth: 300, quality: 0.6 });
      const record = {
        id: uid(),
        erstelltAm: new Date().toISOString(),
        ort, gewerk, leistung, kontext,
        altText: result.altText || '',
        hashtags: Array.isArray(result.hashtags) ? result.hashtags : [],
        thumbDataUrl: await blobToDataUrl(thumbBlob),
        kanaele: {
          instagram: { text: result.instagram || '', veroeffentlicht: false, veroeffentlichtAm: '' },
          facebook: { text: result.facebook || '', veroeffentlicht: false, veroeffentlichtAm: '' },
          linkedin: { text: result.linkedin || '', veroeffentlicht: false, veroeffentlichtAm: '' },
          google: { text: result.googleBusiness || '', veroeffentlicht: false, veroeffentlichtAm: '' },
        },
      };
      await put('socialPosts', record);
      posts = [record, ...posts];
      historyHost.innerHTML = renderHistory(posts);
      attachHistoryHandlers();
      renderResult(record, brandSourceImg);
      resultHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Post generiert', 'success');
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = originalLabel;
    }
  });
}
