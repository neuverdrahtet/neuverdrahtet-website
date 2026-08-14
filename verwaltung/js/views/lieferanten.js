import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast, farbeAusText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';

// Lieferanten-/Großhändler-Stammdaten - getrennt vom reinen Freitext-Feld
// "Lieferant" bei Ausgaben. Enthält optionale IDS-Connect-Zugangsdaten
// (Abschnitt "Großhandelsanbindung"), die erst befüllt werden, sobald der
// jeweilige Großhändler echte Zugangsdaten herausgegeben hat - ohne die
// funktioniert nur die Stammdatenverwaltung, keine Live-Preisabfrage.
const FARBEN = ['#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c', '#6b7280'];

export async function render(container) {
  let liste = await getAll('lieferanten');
  liste.sort((a, b) => (a.firma || '').localeCompare(b.firma || ''));
  const bulk = createBulkSelect('lieferanten', { label: 'Lieferanten' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Lieferanten</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new">+ Neuer Lieferant</button>
      </div>
    </div>
    <p class="hint">Kontakt-/Stammdaten eurer Großhändler und Lieferanten. Der Abschnitt "Großhandelsanbindung" ist optional - erst ausfüllen, wenn ihr echte IDS-Connect-Zugangsdaten vom jeweiligen Großhändler bekommen habt.</p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (liste.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Noch keine Lieferanten angelegt.</div>';
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th></th><th>Firma</th><th>Ansprechpartner</th><th>Telefon</th><th>E-Mail</th><th>Ort</th><th>Großhandelsanbindung</th></tr></thead>
        <tbody>
          ${liste.map((l) => `
            <tr data-id="${l.id}">
              ${bulk.rowCell(l.id)}
              <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${l.farbe || FARBEN[0]}"></span></td>
              <td>${escapeHtml(l.firma)}</td>
              <td>${escapeHtml(l.ansprechpartner || '')}</td>
              <td>${escapeHtml(l.telefon || '')}</td>
              <td>${escapeHtml(l.email || '')}</td>
              <td>${escapeHtml(l.ort || '')}</td>
              <td>${l.idsConnectAktiv ? '<span class="badge badge-success">IDS-Connect aktiv</span>' : '<span class="text-mute">–</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(liste.find((l) => l.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        liste = liste.filter((l) => !ids.includes(l.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(item) {
    const isEdit = !!item;
    const neueId = uid();
    const data = item || {
      id: neueId, firma: '', ansprechpartner: '', telefon: '', email: '',
      strasse: '', plz: '', ort: '', kundennummer: '', zahlungszielTage: '', notizen: '',
      idsConnectAktiv: false, idsConnectEndpoint: '', idsConnectBenutzername: '', idsConnectPasswort: '',
      farbe: farbeAusText(neueId, FARBEN),
    };
    const { body, close } = openModal({
      title: isEdit ? 'Lieferant bearbeiten' : 'Neuer Lieferant',
      bodyHtml: `
        <form id="lf-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Firma *</label><input name="firma" required value="${escapeHtml(data.firma)}"></div>
            <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner" value="${escapeHtml(data.ansprechpartner || '')}"></div>
            <div class="field"><label>Kundennummer bei diesem Lieferanten</label><input name="kundennummer" value="${escapeHtml(data.kundennummer || '')}"></div>
            <div class="field"><label>Telefon</label><input type="tel" name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field col-span-2"><label>Straße/Hausnummer</label><input name="strasse" value="${escapeHtml(data.strasse || '')}"></div>
            <div class="field"><label>PLZ</label><input name="plz" value="${escapeHtml(data.plz || '')}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
            <div class="field"><label>Zahlungsziel (Tage)</label><input type="number" min="0" step="1" name="zahlungszielTage" value="${data.zahlungszielTage || ''}"></div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          <h3 style="margin:18px 0 4px">Großhandelsanbindung (optional)</h3>
          <p class="hint" style="margin-top:0">Erst ausfüllen, wenn ihr vom Großhändler echte IDS-Connect-Zugangsdaten bekommen habt - ohne die bleibt hier alles leer, das ist normal und kein Fehler.</p>
          <div class="form-grid">
            <div class="field-checkbox col-span-2"><label><input type="checkbox" name="idsConnectAktiv" ${data.idsConnectAktiv ? 'checked' : ''}> IDS-Connect für diesen Lieferanten aktiv</label></div>
            <div class="field col-span-2"><label>Endpunkt-URL (vom Großhändler)</label><input name="idsConnectEndpoint" value="${escapeHtml(data.idsConnectEndpoint || '')}" placeholder="https://..."></div>
            <div class="field"><label>Benutzername</label><input name="idsConnectBenutzername" value="${escapeHtml(data.idsConnectBenutzername || '')}"></div>
            <div class="field"><label>Passwort</label><input type="password" name="idsConnectPasswort" value="${escapeHtml(data.idsConnectPasswort || '')}"></div>
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
        if (!confirmDelete(`Lieferant "${data.firma}" in den Papierkorb verschieben?`)) return;
        await remove('lieferanten', data.id);
        toast('In den Papierkorb verschoben');
        close();
        render(container);
      });
    }
    body.querySelector('#lf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const key of ['firma', 'ansprechpartner', 'telefon', 'email', 'strasse', 'plz', 'ort', 'kundennummer', 'notizen', 'idsConnectEndpoint', 'idsConnectBenutzername', 'idsConnectPasswort']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      updated.zahlungszielTage = fd.get('zahlungszielTage') ? Number(fd.get('zahlungszielTage')) : '';
      updated.idsConnectAktiv = fd.get('idsConnectAktiv') === 'on';
      if (!updated.firma) return;
      await put('lieferanten', updated);
      toast(isEdit ? 'Lieferant aktualisiert' : 'Lieferant angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
