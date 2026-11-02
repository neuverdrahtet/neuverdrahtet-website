import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast, farbeAusText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';

// Teams/Kolonnen - fasst Mitarbeiter zu Einsatzgruppen zusammen, damit die
// Plantafel eine ganze Kolonne statt jedes Mitglied einzeln verplanen kann.
// Bewusst eigene, kleine View statt eines dritten Tabs in geraete.js: Teams
// teilen so gut wie nichts mit Geräten/Flotten (kein Status/Scan/Fahrtenbuch/
// CSV-Import, stattdessen eine Mitglieder-Mehrfachauswahl) - ein dritter Tab
// hätte geraete.js nur unnötig verkompliziert.
const FARBEN = ['#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c', '#6b7280'];

export async function render(container) {
  let [teams, mitarbeiter] = await Promise.all([getAll('teams'), getAll('mitarbeiter')]);
  teams.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const bulk = createBulkSelect('teams', { label: 'Teams' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Teams &amp; Kolonnen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neues Team</button></div>
    </div>
    <p class="hint">Teams bündeln Mitarbeiter zu Einsatzgruppen/Kolonnen - stehen in der Plantafel als eigene Zeile zur Verfügung.</p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (teams.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Noch keine Teams angelegt.</div>';
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th></th><th>Name</th><th>Mitglieder</th></tr></thead>
        <tbody>
          ${teams.map((t) => `
            <tr data-id="${t.id}">
              ${bulk.rowCell(t.id)}
              <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${t.farbe || FARBEN[0]}"></span></td>
              <td>${escapeHtml(t.name)}</td>
              <td>${(t.mitarbeiterIds || []).length
                ? (t.mitarbeiterIds || []).map((id) => mitarbeiterById[id]?.name).filter(Boolean).map((n) => escapeHtml(n)).join(', ')
                : '<span class="text-mute">– keine Mitglieder –</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(teams.find((t) => t.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        teams = teams.filter((t) => !ids.includes(t.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(item) {
    const isEdit = !!item;
    const neueId = uid();
    const data = item || { id: neueId, name: '', mitarbeiterIds: [], farbe: farbeAusText(neueId, FARBEN) };

    const { body, close } = openModal({
      title: isEdit ? 'Team bearbeiten' : 'Neues Team',
      bodyHtml: `
        <form id="team-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
          </div>
          <div class="field" style="margin-top:10px">
            <label>Mitglieder</label>
            ${mitarbeiter.length === 0 ? '<p class="hint">Noch keine Mitarbeiter angelegt.</p>' : `
              <div class="flex-row flex-wrap" style="gap:6px">
                ${mitarbeiter.map((m) => `
                  <label style="display:flex;align-items:center;gap:4px;border:1px solid var(--border,#ddd);border-radius:8px;padding:4px 8px;cursor:pointer">
                    <input type="checkbox" class="f-mitglied" value="${m.id}" ${(data.mitarbeiterIds || []).includes(m.id) ? 'checked' : ''}>
                    ${escapeHtml(m.name)}
                  </label>
                `).join('')}
              </div>
            `}
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
        if (!confirmDelete(`Team "${data.name}" in den Papierkorb verschieben?`)) return;
        await remove('teams', data.id);
        toast('In den Papierkorb verschoben');
        close();
        render(container);
      });
    }
    body.querySelector('#team-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data, name: (fd.get('name') || '').toString().trim() };
      updated.mitarbeiterIds = [...body.querySelectorAll('.f-mitglied:checked')].map((cb) => cb.value);
      if (!updated.name) return;
      await put('teams', updated);
      toast(isEdit ? 'Team aktualisiert' : 'Team angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
