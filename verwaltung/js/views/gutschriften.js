// Eigenständige Gutschriften (Kundenguthaben) - UNABHÄNGIG von einer
// bestehenden Rechnung (Kulanz, Rücksendung/Reklamation, Überzahlung). Anders
// als die Storno-Funktion in rechnungen.js (die eine KONKRETE fehlerhafte
// Rechnung durch eine negative Spiegelrechnung korrigiert) entsteht hier ein
// eigenständiges Guthaben, das später ganz oder teilweise gegen eine
// BELIEBIGE künftige Rechnung desselben Kunden verrechnet werden kann (siehe
// rechnungen.js, Feld verrechneteGutschriften). Buchhalterisch wird die
// Gutschrift EINMALIG bei Ausstellung als Erlösminderung gegen das Konto
// "Verbindlichkeiten aus Kundengutschriften" gebucht (siehe journal.js) - die
// spätere Verrechnung gegen eine Rechnung erzeugt bewusst KEINE zweite
// Buchung, siehe Kommentar dort.
import { getAll, put, remove, getSettings, setSettings, USTSAETZE } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, nextDailyNummer, toast, calcTotals, offenerGutschriftBetrag } from '../utils.js';
import { openModal, confirmDelete, mountChipPicker, openKundeSchnellanlage } from '../ui.js';
import { printDokument, buildDocHtml, mountDocPreviewToggle } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { downloadCsv, exportDokumenteAlsPdf } from '../docexport.js';
import { createBulkSelect } from '../bulkselect.js';
import * as journal from '../journal.js';

