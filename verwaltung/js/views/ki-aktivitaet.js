import { getAll } from '../db.js';
import { escapeHtml, formatDateTime } from '../utils.js';

// Read-only Protokoll aller KI-Bürokraft-API-Aufrufe (ai_action_log,
// geschrieben vom Worker in cloudflare-worker-ki-buerokraft/). Absichtlich
// ohne Löschen/Bearbeiten - ein Audit-Log soll nicht nachträglich
// veränderbar sein.
const STATUS_LABEL = { success: 'Erfolgreich', blocked: 'Blockiert', error: 'Fehler' };
const STATUS_BADGE = { success: 'badge-success', blocked: 'badge-danger', error: 'badge-warn' };

export async function render(container) {
  let eintraege = await getAll('ai_action_log');
  eintraege.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>KI-Aktivität</h1>
    </div>
    <p class="hint">Protokoll aller Aufrufe der Werkora-API für die KI-Bürokraft (erfolgreich, blockiert oder fehlgeschlagen) - nur lesbar. Einrichtung/Details siehe <code>cloudflare-worker-ki-buerokraft/README.md</code>.</p>
    <div class="form-row">
      <div class="field"><label>Status</label>
        <select id="filter-status">
          <option value="">Alle</option>
          <option value="success">Erfolgreich</option>
          <option value="blocked">Blockiert</option>
          <option value="error">Fehler</option>
        </select>
      </div>
      <div class="field"><label>Suche (Aktion/Entität)</label><input id="filter-suche" placeholder="z.B. customers.create"></div>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');
  const filterStatus = container.querySelector('#filter-status');
  const filterSuche = container.querySelector('#filter-suche');

  function renderTable() {
    const status = filterStatus.value;
    const suche = filterSuche.value.trim().toLowerCase();
    let gefiltert = eintraege;
    if (status) gefiltert = gefiltert.filter((e) => e.status === status);
    if (suche) gefiltert = gefiltert.filter((e) => (e.action || '').toLowerCase().includes(suche) || (e.entity_type || '').toLowerCase().includes(suche));

    if (gefiltert.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Keine Einträge gefunden. Sobald die KI-Bürokraft-API genutzt wird, erscheinen hier Einträge.</div>';
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Zeitpunkt</th><th>Aktion</th><th>Entität</th><th>Status</th><th>Freigabe nötig</th><th>IP</th></tr></thead>
        <tbody>
          ${gefiltert.slice(0, 500).map((e) => `
            <tr>
              <td>${formatDateTime(e.timestamp)}</td>
              <td><code>${escapeHtml(e.action || '')}</code></td>
              <td>${escapeHtml(e.entity_type || '')}${e.entity_id ? ` <span class="text-mute">${escapeHtml(e.entity_id)}</span>` : ''}</td>
              <td><span class="badge ${STATUS_BADGE[e.status] || ''}">${escapeHtml(STATUS_LABEL[e.status] || e.status || '')}</span></td>
              <td>${e.approval_required ? '⚠️ Ja' : '–'}</td>
              <td class="text-mute">${escapeHtml(e.ip_address || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${gefiltert.length > 500 ? `<p class="hint">Zeigt die neuesten 500 von ${gefiltert.length} Einträgen.</p>` : ''}
    `;
  }

  filterStatus.addEventListener('change', renderTable);
  filterSuche.addEventListener('input', renderTable);
  renderTable();
}
