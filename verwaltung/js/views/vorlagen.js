import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';

export async function render(container) {
  let [vorlagen, katalog, settings] = await Promise.all([getAll('vorlagen'), getAll('katalog'), getSettings()]);
  vorlagen.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Vorlagen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neue Vorlage</button></div>
    </div>
    <p class="hint">Vorlagen bündeln mehrere Positionen (z.B. ein Standardpaket "Steckdose montieren"), die du in Angeboten/Rechnungen mit einem Klick übernehmen kannst.</p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (vorlagen.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Vorlagen angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Positionen</th><th class="text-right">Summe (netto)</th></tr></thead>
        <tbody>
          ${vorlagen.map((v) => {
            const summe = (v.positionen || []).reduce((s, p) => s + (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0), 0);
            return `
            <tr data-id="${v.id}">
              <td>${escapeHtml(v.name)}</td>
              <td>${(v.positionen || []).length}</td>
              <td class="text-right">${formatCurrency(summe)}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(vorlagen.find((v) => v.id === row.dataset.id)));
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(v) {
    const isEdit = !!v;
    const data = v || { id: uid(), name: '', positionen: [] };
    const { body, close } = openModal({
      title: isEdit ? 'Vorlage bearbeiten' : 'Neue Vorlage',
      wide: true,
      bodyHtml: `
        <form id="vorlage-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
          </div>
          <div class="divider"></div>
          <div id="pos-host"></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    const editor = createPositionsEditor({
      host: body.querySelector('#pos-host'),
      katalog,
      positionen: data.positionen,
      defaultSteuersatz: settings.standardSteuersatz,
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Vorlage "${data.name}" wirklich löschen?`)) return;
        await remove('vorlagen', data.id);
        toast('Vorlage gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#vorlage-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data, name: (fd.get('name') || '').toString().trim(), positionen: editor.getPositionen() };
      if (!updated.name) return;
      await put('vorlagen', updated);
      toast(isEdit ? 'Vorlage aktualisiert' : 'Vorlage angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
