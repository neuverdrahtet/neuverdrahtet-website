import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatDate, getCurrentMitarbeiterId, setCurrentMitarbeiterId, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';

const PRIORITAETEN = [
  { id: 'niedrig', titel: 'Niedrig' },
  { id: 'normal', titel: 'Normal' },
  { id: 'hoch', titel: 'Hoch' },
];

const TABS = [
  { id: 'meine', titel: 'Meine Aufgaben' },
  { id: 'erstellt', titel: 'Erstellte Aufgaben' },
  { id: 'erledigt', titel: 'Erledigte Aufgaben' },
  { id: 'alle', titel: 'Alle Aufgaben' },
];

export async function render(container) {
  let [aufgaben, mitarbeiter, projekte, kunden, aufgabenStatus] = await Promise.all([
    getAll('aufgaben'), getAll('mitarbeiter'), getAll('projekte'), getAll('kunden'), getAll('aufgabenStatus'),
  ]);
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  aufgabenStatus.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const statusById = Object.fromEntries(aufgabenStatus.map((s) => [s.id, s]));
  const offenStatus = aufgabenStatus.find((s) => !s.geschlossen) || aufgabenStatus[0];
  const erledigtStatus = aufgabenStatus.find((s) => s.geschlossen) || aufgabenStatus[aufgabenStatus.length - 1];
  aufgaben.sort((a, b) => (a.faelligAm || '9999').localeCompare(b.faelligAm || '9999'));

  let currentMa = getCurrentMitarbeiterId();
  if (!currentMa && mitarbeiter.length) currentMa = mitarbeiter[0].id;
  let tab = 'meine';
  let filtered = aufgaben;

  container.innerHTML = `
    <div class="view-header">
      <h1>Aufgaben</h1>
      <div class="actions">
        <button class="btn" id="btn-status-manage">⚙️ Status verwalten</button>
        <button class="btn btn-primary" id="btn-new">+ Neue Aufgabe</button>
      </div>
    </div>
    <div class="search-bar">
      <label class="text-mute" style="display:flex;align-items:center;gap:6px;font-size:12.5px">
        Ich bin:
        <select id="ich-bin">
          <option value="">– auswählen –</option>
          ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === currentMa ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="tabs" id="tabs">
      ${TABS.map((t) => `<button type="button" class="tab-item ${t.id === tab ? 'active' : ''}" data-tab="${t.id}">${t.titel}</button>`).join('')}
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  container.querySelector('#ich-bin').addEventListener('change', (e) => {
    currentMa = e.target.value;
    setCurrentMitarbeiterId(currentMa);
    applyFilter();
  });
  container.querySelectorAll('.tab-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      container.querySelectorAll('.tab-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      applyFilter();
    });
  });

  function applyFilter() {
    filtered = aufgaben.filter((a) => {
      if (tab === 'meine') return a.zugewiesenAn === currentMa && !statusById[a.status]?.geschlossen;
      if (tab === 'erstellt') return a.erstelltVon === currentMa;
      if (tab === 'erledigt') return !!statusById[a.status]?.geschlossen;
      return true;
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Keine Aufgaben gefunden.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th></th><th>Titel</th><th>Zugewiesen an</th><th>Fällig am</th><th>Priorität</th><th>Status</th></tr></thead>
        <tbody>
          ${filtered.map((a) => {
            const st = statusById[a.status];
            return `
            <tr data-id="${a.id}">
              <td><input type="checkbox" class="chk-erledigt" data-id="${a.id}" ${st?.geschlossen ? 'checked' : ''}></td>
              <td>${escapeHtml(a.titel)}</td>
              <td>${escapeHtml(mitarbeiterById[a.zugewiesenAn]?.name || '')}</td>
              <td>${formatDate(a.faelligAm)}</td>
              <td><span class="badge ${a.prioritaet === 'hoch' ? 'badge-danger' : a.prioritaet === 'niedrig' ? '' : 'badge-warn'}">${escapeHtml(PRIORITAETEN.find((p) => p.id === a.prioritaet)?.titel || 'Normal')}</span></td>
              <td><span class="badge" style="background:${escapeHtml(st?.farbe || 'var(--border)')}22;color:${escapeHtml(st?.farbe || 'var(--text)')}">${escapeHtml(st?.titel || a.status || '')}</span></td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('chk-erledigt')) return;
        openForm(aufgaben.find((a) => a.id === row.dataset.id));
      });
    });
    tableHost.querySelectorAll('.chk-erledigt').forEach((chk) => {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', async () => {
        const a = aufgaben.find((x) => x.id === chk.dataset.id);
        a.status = chk.checked ? (erledigtStatus?.id || 'erledigt') : (offenStatus?.id || 'offen');
        a.erledigtAm = chk.checked ? new Date().toISOString() : '';
        await put('aufgaben', a);
        toast(chk.checked ? 'Aufgabe erledigt' : 'Aufgabe wieder geöffnet', 'success');
        applyFilter();
      });
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-status-manage').addEventListener('click', () => {
    openStatusManager({
      title: 'Aufgaben-Status verwalten',
      store: 'aufgabenStatus',
      items: aufgabenStatus,
      canDelete: (it) => !aufgaben.some((a) => a.status === it.id),
      onChange: () => render(container),
    });
  });

  function openForm(a) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), titel: '', beschreibung: '', zugewiesenAn: currentMa || '', erstelltVon: currentMa || '',
      faelligAm: '', prioritaet: 'normal', status: offenStatus?.id || 'offen', projektId: '', kundeId: '', createdAt: new Date().toISOString(), erledigtAm: '',
    };
    const { body, close } = openModal({
      title: isEdit ? 'Aufgabe bearbeiten' : 'Neue Aufgabe',
      bodyHtml: `
        <form id="aufg-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Zugewiesen an</label>
              <select name="zugewiesenAn"><option value="">–</option>${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.zugewiesenAn ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Fällig am</label><input type="date" name="faelligAm" value="${data.faelligAm || ''}"></div>
            <div class="field"><label>Priorität</label>
              <select name="prioritaet">${PRIORITAETEN.map((p) => `<option value="${p.id}" ${p.id === data.prioritaet ? 'selected' : ''}>${p.titel}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${aufgabenStatus.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt</label>
              <select name="projektId"><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId"><option value="">–</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
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
        if (!confirmDelete(`Aufgabe "${data.titel}" wirklich löschen?`)) return;
        await remove('aufgaben', data.id);
        toast('Aufgabe gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#aufg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      const wasErledigt = !!statusById[data.status]?.geschlossen;
      for (const key of ['titel', 'zugewiesenAn', 'faelligAm', 'prioritaet', 'status', 'projektId', 'kundeId', 'beschreibung']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      const nowErledigt = !!statusById[updated.status]?.geschlossen;
      if (!wasErledigt && nowErledigt) updated.erledigtAm = new Date().toISOString();
      if (!nowErledigt) updated.erledigtAm = '';
      if (!isEdit) updated.erstelltVon = currentMa || '';
      if (!updated.titel) return;
      await put('aufgaben', updated);
      toast(isEdit ? 'Aufgabe aktualisiert' : 'Aufgabe angelegt', 'success');
      close();
      render(container);
    });
  }

  applyFilter();
}
