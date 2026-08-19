import { getAll, put, TERMIN_TYPEN } from '../db.js';
import { escapeHtml, formatDate, localDateStr } from '../utils.js';
import { optionList } from '../ui.js';

// Flache, sortier-/filterbare Liste aller Termine - Ergänzung zur Plantafel
// (die primär kalender-/ressourcenorientiert ist und keine Volltextsuche über
// alle Termine hinweg bietet). Bearbeiten passiert bewusst nicht hier über ein
// eigenes Formular, sondern per Klick auf eine Zeile per Direktsprung in die
// Plantafel-Tagesansicht (#/plantafel/tag/<Datum>) - so bleibt die komplette,
// bereits vorhandene Bearbeitungslogik (Ressourcen, Google-Sync, Terminvorschlag)
// an einer einzigen Stelle im Code.
function typInfo(typId) {
  return TERMIN_TYPEN.find((t) => t.id === typId) || TERMIN_TYPEN[0];
}

export async function render(container) {
  let [termine, kunden, mitarbeiter, terminStatus] = await Promise.all([
    getAll('termine'), getAll('kunden'), getAll('mitarbeiter'), getAll('terminStatus'),
  ]);
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  terminStatus.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const today = localDateStr(new Date());

  function statusInfo(id) {
    return terminStatus.find((s) => s.id === id) || { id: id || 'geplant', titel: id || 'Geplant', farbe: '#6b7280' };
  }

  let zeitraumFilter = 'zukunft';
  let statusFilter = '';
  let mitarbeiterFilter = '';
  let sortAsc = true;
  let filtered = [];

  container.innerHTML = `
    <div class="view-header">
      <h1>Termine</h1>
      <div class="actions"><a class="btn btn-primary" href="#/plantafel">+ Neuer Termin</a></div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Titel, Kunde, Ort ...">
      <select id="zeitraum-filter">
        <option value="zukunft">Anstehend</option>
        <option value="heute">Heute</option>
        <option value="woche">Diese Woche</option>
        <option value="alle">Alle</option>
        <option value="vergangen">Vergangen</option>
      </select>
      <select id="status-filter">
        <option value="">Alle Status</option>
        ${terminStatus.map((s) => `<option value="${s.id}">${escapeHtml(s.titel)}</option>`).join('')}
      </select>
      <select id="mitarbeiter-filter">${optionList(mitarbeiter, { selected: '', placeholder: 'Alle Mitarbeiter' })}</select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    filtered = termine.filter((t) => {
      const datum = (t.start || '').slice(0, 10);
      if (zeitraumFilter === 'heute' && datum !== today) return false;
      if (zeitraumFilter === 'zukunft' && datum < today) return false;
      if (zeitraumFilter === 'vergangen' && datum >= today) return false;
      if (zeitraumFilter === 'woche') {
        const d = new Date(today + 'T00:00:00');
        const inSieben = new Date(d);
        inSieben.setDate(d.getDate() + 7);
        if (datum < today || datum > localDateStr(inSieben)) return false;
      }
      if (statusFilter && (t.status || 'geplant') !== statusFilter) return false;
      if (mitarbeiterFilter && !(t.mitarbeiterIds || []).includes(mitarbeiterFilter)) return false;
      if (!q) return true;
      return [t.titel, kundenById[t.kundeId]?.firma, t.ort].filter(Boolean).join(' ').toLowerCase().includes(q);
    }).sort((a, b) => sortAsc ? (a.start || '').localeCompare(b.start || '') : (b.start || '').localeCompare(a.start || ''));
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Keine Termine gefunden.</div>';
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th id="th-datum" style="cursor:pointer">Datum ${sortAsc ? '↑' : '↓'}</th><th>Zeit</th><th>Status</th><th>Titel</th>
          <th>Kunde</th><th>Ort</th><th>Mitarbeiter</th>
        </tr></thead>
        <tbody>
          ${filtered.map((t) => {
            const datum = (t.start || '').slice(0, 10);
            const zeit = (t.start || '').slice(11, 16) || '--:--';
            const farbe = t.farbe || typInfo(t.typ).farbe;
            const status = statusInfo(t.status);
            const mitarbeiterNamen = (t.mitarbeiterIds || []).map((id) => mitarbeiterById[id]?.name).filter(Boolean).join(', ');
            return `
              <tr data-id="${t.id}" data-datum="${datum}" style="cursor:pointer;border-left:3px solid ${farbe}">
                <td>${formatDate(datum)}${datum === today ? ' <span class="badge badge-accent">Heute</span>' : ''}</td>
                <td>${escapeHtml(zeit)}</td>
                <td>
                  <select class="f-status-inline" data-id="${t.id}" style="background:${status.farbe}22;color:${status.farbe};border-color:${status.farbe}66">
                    ${terminStatus.map((s) => `<option value="${s.id}" ${s.id === status.id ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}
                  </select>
                </td>
                <td>${escapeHtml(t.titel)}</td>
                <td>${escapeHtml(kundenById[t.kundeId]?.firma || '')}</td>
                <td>${escapeHtml(t.ort || '')}</td>
                <td>${escapeHtml(mitarbeiterNamen)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => {
        window.location.hash = `#/plantafel/tag/${row.dataset.datum}`;
      });
    });
    tableHost.querySelectorAll('.f-status-inline').forEach((select) => {
      select.addEventListener('click', (e) => e.stopPropagation());
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const t = termine.find((x) => x.id === select.dataset.id);
        if (!t) return;
        t.status = select.value;
        t.aktualisiertAm = new Date().toISOString();
        await put('termine', t);
        const s = statusInfo(t.status);
        select.style.background = `${s.farbe}22`;
        select.style.color = s.farbe;
        select.style.borderColor = `${s.farbe}66`;
      });
    });
    tableHost.querySelector('#th-datum').addEventListener('click', () => {
      sortAsc = !sortAsc;
      applyFilter();
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#zeitraum-filter').addEventListener('change', (e) => { zeitraumFilter = e.target.value; applyFilter(); });
  container.querySelector('#status-filter').addEventListener('change', (e) => { statusFilter = e.target.value; applyFilter(); });
  container.querySelector('#mitarbeiter-filter').addEventListener('change', (e) => { mitarbeiterFilter = e.target.value; applyFilter(); });

  applyFilter();
}