const STATUS_LABEL = { offen: 'Offen', eingeloest: 'Eingelöst', storniert: 'Storniert' };
const STATUS_BADGE = { offen: 'badge-warn', eingeloest: 'badge-success', storniert: 'badge-danger' };
const GRUENDE_GUTSCHRIFT = [
  { id: 'kulanz', titel: 'Kulanz' },
  { id: 'ruecksendung', titel: 'Rücksendung/Reklamation' },
  { id: 'ueberzahlung', titel: 'Überzahlung durch Kunden' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

export async function render(container, route) {
  let [gutschriften, kunden, settings] = await Promise.all([
    getAll('gutschriften'), getAll('kunden'), getSettings(),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  gutschriften.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = gutschriften;

  // Buchungssatz-Sync ist ein Komfort-Feature (siehe rechnungen.js) - ein
  // Fehler dabei darf das Speichern der Gutschrift nie verhindern.
  async function syncBuchung(g) {
    try { await journal.syncBuchungFuerGutschrift(g, settings); } catch { /* siehe oben */ }
  }

  function docOpts(g) {
    const kunde = kundenById[g.kundeId];
    // Negative Position (menge:-1), analog zur Stornorechnung in rechnungen.js
    // - zeigt auf dem Dokument einen Abzugsbetrag statt einer Forderung, und
    // calcTotals() liefert dadurch direkt die passenden negativen Summen,
    // ohne eine zweite, fehleranfällige manuelle Vorzeichenumkehr der Summen.
    const position = { id: 'gs-pos', bezeichnung: g.betreff || GRUENDE_GUTSCHRIFT.find((r) => r.id === g.grund)?.titel || 'Gutschrift', beschreibung: g.grundText || '', einheit: 'Psch.', menge: -1, einzelpreis: g.netto, steuersatz: g.steuersatz };
    const totals = calcTotals([position]);
    return {
      settings, art: 'Gutschrift', nummer: g.nummer, datum: g.datum,
      refLabel: '', refValue: '',
      kunde, betreff: g.betreff || '',
      introText: 'wir erstellen Ihnen folgende Gutschrift:',
      positionen: [position], totals,
      steuerHinweis: g.steuerart === 'kleinunternehmer' ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : '',
      closingText: (g.notizen || '') + '\n\nDiese Gutschrift wird mit einer künftigen Rechnung verrechnet oder auf Wunsch ausgezahlt.',
      faelligAm: '', steuerart: g.steuerart || 'regel',
    };
  }
  function exportFilename(g) {
    return `Gutschrift-${(g.nummer || g.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  }
  async function exportPdf(items, zipFilename) {
    if (items.length === 0) { toast('Keine Gutschriften zum Exportieren', 'info'); return; }
    if (items.length > 1) toast(`${items.length} PDFs werden erstellt ...`, 'info');
    await exportDokumenteAlsPdf(items, { buildPdfBlob: (g) => buildDocPdfBlob(docOpts(g)), filenameFor: exportFilename, zipFilename });
  }
  function exportCsv(items) {
    if (items.length === 0) { toast('Keine Gutschriften zum Exportieren', 'info'); return; }
    const rows = [['Nummer', 'Kunde', 'Datum', 'Status', 'Grund', 'Brutto', 'Noch offen']];
    for (const g of items) {
      rows.push([g.nummer, kundenById[g.kundeId]?.firma || '', formatDate(g.datum), STATUS_LABEL[g.status] || g.status, GRUENDE_GUTSCHRIFT.find((r) => r.id === g.grund)?.titel || g.grund, g.brutto, offenerGutschriftBetrag(g)]);
    }
    downloadCsv(rows, 'Gutschriften-Export.csv');
  }

  const bulk = createBulkSelect('gutschriften', {
    label: 'Gutschriften',
    deleteFn: async (id) => {
      await remove('gutschriften', id);
      const g = gutschriften.find((x) => x.id === id);
      if (g) await syncBuchung({ ...g, status: 'geloescht' });
    },
    extraActions: [
      { id: 'bulk-export-pdf', label: '📄 Als PDF', onClick: (ids) => exportPdf(gutschriften.filter((g) => ids.includes(g.id)), 'Gutschriften-Auswahl.zip') },
      { id: 'bulk-export-csv', label: '📊 Als CSV', onClick: (ids) => exportCsv(gutschriften.filter((g) => ids.includes(g.id))) },
    ],
  });

  const nichtStorniert = gutschriften.filter((g) => g.status !== 'storniert');
  const kpiOffen = nichtStorniert.filter((g) => offenerGutschriftBetrag(g) > 0);
  const summeOffen = (list) => list.reduce((s, g) => s + offenerGutschriftBetrag(g), 0);
  const summe = (list) => list.reduce((s, g) => s + (g.brutto || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <h1>Gutschriften</h1>
      <div class="actions">
        <button class="btn" id="btn-export-pdf-alle">📄 Alle als PDF</button>
        <button class="btn" id="btn-export-csv-alle">📊 Alle als CSV</button>
        <button class="btn btn-primary" id="btn-new">+ Neue Gutschrift</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card kpi-clickable kpi-accent" id="kpi-offen">
        <div class="kpi-value">${formatCurrency(summeOffen(kpiOffen))}</div>
        <div class="kpi-label">Offenes Guthaben · ${kpiOffen.length} Gutschrift(en)</div>
      </div>
      <div class="kpi-card kpi-clickable" id="kpi-alle">
        <div class="kpi-value">${formatCurrency(summe(nichtStorniert))}</div>
        <div class="kpi-label">Gesamt · ${nichtStorniert.length} Gutschrift(en)</div>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Nummer oder Kunde ...">
      <select id="status-filter">
        <option value="">Alle Status</option>
        <option value="offen-rest">Noch offenes Guthaben</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const status = container.querySelector('#status-filter').value;
    filtered = gutschriften.filter((g) => {
      if (status === 'offen-rest' && !(offenerGutschriftBetrag(g) > 0)) return false;
      else if (status && status !== 'offen-rest' && g.status !== status) return false;
      if (!q) return true;
      return [g.nummer, kundenById[g.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Gutschriften erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Datum</th><th>Grund</th><th>Status</th><th class="text-right">Brutto</th><th class="text-right">Noch offen</th></tr></thead>
        <tbody>
          ${filtered.map((g) => {
            const rest = offenerGutschriftBetrag(g);
            return `
            <tr data-id="${g.id}">
              ${bulk.rowCell(g.id, !!g.versendet)}
              <td>${escapeHtml(g.nummer)}</td>
              <td>${escapeHtml(kundenById[g.kundeId]?.firma || '')}</td>
              <td>${formatDate(g.datum)}</td>
              <td>${escapeHtml(GRUENDE_GUTSCHRIFT.find((r) => r.id === g.grund)?.titel || g.grund || '')}</td>
              <td><span class="badge ${STATUS_BADGE[g.status] || 'badge'}">${STATUS_LABEL[g.status] || g.status}</span></td>
              <td class="text-right">${formatCurrency(g.brutto)}</td>
              <td class="text-right">${g.status === 'storniert' ? '–' : formatCurrency(rest)}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
      <div class="tt-card-list">
        ${filtered.map((g) => `
            <div class="tt-card" data-id="${g.id}">
              <div class="tt-card-top">
                <span class="tt-card-meta">${formatDate(g.datum)}</span>
                <span class="badge ${STATUS_BADGE[g.status] || 'badge'}">${STATUS_LABEL[g.status] || g.status}</span>
              </div>
              <div class="tt-card-title-row"><span>${escapeHtml(g.nummer)}</span></div>
              <div class="tt-card-bottom">
                <span class="tt-card-sub"><span class="tt-card-icon" style="width:18px;height:18px;font-size:10px;vertical-align:-4px;margin-right:5px">🏢</span>${escapeHtml(kundenById[g.kundeId]?.firma || '')}</span>
                <span class="tt-card-amount">${formatCurrency(g.brutto)}</span>
              </div>
            </div>
        `).join('')}
      </div>
    `;
    tableHost.querySelectorAll('tbody tr, .tt-card').forEach((row) => {
      row.addEventListener('click', () => openForm(gutschriften.find((g) => g.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        gutschriften = gutschriften.filter((g) => !ids.includes(g.id));
        filtered = filtered.filter((g) => !ids.includes(g.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#status-filter').addEventListener('change', applyFilter);
  container.querySelector('#kpi-offen').addEventListener('click', () => { container.querySelector('#status-filter').value = 'offen-rest'; applyFilter(); });
  container.querySelector('#kpi-alle').addEventListener('click', () => { container.querySelector('#status-filter').value = ''; applyFilter(); });
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export-pdf-alle').addEventListener('click', () => exportPdf(filtered, 'Gutschriften-Export.zip'));
  container.querySelector('#btn-export-csv-alle').addEventListener('click', () => exportCsv(filtered));

  // Direktsprung auf eine einzelne Gutschrift, z.B. aus der Kundenakte per
  // #/gutschriften/<id> bzw. vorbelegter Kunde per #/gutschriften/neu/<kundeId>.
  if (route && route.startsWith('neu')) {
    const kundeId = route.split('/')[1] || '';
    openForm(null, { kundeId });
  } else if (route) {
    const ziel = gutschriften.find((g) => g.id === route);
    if (ziel) openForm(ziel);
  }

  function openForm(g, prefill) {
    const isEdit = !!g;
    const data = g || {
      id: uid(), nummer: '', kundeId: prefill?.kundeId || '', datum: todayISO(),
      grund: 'kulanz', grundText: '', betreff: '', steuersatz: settings.kleinunternehmer ? 0 : settings.standardSteuersatz,
      steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel',
      netto: 0, steuer: 0, brutto: 0, notizen: '', status: 'offen', verwendungen: [],
      createdAt: new Date().toISOString(), versendet: false, versendetAm: '',
    };
    const locked = isEdit && !!data.versendet;
    const istVerwendet = (data.verwendungen || []).length > 0;
    const kannStornieren = isEdit && locked && data.status === 'offen' && !istVerwendet;
    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.gutschriftPrefix, { datum: settings.gutschriftNummerDatum, zaehler: settings.gutschriftNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Gutschrift ${data.nummer}` : 'Neue Gutschrift',
      wide: true,
      bodyHtml: `
        <form id="gs-form">
          ${locked ? `<p class="hint">🔒 Versendet am ${formatDate(data.versendetAm)} – gesperrt (GoBD). ${data.status === 'storniert' ? 'Storniert.' : ''}</p>` : ''}
          ${istVerwendet ? `
            <div class="hint" style="margin-bottom:10px">
              <strong>Bereits verrechnet gegen:</strong>
              <ul style="margin:4px 0 0 18px">
                ${data.verwendungen.map((v) => `<li>${escapeHtml(v.rechnungNummer)} – ${formatCurrency(v.betrag)} (${formatDate(v.datum)})</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Kunde *</label><div id="f-kunde-host"></div></div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Grund</label>
              <select name="grund" ${locked ? 'disabled' : ''}>${GRUENDE_GUTSCHRIFT.map((r) => `<option value="${r.id}" ${r.id === data.grund ? 'selected' : ''}>${escapeHtml(r.titel)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Betreff / Bezeichnung</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" placeholder="z.B. Rücksendung Lampe Art.-Nr. 123" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Betrag (brutto)</label><input type="number" step="0.01" min="0.01" name="betragBrutto" value="${data.brutto || ''}" ${locked ? 'disabled' : ''} required></div>
            <div class="field"><label>Steuersatz</label>
              <select name="steuersatz" ${locked || settings.kleinunternehmer ? 'disabled' : ''}>${USTSAETZE.map((s) => `<option value="${s.wert}" ${s.wert === data.steuersatz ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
              ${settings.kleinunternehmer ? '<span class="hint mb-0">Kleinunternehmer § 19 UStG – keine USt.</span>' : ''}
            </div>
            <div class="field col-span-2"><label>Notiz (Grund im Detail, optional)</label><input name="grundText" value="${escapeHtml(data.grundText || '')}" ${locked ? 'disabled' : ''}></div>
            <div class="field col-span-2"><label>Notizen (erscheinen auf der Gutschrift)</label><textarea name="notizen" ${locked ? 'disabled' : ''}>${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          <div class="modal-actions">
            ${isEdit && !locked ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${kannStornieren ? '<button type="button" class="btn btn-danger" id="btn-storno">Stornieren</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            ${!locked ? '<button type="submit" class="btn btn-primary">Speichern</button>' : ''}
          </div>
        </form>
      `,
    });

    const kundePicker = mountChipPicker(body.querySelector('#f-kunde-host'), {
      name: 'kundeId', icon: '🏢', title: 'Kunde wählen', placeholder: '– Kunde wählen –',
      items: kunden, selectedId: data.kundeId, disabled: locked,
      itemLabel: (k) => k.firma, itemSub: (k) => [k.plz, k.ort].filter(Boolean).join(' '),
      onCreateNew: () => new Promise((resolve) => {
        openKundeSchnellanlage({
          onCreated: (neuerKunde) => { kunden.push(neuerKunde); kundenById[neuerKunde.id] = neuerKunde; resolve(neuerKunde); },
        });
      }),
    });

    function liveTotals() {
      const brutto = Number(body.querySelector('[name="betragBrutto"]')?.value) || 0;
      const steuersatz = Number(body.querySelector('[name="steuersatz"]')?.value) || 0;
      const einzelpreis = Math.round((brutto / (1 + steuersatz / 100)) * 100) / 100;
      return calcTotals([{ menge: 1, einzelpreis, steuersatz }]);
    }

    mountDocPreviewToggle({
      body, settings, defaultView: settings.dokStandardansicht,
      getDocOpts: () => {
        const totals = liveTotals();
        const kundeIdLive = kundePicker.getValue() || data.kundeId;
        const betreffLive = body.querySelector('input[name="betreff"]')?.value ?? data.betreff ?? '';
        const notizenLive = body.querySelector('textarea[name="notizen"]')?.value ?? data.notizen ?? '';
        return docOpts({ ...data, kundeId: kundeIdLive, betreff: betreffLive, notizen: notizenLive, netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto, steuersatz: Number(body.querySelector('[name="steuersatz"]')?.value) || 0 });
      },
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      const deleteBtn = body.querySelector('#btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirmDelete(`Gutschrift ${data.nummer} in den Papierkorb verschieben?`)) return;
          await remove('gutschriften', data.id);
          await syncBuchung({ ...data, status: 'geloescht' });
          toast('Gutschrift in den Papierkorb verschoben');
          close();
          render(container);
        });
      }
      const stornoBtn = body.querySelector('#btn-storno');
      if (stornoBtn) {
        stornoBtn.addEventListener('click', async () => {
          if (!confirmDelete(`Gutschrift ${data.nummer} stornieren? Das Guthaben entfällt, die Buchung wird rückgängig gemacht.`)) return;
          const storniert = { ...data, status: 'storniert' };
          await put('gutschriften', storniert);
          await syncBuchung(storniert);
          toast('Gutschrift storniert', 'success');
          close();
          render(container);
        });
      }
      async function markVersendetUndSperren() {
        if (data.versendet) return;
        const totals = liveTotals();
        const persisted = { ...data, versendet: true, versendetAm: new Date().toISOString() };
        await put('gutschriften', persisted);
        await syncBuchung(persisted);
        Object.assign(data, persisted);
        toast('Gutschrift wurde ausgestellt und ist nun GoBD-gesperrt.', 'info');
        close();
        openForm({ ...data });
      }
      body.querySelector('#btn-print').addEventListener('click', async () => {
        const opts = docOpts(locked ? data : { ...data, netto: liveTotals().netto, steuer: liveTotals().steuer, brutto: liveTotals().brutto });
        await printDokument({ bodyHtml: buildDocHtml(opts), settings, buildPdfBlob: () => buildDocPdfBlob(opts) });
        if (!locked) await markVersendetUndSperren();
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          const opts = docOpts(data);
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Gutschrift ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unsere Gutschrift ${data.nummer} über ${formatCurrency(data.brutto)}.\n\nMit freundlichen Grüßen\n${settings.firmenname}`,
            filename: `Gutschrift-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(opts),
          });
          if (!locked) await markVersendetUndSperren();
        });
      }
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          sendDocumentViaWhatsApp({
            phone: kunde?.telefon,
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unsere Gutschrift ${data.nummer} über ${formatCurrency(data.brutto)}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${settings.firmenname}`,
            pdfBlob: await buildDocPdfBlob(docOpts(data)),
            filename: `Gutschrift-${data.nummer}.pdf`,
          });
          if (!locked) await markVersendetUndSperren();
        });
      }
    }

    if (!locked) {
      body.querySelector('#gs-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const kundeIdValue = fd.get('kundeId') || '';
        if (!kundeIdValue) { toast('Bitte einen Kunden wählen', 'danger'); return; }
        const brutto = Number(fd.get('betragBrutto'));
        if (!(brutto > 0)) { toast('Bitte einen Betrag größer 0 angeben', 'danger'); return; }
        const steuersatz = Number(fd.get('steuersatz')) || 0;
        const einzelpreis = Math.round((brutto / (1 + steuersatz / 100)) * 100) / 100;
        const totals = calcTotals([{ menge: 1, einzelpreis, steuersatz }]);

        const updated = {
          ...data, kundeId: kundeIdValue, datum: fd.get('datum') || todayISO(),
          grund: fd.get('grund') || 'sonstiges', grundText: (fd.get('grundText') || '').toString().trim(),
          betreff: (fd.get('betreff') || '').toString().trim(), notizen: (fd.get('notizen') || '').toString().trim(),
          steuersatz, steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel',
          netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto,
        };
        updated.nummer = (fd.get('nummer') || '').toString().trim();

        if (!isEdit) {
          const currentSettings = await getSettings();
          const { nummer: autoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
            currentSettings.gutschriftPrefix, { datum: currentSettings.gutschriftNummerDatum, zaehler: currentSettings.gutschriftNummerZaehler }
          );
          if (!updated.nummer) updated.nummer = autoNummer;
          await setSettings({ gutschriftNummerDatum: nDatum, gutschriftNummerZaehler: nZaehler });
        }

        const nummerNorm = updated.nummer.trim().toLowerCase();
        const dupe = gutschriften.some((x) => x.id !== updated.id && (x.nummer || '').trim().toLowerCase() === nummerNorm);
        if (dupe) { toast(`Gutschriftsnummer "${updated.nummer}" ist bereits vergeben – GoBD verlangt eindeutige Nummern.`, 'danger'); return; }

        await put('gutschriften', updated);
        await syncBuchung(updated);
        toast(isEdit ? 'Gutschrift aktualisiert' : 'Gutschrift angelegt', 'success');
        close();
        render(container);
      });
    }
  }

  applyFilter();
}
