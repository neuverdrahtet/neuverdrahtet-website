import { getAll, put, remove, getSettings, setSettings, resolveMarkeSettings, STEUERARTEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextDailyNummer, toast, calcTotals, nimmDokumentVorbelegung, openDokumentMitVorbelegung } from '../utils.js';
import { openModal, confirmDelete, mountChipPicker } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { mountTextbausteinPicker } from '../textbausteine.js';
import { createBulkSelect } from '../bulkselect.js';
import { mountSignaturePad } from '../signature.js';
import { downloadCsv, exportDokumenteAlsPdf } from '../docexport.js';

const STATUS_LABEL = { entwurf: 'Entwurf', versendet: 'Versendet', bestaetigt: 'Bestätigt', storniert: 'Storniert' };
const STATUS_BADGE = { entwurf: 'badge', versendet: 'badge-accent', bestaetigt: 'badge-success', storniert: 'badge-danger' };
const GRUENDE_STORNO = [
  { id: 'kunde_storniert', titel: 'Kunde hat storniert' },
  { id: 'projekt_entfaellt', titel: 'Projekt entfällt' },
  { id: 'terminverschiebung', titel: 'Terminverschiebung führte zu Stornierung' },
  { id: 'fehler', titel: 'Fehlerhaft erstellt' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

export async function render(container, route) {
  let [dokumente, kunden, projekte, katalog, settings, vorlagen, textbausteine, angebote, marken] = await Promise.all([
    getAll('auftragsbestaetigungen'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('vorlagen'), getAll('textbausteine'), getAll('angebote'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  dokumente.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = dokumente;

  function exportOptsFor(a) {
    const kunde = kundenById[a.kundeId];
    const projekt = projekte.find((p) => p.id === a.projektId);
    return {
      settings: resolveMarkeSettings(settings, markenById[projekt?.markeId]), art: 'Auftragsbestätigung', nummer: a.nummer, datum: a.datum,
      kunde, betreff: a.betreff, projekt: projekt?.titel || '',
      introText: 'vielen Dank für Ihren Auftrag. Wir bestätigen hiermit folgende Leistungen:',
      positionen: a.positionen, totals: calcTotals(a.positionen),
      steuerHinweis: STEUERARTEN.find((s) => s.id === a.steuerart)?.hinweis || '',
      closingText: (a.notizen || '') + '\n\nWir freuen uns auf die Zusammenarbeit.',
      zeigeUnterschriftsfeld: true,
      unterschriftKunde: a.unterschriftKunde || null,
    };
  }
  function exportFilename(a) {
    return `Auftragsbestaetigung-${(a.nummer || a.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  }
  async function exportPdf(items, zipFilename) {
    if (items.length === 0) { toast('Keine Auftragsbestätigungen zum Exportieren', 'info'); return; }
    if (items.length > 1) toast(`${items.length} PDFs werden erstellt ...`, 'info');
    await exportDokumenteAlsPdf(items, { buildPdfBlob: (a) => buildDocPdfBlob(exportOptsFor(a)), filenameFor: exportFilename, zipFilename });
  }
  function exportCsv(items) {
    if (items.length === 0) { toast('Keine Auftragsbestätigungen zum Exportieren', 'info'); return; }
    const rows = [['Nummer', 'Kunde', 'Datum', 'Status', 'Netto', 'USt.', 'Brutto']];
    for (const a of items) {
      rows.push([a.nummer, kundenById[a.kundeId]?.firma || '', formatDate(a.datum), STATUS_LABEL[a.status] || a.status, a.netto, a.steuer, a.brutto]);
    }
    downloadCsv(rows, 'Auftragsbestaetigungen-Export.csv');
  }

  const bulk = createBulkSelect('auftragsbestaetigungen', {
    label: 'Auftragsbestätigungen',
    extraActions: [
      { id: 'bulk-export-pdf', label: '📄 Als PDF', onClick: (ids) => exportPdf(dokumente.filter((a) => ids.includes(a.id)), 'Auftragsbestaetigungen-Auswahl.zip') },
      { id: 'bulk-export-csv', label: '📊 Als CSV', onClick: (ids) => exportCsv(dokumente.filter((a) => ids.includes(a.id))) },
    ],
  });

  const kpiEntwurf = dokumente.filter((a) => a.status === 'entwurf');
  const kpiVersendet = dokumente.filter((a) => a.status === 'versendet');
  const kpiBestaetigt = dokumente.filter((a) => a.status === 'bestaetigt');
  const summeAb = (list) => list.reduce((s, a) => s + (a.brutto || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <h1>Auftragsbestätigungen</h1>
      <div class="actions">
        <button class="btn" id="btn-export-pdf-alle">📄 Alle als PDF</button>
        <button class="btn" id="btn-export-csv-alle">📊 Alle als CSV</button>
        <button class="btn btn-primary" id="btn-new">+ Neue Auftragsbestätigung</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card kpi-clickable" id="kpi-entwurf">
        <div class="kpi-value">${kpiEntwurf.length}</div>
        <div class="kpi-label">Entwurf · ${formatCurrency(summeAb(kpiEntwurf))}</div>
      </div>
      <div class="kpi-card kpi-clickable kpi-accent" id="kpi-versendet">
        <div class="kpi-value">${kpiVersendet.length}</div>
        <div class="kpi-label">Versendet · ${formatCurrency(summeAb(kpiVersendet))}</div>
      </div>
      <div class="kpi-card kpi-clickable kpi-success" id="kpi-bestaetigt">
        <div class="kpi-value">${kpiBestaetigt.length}</div>
        <div class="kpi-label">Bestätigt · ${formatCurrency(summeAb(kpiBestaetigt))}</div>
      </div>
      <div class="kpi-card kpi-clickable" id="kpi-alle">
        <div class="kpi-value">${dokumente.length}</div>
        <div class="kpi-label">Gesamt · ${formatCurrency(summeAb(dokumente))}</div>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Nummer oder Kunde ...">
      <select id="status-filter">
        <option value="">Alle Status</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const status = container.querySelector('#status-filter').value;
    filtered = dokumente.filter((a) => {
      if (status && a.status !== status) return false;
      if (!q) return true;
      return [a.nummer, kundenById[a.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Auftragsbestätigungen erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Datum</th><th>Status</th><th class="text-right">Brutto</th></tr></thead>
        <tbody>
          ${filtered.map((a) => `
            <tr data-id="${a.id}">
              ${bulk.rowCell(a.id)}
              <td>${escapeHtml(a.nummer)}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || '')}</td>
              <td>${formatDate(a.datum)}</td>
              <td><span class="badge ${STATUS_BADGE[a.status] || 'badge'}" ${a.status === 'storniert' && (a.stornoGrund || a.stornoGrundText) ? `title="${escapeHtml([GRUENDE_STORNO.find((g) => g.id === a.stornoGrund)?.titel, a.stornoGrundText].filter(Boolean).join(' – '))}"` : ''}>${STATUS_LABEL[a.status] || a.status}</span></td>
              <td class="text-right">${formatCurrency(a.brutto)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(dokumente.find((a) => a.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        dokumente = dokumente.filter((a) => !ids.includes(a.id));
        filtered = filtered.filter((a) => !ids.includes(a.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  function markActiveKpi() {
    const status = container.querySelector('#status-filter').value;
    const idByStatus = { entwurf: 'kpi-entwurf', versendet: 'kpi-versendet', bestaetigt: 'kpi-bestaetigt', '': 'kpi-alle' };
    container.querySelectorAll('.kpi-card').forEach((el) => el.classList.remove('kpi-active'));
    const active = container.querySelector(`#${idByStatus[status] || 'kpi-alle'}`);
    if (active) active.classList.add('kpi-active');
  }
  container.querySelector('#status-filter').addEventListener('change', () => { markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-entwurf').addEventListener('click', () => { container.querySelector('#status-filter').value = 'entwurf'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-versendet').addEventListener('click', () => { container.querySelector('#status-filter').value = 'versendet'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-bestaetigt').addEventListener('click', () => { container.querySelector('#status-filter').value = 'bestaetigt'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-alle').addEventListener('click', () => { container.querySelector('#status-filter').value = ''; markActiveKpi(); applyFilter(); });
  markActiveKpi();
  // Direktsprung auf eine einzelne Auftragsbestätigung, z.B. aus der Kunden-
  // akte/Projekt-Akte per #/auftragsbestaetigung/<id>.
  if (route) {
    const zielDoc = dokumente.find((a) => a.id === route);
    if (zielDoc) openForm(zielDoc);
  }
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export-pdf-alle').addEventListener('click', () => exportPdf(filtered, 'Auftragsbestaetigungen-Export.zip'));
  container.querySelector('#btn-export-csv-alle').addEventListener('click', () => exportCsv(filtered));

  // Kommt der Nutzer über den "+ Auftragsbestätigung"-Schnellknopf aus der
  // Projekt-Akte, liegt hier eine Vorbelegung bereit - Formular direkt
  // vorausgefüllt öffnen.
  const abVorbelegung = nimmDokumentVorbelegung();
  if (abVorbelegung) openForm(null, null, abVorbelegung);

  function openForm(a, ausAngebot, prefill) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), nummer: '', kundeId: ausAngebot?.kundeId || prefill?.kundeId || '', projektId: ausAngebot?.projektId || prefill?.projektId || '', datum: todayISO(),
      status: 'entwurf', betreff: ausAngebot?.betreff || '', notizen: ausAngebot?.notizen || '',
      positionen: ausAngebot ? ausAngebot.positionen.map((p) => ({ ...p, id: uid() })) : [],
      angebotId: ausAngebot?.id || '', createdAt: new Date().toISOString(),
      steuerart: ausAngebot?.steuerart || (settings.kleinunternehmer ? 'kleinunternehmer' : 'regel'),
      unterschriftKunde: '', stornoGrund: '', stornoGrundText: '',
    };

    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.auftragsbestaetigungPrefix, { datum: settings.auftragsbestaetigungNummerDatum, zaehler: settings.auftragsbestaetigungNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Auftragsbestätigung ${data.nummer}` : 'Neue Auftragsbestätigung',
      wide: true,
      bodyHtml: `
        <form id="ab-form">
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}"></div>
            <div class="field"><label>Kunde *</label><div id="f-kunde-host"></div></div>
            <div class="field"><label>Projekt</label><div id="f-projekt-host"></div></div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" placeholder="z.B. Auftragsbestätigung Elektroinstallation"></div>
            <div class="field col-span-2"><label>Steuerart</label>
              <select name="steuerart" id="f-steuerart">${STEUERARTEN.map((s) => `<option value="${s.id}" ${s.id === (data.steuerart || 'regel') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            ${isEdit ? `<div class="field"><label>Status</label>
              <select name="status" id="f-status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </div>
            <div class="col-span-2" id="storno-grund-section" ${data.status === 'storniert' ? '' : 'hidden'}>
              <div class="field">
                <label>Grund der Stornierung</label>
                <select name="stornoGrund">${GRUENDE_STORNO.map((g) => `<option value="${g.id}" ${g.id === data.stornoGrund ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}</select>
                <input type="text" name="stornoGrundText" value="${escapeHtml(data.stornoGrundText || '')}" placeholder="Notiz (optional)" style="margin-top:6px">
              </div>
            </div>` : ''}
          </div>
          <div class="divider"></div>
          <div id="pos-host"></div>
          <div id="tb-picker-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Unterschrift Kunde</h2>
          <p class="hint">Der Kunde kann direkt hier auf dem Bildschirm/Tablet unterschreiben. Beim Ausdrucken erscheint zusätzlich immer eine leere Unterschriftslinie zum handschriftlichen Unterschreiben.</p>
          <div id="sig-host"></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-to-rechnung">→ Rechnung erstellen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    mountChipPicker(body.querySelector('#f-kunde-host'), {
      name: 'kundeId', icon: '🏢', title: 'Kunde wählen', placeholder: '– Kunde wählen –',
      items: kunden, selectedId: data.kundeId,
      itemLabel: (k) => k.firma, itemSub: (k) => [k.plz, k.ort].filter(Boolean).join(' '),
    });
    mountChipPicker(body.querySelector('#f-projekt-host'), {
      name: 'projektId', icon: '🔧', title: 'Projekt wählen', placeholder: '– Projekt wählen –',
      items: projekte, selectedId: data.projektId,
      itemLabel: (p) => p.titel, itemSub: (p) => kundenById[p.kundeId]?.firma || '',
    });

    const editor = createPositionsEditor({
      host: body.querySelector('#pos-host'),
      katalog,
      positionen: data.positionen,
      defaultSteuersatz: settings.standardSteuersatz,
      vorlagen,
    });

    mountTextbausteinPicker(body.querySelector('#tb-picker-host'), {
      textbausteine, kategorie: 'angebot',
      onInsert: (text) => {
        const field = body.querySelector('textarea[name="notizen"]');
        field.value = field.value ? field.value + '\n\n' + text : text;
      },
    });

    const sigHost = body.querySelector('#sig-host');
    let sigPad = null;
    let sigDataUrl = data.unterschriftKunde || '';
    function renderSig() {
      if (sigDataUrl) {
        sigPad = null;
        sigHost.innerHTML = `
          <div class="field">
            <img src="${sigDataUrl}" alt="Unterschrift Kunde" style="max-width:260px;max-height:110px;border:1px solid var(--border);border-radius:6px;background:#fff;display:block">
            <button type="button" class="btn btn-sm" id="btn-sig-neu" style="margin-top:6px;align-self:flex-start">Neu unterschreiben</button>
          </div>
        `;
        sigHost.querySelector('#btn-sig-neu').addEventListener('click', () => { sigDataUrl = ''; renderSig(); });
      } else {
        sigPad = mountSignaturePad(sigHost, {});
      }
    }
    renderSig();

    if (isEdit) {
      body.querySelector('#f-status').addEventListener('change', (e) => {
        body.querySelector('#storno-grund-section').hidden = e.target.value !== 'storniert';
      });
    }

    body.querySelector('#f-steuerart').addEventListener('change', (e) => {
      if (e.target.value !== 'regel') {
        for (const p of editor.getPositionen()) p.steuersatz = 0;
        editor.refresh();
      }
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Auftragsbestätigung ${data.nummer} wirklich löschen?`)) return;
        await remove('auftragsbestaetigungen', data.id);
        toast('Auftragsbestätigung gelöscht');
        close();
        render(container);
      });
      function getEffectiveSettings() {
        const projekt = projekte.find((p) => p.id === data.projektId);
        return resolveMarkeSettings(settings, markenById[projekt?.markeId]);
      }
      function docOpts() {
        const totals = editor.getTotals();
        return {
          settings: getEffectiveSettings(), art: 'Auftragsbestätigung', nummer: data.nummer, datum: data.datum,
          kunde: kundenById[data.kundeId], betreff: data.betreff,
          projekt: projekte.find((p) => p.id === data.projektId)?.titel || '',
          introText: 'vielen Dank für Ihren Auftrag. Wir bestätigen hiermit folgende Leistungen:',
          positionen: editor.getPositionen(), totals,
          steuerHinweis: STEUERARTEN.find((s) => s.id === data.steuerart)?.hinweis || '',
          closingText: (data.notizen || '') + '\n\nWir freuen uns auf die Zusammenarbeit.',
          zeigeUnterschriftsfeld: true,
          unterschriftKunde: sigDataUrl || (sigPad && !sigPad.isEmpty() ? sigPad.getDataUrl() : null),
        };
      }
      body.querySelector('#btn-print').addEventListener('click', () => {
        printHtml(buildDocHtml(docOpts()), settings);
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Auftragsbestätigung ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unsere Auftragsbestätigung ${data.nummer}.\n\nMit freundlichen Grüßen\n${getEffectiveSettings().firmenname}`,
            filename: `Auftragsbestaetigung-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(docOpts()),
          });
        });
      }
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          sendDocumentViaWhatsApp({
            phone: kunde?.telefon,
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unsere Auftragsbestätigung ${data.nummer}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${getEffectiveSettings().firmenname}`,
            pdfBlob: await buildDocPdfBlob(docOpts()),
            filename: `Auftragsbestaetigung-${data.nummer}.pdf`,
          });
        });
      }
      const toRechnungBtn = body.querySelector('#btn-to-rechnung');
      if (toRechnungBtn) {
        // Öffnet die Rechnung NICHT mehr direkt fertig angelegt, sondern das
        // volle Rechnungsformular mit übernommenen Artikeln/Leistungen -
        // vorher gingen beim Direkt-Anlegen die "Abschlagszahlungen
        // berücksichtigen"-Auswahl (Schlussrechnung) und die Wahl
        // Rechnung/Abschlagsrechnung verloren, weil dieser Weg das Formular
        // komplett umging. So bleiben Artikel/Leistungen erhalten UND die
        // Abschlags-Verrechnung ist direkt nutzbar - kein doppeltes Erfassen mehr.
        toRechnungBtn.addEventListener('click', () => {
          close();
          openDokumentMitVorbelegung('rechnungen', {
            kundeId: data.kundeId, projektId: data.projektId, auftragsbestaetigungId: data.id,
            betreff: data.betreff, steuerart: data.steuerart || 'regel',
            positionen: editor.getPositionen().map((p) => ({ ...p, id: uid() })),
          });
        });
      }
    }

    body.querySelector('#ab-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.nummer = (fd.get('nummer') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.datum = fd.get('datum') || todayISO();
      updated.betreff = (fd.get('betreff') || '').toString().trim();
      updated.notizen = (fd.get('notizen') || '').toString().trim();
      updated.steuerart = fd.get('steuerart') || 'regel';
      if (isEdit) {
        updated.status = fd.get('status') || data.status;
        if (updated.status === 'storniert') {
          updated.stornoGrund = fd.get('stornoGrund') || '';
          updated.stornoGrundText = (fd.get('stornoGrundText') || '').toString().trim();
        } else {
          updated.stornoGrund = '';
          updated.stornoGrundText = '';
        }
      }
      if (!updated.kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }
      updated.unterschriftKunde = sigDataUrl || (sigPad && !sigPad.isEmpty() ? sigPad.getDataUrl() : '');

      if (updated.steuerart !== 'regel') {
        for (const p of editor.getPositionen()) p.steuersatz = 0;
      }
      updated.positionen = editor.getPositionen();
      const totals = calcTotals(updated.positionen);
      updated.netto = totals.netto;
      updated.steuer = totals.steuer;
      updated.brutto = totals.brutto;

      if (!isEdit) {
        const currentSettings = await getSettings();
        const { nummer: autoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
          currentSettings.auftragsbestaetigungPrefix, { datum: currentSettings.auftragsbestaetigungNummerDatum, zaehler: currentSettings.auftragsbestaetigungNummerZaehler }
        );
        if (!updated.nummer) updated.nummer = autoNummer;
        await setSettings({ auftragsbestaetigungNummerDatum: nDatum, auftragsbestaetigungNummerZaehler: nZaehler });
      }

      await put('auftragsbestaetigungen', updated);
      toast(isEdit ? 'Auftragsbestätigung aktualisiert' : 'Auftragsbestätigung angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
