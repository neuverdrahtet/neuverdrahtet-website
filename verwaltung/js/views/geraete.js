import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatDate, toast } from '../utils.js';
import { openModal, confirmDelete, optionList } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';

const FARBEN = ['#14b8a6', '#4d8bf0', '#a463f2', '#f0a020', '#ef4444', '#16a085', '#d35400', '#2c3e50'];

export const STATUS = [
  { id: 'verfuegbar', titel: 'Verfügbar', badge: 'badge-success' },
  { id: 'im-einsatz', titel: 'Im Einsatz', badge: 'badge-accent' },
  { id: 'wartung', titel: 'Wartung/Werkstatt', badge: 'badge-warn' },
  { id: 'defekt', titel: 'Defekt/Außer Betrieb', badge: 'badge-danger' },
];

function statusInfo(id) {
  return STATUS.find((s) => s.id === id) || STATUS[0];
}

function qrPayload(typ, id) {
  return `NVQR:${typ}:${id}`;
}

export async function render(container) {
  let [geraete, flotten, mitarbeiter] = await Promise.all([getAll('geraete'), getAll('flotten'), getAll('mitarbeiter')]);
  geraete.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  flotten.sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  let tab = 'geraete';
  const bulkGeraete = createBulkSelect('geraete', { label: 'Geräte' });
  const bulkFlotten = createBulkSelect('flotten', { label: 'Fahrzeuge' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Geräte &amp; Flotten</h1>
      <div class="actions">
        <button class="btn" id="btn-scan">📷 Scannen</button>
        <button class="btn btn-primary" id="btn-new">+ Neu</button>
      </div>
    </div>
    <div class="tabs" id="ge-tabs">
      <button type="button" class="tab-item active" data-tab="geraete">🛠️ Geräte</button>
      <button type="button" class="tab-item" data-tab="flotten">🚐 Flotten</button>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function setTab(t) {
    tab = t;
    container.querySelectorAll('#ge-tabs .tab-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    container.querySelector('#btn-new').textContent = t === 'geraete' ? '+ Neues Gerät' : '+ Neues Fahrzeug';
    renderTable();
  }
  container.querySelectorAll('#ge-tabs .tab-item').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  function zugewiesenLabel(item) {
    if (!item.zugewiesenAn) return '<span class="text-mute">–</span>';
    const ma = mitarbeiterById[item.zugewiesenAn];
    return ma ? escapeHtml(ma.name) : '<span class="text-mute">–</span>';
  }

  function renderTable() {
    const list = tab === 'geraete' ? geraete : flotten;
    if (list.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch ${tab === 'geraete' ? 'keine Geräte' : 'keine Fahrzeuge'} angelegt.</div>`;
      return;
    }
    const bulk = tab === 'geraete' ? bulkGeraete : bulkFlotten;
    if (tab === 'geraete') {
      tableHost.innerHTML = `
        ${bulk.barHtml()}
        <table class="data-table">
          <thead><tr>${bulk.headerCell()}<th></th><th>Name</th><th>Kategorie</th><th>Status</th><th>Zugewiesen an</th><th>Nächste Prüfung</th></tr></thead>
          <tbody>
            ${geraete.map((g) => {
              const s = statusInfo(g.status);
              return `
              <tr data-id="${g.id}">
                ${bulk.rowCell(g.id)}
                <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${g.farbe || FARBEN[0]}"></span></td>
                <td>${escapeHtml(g.name)}</td>
                <td>${escapeHtml(g.kategorie || '')}</td>
                <td><span class="badge ${s.badge}">${s.titel}</span></td>
                <td>${zugewiesenLabel(g)}</td>
                <td>${formatDate(g.naechstePruefung)}</td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      `;
    } else {
      tableHost.innerHTML = `
        ${bulk.barHtml()}
        <table class="data-table">
          <thead><tr>${bulk.headerCell()}<th></th><th>Bezeichnung</th><th>Kennzeichen</th><th>Status</th><th>Zugewiesen an</th><th>TÜV/HU</th></tr></thead>
          <tbody>
            ${flotten.map((f) => {
              const s = statusInfo(f.status);
              return `
              <tr data-id="${f.id}">
                ${bulk.rowCell(f.id)}
                <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${f.farbe || FARBEN[1]}"></span></td>
                <td>${escapeHtml(f.bezeichnung)}</td>
                <td>${escapeHtml(f.kennzeichen || '')}</td>
                <td><span class="badge ${s.badge}">${s.titel}</span></td>
                <td>${zugewiesenLabel(f)}</td>
                <td>${formatDate(f.tuvDatum)}</td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      `;
    }
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => {
        const list2 = tab === 'geraete' ? geraete : flotten;
        openForm(list2.find((x) => x.id === row.dataset.id));
      });
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        if (tab === 'geraete') geraete = geraete.filter((g) => !ids.includes(g.id));
        else flotten = flotten.filter((f) => !ids.includes(f.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-scan').addEventListener('click', () => openScanModal());

  function findByQrPayload(text) {
    const match = /^NVQR:(geraet|flotte):(.+)$/.exec((text || '').trim());
    const id = match ? match[2] : (text || '').trim();
    const typ = match ? match[1] : null;
    if (typ === 'geraet' || !typ) {
      const found = geraete.find((g) => g.id === id);
      if (found) return { typ: 'geraet', item: found };
    }
    if (typ === 'flotte' || !typ) {
      const found = flotten.find((f) => f.id === id);
      if (found) return { typ: 'flotte', item: found };
    }
    return null;
  }

  function openScanModal() {
    const { body, close } = openModal({
      title: '📷 Gerät/Fahrzeug scannen',
      bodyHtml: `
        <div id="scan-video-host" style="display:flex;justify-content:center">
          <video id="scan-video" style="width:100%;max-width:420px;border-radius:8px;background:#000" muted playsinline></video>
        </div>
        <p class="hint" id="scan-hint">Kamera wird gestartet ...</p>
        <div id="scan-result-host"></div>
        <div class="field" style="margin-top:14px">
          <label>Oder Code manuell eingeben</label>
          <div class="flex-row">
            <input type="text" id="scan-manual-input" placeholder="z.B. NVQR:geraet:...">
            <button type="button" class="btn" id="scan-manual-btn">Suchen</button>
          </div>
        </div>
      `,
      onClose: () => stopScanner(),
    });

    let codeReader = null;
    let stopped = false;

    function stopScanner() {
      stopped = true;
      if (codeReader) {
        try { codeReader.reset(); } catch { /* ignore */ }
        codeReader = null;
      }
    }

    function handleFound(text) {
      if (stopped) return;
      const found = findByQrPayload(text);
      if (!found) {
        body.querySelector('#scan-hint').textContent = `Kein Gerät/Fahrzeug zu Code "${text}" gefunden.`;
        return;
      }
      stopScanner();
      body.querySelector('#scan-video-host').hidden = true;
      body.querySelector('#scan-hint').textContent = '';
      renderScanResult(found);
    }

    function renderScanResult(found) {
      const { typ, item } = found;
      const s = statusInfo(item.status);
      const name = typ === 'geraet' ? item.name : item.bezeichnung;
      const resultHost = body.querySelector('#scan-result-host');
      resultHost.innerHTML = `
        <div class="card" style="margin-top:8px">
          <h3 style="margin-top:0">${escapeHtml(name)}</h3>
          <p>Status: <span class="badge ${s.badge}">${s.titel}</span></p>
          <p>Aktuell zugewiesen: <strong>${item.zugewiesenAn ? escapeHtml(mitarbeiterById[item.zugewiesenAn]?.name || '–') : '– (Lager)'}</strong></p>
          <div class="field">
            <label>Neu zuweisen an</label>
            <select id="scan-assign-select">
              <option value="">– Niemand / Lager –</option>
              ${optionList(mitarbeiter, { selected: item.zugewiesenAn || '', placeholder: null })}
            </select>
          </div>
          <div class="modal-actions" style="border:none;padding-top:10px">
            <button type="button" class="btn" id="scan-again-btn">Nochmal scannen</button>
            <span class="spacer"></span>
            <button type="button" class="btn btn-primary" id="scan-assign-btn">Übernehmen</button>
          </div>
        </div>
      `;
      resultHost.querySelector('#scan-again-btn').addEventListener('click', () => {
        resultHost.innerHTML = '';
        body.querySelector('#scan-video-host').hidden = false;
        body.querySelector('#scan-hint').textContent = 'Kamera wird gestartet ...';
        stopped = false;
        startScanner();
      });
      resultHost.querySelector('#scan-assign-btn').addEventListener('click', async () => {
        const select = resultHost.querySelector('#scan-assign-select');
        const newAssignee = select.value || '';
        const store = typ === 'geraet' ? 'geraete' : 'flotten';
        const updated = { ...item, zugewiesenAn: newAssignee, status: newAssignee ? 'im-einsatz' : (item.status === 'im-einsatz' ? 'verfuegbar' : item.status) };
        await put(store, updated);
        if (typ === 'geraet') geraete = geraete.map((g) => (g.id === updated.id ? updated : g));
        else flotten = flotten.map((f) => (f.id === updated.id ? updated : f));
        toast('Zuweisung aktualisiert', 'success');
        renderTable();
        close();
      });
    }

    async function startScanner() {
      if (!window.ZXing) {
        body.querySelector('#scan-hint').textContent = 'Scanner-Bibliothek konnte nicht geladen werden.';
        return;
      }
      try {
        codeReader = new window.ZXing.BrowserMultiFormatReader();
        const videoEl = body.querySelector('#scan-video');
        await codeReader.decodeFromVideoDevice(undefined, videoEl, (result, err) => {
          if (stopped) return;
          if (result) {
            handleFound(result.getText());
          }
        });
        if (!stopped) body.querySelector('#scan-hint').textContent = 'Code vor die Kamera halten ...';
      } catch (err) {
        if (!stopped) body.querySelector('#scan-hint').textContent = `Kamera nicht verfügbar (${err.message || err}). Bitte Code manuell eingeben.`;
      }
    }
    startScanner();

    body.querySelector('#scan-manual-btn').addEventListener('click', () => {
      const val = body.querySelector('#scan-manual-input').value.trim();
      if (!val) return;
      handleFound(val);
    });
  }

  function openQrModal(typ, item) {
    const name = typ === 'geraet' ? item.name : item.bezeichnung;
    const payload = qrPayload(typ, item.id);
    const { body } = openModal({
      title: `QR-Code – ${name}`,
      bodyHtml: `
        <div id="qr-print-area" style="text-align:center">
          <div id="qr-svg-host" style="display:flex;justify-content:center;margin-bottom:10px"></div>
          <p style="font-weight:600">${escapeHtml(name)}</p>
          <p class="hint" style="word-break:break-all">${escapeHtml(payload)}</p>
        </div>
        <div class="modal-actions" style="border:none;padding-top:10px">
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary" id="qr-print-btn">🖨️ Drucken</button>
        </div>
      `,
    });
    const svgHost = body.querySelector('#qr-svg-host');
    if (window.ZXing) {
      try {
        const writer = new window.ZXing.BrowserQRCodeSvgWriter();
        const svg = writer.write(payload, 220, 220);
        svgHost.appendChild(svg);
      } catch (err) {
        svgHost.innerHTML = `<p class="hint">QR-Code konnte nicht erzeugt werden.</p>`;
      }
    } else {
      svgHost.innerHTML = `<p class="hint">Scanner-Bibliothek nicht geladen.</p>`;
    }
    body.querySelector('#qr-print-btn').addEventListener('click', () => {
      const printWin = window.open('', '_blank', 'width=400,height=500');
      printWin.document.write(`<!DOCTYPE html><html><head><title>QR-Code ${escapeHtml(name)}</title></head><body style="text-align:center;font-family:sans-serif">${body.querySelector('#qr-print-area').innerHTML}</body></html>`);
      printWin.document.close();
      printWin.focus();
      printWin.print();
    });
  }

  function openForm(item) {
    const isEdit = !!item;
    const isGeraet = tab === 'geraete';
    const data = item || (isGeraet
      ? { id: uid(), name: '', kategorie: '', status: 'verfuegbar', standort: '', naechstePruefung: '', farbe: FARBEN[geraete.length % FARBEN.length], notizen: '', zugewiesenAn: '' }
      : { id: uid(), bezeichnung: '', kennzeichen: '', status: 'verfuegbar', typ: 'Transporter', tuvDatum: '', kilometerstand: '', farbe: FARBEN[flotten.length % FARBEN.length], notizen: '', zugewiesenAn: '' });

    const { body, close } = openModal({
      title: isEdit ? 'Bearbeiten' : (isGeraet ? 'Neues Gerät' : 'Neues Fahrzeug'),
      bodyHtml: `
        <form id="ge-form">
          <div class="form-grid">
            ${isGeraet ? `
              <div class="field col-span-2"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
              <div class="field"><label>Kategorie</label><input name="kategorie" placeholder="z.B. Messgerät, Maschine" value="${escapeHtml(data.kategorie || '')}"></div>
              <div class="field"><label>Standort</label><input name="standort" value="${escapeHtml(data.standort || '')}"></div>
              <div class="field"><label>Nächste Prüfung</label><input type="date" name="naechstePruefung" value="${data.naechstePruefung || ''}"></div>
            ` : `
              <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
              <div class="field"><label>Kennzeichen</label><input name="kennzeichen" value="${escapeHtml(data.kennzeichen || '')}"></div>
              <div class="field"><label>Typ</label><input name="typ" placeholder="Transporter, PKW, Anhänger ..." value="${escapeHtml(data.typ || '')}"></div>
              <div class="field"><label>TÜV/HU</label><input type="date" name="tuvDatum" value="${data.tuvDatum || ''}"></div>
              <div class="field"><label>Kilometerstand</label><input type="number" min="0" name="kilometerstand" value="${data.kilometerstand || ''}"></div>
            `}
            <div class="field"><label>Status</label>
              <select name="status">${STATUS.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.titel}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Zugewiesen an</label>
              <select name="zugewiesenAn"><option value="">– Niemand / Lager –</option>${optionList(mitarbeiter, { selected: data.zugewiesenAn || '', placeholder: null })}</select>
            </div>
            <div class="field"><label>Farbe (Plantafel)</label>
              <select name="farbe">${FARBEN.map((f) => `<option value="${f}" ${f === data.farbe ? 'selected' : ''}>${f}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn" id="btn-qr">📱 QR-Code</button>' : ''}
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    const storeName = isGeraet ? 'geraete' : 'flotten';
    if (isEdit) {
      body.querySelector('#btn-qr').addEventListener('click', () => openQrModal(isGeraet ? 'geraet' : 'flotte', data));
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Wirklich löschen?')) return;
        await remove(storeName, data.id);
        toast('Gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#ge-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      const nameField = isGeraet ? 'name' : 'bezeichnung';
      if (!updated[nameField]) return;
      await put(storeName, updated);
      toast(isEdit ? 'Aktualisiert' : 'Angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
