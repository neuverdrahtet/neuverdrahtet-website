import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

export async function render(container) {
  let items = await getAll('katalog');
  const settings = await getSettings();
  items.sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  let filtered = items;
  let typeFilter = '';

  container.innerHTML = `
    <div class="view-header">
      <h1>Artikel &amp; Leistungen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neuer Eintrag</button></div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche ...">
      <select id="type-filter">
        <option value="">Alle Typen</option>
        <option value="artikel">Artikel</option>
        <option value="leistung">Leistung</option>
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    filtered = items.filter((i) => {
      if (typeFilter && i.typ !== typeFilter) return false;
      if (!q) return true;
      return [i.bezeichnung, i.beschreibung].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Artikel/Leistungen angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Typ</th><th>Bezeichnung</th><th>Einheit</th><th>Preis (netto)</th><th>USt.</th></tr></thead>
        <tbody>
          ${filtered.map((i) => `
            <tr data-id="${i.id}">
              <td><span class="badge ${i.typ === 'artikel' ? 'badge-accent' : 'badge-success'}">${i.typ === 'artikel' ? 'Artikel' : 'Leistung'}</span></td>
              <td>${escapeHtml(i.bezeichnung)}</td>
              <td>${escapeHtml(i.einheit || '')}</td>
              <td>${formatCurrency(i.preis)}</td>
              <td>${i.steuersatz}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(items.find((i) => i.id === row.dataset.id)));
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    applyFilter();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(item) {
    const isEdit = !!item;
    const data = item || { id: uid(), typ: 'leistung', bezeichnung: '', beschreibung: '', einheit: 'Std.', preis: 0, steuersatz: settings.standardSteuersatz };
    const { body, close } = openModal({
      title: isEdit ? 'Eintrag bearbeiten' : 'Neuer Artikel / Leistung',
      bodyHtml: `
        <form id="kat-form">
          <div class="form-grid">
            <div class="field"><label>Typ</label>
              <select name="typ">
                <option value="leistung" ${data.typ === 'leistung' ? 'selected' : ''}>Leistung</option>
                <option value="artikel" ${data.typ === 'artikel' ? 'selected' : ''}>Artikel</option>
              </select>
            </div>
            <div class="field"><label>Einheit</label><input name="einheit" placeholder="Std., Stk., pauschal ..." value="${escapeHtml(data.einheit || '')}"></div>
            <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
            <div class="field"><label>Preis netto (€)</label><input type="number" step="0.01" min="0" name="preis" value="${data.preis}"></div>
            <div class="field"><label>USt.-Satz (%)</label>
              <select name="steuersatz">
                <option value="19" ${Number(data.steuersatz) === 19 ? 'selected' : ''}>19%</option>
                <option value="7" ${Number(data.steuersatz) === 7 ? 'selected' : ''}>7%</option>
                <option value="0" ${Number(data.steuersatz) === 0 ? 'selected' : ''}>0%</option>
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
        if (!confirmDelete(`"${data.bezeichnung}" wirklich löschen?`)) return;
        await remove('katalog', data.id);
        toast('Eintrag gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#kat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      updated.preis = Number(updated.preis) || 0;
      updated.steuersatz = Number(updated.steuersatz) || 0;
      if (!updated.bezeichnung) return;
      await put('katalog', updated);
      toast(isEdit ? 'Eintrag aktualisiert' : 'Eintrag angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
