import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatDate, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

const FARBEN = ['#14b8a6', '#4d8bf0', '#a463f2', '#f0a020', '#ef4444', '#16a085', '#d35400', '#2c3e50'];

export const STATUS = [
  { id: 'verfuegbar', titel: 'Verfügbar', badge: 'badge-success' },
  { id: 'im-einsatz', titel: 'Im Einsatz', badge: 'badge-accent' },
  { id: 'wartung', titel: 'Wartung/Werkstatt', badge: 'badge-warn' },
  { id: 'defekt', titel: 'Defekt/Außer Betrieb', badge: 'badge-danger' },
];

function statusInfo(id) {
  return STATUS.find((s) => s.id === id) || STATUS[0];
}

export async function render(container) {
  let [geraete, flotten] = await Promise.all([getAll('geraete'), getAll('flotten')]);
  geraete.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  flotten.sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  let tab = 'geraete';

  container.innerHTML = `
    <div class="view-header">
      <h1>Geräte &amp; Flotten</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neu</button></div>
    </div>
    <div class="tabs" id="ge-tabs">
      <button type="button" class="tab-item active" data-tab="geraete">🛠️ Geräte</button>
      <button type="button" class="tab-item" data-tab="flotten">🚐 Flotten</button>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function setTab(t) {
    tab = t;
    container.querySelectorAll('#ge-tabs .tab-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    container.querySelector('#btn-new').textContent = t === 'geraete' ? '+ Neues Gerät' : '+ Neues Fahrzeug';
    renderTable();
  }
  container.querySelectorAll('#ge-tabs .tab-item').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  function renderTable() {
    const list = tab === 'geraete' ? geraete : flotten;
    if (list.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch ${tab === 'geraete' ? 'keine Geräte' : 'keine Fahrzeuge'} angelegt.</div>`;
      return;
    }
    if (tab === 'geraete') {
      tableHost.innerHTML = `
        <table class="data-table">
          <thead><tr><th></th><th>Name</th><th>Kategorie</th><th>Status</th><th>Nächste Prüfung</th></tr></thead>
          <tbody>
            ${geraete.map((g) => {
              const s = statusInfo(g.status);
              return `
              <tr data-id="${g.id}">
                <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${g.farbe || FARBEN[0]}"></span></td>
                <td>${escapeHtml(g.name)}</td>
                <td>${escapeHtml(g.kategorie || '')}</td>
                <td><span class="badge ${s.badge}">${s.titel}</span></td>
                <td>${formatDate(g.naechstePruefung)}</td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      `;
    } else {
      tableHost.innerHTML = `
        <table class="data-table">
          <thead><tr><th></th><th>Bezeichnung</th><th>Kennzeichen</th><th>Status</th><th>TÜV/HU</th></tr></thead>
          <tbody>
            ${flotten.map((f) => {
              const s = statusInfo(f.status);
              return `
              <tr data-id="${f.id}">
                <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${f.farbe || FARBEN[1]}"></span></td>
                <td>${escapeHtml(f.bezeichnung)}</td>
                <td>${escapeHtml(f.kennzeichen || '')}</td>
                <td><span class="badge ${s.badge}">${s.titel}</span></td>
                <td>${formatDate(f.tuvDatum)}</td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      `;
    }
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => {
        const list2 = tab === 'geraete' ? geraete : flotten;
        openForm(list2.find((x) => x.id === row.dataset.id));
      });
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(item) {
    const isEdit = !!item;
    const isGeraet = tab === 'geraete';
    const data = item || (isGeraet
      ? { id: uid(), name: '', kategorie: '', status: 'verfuegbar', standort: '', naechstePruefung: '', farbe: FARBEN[geraete.length % FARBEN.length], notizen: '' }
      : { id: uid(), bezeichnung: '', kennzeichen: '', status: 'verfuegbar', typ: 'Transporter', tuvDatum: '', kilometerstand: '', farbe: FARBEN[flotten.length % FARBEN.length], notizen: '' });

    const { body, close } = openModal({
      title: isEdit ? 'Bearbeiten' : (isGeraet ? 'Neues Gerät' : 'Neues Fahrzeug'),
      bodyHtml: `
        <form id="ge-form">
          <div class="form-grid">
            ${isGeraet ? `
              <div class="field col-span-2"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
              <div class="field"><label>Kategorie</label><input name="kategorie" placeholder="z.B. Messgerät, Maschine" value="${escapeHtml(data.kategorie || '')}"></div>
              <div class="field"><label>Standort</label><input name="standort" value="${escapeHtml(data.standort || '')}"></div>
              <div class="field"><label>Nächste Prüfung</label><input type="date" name="naechstePruefung" value="${data.naechstePruefung || ''}"></div>
            ` : `
              <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
              <div class="field"><label>Kennzeichen</label><input name="kennzeichen" value="${escapeHtml(data.kennzeichen || '')}"></div>
              <div class="field"><label>Typ</label><input name="typ" placeholder="Transporter, PKW, Anhänger ..." value="${escapeHtml(data.typ || '')}"></div>
              <div class="field"><label>TÜV/HU</label><input type="date" name="tuvDatum" value="${data.tuvDatum || ''}"></div>
              <div class="field"><label>Kilometerstand</label><input type="number" min="0" name="kilometerstand" value="${data.kilometerstand || ''}"></div>
            `}
            <div class="field"><label>Status</label>
              <select name="status">${STATUS.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.titel}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Farbe (Plantafel)</label>
              <select name="farbe">${FARBEN.map((f) => `<option value="${f}" ${f === data.farbe ? 'selected' : ''}>${f}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
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
    const storeName = isGeraet ? 'geraete' : 'flotten';
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Wirklich löschen?')) return;
        await remove(storeName, data.id);
        toast('Gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#ge-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      const nameField = isGeraet ? 'name' : 'bezeichnung';
      if (!updated[nameField]) return;
      await put(storeName, updated);
      toast(isEdit ? 'Aktualisiert' : 'Angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
