import { put, remove } from './db.js';
import { uid, escapeHtml, toast } from './utils.js';
import { openModal, confirmDelete } from './ui.js';

/**
 * Generic "Status verwalten" modal: add/rename/recolor/reorder/delete entries
 * of a flat status list (kanbanSpalten, terminStatus, ...). Persists each
 * change immediately to `store` and calls onChange() when the modal closes.
 */
export function openStatusManager({ title = 'Status verwalten', store, items, colorable = true, canDelete = () => true, onChange }) {
  let list = [...items].sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));

  const { body, close } = openModal({
    title,
    bodyHtml: `
      <div class="status-manager-list" id="sm-list"></div>
      <button type="button" class="btn btn-sm" id="sm-add" style="margin-top:10px">+ Status hinzufügen</button>
      <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn btn-primary" id="sm-done">Fertig</button></div>
    `,
    onClose: () => { if (onChange) onChange(); },
  });

  function renderRows() {
    return list.map((it) => `
      <div class="status-row" data-id="${it.id}">
        ${colorable ? `<input type="color" class="s-farbe" value="${it.farbe || '#2b7fd6'}">` : ''}
        <input type="text" class="s-titel" value="${escapeHtml(it.titel)}">
        <button type="button" class="btn btn-sm btn-ghost s-up" title="Nach oben">↑</button>
        <button type="button" class="btn btn-sm btn-ghost s-down" title="Nach unten">↓</button>
        <button type="button" class="btn btn-sm btn-ghost s-del" title="Löschen">✕</button>
      </div>
    `).join('');
  }

  async function persistOrder() {
    for (let i = 0; i < list.length; i++) {
      list[i].reihenfolge = i;
      await put(store, list[i]);
    }
  }

  function bind() {
    const host = body.querySelector('#sm-list');
    host.innerHTML = renderRows();
    host.querySelectorAll('.status-row').forEach((row, i) => {
      const it = list[i];
      row.querySelector('.s-up').disabled = i === 0;
      row.querySelector('.s-down').disabled = i === list.length - 1;
      const farbeInput = row.querySelector('.s-farbe');
      if (farbeInput) {
        farbeInput.addEventListener('input', async () => { it.farbe = farbeInput.value; await put(store, it); });
      }
      row.querySelector('.s-titel').addEventListener('change', async (e) => {
        const val = e.target.value.trim();
        if (!val) { e.target.value = it.titel; return; }
        it.titel = val;
        await put(store, it);
      });
      row.querySelector('.s-up').addEventListener('click', async () => {
        if (i === 0) return;
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        await persistOrder();
        bind();
      });
      row.querySelector('.s-down').addEventListener('click', async () => {
        if (i === list.length - 1) return;
        [list[i + 1], list[i]] = [list[i], list[i + 1]];
        await persistOrder();
        bind();
      });
      row.querySelector('.s-del').addEventListener('click', async () => {
        if (list.length <= 1) { toast('Mindestens ein Status muss bestehen bleiben', 'danger'); return; }
        if (!canDelete(it)) { toast('Status wird noch verwendet – erst Einträge verschieben', 'danger'); return; }
        if (!confirmDelete(`Status "${it.titel}" wirklich löschen?`)) return;
        await remove(store, it.id);
        list = list.filter((x) => x.id !== it.id);
        bind();
      });
    });
  }
  bind();

  body.querySelector('#sm-add').addEventListener('click', async () => {
    const neu = { id: uid(), titel: 'Neuer Status', farbe: '#2b7fd6', reihenfolge: list.length };
    await put(store, neu);
    list.push(neu);
    bind();
  });
  body.querySelector('#sm-done').addEventListener('click', close);
}
