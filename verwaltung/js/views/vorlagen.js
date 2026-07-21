import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';

export async function render(container) {
  let vorlagen = await getAll('vorlagen');
  vorlagen.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const bulk = createBulkSelect('vorlagen', { label: 'Vorlagen' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Vorlagen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neue Vorlage</button></div>
    </div>
    <p class="hint">Dokumentations-Vorlagen sind Text-Bausteine für Berichte (z.B. Abnahmeprotokoll), die du bei einem Projekt-Dokument einfügen kannst.</p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (vorlagen.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Vorlagen angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Name</th></tr></thead>
        <tbody>
          ${vorlagen.map((v) => `
            <tr data-id="${v.id}">
              ${bulk.rowCell(v.id)}
              <td>${escapeHtml(v.name)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(vorlagen.find((v) => v.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        vorlagen = vorlagen.filter((v) => !ids.includes(v.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(v) {
    const isEdit = !!v;
    const data = v || { id: uid(), typ: 'dokumentation', name: '', textVorlage: '' };

    const { body, close } = openModal({
      title: isEdit ? 'Vorlage bearbeiten' : 'Neue Vorlage',
      wide: true,
      bodyHtml: `
        <form id="vorlage-form">
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
          </div>
          <div class="divider"></div>
          <div class="field">
            <label>Text-Vorlage</label>
            <textarea name="textVorlage" style="min-height:220px" placeholder="Platzhalter: {{firma}}, {{kunde}}, {{projekt}}, {{datum}}">${escapeHtml(data.textVorlage || '')}</textarea>
          </div>
          <p class="hint">Diese Vorlage steht bei Projekt-Dokumenten unter "Bericht aus Vorlage erstellen" zur Auswahl.</p>
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
      const updated = {
        ...data,
        name: (fd.get('name') || '').toString().trim(),
        typ: 'dokumentation',
        textVorlage: (fd.get('textVorlage') || '').toString(),
      };
      if (!updated.name) return;
      await put('vorlagen', updated);
      toast(isEdit ? 'Vorlage aktualisiert' : 'Vorlage angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
