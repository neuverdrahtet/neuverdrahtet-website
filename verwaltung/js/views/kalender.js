import { getAll, put, remove, getSettings, TERMIN_TYPEN } from '../db.js';
import { uid, escapeHtml, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import * as google from '../google.js';
import { syncCalendar, deleteSyncedEvent } from '../googlesync.js';
import { suggestSlot } from '../terminvorschlag.js';
import { mountKarte, KARTE_TAB_HTML } from '../karte.js';
import { openStatusManager } from '../statusManager.js';

function typInfo(typId) {
  return TERMIN_TYPEN.find((t) => t.id === typId) || TERMIN_TYPEN[0];
}
function terminFarbe(t) {
  return t.farbe || typInfo(t.typ).farbe;
}

const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export async function render(container, _route, { autoSync = true } = {}) {
  if (autoSync && google.isConnected() && (await google.isConfigured())) {
    try { await syncCalendar(); } catch (err) { /* silent: don't interrupt view load */ }
  }

  let [termine, kunden, projekte, mitarbeiter, settings, terminStatus] = await Promise.all([
    getAll('termine'), getAll('kunden'), getAll('projekte'), getAll('mitarbeiter'), getSettings(), getAll('terminStatus'),
  ]);
  terminStatus.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const statusById = Object.fromEntries(terminStatus.map((s) => [s.id, s]));
  const activeStatusFilter = new Set();

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();

  container.innerHTML = `
    <div class="view-header">
      <h1>Kalender</h1>
      <div class="actions">
        <button class="btn" id="btn-sync">🔄 Mit Google synchronisieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Termin</button>
      </div>
    </div>
    <div class="cal-legend">
      ${TERMIN_TYPEN.map((t) => `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${t.farbe}"></span>${escapeHtml(t.titel)}</span>`).join('')}
    </div>
    <div class="status-pill-bar" id="status-pill-bar"></div>
    <div class="tabs" id="cal-mode-tabs">
      <button type="button" class="tab-item active" data-mode="monat">📅 Monat</button>
      <button type="button" class="tab-item" data-mode="karte">🗺️ Karte</button>
    </div>
    <div id="monat-view">
      <div class="card">
        <div class="cal-header">
          <button class="btn btn-sm" id="btn-prev">← </button>
          <div class="cal-title" id="cal-title"></div>
          <button class="btn btn-sm" id="btn-next">→</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
      </div>
    </div>
    ${KARTE_TAB_HTML}
  `;

  const karte = mountKarte(container, { termine, kundenById, settings });

  function setMode(mode) {
    container.querySelectorAll('#cal-mode-tabs .tab-item').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    container.querySelector('#monat-view').hidden = mode !== 'monat';
    container.querySelector('#karte-view').hidden = mode !== 'karte';
    if (mode === 'karte') karte.refresh();
  }
  container.querySelectorAll('#cal-mode-tabs .tab-item').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  container.querySelector('#btn-sync').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-sync');
    btn.disabled = true;
    btn.textContent = 'Synchronisiere ...';
    try {
      const result = await syncCalendar();
      toast(`Synchronisiert: ${result.created + result.pulled} von Google, ${result.updated + result.pushedNew} an Google übertragen.`, 'success');
      render(container, _route, { autoSync: false });
    } catch (err) {
      toast(err.message, 'danger');
      btn.disabled = false;
      btn.textContent = '🔄 Mit Google synchronisieren';
    }
  });

  const grid = container.querySelector('#cal-grid');
  const title = container.querySelector('#cal-title');

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function terminsOnDay(dateStr) {
    return termine.filter((t) => {
      if (activeStatusFilter.size && !activeStatusFilter.has(t.status || 'geplant')) return false;
      const start = (t.start || '').slice(0, 10);
      const ende = (t.ende || '').slice(0, 10) || start;
      return dateStr >= start && dateStr <= ende;
    }).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  }

  function renderStatusPills() {
    const bar = container.querySelector('#status-pill-bar');
    bar.innerHTML = terminStatus.map((s) => `
      <label class="status-pill ${activeStatusFilter.has(s.id) ? 'active' : ''}" style="--pill-color:${s.farbe}" data-id="${s.id}">
        <input type="checkbox" value="${s.id}" ${activeStatusFilter.has(s.id) ? 'checked' : ''}>
        <span class="dot" style="background:${s.farbe}"></span>${escapeHtml(s.titel)}
      </label>
    `).join('') + `<button type="button" class="status-pill manage-btn" id="btn-status-manage">⚙️ Status verwalten</button>`;
    bar.querySelectorAll('.status-pill[data-id]').forEach((label) => {
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) activeStatusFilter.add(label.dataset.id);
        else activeStatusFilter.delete(label.dataset.id);
        label.classList.toggle('active', e.target.checked);
        renderGrid();
      });
    });
    bar.querySelector('#btn-status-manage').addEventListener('click', () => {
      openStatusManager({
        title: 'Termin-Status verwalten',
        store: 'terminStatus',
        items: terminStatus,
        canDelete: (it) => !termine.some((t) => (t.status || 'geplant') === it.id),
        onChange: () => render(container, _route, { autoSync: false }),
      });
    });
  }

  function renderGrid() {
    title.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday = 0
    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);

    let html = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');
    const today = todayStr();
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const isOtherMonth = d.getMonth() !== viewMonth;
      const events = terminsOnDay(dateStr);
      html += `
        <div class="cal-day ${isOtherMonth ? 'other-month' : ''} ${dateStr === today ? 'today' : ''}" data-date="${dateStr}">
          <div class="day-num">${d.getDate()}</div>
          ${events.slice(0, 3).map((e) => {
            const farbe = terminFarbe(e);
            return `<div class="cal-event" data-id="${e.id}" style="background:${farbe}22;color:${farbe}" title="${escapeHtml(typInfo(e.typ).titel)}">${escapeHtml(e.titel)}</div>`;
          }).join('')}
          ${events.length > 3 ? `<div class="cal-event">+${events.length - 3} weitere</div>` : ''}
        </div>
      `;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.cal-event').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openForm(termine.find((t) => t.id === el.dataset.id));
      });
    });
    grid.querySelectorAll('.cal-day').forEach((el) => {
      el.addEventListener('click', () => openForm(null, el.dataset.date));
    });
  }

  container.querySelector('#btn-prev').addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderGrid();
  });
  container.querySelector('#btn-next').addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderGrid();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm(null, todayStr()));

  function openForm(t, defaultDate) {
    const isEdit = !!t;
    const data = t || {
      id: uid(), titel: '', start: `${defaultDate || todayStr()}T09:00`, ende: '',
      ort: '', kundeId: '', projektId: '', mitarbeiterIds: [], notizen: '', typ: 'termin', farbe: '',
      status: terminStatus[0]?.id || 'geplant',
    };
    const startDate = (data.start || '').slice(0, 10) || defaultDate || todayStr();
    const startTime = (data.start || '').slice(11, 16) || '09:00';

    const { body, close } = openModal({
      title: isEdit ? 'Termin bearbeiten' : 'Neuer Termin',
      bodyHtml: `
        <form id="termin-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Art</label>
              <select name="typ">${TERMIN_TYPEN.map((t) => `<option value="${t.id}" ${t.id === (data.typ || 'termin') ? 'selected' : ''}>${escapeHtml(t.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${terminStatus.map((s) => `<option value="${s.id}" ${s.id === (data.status || terminStatus[0]?.id) ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${startDate}" required></div>
            <div class="field"><label>Uhrzeit</label><input type="time" name="uhrzeit" value="${startTime}"></div>
            <div class="field"><label>Bis (optional, für mehrtägig)</label><input type="date" name="enddatum" value="${(data.ende || '').slice(0, 10)}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
            <div class="field"><label>Farbe (optional, überschreibt Art-Farbe)</label><input type="color" name="farbe" value="${escapeHtml(data.farbe || typInfo(data.typ || 'termin').farbe)}"></div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId"><option value="">–</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Projekt</label>
              <select name="projektId"><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Mitarbeiter</label>
              <div class="tag-list">
                ${mitarbeiter.map((m) => `
                  <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                    <input type="checkbox" name="mitarbeiterIds" value="${m.id}" ${data.mitarbeiterIds?.includes(m.id) ? 'checked' : ''}> ${escapeHtml(m.name)}
                  </label>
                `).join('') || '<span class="text-mute">Keine Mitarbeiter angelegt.</span>'}
              </div>
              <button type="button" class="btn btn-sm" id="btn-vorschlag" style="margin-top:6px;align-self:flex-start">🤖 Nächsten freien Termin vorschlagen</button>
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
    let farbeCustom = !!data.farbe;
    body.querySelector('input[name="farbe"]').addEventListener('input', () => { farbeCustom = true; });
    body.querySelector('select[name="typ"]').addEventListener('change', (e) => {
      if (farbeCustom) return;
      body.querySelector('input[name="farbe"]').value = typInfo(e.target.value).farbe;
    });
    body.querySelector('#btn-vorschlag').addEventListener('click', async () => {
      const checked = body.querySelector('input[name="mitarbeiterIds"]:checked');
      if (!checked) { toast('Bitte zuerst einen Mitarbeiter auswählen', 'danger'); return; }
      const alleTermine = await getAll('termine');
      const vorschlag = suggestSlot(alleTermine.filter((t) => t.id !== data.id), checked.value);
      if (!vorschlag) { toast('Kein freier Termin in den nächsten 3 Wochen gefunden', 'danger'); return; }
      body.querySelector('input[name="datum"]').value = vorschlag.datum;
      body.querySelector('input[name="uhrzeit"]').value = vorschlag.uhrzeit;
      toast(`Vorschlag: ${vorschlag.datum} um ${vorschlag.uhrzeit} Uhr`, 'success');
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Termin "${data.titel}" wirklich löschen?`)) return;
        try { await deleteSyncedEvent(data); } catch (err) { /* ignore Google errors on delete */ }
        await remove('termine', data.id);
        toast('Termin gelöscht');
        close();
        render(container, null, { autoSync: false });
      });
    }
    body.querySelector('#termin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.titel = (fd.get('titel') || '').toString().trim();
      updated.typ = fd.get('typ') || 'termin';
      updated.status = fd.get('status') || terminStatus[0]?.id || 'geplant';
      updated.start = `${fd.get('datum')}T${fd.get('uhrzeit') || '00:00'}`;
      const enddatum = (fd.get('enddatum') || '').toString().trim();
      updated.ende = enddatum && enddatum >= fd.get('datum') ? enddatum : '';
      updated.ort = (fd.get('ort') || '').toString().trim();
      updated.farbe = (fd.get('farbe') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      updated.notizen = (fd.get('notizen') || '').toString().trim();
      updated.aktualisiertAm = new Date().toISOString();
      if (!updated.titel) return;
      await put('termine', updated);
      toast(isEdit ? 'Termin aktualisiert' : 'Termin angelegt', 'success');
      close();
      render(container, null, { autoSync: false });
    });
  }

  renderStatusPills();
  renderGrid();
}
