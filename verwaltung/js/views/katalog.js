import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatDate, toast, excelFileToCsvText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';
import * as lexoffice from '../lexoffice.js';

const TYP_LABEL = { artikel: 'Material', leistung: 'Leistung', geraet: 'Gerät' };
const TYP_BADGE = { artikel: 'badge-accent', leistung: 'badge-success', geraet: 'badge-warn' };
const EINHEITEN_PRESETS = ['Std.', 'Stk.', 'm', 'm²', 'm³', 'lfm', 'kg', 't', 'ltr', 'Psch.', 'Tag', 'Satz', 'Rolle', 'Paket'];

function parseKatalogCsv(text) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^typ$/i.test(cols[0] || '') || /^bezeichnung$/i.test(cols[1] || '')) continue;
    const [typRaw, bezeichnung, einheit, beschreibungRaw] = cols;
    if (!bezeichnung) { errors.push(line); continue; }
    const typRawTrim = (typRaw || '').trim();
    const typ = /^leistung$/i.test(typRawTrim) ? 'leistung' : /^ger[äa]t/i.test(typRawTrim) ? 'geraet' : 'artikel';
    rows.push({
      id: uid(),
      typ,
      bezeichnung,
      beschreibung: beschreibungRaw || '',
      einheit: einheit || (typ === 'artikel' ? 'Stk.' : 'Std.'),
    });
  }
  return { rows, errors };
}

