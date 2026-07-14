import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatDate, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { renderFotoSection } from '../fotos.js';

export async function render(container) {
  let [projekte, kunden, mitarbeiter, spalten, angebote, rechnungen] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'), getAll('angebote'), getAll('rechnungen'),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  projekte.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  let filtered = projekte;

  container.innerHTML = `
    <div class="view-header">
      <h1>Projekte</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neues Projekt</button></div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Titel oder Kunde ...">
      <select id="status-filter"><option value="">Alle Status</option>${spalten.map((s) => `<option value="${s.id}">${escapeHtml(s.titel)}</option>`).join('')}</select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const status = container.querySelector('#status-filter').value;
    filtered = projekte.filter((p) => {
      if (status && p.status !== status) return false;
      if (!q) return true;
      const kunde = kundenById[p.kundeId];
      return [p.titel, kunde?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Keine Projekte gefunden.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Titel</th><th>Kunde</th><th>Status</th><th>Start</th><th>Ende</th></tr></thead>
        <tbody>
          ${filtered.map((p) => `
            <tr data-id="${p.id}">
              <td>${escapeHtml(p.titel)}</td>
              <td>${escapeHtml(kundenById[p.kundeId]?.firma || '')}</td>
              <td><span class="badge badge-accent">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</span></td>
              <td>${formatDate(p.start)}</td>
              <td>${formatDate(p.ende)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(projekte.find((p) => p.id === row.dataset.id)));
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#status-filter').addEventListener('change', applyFilter);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(p) {
    const isEdit = !!p;
    const data = p || { id: uid(), titel: '', kundeId: '', status: spalten[0]?.id || '', beschreibung: '', start: '', ende: '', mitarbeiterIds: [], createdAt: new Date().toISOString() };
    const linkedAngebote = isEdit ? angebote.filter((a) => a.projektId === data.id) : [];
    const linkedRechnungen = isEdit ? rechnungen.filter((r) => r.projektId === data.id) : [];

    const { body, close } = openModal({
      title: isEdit ? 'Projekt bearbeiten' : 'Neues Projekt',
      wide: true,
      bodyHtml: `
        <form id="proj-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId"><option value="">– kein Kunde –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${spalten.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Start</label><input type="date" name="start" value="${data.start || ''}"></div>
            <div class="field"><label>Ende</label><input type="date" name="ende" value="${data.ende || ''}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
            <div class="field col-span-2"><label>Zugewiesene Mitarbeiter</label>
              <div class="tag-list">
                ${mitarbeiter.map((m) => `
                  <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                    <input type="checkbox" name="mitarbeiterIds" value="${m.id}" ${data.mitarbeiterIds?.includes(m.id) ? 'checked' : ''}> ${escapeHtml(m.name)}
                  </label>
                `).join('') || '<span class="text-mute">Keine Mitarbeiter angelegt.</span>'}
              </div>
            </div>
          </div>
          ${isEdit ? `
            <div class="divider"></div>
            <h2 style="font-size:14px;margin:0 0 8px">Verknüpfte Angebote</h2>
            ${linkedAngebote.length ? `<ul class="cal-event-list">${linkedAngebote.map((a) => `<li><span>${escapeHtml(a.nummer)}</span><span>${formatCurrency(a.brutto)}</span></li>`).join('')}</ul>` : '<p class="text-mute">Keine Angebote verknüpft.</p>'}
            <h2 style="font-size:14px;margin:12px 0 8px">Verknüpfte Rechnungen</h2>
            ${linkedRechnungen.length ? `<ul class="cal-event-list">${linkedRechnungen.map((r) => `<li><span>${escapeHtml(r.nummer)}</span><span>${formatCurrency(r.brutto)}</span></li>`).join('')}</ul>` : '<p class="text-mute">Keine Rechnungen verknüpft.</p>'}
            <div class="divider"></div>
            <div id="foto-host"></div>
          ` : ''}
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
        if (!confirmDelete(`Projekt "${data.titel}" wirklich löschen?`)) return;
        await remove('projekte', data.id);
        toast('Projekt gelöscht');
        close();
        render(container);
      });
      renderFotoSection(body.querySelector('#foto-host'), data.id);
    }
    body.querySelector('#proj-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      for (const key of ['titel', 'kundeId', 'status', 'start', 'ende', 'beschreibung']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (!updated.titel) return;
      await put('projekte', updated);
      toast(isEdit ? 'Projekt aktualisiert' : 'Projekt angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
