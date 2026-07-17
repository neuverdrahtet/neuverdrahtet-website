import { escapeHtml } from './utils.js';

/**
 * Mounts a canvas-based signature pad into `host`. Works with mouse, touch
 * and pen via Pointer Events. Returns getters for the drawn PNG so callers
 * can embed it into a PDF (e.g. Kunden-/Mitarbeiter-Unterschrift bei Berichten).
 */
export function mountSignaturePad(host, { label } = {}) {
  host.innerHTML = `
    <div class="field">
      ${label ? `<label>${escapeHtml(label)}</label>` : ''}
      <div class="sig-pad-wrap">
        <canvas class="sig-pad-canvas" width="360" height="140"></canvas>
      </div>
      <button type="button" class="btn btn-sm sig-pad-clear" style="margin-top:6px;align-self:flex-start">Unterschrift löschen</button>
    </div>
  `;
  const canvas = host.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1b1c20';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let drawing = false;
  let hasContent = false;
  let last = null;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  function start(e) {
    drawing = true;
    last = pos(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    hasContent = true;
    e.preventDefault();
  }
  function end() { drawing = false; last = null; }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  host.querySelector('.sig-pad-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasContent = false;
  });

  return {
    isEmpty: () => !hasContent,
    getDataUrl: () => (hasContent ? canvas.toDataURL('image/png') : null),
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasContent = false; },
  };
}
