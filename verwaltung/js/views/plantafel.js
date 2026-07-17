import { getAll, put, remove, getSettings, TERMIN_TYPEN, BEREICHE } from '../db.js';
import { uid, escapeHtml, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import * as google from '../google.js';
import { syncCalendar, deleteSyncedEvent } from '../googlesync.js';
import { suggestSlot } from '../terminvorschlag.js';
import { mountKarte, KARTE_TAB_HTML } from '../karte.js';
import { openStatusManager } from '../statusManager.js';

const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const LANE_HEIGHT = 24;

const RES_TYPES = [
  { type: 'mitarbeiter', field: 'mitarbeiterIds', label: 'Mitarbeiter', nameKey: 'name', colorFallback: '#f0a020' },
  { type: 'geraet', field: 'geraeteIds', label: 'Geräte', nameKey: 'name', colorFallback: '#14b8a6' },
  { type: 'flotte', field: 'flottenIds', label: 'Flotten', nameKey: 'bezeichnung', colorFallback: '#4d8bf0' },
];

function typInfo(typId) {
  return TERMIN_TYPEN.find((t) => t.id === typId) || TERMIN_TYPEN[0];
}

function startOfWeek(d) {
  const date = new Date(d);
  const offset = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateOnly(iso) {
  return (iso || '').slice(0, 10);
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenStr(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

export async function render(container, _route, { autoSync = true } = {}) {
  if (autoSync && google.isConnected() && (await google.isConfigured())) {
    try { await syncCalendar(); } catch (err) { /* silent: don't interrupt view load */ }
  }

  let [termine, kunden, projekte, mitarbeiter, geraete, flotten, settings, terminStatus] = await Promise.all([
    getAll('termine'), getAll('kunden'), getAll('projekte'), getAll('mitarbeiter'), getAll('geraete'), getAll('flotten'), getSettings(), getAll('terminStatus'),
  ]);
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  geraete.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  flotten.sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  terminStatus.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const activeStatusFilter = new Set();
  let bereichFilter = '';

  const resourceLists = { mitarbeiter, geraet: geraete, flotte: flotten };

  const now = new Date();
  let weekStart = startOfWeek(now);
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();

  container.innerHTML = `
    <div class="view-header">
      <h1>Plantafel</h1>
      <div class="actions">
        <button class="btn" id="btn-sync">🔄 Mit Google synchronisieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Termin</button>
      </div>
    </div>
    <div class="cal-legend">
      ${TERMIN_TYPEN.map((t) => `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${t.farbe}"></span>${escapeHtml(t.titel)}</span>`).join('')}
    </div>
    <div class="flex-row flex-wrap" style="margin-bottom:10px">
      <select id="bereich-filter">
        <option value="">Alle Bereiche</option>
        ${BEREICHE.map((b) => `<option value="${b.id}">${escapeHtml(b.titel)}</option>`).join('')}
      </select>
    </div>
    <div class="status-pill-bar" id="status-pill-bar"></div>
    <div class="tabs" id="pt-mode-tabs">
      <button type="button" class="tab-item active" data-mode="woche">🗓️ Woche</button>
      <button type="button" class="tab-item" data-mode="monat">📅 Monat</button>
      <button type="button" class="tab-item" data-mode="karte">🗺️ Karte</button>
    </div>
    <div id="woche-view">
      <div class="card">
        <div class="cal-header">
          <button class="btn btn-sm" id="btn-prev">← Woche</button>
          <div class="cal-title" id="week-title"></div>
          <button class="btn btn-sm" id="btn-today">Heute</button>
          <button class="btn btn-sm" id="btn-next">Woche →</button>
        </div>
        <p class="hint">Balken ziehen zum Verschieben (auch auf andere Zeilen), am rechten Rand ziehen zum Verlängern/Verkürzen.</p>
        <div id="plantafel-host"></div>
      </div>
    </div>
    <div id="monat-view" hidden>
      <div class="card">
        <div class="cal-header">
          <button class="btn btn-sm" id="btn-monat-prev">← </button>
          <div class="cal-title" id="cal-title"></div>
          <button class="btn btn-sm" id="btn-monat-next">→</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
      </div>
    </div>
    ${KARTE_TAB_HTML}
  `;

  const host = container.querySelector('#plantafel-host');
  const weekTitle = container.querySelector('#week-title');
  const monatGrid = container.querySelector('#cal-grid');
  const monatTitle = container.querySelector('#cal-title');
  const karte = mountKarte(container, { termine, kundenById, settings });

  function setMode(mode) {
    container.querySelectorAll('#pt-mode-tabs .tab-item').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    container.querySelector('#woche-view').hidden = mode !== 'woche';
    container.querySelector('#monat-view').hidden = mode !== 'monat';
    container.querySelector('#karte-view').hidden = mode !== 'karte';
    if (mode === 'karte') karte.refresh();
  }
  container.querySelectorAll('#pt-mode-tabs .tab-item').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

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

  function passesFilters(t) {
    if (activeStatusFilter.size && !activeStatusFilter.has(t.status || 'geplant')) return false;
    if (bereichFilter) {
      const projekt = projekteById[t.projektId];
      if (!projekt || projekt.bereich !== bereichFilter) return false;
    }
    return true;
  }

  container.querySelector('#bereich-filter').addEventListener('change', (e) => {
    bereichFilter = e.target.value;
    renderGrid();
    renderMonatGrid();
  });

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
        renderMonatGrid();
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

  // ---------- Woche (Gantt) ----------

  function fmtDay(d) {
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(d);
  }

  function weekDays() {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  // Lane-packing: assign each termin (clipped to the visible week) a lane index so overlapping bars stack instead of collide.
  function packLanes(items) {
    const lanes = []; // lanes[i] = last occupied day-index (0-6)
    for (const it of items) {
      let lane = lanes.findIndex((lastDay) => lastDay < it.startIdx);
      if (lane === -1) { lane = lanes.length; lanes.push(-1); }
      lanes[lane] = it.endIdx;
      it.lane = lane;
    }
    return lanes.length;
  }

  function buildRow(resource, resType, field, nameKey, colorFallback, weekStartStr, weekEndStr, todayStr) {
    const items = termine
      .filter((t) => t[field]?.includes(resource.id))
      .filter(passesFilters)
      .map((t) => {
        const start = toDateOnly(t.start);
        const ende = toDateOnly(t.ende) || start;
        if (ende < weekStartStr || start > weekEndStr) return null;
        const clipStart = start < weekStartStr ? weekStartStr : start;
        const clipEnd = ende > weekEndStr ? weekEndStr : ende;
        return { termin: t, startIdx: daysBetweenStr(weekStartStr, clipStart), endIdx: daysBetweenStr(weekStartStr, clipEnd) };
      })
      .filter(Boolean)
      .sort((a, b) => a.startIdx - b.startIdx);
    const laneCount = packLanes(items);
    const rowHeight = Math.max(56, laneCount * LANE_HEIGHT + 14);

    return `
      <div class="plantafel-row">
        <div class="plantafel-cell plantafel-name">
          <span class="dot" style="background:${resource.farbe || colorFallback}"></span>${escapeHtml(resource[nameKey] || '')}
        </div>
        <div class="plantafel-days" data-restype="${resType}" data-resid="${resource.id}" style="min-height:${rowHeight}px">
          ${weekDays().map((d, i) => {
            const dateStr = toDateOnly(d.toISOString());
            return `<div class="plantafel-day ${dateStr === todayStr ? 'is-today' : ''}" data-idx="${i}" data-date="${dateStr}"></div>`;
          }).join('')}
          <div class="plantafel-bars">
            ${items.map((it) => {
              const farbe = it.termin.farbe || typInfo(it.termin.typ).farbe;
              const span = it.endIdx - it.startIdx + 1;
              return `
                <div class="plantafel-bar" data-id="${it.termin.id}"
                  style="left:calc(${it.startIdx}/7*100%); width:calc(${span}/7*100% - 4px); top:${it.lane * LANE_HEIGHT + 6}px; background:${farbe}33; border-color:${farbe}; color:${farbe}">
                  <span class="plantafel-bar-label">${escapeHtml(it.termin.titel)}</span>
                  <span class="plantafel-bar-handle" data-id="${it.termin.id}"></span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderGrid() {
    const days = weekDays();
    const weekEnd = days[6];
    const weekStartStr = toDateOnly(days[0].toISOString());
    const weekEndStr = toDateOnly(days[6].toISOString());
    weekTitle.textContent = `${fmtDay(weekStart)} – ${fmtDay(weekEnd)} ${weekEnd.getFullYear()}`;

    if (mitarbeiter.length === 0) {
      host.innerHTML = '<div class="empty-state">Noch keine Mitarbeiter angelegt.</div>';
      return;
    }

    const todayStr = toDateOnly(new Date().toISOString());

    host.innerHTML = `
      <div class="plantafel-grid">
        <div class="plantafel-rowhead">
          <div class="plantafel-cell plantafel-head"></div>
          <div class="plantafel-days-head">
            ${days.map((d) => {
              const dateStr = toDateOnly(d.toISOString());
              return `<div class="plantafel-cell plantafel-head ${dateStr === todayStr ? 'is-today' : ''}">${DOW[(d.getDay() + 6) % 7]}<br>${fmtDay(d)}</div>`;
            }).join('')}
          </div>
        </div>
        ${RES_TYPES.map(({ type, field, label, nameKey, colorFallback }) => {
          const list = resourceLists[type];
          if (list.length === 0) return '';
          return `
            <div class="plantafel-section-label">${label}</div>
            ${list.map((r) => buildRow(r, type, field, nameKey, colorFallback, weekStartStr, weekEndStr, todayStr)).join('')}
          `;
        }).join('')}
      </div>
    `;

    wireInteractions(weekStartStr);
  }

  function wireInteractions(weekStartStr) {
    // Click empty day cell -> new termin for that resource/day
    host.querySelectorAll('.plantafel-day').forEach((cell) => {
      cell.addEventListener('click', () => {
        const row = cell.closest('.plantafel-days');
        openForm(null, { date: cell.dataset.date, resType: row.dataset.restype, resId: row.dataset.resid });
      });
    });

    // Click bar -> edit; drag handled separately (dragstart won't fire the click after a real drag)
    host.querySelectorAll('.plantafel-bar-label').forEach((label) => {
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        const bar = label.closest('.plantafel-bar');
        openForm(termine.find((t) => t.id === bar.dataset.id));
      });
    });

    // Verschieben per Pointer Events (funktioniert einheitlich mit Maus, Touch/Tablet und Stift –
    // natives HTML5-Drag&Drop wird auf iOS/Touch-Geräten nicht unterstützt).
    async function moveTerminTo(termin, row, clientX) {
      const rect = row.getBoundingClientRect();
      const dayIdx = Math.max(0, Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7)));
      const start = toDateOnly(termin.start);
      const ende = toDateOnly(termin.ende) || start;
      const duration = daysBetweenStr(start, ende);
      const newStart = addDaysStr(weekStartStr, dayIdx);
      const newEnde = addDaysStr(newStart, duration);
      const time = (termin.start || '').slice(11, 16) || '00:00';
      termin.start = `${newStart}T${time}`;
      termin.ende = newEnde;
      const resType = row.dataset.restype;
      const resId = row.dataset.resid;
      const resDef = RES_TYPES.find((r) => r.type === resType);
      if (resDef && resId && !termin[resDef.field]?.includes(resId)) {
        termin[resDef.field] = [resId];
      }
      termin.aktualisiertAm = new Date().toISOString();
      await put('termine', termin);
      toast('Termin verschoben', 'success');
      renderGrid();
    }

    host.querySelectorAll('.plantafel-bar').forEach((bar) => {
      bar.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.plantafel-bar-handle')) return;
        if (e.button !== undefined && e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;

        function onMove(ev) {
          if (!dragging && (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6)) {
            dragging = true;
            bar.classList.add('dragging');
            // Erst jetzt capturen: setPointerCapture würde sonst auch den Klick eines
            // einfachen Taps auf .plantafel-bar-label auf die Bar umleiten und die
            // Bearbeitung verhindern.
            bar.setPointerCapture(e.pointerId);
          }
        }
        async function onUp(ev) {
          bar.removeEventListener('pointermove', onMove);
          bar.removeEventListener('pointerup', onUp);
          bar.removeEventListener('pointercancel', onUp);
          bar.classList.remove('dragging');
          if (!dragging) return; // einfacher Tap -> Klick auf .plantafel-bar-label öffnet die Bearbeitung
          const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.plantafel-days');
          const termin = termine.find((t) => t.id === bar.dataset.id);
          if (target && termin) await moveTerminTo(termin, target, ev.clientX);
        }
        bar.addEventListener('pointermove', onMove);
        bar.addEventListener('pointerup', onUp);
        bar.addEventListener('pointercancel', onUp);
      });
    });

    // Verlängern/Verkürzen per Handle (rechter Rand), ebenfalls über Pointer Events.
    host.querySelectorAll('.plantafel-bar-handle').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const bar = handle.closest('.plantafel-bar');
        const row = bar.closest('.plantafel-days');
        const termin = termine.find((t) => t.id === handle.dataset.id);
        if (!termin) return;
        handle.setPointerCapture(e.pointerId);
        const rect = row.getBoundingClientRect();
        const dayWidth = rect.width / 7;
        const startDate = toDateOnly(termin.start);
        const originalEnde = toDateOnly(termin.ende) || startDate;
        let currentEnde = originalEnde;

        function onMove(ev) {
          const deltaPx = ev.clientX - e.clientX;
          const deltaDays = Math.round(deltaPx / dayWidth);
          let newEnde = addDaysStr(originalEnde, deltaDays);
          if (newEnde < startDate) newEnde = startDate;
          currentEnde = newEnde;
          const span = daysBetweenStr(startDate, newEnde) + 1;
          const startIdx = Math.max(0, daysBetweenStr(weekStartStr, startDate));
          bar.style.width = `calc(${Math.min(span, 7 - startIdx)}/7*100% - 4px)`;
        }
        function onUp() {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          termin.ende = currentEnde;
          termin.aktualisiertAm = new Date().toISOString();
          put('termine', termin).then(() => renderGrid());
        }
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    });
  }

  container.querySelector('#btn-prev').addEventListener('click', () => {
    weekStart.setDate(weekStart.getDate() - 7);
    renderGrid();
  });
  container.querySelector('#btn-next').addEventListener('click', () => {
    weekStart.setDate(weekStart.getDate() + 7);
    renderGrid();
  });
  container.querySelector('#btn-today').addEventListener('click', () => {
    weekStart = startOfWeek(new Date());
    renderGrid();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  // ---------- Monat ----------

  function todayStrFn() {
    return new Date().toISOString().slice(0, 10);
  }

  function terminsOnDay(dateStr) {
    return termine.filter((t) => {
      if (!passesFilters(t)) return false;
      const start = (t.start || '').slice(0, 10);
      const ende = (t.ende || '').slice(0, 10) || start;
      return dateStr >= start && dateStr <= ende;
    }).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  }

  function renderMonatGrid() {
    monatTitle.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday = 0
    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);

    let html = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');
    const today = todayStrFn();
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
            const farbe = e.farbe || typInfo(e.typ).farbe;
            return `<div class="cal-event" data-id="${e.id}" style="background:${farbe}22;color:${farbe}" title="${escapeHtml(typInfo(e.typ).titel)}">${escapeHtml(e.titel)}</div>`;
          }).join('')}
          ${events.length > 3 ? `<div class="cal-event">+${events.length - 3} weitere</div>` : ''}
        </div>
      `;
    }
    monatGrid.innerHTML = html;

    monatGrid.querySelectorAll('.cal-event').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openForm(termine.find((t) => t.id === el.dataset.id));
      });
    });
    monatGrid.querySelectorAll('.cal-day').forEach((el) => {
      el.addEventListener('click', () => openForm(null, { date: el.dataset.date }));
    });
  }

  container.querySelector('#btn-monat-prev').addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderMonatGrid();
  });
  container.querySelector('#btn-monat-next').addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderMonatGrid();
  });

  // ---------- Gemeinsames Termin-Formular ----------

  function openForm(t, prefill) {
    const isEdit = !!t;
    const todayStr = new Date().toISOString().slice(0, 10);
    const data = t || {
      id: uid(), titel: '', typ: 'termin', start: `${prefill?.date || todayStr}T09:00`, ende: '',
      ort: '', kundeId: '', projektId: '',
      mitarbeiterIds: prefill?.resType === 'mitarbeiter' ? [prefill.resId] : [],
      geraeteIds: prefill?.resType === 'geraet' ? [prefill.resId] : [],
      flottenIds: prefill?.resType === 'flotte' ? [prefill.resId] : [],
      notizen: '', farbe: '', status: terminStatus[0]?.id || 'geplant',
    };
    const startDate = (data.start || '').slice(0, 10) || prefill?.date || todayStr;
    const startTime = (data.start || '').slice(11, 16) || '09:00';

    const { body, close } = openModal({
      title: isEdit ? 'Termin bearbeiten' : 'Neuer Termin',
      wide: true,
      bodyHtml: `
        <form id="pt-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Art</label>
              <select name="typ">${TERMIN_TYPEN.map((tt) => `<option value="${tt.id}" ${tt.id === (data.typ || 'termin') ? 'selected' : ''}>${escapeHtml(tt.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${terminStatus.map((s) => `<option value="${s.id}" ${s.id === (data.status || terminStatus[0]?.id) ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Uhrzeit</label><input type="time" name="uhrzeit" value="${startTime}"></div>
            <div class="field"><label>Von</label><input type="date" name="datum" value="${startDate}" required></div>
            <div class="field"><label>Bis (optional, für mehrtägig)</label><input type="date" name="enddatum" value="${toDateOnly(data.ende) || ''}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
            <div class="field"><label>Farbe (optional, überschreibt Art-Farbe)</label><input type="color" name="farbe" value="${escapeHtml(data.farbe || typInfo(data.typ || 'termin').farbe)}"></div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId"><option value="">–</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Projekt <span class="text-mute" id="f-projekt-bereich"></span></label>
              <select name="projektId"><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" data-bereich="${p.bereich || ''}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
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
            ${geraete.length ? `
              <div class="field col-span-2"><label>Geräte</label>
                <div class="tag-list">
                  ${geraete.map((g) => `
                    <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                      <input type="checkbox" name="geraeteIds" value="${g.id}" ${data.geraeteIds?.includes(g.id) ? 'checked' : ''}> ${escapeHtml(g.name)}
                    </label>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            ${flotten.length ? `
              <div class="field col-span-2"><label>Flotten</label>
                <div class="tag-list">
                  ${flotten.map((f) => `
                    <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                      <input type="checkbox" name="flottenIds" value="${f.id}" ${data.flottenIds?.includes(f.id) ? 'checked' : ''}> ${escapeHtml(f.bezeichnung)}
                    </label>
                  `).join('')}
                </div>
              </div>
            ` : ''}
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
    function updateProjektBereichHint() {
      const select = body.querySelector('select[name="projektId"]');
      const bereichId = select.selectedOptions[0]?.dataset.bereich;
      const bereich = BEREICHE.find((b) => b.id === bereichId);
      body.querySelector('#f-projekt-bereich').textContent = bereich ? `(${bereich.titel})` : '';
    }
    updateProjektBereichHint();
    body.querySelector('select[name="projektId"]').addEventListener('change', updateProjektBereichHint);

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
      const vorschlag = suggestSlot(alleTermine.filter((x) => x.id !== data.id), checked.value);
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
    body.querySelector('#pt-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.titel = (fd.get('titel') || '').toString().trim();
      updated.typ = fd.get('typ') || 'termin';
      updated.start = `${fd.get('datum')}T${fd.get('uhrzeit') || '00:00'}`;
      const enddatum = (fd.get('enddatum') || '').toString().trim();
      updated.ende = enddatum && enddatum >= fd.get('datum') ? enddatum : '';
      updated.ort = (fd.get('ort') || '').toString().trim();
      updated.farbe = (fd.get('farbe') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.status = fd.get('status') || terminStatus[0]?.id || 'geplant';
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      updated.geraeteIds = fd.getAll('geraeteIds');
      updated.flottenIds = fd.getAll('flottenIds');
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
  renderMonatGrid();
}