export async function render(container) {
  let items = await getAll('katalog');
  let lagerbewegungen = await getAll('lagerbewegungen');
  items.sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  let filtered = items;
  let typeFilter = '';
  const bulk = createBulkSelect('katalog', { label: 'Einträge' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Artikel &amp; Leistungen</h1>
      <div class="actions">
        <button class="btn" id="btn-import">⇪ Material/Leistungen importieren</button>
        <button class="btn" id="btn-lexoffice-sync">🔗 Aus lexoffice abgleichen</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Eintrag</button>
      </div>
    </div>
    <p class="hint">Preise werden hier bewusst nicht geführt – die Preisführung läuft komplett über lexoffice (siehe „Aus lexoffice abgleichen“).</p>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche ...">
      <select id="type-filter">
        <option value="">Alle Typen</option>
        <option value="artikel">Material</option>
        <option value="leistung">Leistung</option>
        <option value="geraet">Gerät</option>
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
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Typ</th><th>Bezeichnung</th><th>Einheit</th><th>Bestand</th></tr></thead>
        <tbody>
          ${filtered.map((i) => {
            const tracked = i.typ === 'artikel' && i.bestandTracking;
            const niedrig = tracked && Number(i.bestand ?? 0) <= Number(i.mindestbestand ?? 0);
            return `
            <tr data-id="${i.id}">
              ${bulk.rowCell(i.id)}
              <td><span class="badge ${TYP_BADGE[i.typ] || 'badge-accent'}">${TYP_LABEL[i.typ] || 'Material'}</span></td>
              <td>${escapeHtml(i.bezeichnung)}${i.lexofficeArtikelId ? ' <span title="Verknüpft mit lexoffice">🔗</span>' : ''}</td>
              <td>${escapeHtml(i.einheit || '')}</td>
              <td>
                ${tracked ? `
                  <span class="flex-row" style="align-items:center;gap:6px" onclick="event.stopPropagation()">
                    <span class="badge ${niedrig ? 'badge-danger' : 'badge'}" title="Mindestbestand: ${Number(i.mindestbestand ?? 0)} ${escapeHtml(i.einheit || '')}">${Number(i.bestand ?? 0)} ${escapeHtml(i.einheit || '')}</span>
                    <button type="button" class="btn btn-sm btn-ghost lager-btn" data-id="${i.id}" data-richtung="aus" title="Verbrauch/Entnahme erfassen">−</button>
                    <button type="button" class="btn btn-sm btn-ghost lager-btn" data-id="${i.id}" data-richtung="ein" title="Wareneingang erfassen">+</button>
                  </span>
                ` : '<span class="text-mute">–</span>'}
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(items.find((i) => i.id === row.dataset.id)));
    });
    tableHost.querySelectorAll('.lager-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLagerbewegungForm(items.find((i) => i.id === btn.dataset.id), btn.dataset.richtung);
      });
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        items = items.filter((i) => !ids.includes(i.id));
        filtered = filtered.filter((i) => !ids.includes(i.id));
        renderTable();
      },
    });
  }

  function openLagerbewegungForm(item, richtung) {
    if (!item) return;
    const isEin = richtung === 'ein';
    const { body, close } = openModal({
      title: `${isEin ? 'Wareneingang' : 'Verbrauch/Entnahme'}: ${item.bezeichnung}`,
      bodyHtml: `
        <form id="lager-form">
          <p class="hint">Aktueller Bestand: <strong>${Number(item.bestand ?? 0)} ${escapeHtml(item.einheit || '')}</strong></p>
          <div class="field"><label>Menge (${escapeHtml(item.einheit || 'Stk.')}) *</label><input type="number" step="0.01" min="0.01" name="menge" required autofocus></div>
          <div class="field"><label>Grund / Notiz (optional)</label><input name="grund" placeholder="${isEin ? 'z.B. Bestellung Sonepar' : 'z.B. Baustelle Müller'}"></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">${isEin ? 'Eingang buchen' : 'Entnahme buchen'}</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#lager-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const menge = Number(fd.get('menge')) || 0;
      if (menge <= 0) return;
      const delta = isEin ? menge : -menge;
      item.bestand = Math.max(0, Number(item.bestand ?? 0) + delta);
      await put('katalog', item);
      await put('lagerbewegungen', {
        id: uid(), katalogId: item.id, delta, grund: (fd.get('grund') || '').toString().trim(),
        datum: new Date().toISOString(),
      });
      toast(`${isEin ? 'Wareneingang' : 'Entnahme'} gebucht`, 'success');
      close();
      render(container);
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    applyFilter();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-import').addEventListener('click', () => openImport());
  container.querySelector('#btn-lexoffice-sync').addEventListener('click', () => openLexofficeSync());

  function openLexofficeSync() {
    const { body, close } = openModal({
      title: 'Aus lexoffice abgleichen',
      wide: true,
      bodyHtml: `
        <p class="hint">Lädt deinen Artikelstamm aus lexoffice. Der Preis wird nur zur Auswahl angezeigt und NICHT lokal gespeichert – die Preisführung bleibt komplett in lexoffice.</p>
        <div id="lo-sync-host"><p class="text-mute">Lade Artikel ...</p></div>
        <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" id="btn-cancel">Schließen</button></div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    const host = body.querySelector('#lo-sync-host');

    lexoffice.fetchArtikel().then((artikel) => {
      const bekannteIds = new Set(items.map((i) => i.lexofficeArtikelId).filter(Boolean));
      if (artikel.length === 0) {
        host.innerHTML = '<p class="text-mute">Keine Artikel in lexoffice gefunden.</p>';
        return;
      }
      host.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Bezeichnung</th><th>Einheit</th><th class="text-right">Preis (nur Anzeige)</th><th></th></tr></thead>
          <tbody>
            ${artikel.map((a) => {
              const bereitsVerknuepft = bekannteIds.has(a.id);
              const preis = a.price?.netPrice ?? a.price?.grossPrice;
              return `
                <tr>
                  <td>${escapeHtml(a.title || a.name || '(ohne Namen)')}</td>
                  <td>${escapeHtml(a.unitName || '')}</td>
                  <td class="text-right">${preis != null ? `${Number(preis).toFixed(2)} €` : '–'}</td>
                  <td>${bereitsVerknuepft ? '<span class="badge badge-success">Verknüpft</span>' : `<button type="button" class="btn btn-sm lo-import" data-id="${escapeHtml(a.id)}">Importieren</button>`}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      host.querySelectorAll('.lo-import').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const a = artikel.find((x) => x.id === btn.dataset.id);
          if (!a) return;
          const typ = /service|leistung/i.test(a.type || '') ? 'leistung' : 'artikel';
          const neu = {
            id: uid(), typ, bezeichnung: a.title || a.name || '(ohne Namen)', beschreibung: '',
            einheit: a.unitName || (typ === 'artikel' ? 'Stk.' : 'Std.'),
            lexofficeArtikelId: a.id,
          };
          await put('katalog', neu);
          items.push(neu);
          toast(`"${neu.bezeichnung}" importiert`, 'success');
          btn.closest('tr').querySelector('td:last-child').innerHTML = '<span class="badge badge-success">Verknüpft</span>';
          applyFilter();
        });
      });
    }).catch((err) => {
      host.innerHTML = `<p class="text-mute">Fehler: ${escapeHtml(err.message)}</p>`;
    });
  }

  function openImport() {
    const { body, close } = openModal({
      title: 'Material / Leistungen importieren',
      wide: true,
      bodyHtml: `
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>Typ;Bezeichnung;Einheit;Beschreibung</code> (Beschreibung optional) – Typ ist "Material", "Leistung" oder "Gerät". Eine optionale Kopfzeile wird erkannt.</p>
        <div class="field" style="margin-bottom:10px">
          <label>CSV- oder Excel-Datei</label>
          <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </div>
        <div class="field">
          <label>oder CSV-Text einfügen</label>
          <textarea id="import-text" style="min-height:160px;font-family:monospace" placeholder="Material;Kabel NYM-J 3x1,5mm²;m
Leistung;Steckdose montieren;Std."></textarea>
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
      const { rows, errors } = parseKatalogCsv(text);
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
      bestandTracking: false, bestand: 0, mindestbestand: 0,
    };
    const bewegungen = isEdit
      ? lagerbewegungen.filter((b) => b.katalogId === data.id).sort((a, b) => (b.datum || '').localeCompare(a.datum || '')).slice(0, 8)
      : [];
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
              </select>
            </div>
            <div class="field"><label>Einheit</label>
              <input name="einheit" list="einheiten-presets" placeholder="auswählen oder frei eingeben" value="${escapeHtml(data.einheit || '')}">
              <datalist id="einheiten-presets">${EINHEITEN_PRESETS.map((e) => `<option value="${e}"></option>`).join('')}</datalist>
            </div>
            <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
          </div>

          <div id="bestand-section" ${data.typ === 'artikel' ? '' : 'hidden'}>
            <div class="divider"></div>
            <h2 style="font-size:14px;margin:0 0 8px">Lagerbestand</h2>
            <div class="field-checkbox">
              <label><input type="checkbox" name="bestandTracking" id="f-bestand-tracking" ${data.bestandTracking ? 'checked' : ''}> Lagerbestand für diesen Artikel verfolgen</label>
            </div>
            <div id="bestand-felder" class="form-grid" ${data.bestandTracking ? '' : 'hidden'} style="margin-top:8px">
              <div class="field"><label>Aktueller Bestand</label><input type="number" step="0.01" min="0" name="bestand" value="${data.bestand ?? 0}"></div>
              <div class="field"><label>Mindestbestand (Warnschwelle)</label><input type="number" step="0.01" min="0" name="mindestbestand" value="${data.mindestbestand ?? 0}"></div>
            </div>
            ${isEdit && data.bestandTracking ? `
              <p class="hint" style="margin-top:6px">Bestand direkt hier ändern zählt nicht als protokollierte Bewegung – für eine nachvollziehbare Historie lieber über die +/− Buttons in der Tabelle buchen.</p>
              ${bewegungen.length ? `
                <div style="margin-top:8px">
                  <p class="text-mute" style="font-size:12.5px;margin:0 0 4px">Letzte Bewegungen:</p>
                  <ul class="cal-event-list">
                    ${bewegungen.map((b) => `<li>${formatDate(b.datum)}: ${b.delta > 0 ? '+' : ''}${b.delta} ${escapeHtml(data.einheit || '')}${b.grund ? ` – ${escapeHtml(b.grund)}` : ''}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            ` : ''}
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
    body.querySelector('#f-typ').addEventListener('change', (e) => {
      body.querySelector('#bestand-section').hidden = e.target.value !== 'artikel';
    });
    body.querySelector('#f-bestand-tracking').addEventListener('change', (e) => {
      body.querySelector('#bestand-felder').hidden = !e.target.checked;
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
      updated.bestandTracking = updated.typ === 'artikel' && body.querySelector('#f-bestand-tracking').checked;
      updated.bestand = updated.bestandTracking ? (Number(updated.bestand) || 0) : (data.bestand || 0);
      updated.mindestbestand = updated.bestandTracking ? (Number(updated.mindestbestand) || 0) : (data.mindestbestand || 0);
      if (!updated.bezeichnung) return;
      await put('katalog', updated);
      toast(isEdit ? 'Eintrag aktualisiert' : 'Eintrag angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
