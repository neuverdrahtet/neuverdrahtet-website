import { getAll, put, remove } from './db.js';
import { uid, escapeHtml, compressImage, toast } from './utils.js';
import { confirmDelete, openModal } from './ui.js';
import { FIREBASE_ENABLED, uploadBlobToStorage, deleteBlobFromStorage } from './blobstore.js';

function berechneFlaeche(a) {
  const laenge = Number(a.laenge) || 0;
  const breite = Number(a.breite) || 0;
  if (!laenge || !breite) return null;
  return Math.round(laenge * breite * 100) / 100;
}

/** Aufmaß und Dokumentation vor Ort: strukturierte Maßaufnahme je Raum/Bauteil, mit optionalem Foto. */
export function renderAufmassSection(host, projektId) {
  async function load() {
    const eintraege = (await getAll('aufmasse'))
      .filter((a) => a.projektId === projektId)
      .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));

    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
        <h2 style="font-size:14px;margin:0">Aufmaß</h2>
        <button type="button" class="btn btn-sm" id="btn-aufmass-neu">+ Maß erfassen</button>
      </div>
      ${eintraege.length === 0 ? '<p class="text-mute">Noch kein Aufmaß erfasst.</p>' : `
        <table class="data-table">
          <thead><tr><th>Raum/Bauteil</th><th class="text-right">L × B × H (m)</th><th class="text-right">Fläche</th><th class="text-right">Menge</th><th></th><th></th></tr></thead>
          <tbody>
            ${eintraege.map((a) => {
              const flaeche = berechneFlaeche(a);
              return `
                <tr data-id="${a.id}">
                  <td>${escapeHtml(a.bezeichnung || '')}${a.notiz ? `<div class="text-mute" style="font-size:11px">${escapeHtml(a.notiz)}</div>` : ''}</td>
                  <td class="text-right">${[a.laenge, a.breite, a.hoehe].filter((v) => v !== '' && v != null).length ? `${a.laenge || '–'} × ${a.breite || '–'}${a.hoehe ? ' × ' + a.hoehe : ''}` : '–'}</td>
                  <td class="text-right">${flaeche != null ? `${flaeche} m²` : '–'}</td>
                  <td class="text-right">${a.menge ? `${a.menge} ${escapeHtml(a.einheit || '')}` : '–'}</td>
                  <td>${(a.url || a.blob) ? `<button type="button" class="btn btn-sm aufmass-foto" data-id="${a.id}" title="Foto ansehen">📷</button>` : ''}</td>
                  <td>
                    <button type="button" class="btn btn-sm aufmass-edit" data-id="${a.id}" title="Bearbeiten">✎</button>
                    <button type="button" class="btn btn-sm btn-ghost aufmass-del" data-id="${a.id}" title="Löschen">✕</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `}
    `;

    host.querySelector('#btn-aufmass-neu').addEventListener('click', () => openForm());
    host.querySelectorAll('.aufmass-edit').forEach((btn) => {
      btn.addEventListener('click', () => openForm(eintraege.find((a) => a.id === btn.dataset.id)));
    });
    host.querySelectorAll('.aufmass-foto').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = eintraege.find((x) => x.id === btn.dataset.id);
        const url = a?.url || (a?.blob ? URL.createObjectURL(a.blob) : '');
        if (!url) return;
        openModal({ title: a.bezeichnung || 'Foto', wide: true, bodyHtml: `<div style="display:flex;justify-content:center"><img src="${escapeHtml(url)}" alt="" style="max-width:100%;max-height:75vh;border-radius:8px"></div>` });
      });
    });
    host.querySelectorAll('.aufmass-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Aufmaß-Eintrag wirklich löschen?')) return;
        const a = eintraege.find((x) => x.id === btn.dataset.id);
        await remove('aufmasse', btn.dataset.id);
        if (a?.path) await deleteBlobFromStorage(a.path);
        load();
      });
    });
  }

  function openForm(a) {
    const isEdit = !!a;
    const data = a || { id: uid(), projektId, bezeichnung: '', laenge: '', breite: '', hoehe: '', menge: '', einheit: 'Stk.', notiz: '', erstelltAm: new Date().toISOString() };
    const { body, close } = openModal({
      title: isEdit ? 'Aufmaß bearbeiten' : 'Aufmaß erfassen',
      bodyHtml: `
        <form id="aufmass-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Raum/Bauteil</label><input name="bezeichnung" value="${escapeHtml(data.bezeichnung || '')}" placeholder="z.B. Wohnzimmer, Wand Nord" required></div>
            <div class="field"><label>Länge (m)</label><input type="number" step="0.01" min="0" name="laenge" value="${data.laenge || ''}"></div>
            <div class="field"><label>Breite (m)</label><input type="number" step="0.01" min="0" name="breite" value="${data.breite || ''}"></div>
            <div class="field"><label>Höhe (m, optional)</label><input type="number" step="0.01" min="0" name="hoehe" value="${data.hoehe || ''}"></div>
            <div class="field"><label>Menge/Stückzahl (falls nicht Fläche)</label><input type="number" step="0.01" min="0" name="menge" value="${data.menge || ''}"></div>
            <div class="field"><label>Einheit</label><input name="einheit" value="${escapeHtml(data.einheit || 'Stk.')}"></div>
            <div class="field col-span-2"><label>Notiz</label><textarea name="notiz" rows="2">${escapeHtml(data.notiz || '')}</textarea></div>
            <div class="field col-span-2"><label>Foto (optional)</label><input type="file" accept="image/*" id="af-foto-input"></div>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    let neuesFoto = null;
    body.querySelector('#af-foto-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { neuesFoto = await compressImage(file); toast('Foto hinzugefügt (wird beim Speichern übernommen)', 'success'); }
      catch (err) { toast(err.message, 'danger'); }
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Aufmaß-Eintrag wirklich löschen?')) return;
        await remove('aufmasse', data.id);
        if (data.path) await deleteBlobFromStorage(data.path);
        close();
        load();
      });
    }
    body.querySelector('#aufmass-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.bezeichnung = (fd.get('bezeichnung') || '').toString().trim();
      updated.laenge = fd.get('laenge') ? Number(fd.get('laenge')) : '';
      updated.breite = fd.get('breite') ? Number(fd.get('breite')) : '';
      updated.hoehe = fd.get('hoehe') ? Number(fd.get('hoehe')) : '';
      updated.menge = fd.get('menge') ? Number(fd.get('menge')) : '';
      updated.einheit = (fd.get('einheit') || '').toString().trim();
      updated.notiz = (fd.get('notiz') || '').toString().trim();
      if (!updated.bezeichnung) return;
      if (neuesFoto) {
        if (FIREBASE_ENABLED) {
          const meta = await uploadBlobToStorage(`aufmasse/${projektId}/${updated.id}`, neuesFoto);
          Object.assign(updated, meta);
        } else {
          updated.blob = neuesFoto;
        }
      }
      await put('aufmasse', updated);
      toast(isEdit ? 'Aufmaß aktualisiert' : 'Aufmaß erfasst', 'success');
      close();
      load();
    });
  }

  load();
}
