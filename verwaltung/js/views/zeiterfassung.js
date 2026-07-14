import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatDate, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

const TIMER_KEY = 'nv-running-timer';

function loadRunningTimer() {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch { return null; }
}
function saveRunningTimer(t) {
  if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t));
  else localStorage.removeItem(TIMER_KEY);
}
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')} Std.`;
}

export async function render(container) {
  let [eintraege, projekte, mitarbeiter, settings] = await Promise.all([
    getAll('zeiterfassung'), getAll('projekte'), getAll('mitarbeiter'), getSettings(),
  ]);
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  eintraege.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  let filtered = eintraege;
  let tickInterval = null;

  container.innerHTML = `
    <div class="view-header">
      <h1>Zeiterfassung</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Eintrag erfassen</button></div>
    </div>

    <div class="card" id="timer-card"></div>

    <div class="search-bar">
      <select id="filter-projekt"><option value="">Alle Projekte</option>${projekte.map((p) => `<option value="${p.id}">${escapeHtml(p.titel)}</option>`).join('')}</select>
      <select id="filter-mitarbeiter"><option value="">Alle Mitarbeiter</option>${mitarbeiter.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
    </div>
    <div id="table-host"></div>
  `;

  // --- Timer widget ---
  const timerCard = container.querySelector('#timer-card');
  function renderTimer() {
    const running = loadRunningTimer();
    if (!running) {
      timerCard.innerHTML = `
        <h2>Zeit stoppen</h2>
        <div class="form-grid">
          <div class="field"><label>Projekt *</label>
            <select id="timer-projekt"><option value="">– wählen –</option>${projekte.map((p) => `<option value="${p.id}">${escapeHtml(p.titel)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Mitarbeiter</label>
            <select id="timer-mitarbeiter"><option value="">–</option>${mitarbeiter.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-start" style="margin-top:10px;font-size:16px;padding:14px 22px">▶️ Zeit starten</button>
      `;
      timerCard.querySelector('#btn-start').addEventListener('click', () => {
        const projektId = timerCard.querySelector('#timer-projekt').value;
        if (!projektId) { toast('Bitte ein Projekt wählen', 'danger'); return; }
        const mitarbeiterId = timerCard.querySelector('#timer-mitarbeiter').value;
        saveRunningTimer({ projektId, mitarbeiterId, startedAt: new Date().toISOString() });
        renderTimer();
      });
    } else {
      const projekt = projekteById[running.projektId];
      timerCard.innerHTML = `
        <h2>⏱️ Zeit läuft: ${escapeHtml(projekt?.titel || '')}</h2>
        <div class="kpi-value" id="timer-display" style="font-size:32px;margin:10px 0">00:00:00</div>
        <button class="btn btn-danger" id="btn-stop" style="font-size:16px;padding:14px 22px">⏹️ Stoppen &amp; speichern</button>
      `;
      const display = timerCard.querySelector('#timer-display');
      function tick() {
        const secs = Math.floor((Date.now() - new Date(running.startedAt).getTime()) / 1000);
        const h = String(Math.floor(secs / 3600)).padStart(2, '0');
        const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        display.textContent = `${h}:${m}:${s}`;
      }
      tick();
      tickInterval = setInterval(tick, 1000);
      timerCard.querySelector('#btn-stop').addEventListener('click', async () => {
        clearInterval(tickInterval);
        const minutes = Math.max(1, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000));
        saveRunningTimer(null);
        openForm({
          id: uid(), projektId: running.projektId, mitarbeiterId: running.mitarbeiterId,
          datum: running.startedAt.slice(0, 10), dauerMinuten: minutes, beschreibung: '', abgerechnet: false,
        }, { isNewFromTimer: true });
      });
    }
  }

  const tableHost = container.querySelector('#table-host');
  function applyFilter() {
    const projektId = container.querySelector('#filter-projekt').value;
    const mitarbeiterId = container.querySelector('#filter-mitarbeiter').value;
    filtered = eintraege.filter((e) => (!projektId || e.projektId === projektId) && (!mitarbeiterId || e.mitarbeiterId === mitarbeiterId));
    renderTable();
  }
  container.querySelector('#filter-projekt').addEventListener('change', applyFilter);
  container.querySelector('#filter-mitarbeiter').addEventListener('change', applyFilter);

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Zeiten erfasst.</div>`;
      return;
    }
    const totalMinutes = filtered.reduce((s, e) => s + (e.dauerMinuten || 0), 0);
    tableHost.innerHTML = `
      <p class="hint">Gesamt: ${formatDuration(totalMinutes)}</p>
      <table class="data-table">
        <thead><tr><th>Datum</th><th>Projekt</th><th>Mitarbeiter</th><th>Dauer</th><th>Beschreibung</th><th>Status</th></tr></thead>
        <tbody>
          ${filtered.map((e) => `
            <tr data-id="${e.id}">
              <td>${formatDate(e.datum)}</td>
              <td>${escapeHtml(projekteById[e.projektId]?.titel || '')}</td>
              <td>${escapeHtml(mitarbeiterById[e.mitarbeiterId]?.name || '')}</td>
              <td>${formatDuration(e.dauerMinuten || 0)}</td>
              <td>${escapeHtml(e.beschreibung || '')}</td>
              <td><span class="badge ${e.abgerechnet ? 'badge-success' : 'badge'}">${e.abgerechnet ? 'abgerechnet' : 'offen'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(eintraege.find((e) => e.id === row.dataset.id)));
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(entry, { isNewFromTimer = false } = {}) {
    const isEdit = !!entry && !isNewFromTimer;
    const data = entry || {
      id: uid(), projektId: '', mitarbeiterId: '', datum: new Date().toISOString().slice(0, 10),
      dauerMinuten: 60, beschreibung: '', abgerechnet: false,
    };
    const { body, close } = openModal({
      title: isNewFromTimer ? 'Zeit speichern' : (isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag'),
      bodyHtml: `
        <form id="ze-form">
          <div class="form-grid">
            <div class="field"><label>Projekt *</label>
              <select name="projektId" required>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Mitarbeiter</label>
              <select name="mitarbeiterId"><option value="">–</option>${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.mitarbeiterId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Dauer (Minuten)</label><input type="number" min="1" name="dauerMinuten" value="${data.dauerMinuten}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
            <div class="field field-checkbox col-span-2"><input type="checkbox" name="abgerechnet" id="ze-abgerechnet" ${data.abgerechnet ? 'checked' : ''}><label for="ze-abgerechnet">Bereits abgerechnet</label></div>
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
        if (!confirmDelete('Eintrag wirklich löschen?')) return;
        await remove('zeiterfassung', data.id);
        toast('Eintrag gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#ze-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.projektId = fd.get('projektId') || '';
      updated.mitarbeiterId = fd.get('mitarbeiterId') || '';
      updated.datum = fd.get('datum') || data.datum;
      updated.dauerMinuten = Number(fd.get('dauerMinuten')) || 0;
      updated.beschreibung = (fd.get('beschreibung') || '').toString().trim();
      updated.abgerechnet = fd.get('abgerechnet') === 'on';
      if (!updated.projektId) { toast('Bitte ein Projekt wählen', 'danger'); return; }
      await put('zeiterfassung', updated);
      toast('Zeit gespeichert', 'success');
      close();
      render(container);
    });
  }

  renderTimer();
  renderTable();

  return () => { if (tickInterval) clearInterval(tickInterval); };
}
