import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast, farbeAusText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';

const KUNDEN_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

function kuerzeText(text, maxLaenge) {
  const einzeilig = (text || '').replace(/\s+/g, ' ').trim();
  return einzeilig.length > maxLaenge ? einzeilig.slice(0, maxLaenge - 1) + '…' : einzeilig;
}

export async function render(container) {
  let [kunden, spalten] = await Promise.all([getAll('kunden'), getAll('kundenStatus')]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);

  container.innerHTML = `
    <div class="view-header">
      <h1>Lead-Pipeline</h1>
      <div class="actions">
        <button class="btn" id="btn-status-manage">⚙️ Status verwalten</button>
        <button class="btn btn-primary" id="btn-new-card">+ Neuer Lead</button>
      </div>
    </div>
    <p class="hint">Kunden-Status entlang der Vertriebsphase - per Ziehen oder über die Auswahl in der Karte verschieben. Vollständige Kundendaten (Adresse, Kundenakte, Dokumente) bearbeitest du in der <a href="#/kunden">Kunden-Ansicht</a>.</p>
    <div class="kanban-board" id="board"></div>
  `;
  const board = container.querySelector('#board');

  function renderBoard() {
    board.innerHTML = spalten.map((s) => {
      const cards = kunden.filter((k) => (k.status || 'kunde') === s.id);
      return `
        <div class="kanban-col" data-col="${s.id}" style="--col-color:${escapeHtml(s.farbe || 'var(--border)')}">
          <div class="kanban-col-header">
            <span class="col-title"><span class="col-dot"></span>${escapeHtml(s.titel)}</span>
            <span class="count">${cards.length}</span>
          </div>
          <div class="kanban-cards" data-col-body="${s.id}">
            ${cards.map((k) => `
              <div class="kanban-card" draggable="true" data-id="${k.id}" style="border-left-color:${escapeHtml(k.farbe || 'var(--accent)')}">
                <div class="title">${escapeHtml(k.firma)}</div>
                ${k.ansprechpartner ? `<div class="meta">${escapeHtml(k.ansprechpartner)}</div>` : ''}
                ${k.telefon ? `<div class="meta">${escapeHtml(k.telefon)}</div>` : ''}
                ${k.notizen ? `<div class="meta text-mute" style="white-space:pre-wrap">${escapeHtml(kuerzeText(k.notizen, 140))}</div>` : ''}
                <select class="card-move" data-id="${k.id}" title="Status wechseln (auch per Ziehen möglich)">
                  ${spalten.map((s2) => `<option value="${s2.id}" ${s2.id === (k.status || 'kunde') ? 'selected' : ''}>${escapeHtml(s2.titel)}</option>`).join('')}
                </select>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    board.querySelectorAll('.kanban-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-move')) return;
        openCardForm(kunden.find((k) => k.id === card.dataset.id));
      });
    });

    board.querySelectorAll('.card-move').forEach((select) => {
      select.addEventListener('click', (e) => e.stopPropagation());
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const kunde = kunden.find((k) => k.id === select.dataset.id);
        if (!kunde) return;
        kunde.status = select.value;
        await put('kunden', kunde);
        renderBoard();
      });
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
        const kunde = kunden.find((k) => k.id === id);
        const newStatus = col.dataset.col;
        if (!kunde || !newStatus || kunde.status === newStatus) return;
        kunde.status = newStatus;
        await put('kunden', kunde);
        renderBoard();
      });
    });
  }

  container.querySelector('#btn-new-card').addEventListener('click', () => openCardForm());
  container.querySelector('#btn-status-manage').addEventListener('click', () => {
    openStatusManager({
      title: 'Kunden-Status verwalten',
      store: 'kundenStatus',
      items: spalten,
      canDelete: (it) => !kunden.some((k) => (k.status || 'kunde') === it.id),
      onChange: () => render(container),
    });
  });

  function openCardForm(k) {
    const isEdit = !!k;
    const neueId = uid();
    const data = k || { id: neueId, firma: '', ansprechpartner: '', telefon: '', email: '', notizen: '', status: spalten[0]?.id || '', farbe: farbeAusText(neueId, KUNDEN_FARBEN) };
    const { body, close } = openModal({
      title: isEdit ? 'Lead bearbeiten' : 'Neuer Lead',
      bodyHtml: `
        <form id="lead-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Firma / Name *</label><input name="firma" required value="${escapeHtml(data.firma)}"></div>
            <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner" value="${escapeHtml(data.ansprechpartner || '')}"></div>
            <div class="field"><label>Status</label>
              <select name="status">${spalten.map((s) => `<option value="${s.id}" ${s.id === (data.status || 'kunde') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field col-span-2"><label>Notizen / Anliegen</label><textarea name="notizen" rows="4">${escapeHtml(data.notizen || '')}</textarea></div>
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
        if (!confirmDelete(`Kunde "${data.firma}" in den Papierkorb verschieben?`)) return;
        await remove('kunden', data.id);
        toast('Kunde in den Papierkorb verschoben');
        close();
        render(container);
      });
    }
    body.querySelector('#lead-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const key of ['firma', 'ansprechpartner', 'status', 'telefon', 'email', 'notizen']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (!updated.firma) return;
      await put('kunden', updated);
      toast(isEdit ? 'Kunde aktualisiert' : 'Lead angelegt', 'success');
      close();
      render(container);
    });
  }

  renderBoard();
}
