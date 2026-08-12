import { getAll, put } from '../db.js';
import { escapeHtml, formatDateTime, toast } from '../utils.js';
import { getSession } from '../auth.js';
import { openModal } from '../ui.js';

// "KI-Freigaben" (Vorgabe Abschnitt 30): zeigt Aktionen, die die KI-Bürokraft
// versucht hat, die aber serverseitig gesperrt sind (Angebot/Rechnung
// versenden, löschen, ...). WICHTIG: Freigeben/Ablehnen hier führt die
// eigentliche Aktion NICHT automatisch aus - es markiert den Eintrag nur als
// bearbeitet, damit du siehst, was die KI wollte. Die Aktion selbst (z.B.
// Angebot versenden) machst du weiterhin ganz normal in der jeweiligen
// Werkora-Ansicht. Siehe cloudflare-worker-ki-buerokraft/README.md.
const STATUS_LABEL = { offen: 'Offen', freigegeben: 'Freigegeben', abgelehnt: 'Abgelehnt' };
const STATUS_BADGE = { offen: 'badge-warn', freigegeben: 'badge-success', abgelehnt: 'badge-danger' };

export async function render(container) {
  let eintraege = await getAll('ki_freigaben');
  eintraege.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>KI-Freigaben</h1>
    </div>
    <p class="hint">
      Aktionen, die die KI-Bürokraft versucht hat, die aber gesperrt sind (z.B. Angebot/Rechnung versenden, Löschen).
      <strong>Freigeben/Ablehnen führt die Aktion hier NICHT automatisch aus</strong> - es ist nur zur Kenntnisnahme. Die eigentliche Aktion machst du weiterhin selbst in der jeweiligen Werkora-Ansicht.
    </p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  async function bearbeiten(eintrag, neuerStatus) {
    const session = getSession();
    const updated = { ...eintrag, status: neuerStatus, bearbeitet_am: new Date().toISOString(), bearbeitet_von: session?.name || session?.role || '' };
    await put('ki_freigaben', updated);
    Object.assign(eintrag, updated);
    toast(neuerStatus === 'freigegeben' ? 'Als freigegeben markiert' : 'Als abgelehnt markiert', 'success');
    renderTable();
  }

  function kommentieren(eintrag) {
    const { body, close } = openModal({
      title: 'Kommentar hinterlegen',
      bodyHtml: `
        <form id="kommentar-form">
          <div class="field"><label>Kommentar</label><textarea name="kommentar" rows="4">${escapeHtml(eintrag.kommentar || '')}</textarea></div>
          <div class="modal-actions"><button type="submit" class="btn btn-primary">Speichern</button></div>
        </form>
      `,
    });
    body.querySelector('#kommentar-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const kommentar = new FormData(e.target).get('kommentar').toString().trim();
      const updated = { ...eintrag, kommentar };
      await put('ki_freigaben', updated);
      Object.assign(eintrag, updated);
      toast('Kommentar gespeichert', 'success');
      close();
      renderTable();
    });
  }

  function renderTable() {
    if (eintraege.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Noch keine Freigabe-Anfragen. Sobald die KI-Bürokraft-API eine gesperrte Aktion versucht, erscheint hier ein Eintrag.</div>';
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Zeitpunkt</th><th>Aktion</th><th>Nachricht</th><th>Status</th><th>Kommentar</th><th></th></tr></thead>
        <tbody>
          ${eintraege.map((e, i) => `
            <tr>
              <td>${formatDateTime(e.timestamp)}</td>
              <td><code>${escapeHtml(e.action || '')}</code></td>
              <td>${escapeHtml(e.message || '')}</td>
              <td><span class="badge ${STATUS_BADGE[e.status] || ''}">${escapeHtml(STATUS_LABEL[e.status] || e.status || '')}</span>${e.bearbeitet_von ? `<div class="text-mute">von ${escapeHtml(e.bearbeitet_von)}</div>` : ''}</td>
              <td>${escapeHtml(e.kommentar || '')}</td>
              <td class="actions-cell">
                ${e.status === 'offen' ? `
                  <button class="btn btn-sm btn-success" data-freigeben="${i}">Freigeben</button>
                  <button class="btn btn-sm" data-bearbeiten="${i}">Bearbeiten</button>
                  <button class="btn btn-sm btn-danger" data-ablehnen="${i}">Ablehnen</button>
                ` : `<button class="btn btn-sm" data-bearbeiten="${i}">Bearbeiten</button>`}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('[data-freigeben]').forEach((btn) => btn.addEventListener('click', () => bearbeiten(eintraege[Number(btn.dataset.freigeben)], 'freigegeben')));
    tableHost.querySelectorAll('[data-ablehnen]').forEach((btn) => btn.addEventListener('click', () => bearbeiten(eintraege[Number(btn.dataset.ablehnen)], 'abgelehnt')));
    tableHost.querySelectorAll('[data-bearbeiten]').forEach((btn) => btn.addEventListener('click', () => kommentieren(eintraege[Number(btn.dataset.bearbeiten)])));
  }

  renderTable();
}
