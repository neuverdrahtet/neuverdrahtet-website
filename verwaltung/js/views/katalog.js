import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

function parseNumber(str) {
  const n = Number(String(str ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function cellToText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'number') return String(cell).replace('.', ',');
  return String(cell).trim();
}

async function excelFileToCsvText(file) {
  if (!window.XLSX) throw new Error('Excel-Bibliothek konnte nicht geladen werden.');
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  return rows.map((row) => row.map(cellToText).join(';')).join('\n');
}

function parseKatalogCsv(text, standardSteuersatz) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^typ$/i.test(cols[0] || '') || /^bezeichnung$/i.test(cols[1] || '')) continue;
    const [typRaw, bezeichnung, einheit, preisRaw, ustRaw] = cols;
    if (!bezeichnung) { errors.push(line); continue; }
    const typ = /^leistung$/i.test((typRaw || '').trim()) ? 'leistung' : 'artikel';
    rows.push({
      id: uid(),
      typ,
      bezeichnung,
      beschreibung: '',
      einheit: einheit || (typ === 'artikel' ? 'Stk.' : 'Std.'),
      preis: parseNumber(preisRaw),
      steuersatz: ustRaw ? parseNumber(ustRaw) : standardSteuersatz,
    });
  }
  return { rows, errors };
}

export async function render(container) {
  let items = await getAll('katalog');
  const settings = await getSettings();
  items.sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  let filtered = items;
  let typeFilter = '';

  container.innerHTML = `
    <div class="view-header">
      <h1>Artikel &amp; Leistungen</h1>
      <div class="actions">
        <button class="btn" id="btn-import">⇪ Material/Leistungen importieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Eintrag</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche ...">
      <select id="type-filter">
        <option value="">Alle Typen</option>
        <option value="artikel">Artikel</option>
        <option value="leistung">Leistung</option>
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    filtered = items.filter((i) => {
      if (typeFilter && i.typ !== typeFilter) return false;
      if (!q) return true;
      return [i.bezeichnung, i.beschreibung].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Artikel/Leistungen angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Typ</th><th>Bezeichnung</th><th>Einheit</th><th>Preis (netto)</th><th>USt.</th></tr></thead>
        <tbody>
          ${filtered.map((i) => `
            <tr data-id="${i.id}">
              <td><span class="badge ${i.typ === 'artikel' ? 'badge-accent' : 'badge-success'}">${i.typ === 'artikel' ? 'Artikel' : 'Leistung'}</span></td>
              <td>${escapeHtml(i.bezeichnung)}</td>
              <td>${escapeHtml(i.einheit || '')}</td>
              <td>${formatCurrency(i.preis)}</td>
              <td>${i.steuersatz}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(items.find((i) => i.id === row.dataset.id)));
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    applyFilter();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-import').addEventListener('click', () => openImport());

  function openImport() {
    const { body, close } = openModal({
      title: 'Material / Leistungen importieren',
      wide: true,
      bodyHtml: `
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>Typ;Bezeichnung;Einheit;Preis;USt</code> – Typ ist "Material"/"Artikel" oder "Leistung". Eine optionale Kopfzeile wird erkannt.</p>
        <div class="field" style="margin-bottom:10px">
          <label>CSV- oder Excel-Datei</label>
          <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </div>
        <div class="field">
          <label>oder CSV-Text einfügen</label>
          <textarea id="import-text" style="min-height:160px;font-family:monospace" placeholder="Material;Kabel NYM-J 3x1,5mm²;m;1,20;19
Leistung;Steckdose montieren;Std.;65;19"></textarea>
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
      const { rows, errors } = parseKatalogCsv(text, settings.standardSteuersatz);
      if (rows.length === 0) {
        body.querySelector('#import-preview').textContent = 'Keine gültigen Zeilen gefunden.';
        return;
      }
      for (const row of rows) await put('katalog', row);
      toast(`${rows.length} Einträge importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen` : ''}`, 'success');
      close();
      render(container);
    });
  }

  function openForm(item) {
    const isEdit = !!item;
    const data = item || { id: uid(), typ: 'leistung', bezeichnung: '', beschreibung: '', einheit: 'Std.', preis: 0, steuersatz: settings.standardSteuersatz };
    const { body, close } = openModal({
      title: isEdit ? 'Eintrag bearbeiten' : 'Neuer Artikel / Leistung',
      bodyHtml: `
        <form id="kat-form">
          <div class="form-grid">
            <div class="field"><label>Typ</label>
              <select name="typ">
                <option value="leistung" ${data.typ === 'leistung' ? 'selected' : ''}>Leistung</option>
                <option value="artikel" ${data.typ === 'artikel' ? 'selected' : ''}>Artikel</option>
              </select>
            </div>
            <div class="field"><label>Einheit</label><input name="einheit" placeholder="Std., Stk., pauschal ..." value="${escapeHtml(data.einheit || '')}"></div>
            <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
            <div class="field"><label>Preis netto (€)</label><input type="number" step="0.01" min="0" name="preis" value="${data.preis}"></div>
            <div class="field"><label>USt.-Satz (%)</label>
              <select name="steuersatz">
                <option value="19" ${Number(data.steuersatz) === 19 ? 'selected' : ''}>19%</option>
                <option value="7" ${Number(data.steuersatz) === 7 ? 'selected' : ''}>7%</option>
                <option value="0" ${Number(data.steuersatz) === 0 ? 'selected' : ''}>0%</option>
              </select>
            </div>
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
        if (!confirmDelete(`"${data.bezeichnung}" wirklich löschen?`)) return;
        await remove('katalog', data.id);
        toast('Eintrag gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#kat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      updated.preis = Number(updated.preis) || 0;
      updated.steuersatz = Number(updated.steuersatz) || 0;
      if (!updated.bezeichnung) return;
      await put('katalog', updated);
      toast(isEdit ? 'Eintrag aktualisiert' : 'Eintrag angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
