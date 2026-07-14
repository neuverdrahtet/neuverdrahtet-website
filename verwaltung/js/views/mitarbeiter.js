import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

const FARBEN = ['#f0a020', '#2b7fd6', '#1f8a4c', '#c0392b', '#8e44ad', '#16a085', '#d35400', '#2c3e50'];

export async function render(container) {
  let mitarbeiter = await getAll('mitarbeiter');
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Mitarbeiter</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neuer Mitarbeiter</button></div>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (mitarbeiter.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Mitarbeiter angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th></th><th>Name</th><th>Rolle</th><th>Telefon</th><th>E-Mail</th></tr></thead>
        <tbody>
          ${mitarbeiter.map((m) => `
            <tr data-id="${m.id}">
              <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${m.farbe || '#f0a020'}"></span></td>
              <td>${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.rolle || '')}</td>
              <td>${escapeHtml(m.telefon || '')}</td>
              <td>${escapeHtml(m.email || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(mitarbeiter.find((m) => m.id === row.dataset.id)));
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(m) {
    const isEdit = !!m;
    const data = m || { id: uid(), name: '', rolle: '', telefon: '', email: '', farbe: FARBEN[mitarbeiter.length % FARBEN.length] };
    const { body, close } = openModal({
      title: isEdit ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter',
      bodyHtml: `
        <form id="ma-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
            <div class="field"><label>Rolle</label><input name="rolle" placeholder="z.B. Elektriker" value="${escapeHtml(data.rolle || '')}"></div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field"><label>Kalenderfarbe</label>
              <select name="farbe">
                ${FARBEN.map((f) => `<option value="${f}" ${f === data.farbe ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
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
    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Mitarbeiter "${data.name}" wirklich löschen?`)) return;
        await remove('mitarbeiter', data.id);
        toast('Mitarbeiter gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#ma-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      if (!updated.name) return;
      await put('mitarbeiter', updated);
      toast(isEdit ? 'Mitarbeiter aktualisiert' : 'Mitarbeiter angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
