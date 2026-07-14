import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

export async function render(container) {
  let [projekte, kunden, mitarbeiter, spalten] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));

  container.innerHTML = `
    <div class="view-header">
      <h1>Kanban</h1>
      <div class="actions">
        <button class="btn" id="btn-new-col">+ Spalte</button>
        <button class="btn btn-primary" id="btn-new-card">+ Neues Projekt</button>
      </div>
    </div>
    <div class="kanban-board" id="board"></div>
  `;
  const board = container.querySelector('#board');

  function renderBoard() {
    board.innerHTML = spalten.map((s) => {
      const cards = projekte.filter((p) => p.status === s.id);
      return `
        <div class="kanban-col" data-col="${s.id}">
          <div class="kanban-col-header">
            <span>${escapeHtml(s.titel)}</span>
            <span class="count">${cards.length}</span>
          </div>
          <div class="kanban-cards" data-col-body="${s.id}">
            ${cards.map((p) => `
              <div class="kanban-card" draggable="true" data-id="${p.id}">
                <div class="title">${escapeHtml(p.titel)}</div>
                <div class="meta">${escapeHtml(kundenById[p.kundeId]?.firma || '')}</div>
                ${p.mitarbeiterIds?.length ? `<div class="meta">${p.mitarbeiterIds.map((id) => escapeHtml(mitarbeiterById[id]?.name || '')).filter(Boolean).join(', ')}</div>` : ''}
              </div>
            `).join('')}
          </div>
          <div class="flex-row" style="margin-top:6px">
            <button class="btn btn-sm btn-ghost btn-rename" data-col="${s.id}">Umbenennen</button>
            <button class="btn btn-sm btn-ghost btn-del-col" data-col="${s.id}">Löschen</button>
          </div>
        </div>
      `;
    }).join('') + `
      <div class="kanban-col kanban-add-col">
        <button class="btn" id="btn-new-col-inline" style="width:100%">+ Spalte hinzufügen</button>
      </div>
    `;

    board.querySelectorAll('.kanban-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => openCardForm(projekte.find((p) => p.id === card.dataset.id)));
    });

    board.querySelectorAll('.kanban-col').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const projekt = projekte.find((p) => p.id === id);
        const newStatus = col.dataset.col;
        if (!projekt || !newStatus || projekt.status === newStatus) return;
        projekt.status = newStatus;
        await put('projekte', projekt);
        renderBoard();
      });
    });

    board.querySelectorAll('.btn-rename').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const s = spalten.find((x) => x.id === btn.dataset.col);
        const name = window.prompt('Spaltenname', s.titel);
        if (!name) return;
        s.titel = name.trim();
        await put('kanbanSpalten', s);
        renderBoard();
      });
    });
    board.querySelectorAll('.btn-del-col').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const s = spalten.find((x) => x.id === btn.dataset.col);
        const inUse = projekte.some((p) => p.status === s.id);
        if (inUse) {
          toast('Spalte enthält noch Projekte – erst verschieben', 'danger');
          return;
        }
        if (!confirmDelete(`Spalte "${s.titel}" wirklich löschen?`)) return;
        await remove('kanbanSpalten', s.id);
        spalten = spalten.filter((x) => x.id !== s.id);
        renderBoard();
      });
    });

    const addColBtn = board.querySelector('#btn-new-col-inline');
    if (addColBtn) addColBtn.addEventListener('click', addColumn);
  }

  async function addColumn() {
    const name = window.prompt('Name der neuen Spalte');
    if (!name) return;
    const s = { id: uid(), titel: name.trim(), reihenfolge: spalten.length };
    await put('kanbanSpalten', s);
    spalten.push(s);
    renderBoard();
  }
  container.querySelector('#btn-new-col').addEventListener('click', addColumn);
  container.querySelector('#btn-new-card').addEventListener('click', () => openCardForm());

  function openCardForm(p) {
    const isEdit = !!p;
    const data = p || { id: uid(), titel: '', kundeId: '', status: spalten[0]?.id || '', beschreibung: '', start: '', ende: '', mitarbeiterIds: [], createdAt: new Date().toISOString() };
    const { body, close } = openModal({
      title: isEdit ? 'Projekt bearbeiten' : 'Neues Projekt',
      bodyHtml: `
        <form id="card-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId"><option value="">– kein Kunde –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${spalten.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
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
        if (!confirmDelete(`Projekt "${data.titel}" wirklich löschen?`)) return;
        await remove('projekte', data.id);
        toast('Projekt gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#card-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const key of ['titel', 'kundeId', 'status', 'beschreibung']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (!updated.titel) return;
      await put('projekte', updated);
      toast(isEdit ? 'Projekt aktualisiert' : 'Projekt angelegt', 'success');
      close();
      render(container);
    });
  }

  renderBoard();
}
