import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast, openTerminMitVorbelegung, farbeAusText, formatDate } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';

const SPALTEN_FARBEN = ['#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c', '#6b7280'];

// Sammlungen, die ein Projekt per projektId referenzieren - beim Zusammenlegen
// zweier Projekte müssen diese Verweise auf das behaltene Projekt umgehängt
// werden, sonst würden z.B. Termine/Angebote am gelöschten Duplikat "hängen
// bleiben" und aus der Akte verschwinden.
const PROJEKT_REFERENZ_STORES = [
  'termine', 'aufgaben', 'emails', 'angebote', 'auftragsbestaetigungen', 'rechnungen',
  'mahnungen', 'ausgaben', 'zeiterfassung', 'dokumente', 'fotos', 'aufmasse', 'nachrichten',
];

async function verschiebeProjektReferenzen(alteProjektId, neueProjektId) {
  for (const store of PROJEKT_REFERENZ_STORES) {
    const rows = await getAll(store);
    const betroffen = rows.filter((r) => r.projektId === alteProjektId);
    for (const row of betroffen) {
      await put(store, { ...row, projektId: neueProjektId });
    }
  }
}

export async function render(container) {
  let [projekte, kunden, mitarbeiter, spalten, marken] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'), getAll('marken'),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));

  container.innerHTML = `
    <div class="view-header">
      <h1>Kanban</h1>
      <div class="actions">
        <button class="btn" id="btn-duplikate-pruefen">🔍 Doppelte Anfragen prüfen</button>
        <button class="btn" id="btn-status-manage">⚙️ Status verwalten</button>
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
        <div class="kanban-col" data-col="${s.id}" style="--col-color:${farbeAusText(s.id, SPALTEN_FARBEN)}">
          <div class="kanban-col-header">
            <span class="col-title"><span class="col-dot"></span>${escapeHtml(s.titel)}</span>
            <span class="count">${cards.length}</span>
          </div>
          <div class="kanban-cards" data-col-body="${s.id}">
            ${cards.map((p) => `
              <div class="kanban-card" draggable="true" data-id="${p.id}" style="border-left-color:${escapeHtml(p.farbe || 'var(--accent)')}">
                ${p.autoErstellt ? '<span class="badge badge-accent" style="display:block;width:fit-content;margin-bottom:4px">🆕 Neue Anfrage</span>' : ''}
                ${marken.length > 0 && p.markeId && markenById[p.markeId] ? `<span class="badge" style="display:block;width:fit-content;margin-bottom:4px">🏷️ ${escapeHtml(markenById[p.markeId].name)}</span>` : ''}
                <div class="title">${escapeHtml(p.titel)}</div>
                <div class="meta">${escapeHtml(kundenById[p.kundeId]?.firma || '')}</div>
                ${p.mitarbeiterIds?.length ? `<div class="meta">${p.mitarbeiterIds.map((id) => escapeHtml(mitarbeiterById[id]?.name || '')).filter(Boolean).join(', ')}</div>` : ''}
                <select class="card-move" data-id="${p.id}" title="Spalte wechseln (auch per Ziehen möglich)">
                  ${spalten.map((s2) => `<option value="${s2.id}" ${s2.id === p.status ? 'selected' : ''}>${escapeHtml(s2.titel)}</option>`).join('')}
                </select>
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
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.card-move')) return;
        const p = projekte.find((p) => p.id === card.dataset.id);
        if (p?.autoErstellt) {
          p.autoErstellt = false;
          await put('projekte', p);
          renderBoard();
        }
        openCardForm(p);
      });
    });

    board.querySelectorAll('.card-move').forEach((select) => {
      select.addEventListener('click', (e) => e.stopPropagation());
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const projekt = projekte.find((p) => p.id === select.dataset.id);
        if (!projekt) return;
        projekt.status = select.value;
        await put('projekte', projekt);
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
  container.querySelector('#btn-status-manage').addEventListener('click', () => {
    openStatusManager({
      title: 'Projekt-Status verwalten',
      store: 'kanbanSpalten',
      items: spalten,
      canDelete: (it) => !projekte.some((p) => p.status === it.id),
      onChange: () => render(container),
    });
  });
  container.querySelector('#btn-duplikate-pruefen').addEventListener('click', openDuplikatePruefenModal);

  function openDuplikatePruefenModal() {
    const gruppenMap = new Map();
    for (const p of projekte) {
      if (!p.kundeId) continue;
      if (!gruppenMap.has(p.kundeId)) gruppenMap.set(p.kundeId, []);
      gruppenMap.get(p.kundeId).push(p);
    }
    const gruppen = [...gruppenMap.entries()]
      .filter(([, liste]) => liste.length > 1)
      .map(([kundeId, liste]) => ({ kundeId, liste: liste.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')) }));

    const { body, close } = openModal({
      title: `Mögliche doppelte Projekte (${gruppen.length} Kunde${gruppen.length === 1 ? '' : 'n'} mit mehreren Projekten)`,
      wide: true,
      bodyHtml: `
        <p class="hint">Häufigste Ursache: derselbe Kunde schreibt mehrfach zum selben Anliegen, wodurch bei jeder Anfrage ein neues Projekt entsteht. Prüfe pro Gruppe, ob es sich wirklich um dasselbe Anliegen handelt, bevor du zusammenlegst - unterschiedliche Aufträge desselben Kunden sollten getrennt bleiben.</p>
        ${gruppen.length === 0 ? '<p class="text-mute">Keine Kunden mit mehreren Projekten gefunden.</p>' : gruppen.map((g, gi) => `
          <div class="card" style="margin-bottom:12px">
            <strong>${escapeHtml(kundenById[g.kundeId]?.firma || '(unbekannter Kunde)')}</strong>
            <span class="text-mute"> · ${g.liste.length} Projekte</span>
            <ul class="cal-event-list" style="margin-top:8px">
              ${g.liste.map((p, pi) => `
                <li>
                  <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
                    <input type="radio" name="keep-${gi}" value="${p.id}" ${pi === 0 ? 'checked' : ''} style="margin-top:3px">
                    <span>
                      <strong>${escapeHtml(p.titel)}</strong> <span class="text-mute">(angelegt ${p.createdAt ? formatDate(p.createdAt) : 'unbekannt'})</span><br>
                      <span class="text-mute" style="white-space:pre-wrap">${escapeHtml((p.beschreibung || '').slice(0, 200))}</span>
                    </span>
                  </label>
                </li>
              `).join('')}
            </ul>
            <p class="hint" style="margin:4px 0 8px">Ausgewähltes Projekt (Radiobutton) bleibt bestehen, alle anderen dieser Gruppe werden hineingelegt (Beschreibungen zusammengeführt, Termine/Aufgaben/Angebote/Rechnungen/etc. umgehängt) und danach in den Papierkorb verschoben.</p>
            <button type="button" class="btn btn-sm btn-primary btn-merge-gruppe" data-gi="${gi}">In ausgewähltes Projekt zusammenlegen</button>
          </div>
        `).join('')}
      `,
    });

    body.querySelectorAll('.btn-merge-gruppe').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const gi = Number(btn.dataset.gi);
        const gruppe = gruppen[gi];
        const behaltenId = body.querySelector(`input[name="keep-${gi}"]:checked`)?.value;
        if (!behaltenId) return;
        const behalten = gruppe.liste.find((p) => p.id === behaltenId);
        const rest = gruppe.liste.filter((p) => p.id !== behaltenId);
        if (rest.length === 0) return;
        if (!confirmDelete(`${rest.length} Projekt(e) in "${behalten.titel}" zusammenlegen? Alle zugehörigen Termine/Aufgaben/Angebote/Rechnungen/Ausgaben/Dokumente werden umgehängt, die übrigen Projekte danach in den Papierkorb verschoben.`)) return;
        btn.disabled = true;
        btn.textContent = 'Wird zusammengelegt …';
        try {
          let aktuellBehalten = behalten;
          for (const p of rest) {
            await verschiebeProjektReferenzen(p.id, behaltenId);
            aktuellBehalten = {
              ...aktuellBehalten,
              beschreibung: [aktuellBehalten.beschreibung, `--- Zusammengelegt aus "${p.titel}" ---\n${p.beschreibung || ''}`.trim()].filter(Boolean).join('\n\n'),
            };
            await put('projekte', aktuellBehalten);
            await remove('projekte', p.id);
          }
          toast(`${rest.length} Projekt(e) zusammengelegt`, 'success');
          close();
          render(container);
        } catch (err) {
          toast(err.message || 'Zusammenlegen fehlgeschlagen', 'danger');
          btn.disabled = false;
          btn.textContent = 'In ausgewähltes Projekt zusammenlegen';
        }
      });
    });
  }

  function openCardForm(p) {
    const isEdit = !!p;
    const data = p || { id: uid(), titel: '', kundeId: '', status: spalten[0]?.id || '', beschreibung: '', start: '', ende: '', mitarbeiterIds: [], farbe: '', createdAt: new Date().toISOString() };
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
            <div class="field"><label>Farbe</label><input type="color" name="farbe" value="${escapeHtml(data.farbe || '#2b7fd6')}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-neuer-termin">📅 + Termin</button>' : ''}
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
        if (!confirmDelete(`Projekt "${data.titel}" in den Papierkorb verschieben?`)) return;
        await remove('projekte', data.id);
        toast('Projekt in den Papierkorb verschoben');
        close();
        render(container);
      });
      body.querySelector('#btn-neuer-termin').addEventListener('click', () => {
        const kunde = kundenById[body.querySelector('select[name="kundeId"]').value];
        const prefill = {
          titel: data.titel, kundeId: kunde?.id || '', projektId: data.id,
          ort: kunde ? [kunde.strasse, kunde.plz, kunde.ort].filter((s) => s && s.trim()).join(', ') : '',
        };
        close();
        openTerminMitVorbelegung(prefill);
      });
    }
    body.querySelector('#card-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const key of ['titel', 'kundeId', 'status', 'beschreibung', 'farbe']) {
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
