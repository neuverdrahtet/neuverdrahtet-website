import { getAll, put, remove, getSettings, BEREICHE } from '../db.js';
import { uid, escapeHtml, formatDate, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { renderFotoSection } from '../fotos.js';
import { renderDokumenteSection } from '../dokumente.js';

const ALLE_OFFEN = '__offen__';
const ALLE = '__alle__';

export async function render(container) {
  let [projekte, kunden, mitarbeiter, spalten, angebote, rechnungen, kategorien, settings] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'),
    getAll('angebote'), getAll('rechnungen'), getAll('kategorien'), getSettings(),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  kategorien.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  const kategorienById = Object.fromEntries(kategorien.map((k) => [k.id, k]));
  projekte.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  let folder = ALLE_OFFEN;
  let filtered = projekte;

  container.innerHTML = `
    <div class="view-header">
      <h1>Projekte</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neues Projekt</button></div>
    </div>
    <div class="projekte-layout">
      <div class="projekte-folders" id="folders"></div>
      <div class="projekte-main">
        <div class="search-bar">
          <input type="search" id="search" placeholder="Suche nach Titel oder Kunde ...">
        </div>
        <div id="table-host"></div>
      </div>
    </div>
  `;
  const foldersHost = container.querySelector('#folders');
  const tableHost = container.querySelector('#table-host');

  function folderCount(id) {
    if (id === ALLE) return projekte.length;
    if (id === ALLE_OFFEN) return projekte.filter((p) => !spaltenById[p.status]?.geschlossen).length;
    return projekte.filter((p) => p.status === id).length;
  }

  function renderFolders() {
    const items = [
      { id: ALLE_OFFEN, titel: 'Alle offenen' },
      { id: ALLE, titel: 'Alle Projekte' },
      ...spalten.map((s) => ({ id: s.id, titel: s.titel })),
    ];
    foldersHost.innerHTML = items.map((it) => `
      <button type="button" class="folder-item ${folder === it.id ? 'active' : ''}" data-folder="${it.id}">
        <span>${escapeHtml(it.titel)}</span><span class="count">${folderCount(it.id)}</span>
      </button>
    `).join('');
    foldersHost.querySelectorAll('.folder-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        folder = btn.dataset.folder;
        applyFilter();
      });
    });
  }

  function applyFilter() {
    renderFolders();
    const q = container.querySelector('#search').value.trim().toLowerCase();
    filtered = projekte.filter((p) => {
      if (folder === ALLE_OFFEN && spaltenById[p.status]?.geschlossen) return false;
      if (folder !== ALLE && folder !== ALLE_OFFEN && p.status !== folder) return false;
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
        <thead><tr><th>Titel</th><th>Kunde</th><th>Bereich</th><th>Status</th><th>Start</th><th>Ende</th></tr></thead>
        <tbody>
          ${filtered.map((p) => `
            <tr data-id="${p.id}">
              <td>${escapeHtml(p.titel)}</td>
              <td>${escapeHtml(kundenById[p.kundeId]?.firma || '')}</td>
              <td>${escapeHtml(kategorienById[p.kategorieId]?.titel || BEREICHE.find((b) => b.id === p.bereich)?.titel || '')}</td>
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
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(p) {
    const isEdit = !!p;
    const data = p || {
      id: uid(), titel: '', kundeId: '', status: spalten[0]?.id || '', beschreibung: '',
      start: '', ende: '', mitarbeiterIds: [], bereich: 'auftrag', kategorieId: '', createdAt: new Date().toISOString(),
    };
    const linkedAngebote = isEdit ? angebote.filter((a) => a.projektId === data.id) : [];
    const linkedRechnungen = isEdit ? rechnungen.filter((r) => r.projektId === data.id) : [];
    const kategorienForBereich = (bereich) => kategorien.filter((k) => k.bereich === bereich);

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
            <div class="field"><label>Bereich</label>
              <select name="bereich" id="f-bereich">${BEREICHE.map((b) => `<option value="${b.id}" ${b.id === data.bereich ? 'selected' : ''}>${escapeHtml(b.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kategorie</label>
              <select name="kategorieId" id="f-kategorie">${kategorienForBereich(data.bereich).map((k) => `<option value="${k.id}" ${k.id === data.kategorieId ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}</select>
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
            <div class="divider"></div>
            <div id="dok-host"></div>
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
    body.querySelector('#f-bereich').addEventListener('change', (e) => {
      const sel = body.querySelector('#f-kategorie');
      sel.innerHTML = kategorienForBereich(e.target.value).map((k) => `<option value="${k.id}">${escapeHtml(k.titel)}</option>`).join('');
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
      renderDokumenteSection(body.querySelector('#dok-host'), 'projekt', data.id, {
        title: 'Dokumente (Berichte, Stundenzettel, ...)',
        berichtContext: { firma: settings.firmenname, kunde: kundenById[data.kundeId]?.firma || '', projekt: data.titel },
      });
    }
    body.querySelector('#proj-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      for (const key of ['titel', 'kundeId', 'status', 'start', 'ende', 'beschreibung', 'bereich', 'kategorieId']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (!updated.titel) return;
      await put('projekte', updated);
      toast(isEdit ? 'Projekt aktualisiert' : 'Projekt angelegt', 'success');
      close();
      render(container);
    });
  }

  applyFilter();
}
