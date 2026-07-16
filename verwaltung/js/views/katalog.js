import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast, excelFileToCsvText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

const TYP_LABEL = { artikel: 'Material', leistung: 'Leistung', geraet: 'Gerät', paket: 'Paket' };
const TYP_BADGE = { artikel: 'badge-accent', leistung: 'badge-success', geraet: 'badge-warn', paket: 'badge-purple' };

function parseNumber(str) {
  const n = Number(String(str ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseKatalogCsv(text, standardSteuersatz) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^typ$/i.test(cols[0] || '') || /^bezeichnung$/i.test(cols[1] || '')) continue;
    const [typRaw, bezeichnung, einheit, preisRaw, ustRaw, beschreibungRaw] = cols;
    if (!bezeichnung) { errors.push(line); continue; }
    const typRawTrim = (typRaw || '').trim();
    const typ = /^leistung$/i.test(typRawTrim) ? 'leistung' : /^ger[äa]t/i.test(typRawTrim) ? 'geraet' : 'artikel';
    rows.push({
      id: uid(),
      typ,
      bezeichnung,
      beschreibung: beschreibungRaw || '',
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
        <option value="artikel">Material</option>
        <option value="leistung">Leistung</option>
        <option value="geraet">Gerät</option>
        <option value="paket">Paket</option>
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
        <thead><tr><th>Typ</th><th>Bezeichnung</th><th>Einheit</th><th class="text-right">EK</th><th class="text-right">Zuschlag</th><th class="text-right">VK (netto)</th><th>USt.</th></tr></thead>
        <tbody>
          ${filtered.map((i) => `
            <tr data-id="${i.id}">
              <td><span class="badge ${TYP_BADGE[i.typ] || 'badge-accent'}">${TYP_LABEL[i.typ] || 'Material'}</span></td>
              <td>${escapeHtml(i.bezeichnung)}</td>
              <td>${escapeHtml(i.einheit || '')}</td>
              <td class="text-right">${i.einkaufspreis ? formatCurrency(i.einkaufspreis) : '–'}</td>
              <td class="text-right">${i.einkaufspreis ? `${i.aufschlagProzent || 0}%` : '–'}</td>
              <td class="text-right">${formatCurrency(i.preis)}</td>
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
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>Typ;Bezeichnung;Einheit;Preis;USt;Beschreibung</code> (Beschreibung optional) – Typ ist "Material", "Leistung" oder "Gerät". Eine optionale Kopfzeile wird erkannt.</p>
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
    const data = item || {
      id: uid(), typ: 'leistung', bezeichnung: '', beschreibung: '', einheit: 'Std.',
      einkaufspreis: 0, aufschlagProzent: settings.standardAufschlagProzent ?? 20, preis: 0, steuersatz: settings.standardSteuersatz, komponenten: [],
    };
    const komponentenAuswahl = items.filter((i) => i.typ !== 'paket' && i.id !== data.id);
    let kompState = (data.komponenten || []).map((k) => ({ ...k }));
    const { body, close } = openModal({
      title: isEdit ? 'Eintrag bearbeiten' : 'Neuer Artikel / Leistung',
      wide: true,
      bodyHtml: `
        <form id="kat-form">
          <div class="form-grid">
            <div class="field"><label>Typ</label>
              <select name="typ" id="f-typ">
                <option value="leistung" ${data.typ === 'leistung' ? 'selected' : ''}>Leistung</option>
                <option value="artikel" ${data.typ === 'artikel' ? 'selected' : ''}>Material</option>
                <option value="geraet" ${data.typ === 'geraet' ? 'selected' : ''}>Gerät</option>
                <option value="paket" ${data.typ === 'paket' ? 'selected' : ''}>Paket (Leistung + Material + Gerät kombiniert)</option>
              </select>
            </div>
            <div class="field"><label>Einheit</label><input name="einheit" placeholder="Std., Stk., pauschal ..." value="${escapeHtml(data.einheit || '')}"></div>
            <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
          </div>

          <div id="komp-section" ${data.typ === 'paket' ? '' : 'hidden'}>
            <div class="divider"></div>
            <h2 style="font-size:14px;margin:0 0 8px">Komponenten des Pakets</h2>
            <p class="hint">Kombiniere bestehende Leistungen, Material und Geräte zu einem Gesamtpaket – der Einkaufspreis unten wird automatisch aus den Komponenten berechnet.</p>
            <div id="komp-list" style="margin-bottom:10px"></div>
            <div class="flex-row flex-wrap">
              <select id="komp-add-select">
                <option value="">Komponente wählen ...</option>
                ${komponentenAuswahl.map((k) => `<option value="${k.id}">${escapeHtml(TYP_LABEL[k.typ] || '')}: ${escapeHtml(k.bezeichnung)} (${formatCurrency(k.preis)})</option>`).join('')}
              </select>
              <button type="button" class="btn btn-sm" id="btn-komp-add">+ hinzufügen</button>
            </div>
          </div>

          <div class="divider"></div>
          <div class="form-grid">
            <div class="field"><label>Einkaufspreis EK (€, optional)</label><input type="number" step="0.01" min="0" name="einkaufspreis" id="f-ek" value="${data.einkaufspreis || ''}"></div>
            <div class="field"><label>Zuschlag (%)</label><input type="number" step="1" min="0" name="aufschlagProzent" id="f-zuschlag" value="${data.aufschlagProzent ?? 20}"></div>
            <div class="field"><label>Verkaufspreis VK netto (€) *</label><input type="number" step="0.01" min="0" name="preis" id="f-vk" required value="${data.preis}"></div>
            <div class="field"><label>USt.-Satz (%)</label>
              <select name="steuersatz">
                <option value="19" ${Number(data.steuersatz) === 19 ? 'selected' : ''}>19%</option>
                <option value="7" ${Number(data.steuersatz) === 7 ? 'selected' : ''}>7%</option>
                <option value="0" ${Number(data.steuersatz) === 0 ? 'selected' : ''}>0%</option>
              </select>
            </div>
          </div>
          <p class="hint">EK + Zuschlag berechnen den VK automatisch (VK = EK × (1 + Zuschlag/100)). Der VK bleibt trotzdem direkt editierbar.</p>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    function recalcVk() {
      const ek = Number(body.querySelector('#f-ek').value) || 0;
      const zuschlag = Number(body.querySelector('#f-zuschlag').value) || 0;
      if (ek > 0) {
        body.querySelector('#f-vk').value = (Math.round(ek * (1 + zuschlag / 100) * 100) / 100).toFixed(2);
      }
    }
    function renderKomp() {
      const host = body.querySelector('#komp-list');
      host.innerHTML = kompState.map((k, i) => {
        const komp = items.find((it) => it.id === k.katalogId);
        const zeilensumme = (komp?.preis || 0) * (Number(k.menge) || 0);
        return `
          <div class="flex-row" data-i="${i}" style="align-items:center;margin-bottom:6px">
            <span style="flex:1">${escapeHtml(komp?.bezeichnung || '(gelöscht)')}</span>
            <input type="number" step="0.01" min="0" class="komp-menge" value="${k.menge ?? 1}" style="width:80px">
            <span style="width:90px;text-align:right">${formatCurrency(zeilensumme)}</span>
            <button type="button" class="btn btn-sm btn-ghost komp-del" title="Entfernen">✕</button>
          </div>
        `;
      }).join('') || '<p class="text-mute">Noch keine Komponenten hinzugefügt.</p>';
      host.querySelectorAll('[data-i]').forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector('.komp-menge').addEventListener('input', (e) => {
          kompState[i].menge = Number(e.target.value);
          const komp = items.find((it) => it.id === kompState[i].katalogId);
          row.querySelector('span:last-of-type').textContent = formatCurrency((komp?.preis || 0) * (Number(kompState[i].menge) || 0));
          updateEkFromKomp();
        });
        row.querySelector('.komp-del').addEventListener('click', () => {
          kompState.splice(i, 1);
          renderKomp();
          updateEkFromKomp();
        });
      });
    }
    function updateEkFromKomp() {
      const sum = kompState.reduce((s, k) => {
        const komp = items.find((it) => it.id === k.katalogId);
        return s + (komp?.preis || 0) * (Number(k.menge) || 0);
      }, 0);
      body.querySelector('#f-ek').value = sum.toFixed(2);
      recalcVk();
    }
    if (data.typ === 'paket') updateEkFromKomp();
    renderKomp();
    body.querySelector('#f-typ').addEventListener('change', (e) => {
      const isPaket = e.target.value === 'paket';
      body.querySelector('#komp-section').hidden = !isPaket;
      if (isPaket) updateEkFromKomp();
    });
    body.querySelector('#btn-komp-add').addEventListener('click', () => {
      const select = body.querySelector('#komp-add-select');
      if (!select.value) return;
      kompState.push({ katalogId: select.value, menge: 1 });
      select.value = '';
      renderKomp();
      updateEkFromKomp();
    });
    body.querySelector('#f-ek').addEventListener('input', recalcVk);
    body.querySelector('#f-zuschlag').addEventListener('input', recalcVk);
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
      updated.einkaufspreis = Number(updated.einkaufspreis) || 0;
      updated.aufschlagProzent = Number(updated.aufschlagProzent) || 0;
      updated.steuersatz = Number(updated.steuersatz) || 0;
      if (updated.typ === 'paket') {
        updated.komponenten = kompState;
        updated.einkaufspreis = kompState.reduce((s, k) => {
          const komp = items.find((it) => it.id === k.katalogId);
          return s + (komp?.preis || 0) * (Number(k.menge) || 0);
        }, 0);
      } else {
        updated.komponenten = [];
      }
      if (!updated.bezeichnung) return;
      await put('katalog', updated);
      toast(isEdit ? 'Eintrag aktualisiert' : 'Eintrag angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
