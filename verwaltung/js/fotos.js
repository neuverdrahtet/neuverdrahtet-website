import { getAll, put, remove } from './db.js';
import { uid, escapeHtml, compressImage, toast } from './utils.js';
import { confirmDelete, openModal } from './ui.js';
import { FIREBASE_ENABLED, uploadBlobToStorage, deleteBlobFromStorage } from './blobstore.js';

function openFotoLightbox(url, dateiname) {
  openModal({
    title: dateiname || 'Foto',
    wide: true,
    bodyHtml: `<div style="display:flex;justify-content:center"><img src="${escapeHtml(url)}" alt="" style="max-width:100%;max-height:75vh;border-radius:8px"></div>`,
  });
}

export function renderFotoSection(host, projektId) {
  async function load() {
    const fotos = (await getAll('fotos'))
      .filter((f) => f.projektId === projektId)
      .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));

    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
        <h2 style="font-size:14px;margin:0">Fotos</h2>
        <label class="btn btn-sm" style="cursor:pointer">
          + Foto hinzufügen
          <input type="file" accept="image/*" capture="environment" id="foto-input" hidden multiple>
        </label>
      </div>
      <div class="foto-grid" id="foto-grid">
        ${fotos.length === 0 ? '<p class="text-mute">Noch keine Fotos.</p>' : fotos.map((f) => `
          <div class="foto-thumb" data-id="${f.id}">
            <img src="${f.url ? escapeHtml(f.url) : (f.blob ? URL.createObjectURL(f.blob) : '')}" alt="" title="Zum Vergrößern anklicken">
            <button type="button" class="foto-del" data-id="${f.id}" title="Löschen">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    host.querySelector('#foto-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      const label = host.querySelector('label.btn');
      label.textContent = 'Lädt ...';
      for (const file of files) {
        try {
          const blob = await compressImage(file);
          const id = uid();
          const row = { id, projektId, erstelltAm: new Date().toISOString(), dateiname: file.name };
          if (FIREBASE_ENABLED) {
            const meta = await uploadBlobToStorage(`fotos/${projektId}/${id}`, blob);
            Object.assign(row, meta);
          } else {
            row.blob = blob;
          }
          await put('fotos', row);
        } catch (err) {
          toast(err.message, 'danger');
        }
      }
      load();
    });

    host.querySelectorAll('.foto-thumb img').forEach((img) => {
      img.addEventListener('click', () => {
        const id = img.closest('.foto-thumb').dataset.id;
        openFotoLightbox(img.src, fotos.find((f) => f.id === id)?.dateiname);
      });
    });

    host.querySelectorAll('.foto-del').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!confirmDelete('Foto wirklich löschen?')) return;
        const foto = fotos.find((f) => f.id === btn.dataset.id);
        await remove('fotos', btn.dataset.id);
        if (foto?.path) await deleteBlobFromStorage(foto.path);
        load();
      });
    });
  }

  load();
}
