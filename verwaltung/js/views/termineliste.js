import { getAll, put, remove, TERMIN_TYPEN } from '../db.js';
import { escapeHtml, formatDate, localDateStr, toast } from '../utils.js';
import { optionList, openModal, confirmDelete } from '../ui.js';

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
      <div class="actions">
        <button class="btn" id="btn-duplikate">🧹 Duplikate bereinigen</button>
        <a class="btn btn-primary" href="#/plantafel">+ Neuer Termin</a>
      </div>
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
  container.querySelector('#btn-duplikate').addEventListener('click', () => openDuplikateModal());

  // Findet Termine mit exakt gleichem Titel + gleicher Startzeit - z.B.
  // entstanden, wenn ein Termin sowohl in Werkora als auch unabhängig direkt
  // im Google-Kalender angelegt wurde, oder durch mehrfache API-Aufrufe
  // (inzwischen an beiden Stellen durch Abgleich-/Idempotenz-Logik verhindert -
  // dieses Werkzeug räumt nur auf, was schon vor dem Fix entstanden ist).
  function findDuplikatGruppen() {
    const groups = new Map();
    for (const t of termine) {
      const key = `${(t.titel || '').trim().toLowerCase()}|${t.start || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  }

  function openDuplikateModal() {
    const gruppen = findDuplikatGruppen();
    if (gruppen.length === 0) {
      toast('Keine Duplikate gefunden.', 'success');
      return;
    }
    // Bevorzugt den mit Google verknüpften Termin behalten (der ist am
    // ehesten der "echte"), sonst einfach den ersten der Gruppe.
    const behalten = new Map(gruppen.map((g) => [g, g.find((t) => t.googleEventId) || g[0]]));
    const { body, close } = openModal({
      title: 'Duplikate bereinigen',
      wide: true,
      bodyHtml: `
        <p class="hint">${gruppen.length} Gruppe(n) mit insgesamt ${gruppen.reduce((s, g) => s + g.length - 1, 0)} überzähligen Termin(en) gefunden. Vorausgewählt bleibt jeweils der mit Google verknüpfte bzw. der erste Termin erhalten - Auswahl vor dem Löschen prüfen.</p>
        <div id="dup-groups">
          ${gruppen.map((g, gi) => `
            <div class="card" style="margin-bottom:10px">
              <strong>${escapeHtml(g[0].titel)}</strong>
              <div class="text-mute" style="font-size:12px;margin-bottom:6px">${formatDate(g[0].start)} ${escapeHtml((g[0].start || '').slice(11, 16))} Uhr · ${g.length} gleiche Termine</div>
              ${g.map((t, ti) => `
                <label class="field-checkbox" style="display:flex;align-items:center;gap:8px;padding:4px 0">
                  <input type="checkbox" class="dup-del" data-gi="${gi}" data-ti="${ti}" ${t.id === behalten.get(g).id ? '' : 'checked'}>
                  <span>${escapeHtml(t.ort || '– kein Ort –')}${t.googleEventId ? ' · 🔗 Google' : ''}${t.id === behalten.get(g).id ? ' (bleibt erhalten)' : ''}</span>
                </label>
              `).join('')}
            </div>
          `).join('')}
        </div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-danger" id="btn-dup-delete">Ausgewählte löschen</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#btn-dup-delete').addEventListener('click', async () => {
      const checked = Array.from(body.querySelectorAll('.dup-del:checked'));
      if (checked.length === 0) { toast('Keine Termine ausgewählt.', 'danger'); return; }
      if (!confirmDelete(`${checked.length} Termin(e) wirklich löschen?`)) return;
      for (const cb of checked) {
        const t = gruppen[Number(cb.dataset.gi)][Number(cb.dataset.ti)];
        await remove('termine', t.id);
        termine = termine.filter((x) => x.id !== t.id);
      }
      toast(`${checked.length} Duplikat(e) gelöscht`, 'success');
      close();
      applyFilter();
    });
  }

  applyFilter();
}
