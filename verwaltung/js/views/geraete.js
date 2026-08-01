import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatDate, todayISO, toast, farbeAusText } from '../utils.js';
import { openModal, confirmDelete, optionList } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';
import { loadZXing } from '../vendorLoader.js';

const FARBEN = ['#14b8a6', '#4d8bf0', '#a463f2', '#f0a020', '#ef4444', '#16a085', '#d35400', '#2c3e50'];

// Vorschlagslisten für das Hersteller-Feld (Autovervollständigung) - deckt die
// im Handwerk gängigsten Marken ab, ersetzt aber keine freie Eingabe.
const HERSTELLER_PRESETS_GERAETE = [
  'Hilti', 'Bosch Professional', 'Makita', 'Milwaukee', 'DeWalt', 'Metabo', 'Festool',
  'Würth', 'Knipex', 'Wacker Neuson', 'Stihl', 'Fluke', 'Gossen Metrawatt', 'Testo',
];
const HERSTELLER_PRESETS_FLOTTEN = [
  'Mercedes-Benz', 'Volkswagen', 'Ford', 'MAN', 'Renault', 'Opel', 'Fiat', 'Iveco', 'Citroën',
];

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

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Echtes Fahrten-Log je Fahrzeug (Datum/Start/Ziel/Zweck/km) statt nur eines
// einzelnen Kilometerstand-Felds - für die steuerliche Nutzung (Privatanteil,
// Betriebsausgaben) reicht eine Momentaufnahme nicht aus.
async function mountFahrtenbuch(host, flotte, mitarbeiter, mitarbeiterById) {
  let fahrten = (await getAll('fahrten')).filter((f) => f.flotteId === flotte.id);
  fahrten.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  let showForm = false;

  function exportCsv() {
    const rows = [['Datum', 'Fahrer', 'Start', 'Ziel', 'Zweck', 'km Start', 'km Ende', 'km gefahren', 'Privatfahrt']];
    for (const f of [...fahrten].sort((a, b) => (a.datum || '').localeCompare(b.datum || ''))) {
      rows.push([
        formatDate(f.datum), mitarbeiterById[f.mitarbeiterId]?.name || '', f.start || '', f.ziel || '', f.zweck || '',
        f.kmStart ?? '', f.kmEnde ?? '', f.kmGefahren ?? '', f.privat ? 'ja' : 'nein',
      ]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadFile(csv, `fahrtenbuch-${(flotte.kennzeichen || flotte.bezeichnung || 'fahrzeug').replace(/[^a-z0-9-]/gi, '_')}.csv`, 'text/csv;charset=utf-8');
  }

  function render() {
    const gesamtKm = fahrten.reduce((s, f) => s + (Number(f.kmGefahren) || 0), 0);
    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
        <span class="text-mute" style="font-size:12px">${fahrten.length} Fahrten erfasst · ${gesamtKm} km gesamt</span>
        <div class="flex-row" style="gap:6px">
          ${fahrten.length ? '<button type="button" class="btn btn-sm" id="fb-export">📄 Als CSV exportieren</button>' : ''}
          <button type="button" class="btn btn-sm" id="fb-add">+ Fahrt erfassen</button>
        </div>
      </div>
      ${showForm ? `
        <div id="fb-form" class="form-grid" style="margin-bottom:10px">
          <div class="field"><label>Datum</label><input type="date" name="datum" value="${todayISO()}" required></div>
          <div class="field"><label>Fahrer</label><select name="mitarbeiterId"><option value="">–</option>${optionList(mitarbeiter, { selected: '', placeholder: null })}</select></div>
          <div class="field"><label>Start</label><input name="start" placeholder="z.B. Firma"></div>
          <div class="field"><label>Ziel</label><input name="ziel" placeholder="z.B. Kunde XY"></div>
          <div class="field col-span-2"><label>Zweck</label><input name="zweck" placeholder="Anlass der Fahrt"></div>
          <div class="field"><label>km Start</label><input type="number" min="0" name="kmStart" value="${flotte.kilometerstand || 0}" required></div>
          <div class="field"><label>km Ende</label><input type="number" min="0" name="kmEnde" required></div>
          <div class="field col-span-2"><label><input type="checkbox" name="privat"> Privatfahrt</label></div>
          <div class="modal-actions" style="border:none;padding-top:0;grid-column:1/-1">
            <span class="spacer"></span>
            <button type="button" class="btn btn-sm" id="fb-cancel">Abbrechen</button>
            <button type="button" class="btn btn-sm btn-primary" id="fb-save">Speichern</button>
          </div>
        </div>
      ` : ''}
      ${fahrten.length === 0 ? '<p class="text-mute" style="font-size:12px">Noch keine Fahrten erfasst.</p>' : `
        <table class="table" style="font-size:12px">
          <thead><tr><th>Datum</th><th>Fahrer</th><th>Start → Ziel</th><th>Zweck</th><th>km</th><th></th></tr></thead>
          <tbody>
            ${fahrten.map((f) => `
              <tr>
                <td>${formatDate(f.datum)}</td>
                <td>${escapeHtml(mitarbeiterById[f.mitarbeiterId]?.name || '–')}</td>
                <td>${escapeHtml(f.start || '')} → ${escapeHtml(f.ziel || '')}</td>
                <td>${escapeHtml(f.zweck || '')}${f.privat ? ' <span class="badge">privat</span>' : ''}</td>
                <td>${f.kmGefahren || 0} km</td>
                <td><button type="button" class="btn btn-sm btn-ghost" data-del="${f.id}" title="Fahrt löschen">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    `;
    host.querySelector('#fb-export')?.addEventListener('click', exportCsv);
    host.querySelector('#fb-add')?.addEventListener('click', () => { showForm = true; render(); });
    host.querySelector('#fb-cancel')?.addEventListener('click', () => { showForm = false; render(); });
    host.querySelector('#fb-save')?.addEventListener('click', async () => {
      // Kein verschachteltes <form> möglich, da diese Sektion bereits innerhalb
      // des äußeren Fahrzeug-Formulars (#ge-form) liegt - HTML erlaubt keine
      // geschachtelten Formulare (der Browser würde das innere sonst stillschweigend
      // entfernen). Deshalb Felder direkt auslesen statt über FormData/submit.
      const form = host.querySelector('#fb-form');
      const kmStart = Number(form.querySelector('[name="kmStart"]').value) || 0;
      const kmEnde = Number(form.querySelector('[name="kmEnde"]').value) || 0;
      if (kmEnde < kmStart) { toast('km Ende muss größer oder gleich km Start sein', 'danger'); return; }
      const eintrag = {
        id: uid(), flotteId: flotte.id, datum: form.querySelector('[name="datum"]').value || todayISO(),
        mitarbeiterId: form.querySelector('[name="mitarbeiterId"]').value || '',
        start: form.querySelector('[name="start"]').value.trim(),
        ziel: form.querySelector('[name="ziel"]').value.trim(), zweck: form.querySelector('[name="zweck"]').value.trim(),
        kmStart, kmEnde, kmGefahren: kmEnde - kmStart, privat: form.querySelector('[name="privat"]').checked,
      };
      await put('fahrten', eintrag);
      // Kilometerstand des Fahrzeugs automatisch nachziehen, damit die nächste
      // Fahrt wieder sinnvoll vorbelegt ist und die Stammdaten aktuell bleiben.
      if (kmEnde > (Number(flotte.kilometerstand) || 0)) {
        flotte.kilometerstand = kmEnde;
        await put('flotten', flotte);
      }
      fahrten.unshift(eintrag);
      showForm = false;
      toast('Fahrt erfasst', 'success');
      render();
    });
    host.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Fahrt wirklich löschen?')) return;
        await remove('fahrten', btn.dataset.del);
        fahrten = fahrten.filter((f) => f.id !== btn.dataset.del);
        render();
      });
    });
  }
  render();
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

  function herstellerLabel(item) {
    const teile = [item.hersteller, item.modell].filter(Boolean);
    return teile.length ? escapeHtml(teile.join(' – ')) : '<span class="text-mute">–</span>';
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
          <thead><tr>${bulk.headerCell()}<th></th><th>Name</th><th>Kategorie</th><th>Hersteller/Modell</th><th>Status</th><th>Zugewiesen an</th><th>Nächste Prüfung</th></tr></thead>
          <tbody>
            ${geraete.map((g) => {
              const s = statusInfo(g.status);
              return `
              <tr data-id="${g.id}">
                ${bulk.rowCell(g.id)}
                <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${g.farbe || FARBEN[0]}"></span></td>
                <td>${escapeHtml(g.name)}</td>
                <td>${escapeHtml(g.kategorie || '')}</td>
                <td>${herstellerLabel(g)}</td>
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
          <thead><tr>${bulk.headerCell()}<th></th><th>Bezeichnung</th><th>Kennzeichen</th><th>Hersteller/Modell</th><th>Status</th><th>Zugewiesen an</th><th>TÜV/HU</th></tr></thead>
          <tbody>
            ${flotten.map((f) => {
              const s = statusInfo(f.status);
              return `
              <tr data-id="${f.id}">
                ${bulk.rowCell(f.id)}
                <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${f.farbe || FARBEN[1]}"></span></td>
                <td>${escapeHtml(f.bezeichnung)}</td>
                <td>${escapeHtml(f.kennzeichen || '')}</td>
                <td>${herstellerLabel(f)}</td>
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
      try {
        await loadZXing();
      } catch {
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
    svgHost.innerHTML = `<p class="hint">Lädt ...</p>`;
    loadZXing().then(() => {
      try {
        const writer = new window.ZXing.BrowserQRCodeSvgWriter();
        const svg = writer.write(payload, 220, 220);
        svgHost.innerHTML = '';
        svgHost.appendChild(svg);
      } catch (err) {
        svgHost.innerHTML = `<p class="hint">QR-Code konnte nicht erzeugt werden.</p>`;
      }
    }).catch(() => {
      svgHost.innerHTML = `<p class="hint">Scanner-Bibliothek konnte nicht geladen werden.</p>`;
    });
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
    const neueId = uid();
    const data = item || (isGeraet
      ? { id: neueId, name: '', kategorie: '', hersteller: '', modell: '', status: 'verfuegbar', standort: '', naechstePruefung: '', farbe: farbeAusText(neueId, FARBEN), notizen: '', zugewiesenAn: '', anschaffungswert: '', anschaffungsdatum: '' }
      : { id: neueId, bezeichnung: '', kennzeichen: '', hersteller: '', modell: '', status: 'verfuegbar', typ: 'Transporter', tuvDatum: '', kilometerstand: '', farbe: farbeAusText(neueId, FARBEN), notizen: '', zugewiesenAn: '', anschaffungswert: '', anschaffungsdatum: '' });
    const herstellerPresets = isGeraet ? HERSTELLER_PRESETS_GERAETE : HERSTELLER_PRESETS_FLOTTEN;

    const { body, close } = openModal({
      title: isEdit ? 'Bearbeiten' : (isGeraet ? 'Neues Gerät' : 'Neues Fahrzeug'),
      bodyHtml: `
        <form id="ge-form">
          <div class="form-grid">
            ${isGeraet ? `
              <div class="field col-span-2"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
              <div class="field"><label>Kategorie</label><input name="kategorie" placeholder="z.B. Messgerät, Maschine" value="${escapeHtml(data.kategorie || '')}"></div>
              <div class="field"><label>Standort</label><input name="standort" value="${escapeHtml(data.standort || '')}"></div>
              <div class="field"><label>Hersteller</label>
                <input name="hersteller" list="hersteller-presets" placeholder="z.B. Hilti" value="${escapeHtml(data.hersteller || '')}">
                <datalist id="hersteller-presets">${herstellerPresets.map((h) => `<option value="${escapeHtml(h)}"></option>`).join('')}</datalist>
              </div>
              <div class="field"><label>Modell</label><input name="modell" placeholder="z.B. TE 30-C" value="${escapeHtml(data.modell || '')}"></div>
              <div class="field"><label>Nächste Prüfung</label><input type="date" name="naechstePruefung" value="${data.naechstePruefung || ''}"></div>
              <div class="field"><label>Anschaffungswert (€, optional)</label><input type="number" step="0.01" min="0" name="anschaffungswert" value="${data.anschaffungswert || ''}"></div>
              <div class="field"><label>Anschaffungsdatum (optional)</label><input type="date" name="anschaffungsdatum" value="${data.anschaffungsdatum || ''}"></div>
            ` : `
              <div class="field col-span-2"><label>Bezeichnung *</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
              <div class="field"><label>Kennzeichen</label><input name="kennzeichen" value="${escapeHtml(data.kennzeichen || '')}"></div>
              <div class="field"><label>Typ</label><input name="typ" placeholder="Transporter, PKW, Anhänger ..." value="${escapeHtml(data.typ || '')}"></div>
              <div class="field"><label>Hersteller</label>
                <input name="hersteller" list="hersteller-presets" placeholder="z.B. Mercedes-Benz" value="${escapeHtml(data.hersteller || '')}">
                <datalist id="hersteller-presets">${herstellerPresets.map((h) => `<option value="${escapeHtml(h)}"></option>`).join('')}</datalist>
              </div>
              <div class="field"><label>Modell</label><input name="modell" placeholder="z.B. Sprinter 316 CDI" value="${escapeHtml(data.modell || '')}"></div>
              <div class="field"><label>TÜV/HU</label><input type="date" name="tuvDatum" value="${data.tuvDatum || ''}"></div>
              <div class="field"><label>Kilometerstand</label><input type="number" min="0" name="kilometerstand" value="${data.kilometerstand || ''}"></div>
              <div class="field"><label>Anschaffungswert (€, optional)</label><input type="number" step="0.01" min="0" name="anschaffungswert" value="${data.anschaffungswert || ''}"></div>
              <div class="field"><label>Anschaffungsdatum (optional)</label><input type="date" name="anschaffungsdatum" value="${data.anschaffungsdatum || ''}"></div>
            `}
            <div class="field"><label>Status</label>
              <select name="status">${STATUS.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.titel}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Zugewiesen an</label>
              <select name="zugewiesenAn"><option value="">– Niemand / Lager –</option>${optionList(mitarbeiter, { selected: data.zugewiesenAn || '', placeholder: null })}</select>
            </div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          ${!isGeraet && isEdit ? `
            <div class="divider"></div>
            <h3 style="font-size:14px;margin:0 0 8px">🚗 Fahrtenbuch</h3>
            <div id="fahrtenbuch-host"></div>
          ` : ''}
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
        if (!confirmDelete('In den Papierkorb verschieben?')) return;
        await remove(storeName, data.id);
        toast('In den Papierkorb verschoben');
        close();
        render(container);
      });
      if (!isGeraet) {
        mountFahrtenbuch(body.querySelector('#fahrtenbuch-host'), data, mitarbeiter, mitarbeiterById);
      }
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
