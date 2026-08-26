import { getAll, put, remove, GEWERKE } from '../db.js';
import { uid, escapeHtml, toast, farbeAusText, excelFileToCsvText, toCsv, downloadTextFile } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';

// Externe Nachunternehmer/Subunternehmer - bewusst getrennt von mitarbeiter.js
// (keine eigene Personalakte/kein Login, sondern nur die Kontakt-/Leistungs-
// daten, die gebraucht werden, um sie einem Projekt zuzuordnen).
const FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

function gewerkTitel(id) {
  return GEWERKE.find((g) => g.id === id)?.titel || '';
}

function gewerkIdVonTitel(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return '';
  return GEWERKE.find((g) => g.id === t || g.titel.toLowerCase() === t)?.id || '';
}

function parseSubunternehmerCsv(text) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^firma$/i.test(cols[0] || '')) continue;
    const [firma, ansprechpartner, telefon, email, gewerk, stundensatz, notizen] = cols;
    if (!firma) { errors.push(line); continue; }
    const neueId = uid();
    rows.push({
      id: neueId, firma, ansprechpartner: ansprechpartner || '', telefon: telefon || '', email: email || '',
      gewerk: gewerkIdVonTitel(gewerk), stundensatz: stundensatz ? Number(String(stundensatz).replace(',', '.')) || '' : '',
      notizen: notizen || '', farbe: farbeAusText(neueId, FARBEN),
    });
  }
  return { rows, errors };
}

export async function render(container) {
  let liste = await getAll('subunternehmer');
  liste.sort((a, b) => (a.firma || '').localeCompare(b.firma || ''));
  const bulk = createBulkSelect('subunternehmer', { label: 'Subunternehmer' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Subunternehmer</h1>
      <div class="actions">
        <button class="btn" id="btn-export">⇩ Export (CSV)</button>
        <button class="btn" id="btn-import">⇪ Importieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Subunternehmer</button>
      </div>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (liste.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Noch keine Subunternehmer angelegt.</div>';
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th></th><th>Firma</th><th>Ansprechpartner</th><th>Telefon</th><th>E-Mail</th><th>Gewerk</th></tr></thead>
        <tbody>
          ${liste.map((s) => `
            <tr data-id="${s.id}">
              ${bulk.rowCell(s.id)}
              <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${s.farbe || FARBEN[0]}"></span></td>
              <td>${escapeHtml(s.firma)}</td>
              <td>${escapeHtml(s.ansprechpartner || '')}</td>
              <td>${escapeHtml(s.telefon || '')}</td>
              <td>${escapeHtml(s.email || '')}</td>
              <td>${s.gewerk ? escapeHtml(gewerkTitel(s.gewerk)) : '<span class="text-mute">–</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(liste.find((s) => s.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        liste = liste.filter((s) => !ids.includes(s.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export').addEventListener('click', () => {
    const header = ['Firma', 'Ansprechpartner', 'Telefon', 'E-Mail', 'Gewerk', 'Stundensatz', 'Notizen'];
    const rows = [header, ...liste.map((s) => [s.firma || '', s.ansprechpartner || '', s.telefon || '', s.email || '', gewerkTitel(s.gewerk), s.stundensatz ?? '', s.notizen || ''])];
    downloadTextFile(`neuverdrahtet-subunternehmer-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast('Export erstellt', 'success');
  });
  container.querySelector('#btn-import').addEventListener('click', () => openImport());

  function openImport() {
    const { body, close } = openModal({
      title: 'Subunternehmer importieren',
      wide: true,
      bodyHtml: `
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>Firma;Ansprechpartner;Telefon;E-Mail;Gewerk;Stundensatz;Notizen</code> – nur Firma ist Pflicht, Gewerk optional (z.B. "elektro" oder Klartext wie "Elektro"). Eine optionale Kopfzeile wird erkannt.</p>
        <div class="field" style="margin-bottom:10px">
          <label>CSV- oder Excel-Datei</label>
          <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </div>
        <div class="field">
          <label>oder CSV-Text einfügen</label>
          <textarea id="import-text" style="min-height:160px;font-family:monospace" placeholder="Trockenbau Schulz;Herr Schulz;0201987654;schulz@example.de;trockenbau;45;"></textarea>
        </div>
        <div id="import-preview" class="text-mute" style="margin-top:8px"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="btn-do-import">Importieren</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const isExcel = /\.xlsx?$/i.test(file.name);
      try {
        body.querySelector('#import-text').value = isExcel ? await excelFileToCsvText(file) : await file.text();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
    body.querySelector('#btn-do-import').addEventListener('click', async () => {
      const text = body.querySelector('#import-text').value;
      const { rows, errors } = parseSubunternehmerCsv(text);
      if (rows.length === 0) {
        body.querySelector('#import-preview').textContent = 'Keine gültigen Zeilen gefunden.';
        return;
      }
      for (const row of rows) await put('subunternehmer', row);
      toast(`${rows.length} Subunternehmer importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen` : ''}`, 'success');
      close();
      render(container);
    });
  }

  function openForm(item) {
    const isEdit = !!item;
    const neueId = uid();
    const data = item || {
      id: neueId, firma: '', ansprechpartner: '', telefon: '', email: '',
      gewerk: '', stundensatz: '', notizen: '', farbe: farbeAusText(neueId, FARBEN),
    };
    const { body, close } = openModal({
      title: isEdit ? 'Subunternehmer bearbeiten' : 'Neuer Subunternehmer',
      bodyHtml: `
        <form id="su-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Firma *</label><input name="firma" required value="${escapeHtml(data.firma)}"></div>
            <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner" value="${escapeHtml(data.ansprechpartner || '')}"></div>
            <div class="field"><label>Gewerk</label>
              <select name="gewerk"><option value="">– kein Gewerk –</option>${GEWERKE.map((g) => `<option value="${g.id}" ${g.id === data.gewerk ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Telefon</label><input type="tel" name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field"><label>Stundensatz (€, optional)</label><input type="number" step="0.01" min="0" name="stundensatz" value="${data.stundensatz || ''}"></div>
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
        if (!confirmDelete(`Subunternehmer "${data.firma}" in den Papierkorb verschieben?`)) return;
        await remove('subunternehmer', data.id);
        toast('In den Papierkorb verschoben');
        close();
        render(container);
      });
    }
    body.querySelector('#su-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const key of ['firma', 'ansprechpartner', 'telefon', 'email', 'gewerk', 'notizen']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      updated.stundensatz = fd.get('stundensatz') ? Number(fd.get('stundensatz')) : '';
      if (!updated.firma) return;
      await put('subunternehmer', updated);
      toast(isEdit ? 'Subunternehmer aktualisiert' : 'Subunternehmer angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
