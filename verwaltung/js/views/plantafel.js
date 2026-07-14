import { getAll, put, remove, TERMIN_TYPEN } from '../db.js';
import { uid, escapeHtml, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

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

export async function render(container) {
  let [termine, kunden, projekte, mitarbeiter] = await Promise.all([
    getAll('termine'), getAll('kunden'), getAll('projekte'), getAll('mitarbeiter'),
  ]);
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let weekStart = startOfWeek(new Date());

  container.innerHTML = `
    <div class="view-header">
      <h1>Plantafel</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neuer Termin</button></div>
    </div>
    <div class="cal-legend">
      ${TERMIN_TYPEN.map((t) => `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${t.farbe}"></span>${escapeHtml(t.titel)}</span>`).join('')}
    </div>
    <div class="card">
      <div class="cal-header">
        <button class="btn btn-sm" id="btn-prev">← Woche</button>
        <div class="cal-title" id="week-title"></div>
        <button class="btn btn-sm" id="btn-today">Heute</button>
        <button class="btn btn-sm" id="btn-next">Woche →</button>
      </div>
      <div id="plantafel-host"></div>
    </div>
  `;

  const host = container.querySelector('#plantafel-host');
  const weekTitle = container.querySelector('#week-title');

  function fmtDay(d) {
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(d);
  }

  function renderGrid() {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
    const weekEnd = days[6];
    weekTitle.textContent = `${fmtDay(weekStart)} – ${fmtDay(weekEnd)} ${weekEnd.getFullYear()}`;

    if (mitarbeiter.length === 0) {
      host.innerHTML = '<div class="empty-state">Noch keine Mitarbeiter angelegt.</div>';
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    host.innerHTML = `
      <div class="plantafel-grid" style="grid-template-columns: 160px repeat(7, 1fr);">
        <div class="plantafel-cell plantafel-head"></div>
        ${days.map((d) => {
          const dateStr = d.toISOString().slice(0, 10);
          return `<div class="plantafel-cell plantafel-head ${dateStr === todayStr ? 'is-today' : ''}">${DOW[(d.getDay() + 6) % 7]}<br>${fmtDay(d)}</div>`;
        }).join('')}
        ${mitarbeiter.map((m) => `
          <div class="plantafel-cell plantafel-name">
            <span class="dot" style="background:${m.farbe || '#f0a020'}"></span>${escapeHtml(m.name)}
          </div>
          ${days.map((d) => {
            const dateStr = d.toISOString().slice(0, 10);
            const dayTermine = termine.filter((t) => t.mitarbeiterIds?.includes(m.id) && (t.start || '').slice(0, 10) === dateStr);
            return `
              <div class="plantafel-cell plantafel-day ${dateStr === todayStr ? 'is-today' : ''}" data-ma="${m.id}" data-date="${dateStr}">
                ${dayTermine.map((t) => {
                  const ti = typInfo(t.typ);
                  return `<div class="plantafel-chip" data-id="${t.id}" style="background:${ti.farbe}22;color:${ti.farbe};border-color:${ti.farbe}55" title="${escapeHtml(t.titel)}">${escapeHtml(t.titel)}</div>`;
                }).join('')}
              </div>
            `;
          }).join('')}
        `).join('')}
      </div>
    `;

    host.querySelectorAll('.plantafel-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openForm(termine.find((t) => t.id === chip.dataset.id));
      });
    });
    host.querySelectorAll('.plantafel-day').forEach((cell) => {
      cell.addEventListener('click', () => openForm(null, { date: cell.dataset.date, mitarbeiterId: cell.dataset.ma }));
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

  function openForm(t, prefill) {
    const isEdit = !!t;
    const todayStr = new Date().toISOString().slice(0, 10);
    const data = t || {
      id: uid(), titel: '', typ: 'termin', start: `${prefill?.date || todayStr}T09:00`, ende: '',
      ort: '', kundeId: '', projektId: '', mitarbeiterIds: prefill?.mitarbeiterId ? [prefill.mitarbeiterId] : [], notizen: '',
    };
    const startDate = (data.start || '').slice(0, 10) || prefill?.date || todayStr;
    const startTime = (data.start || '').slice(11, 16) || '09:00';

    const { body, close } = openModal({
      title: isEdit ? 'Termin bearbeiten' : 'Neuer Termin',
      bodyHtml: `
        <form id="pt-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Art</label>
              <select name="typ">${TERMIN_TYPEN.map((tt) => `<option value="${tt.id}" ${tt.id === (data.typ || 'termin') ? 'selected' : ''}>${escapeHtml(tt.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${startDate}" required></div>
            <div class="field"><label>Uhrzeit</label><input type="time" name="uhrzeit" value="${startTime}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
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
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Termin "${data.titel}" wirklich löschen?`)) return;
        await remove('termine', data.id);
        toast('Termin gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#pt-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.titel = (fd.get('titel') || '').toString().trim();
      updated.typ = fd.get('typ') || 'termin';
      updated.start = `${fd.get('datum')}T${fd.get('uhrzeit') || '00:00'}`;
      updated.ort = (fd.get('ort') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      updated.notizen = (fd.get('notizen') || '').toString().trim();
      updated.aktualisiertAm = new Date().toISOString();
      if (!updated.titel) return;
      await put('termine', updated);
      toast(isEdit ? 'Termin aktualisiert' : 'Termin angelegt', 'success');
      close();
      render(container);
    });
  }

  renderGrid();
}
