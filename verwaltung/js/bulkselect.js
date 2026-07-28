import { remove, isTrashStore } from './db.js';
import { toast } from './utils.js';
import { confirmDelete } from './ui.js';

/**
 * Reusable checkbox-multi-select + Bulk-Löschen-Leiste für Tabellen-Views.
 * Ein Aufruf pro View (außerhalb von renderTable), dann headerCell()/rowCell()
 * in die Tabelle einbauen, barHtml() vor die Tabelle setzen und nach dem
 * Neuzeichnen wire() aufrufen.
 */
export function createBulkSelect(store, { label = 'Einträge', deleteFn } = {}) {
  const selected = new Set();
  const doDelete = deleteFn || ((id) => remove(store, id));
  // Papierkorb-fähige Stores landen nur im Papierkorb (siehe db.js
  // TRASH_STORES) - Text/Toast entsprechend anpassen, damit "unwiderruflich"
  // nicht fälschlich suggeriert wird.
  const soft = !deleteFn && isTrashStore(store);

  function headerCell() {
    return `<th class="col-select"><input type="checkbox" class="bulk-select-all" title="Alle auswählen"></th>`;
  }

  function rowCell(id, locked = false) {
    return `<td class="col-select"><input type="checkbox" class="bulk-select-row" data-id="${id}" ${selected.has(id) ? 'checked' : ''} ${locked ? 'disabled title="Gesperrt"' : ''}></td>`;
  }

  function barHtml() {
    if (selected.size === 0) return '';
    return `
      <div class="bulk-bar">
        <span>${selected.size} ${label} ausgewählt</span>
        <button type="button" class="btn btn-sm" id="bulk-clear">Auswahl aufheben</button>
        <button type="button" class="btn btn-sm btn-danger" id="bulk-delete">🗑 Löschen</button>
      </div>
    `;
  }

  function wire(host, { onChange, onDeleted }) {
    const rowBoxes = () => Array.from(host.querySelectorAll('.bulk-select-row'));
    rowBoxes().forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.id);
        else selected.delete(cb.dataset.id);
        onChange();
      });
    });
    const selAll = host.querySelector('.bulk-select-all');
    if (selAll) {
      const enabled = rowBoxes().filter((cb) => !cb.disabled);
      selAll.checked = enabled.length > 0 && enabled.every((cb) => selected.has(cb.dataset.id));
      selAll.addEventListener('click', (e) => e.stopPropagation());
      selAll.addEventListener('change', () => {
        enabled.forEach((cb) => {
          if (selAll.checked) selected.add(cb.dataset.id);
          else selected.delete(cb.dataset.id);
        });
        onChange();
      });
    }
    const delBtn = host.querySelector('#bulk-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ids = Array.from(selected);
        const frage = soft ? `${ids.length} ${label} in den Papierkorb verschieben?` : `${ids.length} ${label} wirklich unwiderruflich löschen?`;
        if (!confirmDelete(frage)) return;
        const done = [];
        let lastError = null;
        for (const id of ids) {
          try {
            await doDelete(id);
            done.push(id);
          } catch (err) {
            // Einzelner Fehlschlag (z.B. Netzwerk) blockt nicht den Rest, aber
            // der Grund darf nicht stillschweigend verschwinden - sonst sieht
            // man am Ende nur "0 von N gelöscht" ohne jeden Hinweis, woran es lag.
            lastError = err;
          }
        }
        done.forEach((id) => selected.delete(id));
        const verb = soft ? 'in den Papierkorb verschoben' : 'gelöscht';
        let meldung = done.length === ids.length ? `${done.length} ${label} ${verb}` : `${done.length} von ${ids.length} ${label} ${verb}`;
        if (lastError) meldung += ` – Fehler: ${lastError.message || lastError}`;
        toast(meldung, done.length === ids.length ? 'success' : 'danger');
        onDeleted(done);
      });
    }
    const clearBtn = host.querySelector('#bulk-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selected.clear();
        onChange();
      });
    }
  }

  function clear() {
    selected.clear();
  }

  return { headerCell, rowCell, barHtml, wire, clear, selected };
}
