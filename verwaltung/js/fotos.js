import { getAll, put, remove } from './db.js';
import { uid, compressImage, toast } from './utils.js';
import { confirmDelete } from './ui.js';

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
            <img src="${URL.createObjectURL(f.blob)}" alt="">
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
          await put('fotos', { id: uid(), projektId, blob, erstelltAm: new Date().toISOString(), dateiname: file.name });
        } catch (err) {
          toast(err.message, 'danger');
        }
      }
      load();
    });

    host.querySelectorAll('.foto-del').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!confirmDelete('Foto wirklich löschen?')) return;
        await remove('fotos', btn.dataset.id);
        load();
      });
    });
  }

  load();
}
