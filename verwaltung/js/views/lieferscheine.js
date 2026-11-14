// Lieferschein: eigener, einfacherer Dokumenttyp neben Angebot/Auftrags-
// bestätigung/Rechnung (14.11.2026, auf Dannys Wunsch). Bewusst OHNE Preise
// auf dem Dokument selbst (docOpts().ohnePreise -> docpdf.js/pdf.js blenden
// die Preisspalten + den Summenblock aus) - ein Lieferschein weist aus, WAS
// geliefert wurde, der Preis steht auf der Rechnung. Die Positionen-Eingabe
// nutzt trotzdem denselben createPositionsEditor wie die anderen drei
// Dokumenttypen (zeigt beim Erfassen weiterhin Preisfelder an, die hier
// einfach ignoriert werden) - eine eigene, preisfreie Editor-Variante wäre
// mehr Aufwand gewesen, als der Nutzen dafür rechtfertigt.
import { getAll, put, remove, getSettings, setSettings, resolveMarkeSettings } from '../db.js';
import { uid, escapeHtml, formatDate, todayISO, nextDailyNummer, toast, nimmDokumentVorbelegung, openDokumentMitVorbelegung } from '../utils.js';
import { openModal, confirmDelete, mountChipPicker, openKundeSchnellanlage } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printDokument, buildDocHtml, mountDocPreviewToggle } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { createBulkSelect } from '../bulkselect.js';
import { mountSignaturePad } from '../signature.js';
import { downloadCsv, exportDokumenteAlsPdf } from '../docexport.js';

const STATUS_LABEL = { entwurf: 'Entwurf', versendet: 'Versendet', storniert: 'Storniert' };
const STATUS_BADGE = { entwurf: 'badge', versendet: 'badge-accent', storniert: 'badge-danger' };
const GRUENDE_STORNO = [
  { id: 'falsch_erfasst', titel: 'Falsch erfasst' },
  { id: 'lieferung_entfaellt', titel: 'Lieferung entfällt' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

export async function render(container, route) {
  let [dokumente, kunden, projekte, katalog, settings, vorlagen, marken] = await Promise.all([
    getAll('lieferscheine'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('vorlagen'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  dokumente.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = dokumente;

  function exportOptsFor(l) {
    const kunde = kundenById[l.kundeId];
    const projekt = projekte.find((p) => p.id === l.projektId);
    return {
      settings: resolveMarkeSettings(settings, markenById[projekt?.markeId]), art: 'Lieferschein', nummer: l.nummer, datum: l.datum,
      kunde, betreff: l.betreff, projekt: projekt?.titel || '',
      introText: 'hiermit liefern wir folgende Positionen:',
      positionen: l.positionen, ohnePreise: true,
      closingText: l.notizen || '',
      zeigeUnterschriftsfeld: true, zweiteUnterschriftLabel: 'Ware erhalten (Kunde)',
      unterschriftKunde: l.unterschriftKunde || null,
    };
  }
  function exportFilename(l) {
    return `Lieferschein-${(l.nummer || l.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  }
  async function exportPdf(items, zipFilename) {
    if (items.length === 0) { toast('Keine Lieferscheine zum Exportieren', 'info'); return; }
    if (items.length > 1) toast(`${items.length} PDFs werden erstellt ...`, 'info');
    await exportDokumenteAlsPdf(items, { buildPdfBlob: (l) => buildDocPdfBlob(exportOptsFor(l)), filenameFor: exportFilename, zipFilename });
  }
  function exportCsv(items) {
    if (items.length === 0) { toast('Keine Lieferscheine zum Exportieren', 'info'); return; }
    const rows = [['Nummer', 'Kunde', 'Datum', 'Status', 'Positionen']];
    for (const l of items) {
      rows.push([l.nummer, kundenById[l.kundeId]?.firma || '', formatDate(l.datum), STATUS_LABEL[l.status] || l.status, (l.positionen || []).length]);
    }
    downloadCsv(rows, 'Lieferscheine-Export.csv');
  }

  const bulk = createBulkSelect('lieferscheine', {
    label: 'Lieferscheine',
    extraActions: [
      { id: 'bulk-export-pdf', label: '📄 Als PDF', onClick: (ids) => exportPdf(dokumente.filter((l) => ids.includes(l.id)), 'Lieferscheine-Auswahl.zip') },
      { id: 'bulk-export-csv', label: '📊 Als CSV', onClick: (ids) => exportCsv(dokumente.filter((l) => ids.includes(l.id))) },
    ],
  });

  const kpiEntwurf = dokumente.filter((l) => l.status === 'entwurf');
  const kpiVersendet = dokumente.filter((l) => l.status === 'versendet');

  container.innerHTML = `
    <div class="view-header">
      <h1>Lieferscheine</h1>
      <div class="actions">
        <button class="btn" id="btn-export-pdf-alle">📄 Alle als PDF</button>
        <button class="btn" id="btn-export-csv-alle">📊 Alle als CSV</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Lieferschein</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card kpi-clickable" id="kpi-entwurf">
        <div class="kpi-value">${kpiEntwurf.length}</div>
        <div class="kpi-label">Entwurf</div>
      </div>
      <div class="kpi-card kpi-clickable kpi-accent" id="kpi-versendet">
        <div class="kpi-value">${kpiVersendet.length}</div>
        <div class="kpi-label">Versendet</div>
      </div>
      <div class="kpi-card kpi-clickable" id="kpi-alle">
        <div class="kpi-value">${dokumente.length}</div>
        <div class="kpi-label">Gesamt</div>
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
    filtered = dokumente.filter((l) => {
      if (status && l.status !== status) return false;
      if (!q) return true;
      return [l.nummer, kundenById[l.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Lieferscheine erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Datum</th><th>Status</th><th class="text-right">Positionen</th></tr></thead>
        <tbody>
          ${filtered.map((l) => `
            <tr data-id="${l.id}">
              ${bulk.rowCell(l.id)}
              <td>${escapeHtml(l.nummer)}</td>
              <td>${escapeHtml(kundenById[l.kundeId]?.firma || '')}</td>
              <td>${formatDate(l.datum)}</td>
              <td><span class="badge ${STATUS_BADGE[l.status] || 'badge'}" ${l.status === 'storniert' && (l.stornoGrund || l.stornoGrundText) ? `title="${escapeHtml([GRUENDE_STORNO.find((g) => g.id === l.stornoGrund)?.titel, l.stornoGrundText].filter(Boolean).join(' – '))}"` : ''}>${STATUS_LABEL[l.status] || l.status}</span></td>
              <td class="text-right">${(l.positionen || []).length}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(dokumente.find((l) => l.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        dokumente = dokumente.filter((l) => !ids.includes(l.id));
        filtered = filtered.filter((l) => !ids.includes(l.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  function markActiveKpi() {
    const status = container.querySelector('#status-filter').value;
    const idByStatus = { entwurf: 'kpi-entwurf', versendet: 'kpi-versendet', '': 'kpi-alle' };
    container.querySelectorAll('.kpi-card').forEach((el) => el.classList.remove('kpi-active'));
    const active = container.querySelector(`#${idByStatus[status] || 'kpi-alle'}`);
    if (active) active.classList.add('kpi-active');
  }
  container.querySelector('#status-filter').addEventListener('change', () => { markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-entwurf').addEventListener('click', () => { container.querySelector('#status-filter').value = 'entwurf'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-versendet').addEventListener('click', () => { container.querySelector('#status-filter').value = 'versendet'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-alle').addEventListener('click', () => { container.querySelector('#status-filter').value = ''; markActiveKpi(); applyFilter(); });
  markActiveKpi();
  // Direktsprung auf einen einzelnen Lieferschein, z.B. aus der Kunden-/
  // Projekt-Akte per #/lieferscheine/<id>.
  if (route) {
    const zielDoc = dokumente.find((l) => l.id === route);
    if (zielDoc) openForm(zielDoc);
  }
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export-pdf-alle').addEventListener('click', () => exportPdf(filtered, 'Lieferscheine-Export.zip'));
  container.querySelector('#btn-export-csv-alle').addEventListener('click', () => exportCsv(filtered));

  // Kommt der Nutzer über "→ Lieferschein erstellen" aus Angebot/
  // Auftragsbestätigung, liegt hier eine Vorbelegung bereit.
  const lsVorbelegung = nimmDokumentVorbelegung();
  if (lsVorbelegung) openForm(null, lsVorbelegung);

  function openForm(l, prefill) {
    const isEdit = !!l;
    const data = l || {
      id: uid(), nummer: '', kundeId: prefill?.kundeId || '', projektId: prefill?.projektId || '', datum: todayISO(),
      status: 'entwurf', betreff: prefill?.betreff || '', notizen: '',
      positionen: prefill?.positionen ? prefill.positionen.map((p) => ({ ...p, id: uid() })) : [],
      angebotId: prefill?.angebotId || '', auftragsbestaetigungId: prefill?.auftragsbestaetigungId || '',
      createdAt: new Date().toISOString(),
      unterschriftKunde: '', stornoGrund: '', stornoGrundText: '',
    };

    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.lieferscheinPrefix, { datum: settings.lieferscheinNummerDatum, zaehler: settings.lieferscheinNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Lieferschein ${data.nummer}` : 'Neuer Lieferschein',
      wide: true,
      fullscreen: true,
      bodyHtml: `
        <form id="ls-form">
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}"></div>
            <div class="field"><label>Kunde *</label><div id="f-kunde-host"></div></div>
            <div class="field"><label>Projekt</label><div id="f-projekt-host"></div></div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" placeholder="z.B. Materiallieferung Baustelle Musterstraße"></div>
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
          <p class="hint">Preise sind hier nur zur eigenen Kalkulation sichtbar - auf dem gedruckten/versendeten Lieferschein erscheinen ausschließlich Bezeichnung, Menge und Einheit, keine Preise.</p>
          <div id="pos-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Unterschrift: Ware erhalten (Kunde)</h2>
          <p class="hint">Der Kunde kann direkt hier auf dem Bildschirm/Tablet die erhaltene Ware bestätigen. Beim Ausdrucken erscheint zusätzlich immer eine leere Unterschriftslinie.</p>
          <div id="sig-host"></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    const kundePicker = mountChipPicker(body.querySelector('#f-kunde-host'), {
      name: 'kundeId', icon: '🏢', title: 'Kunde wählen', placeholder: '– Kunde wählen –',
      items: kunden, selectedId: data.kundeId,
      itemLabel: (k) => k.firma, itemSub: (k) => [k.plz, k.ort].filter(Boolean).join(' '),
      onCreateNew: () => new Promise((resolve) => {
        openKundeSchnellanlage({
          onCreated: (neuerKunde) => {
            kunden.push(neuerKunde);
            kundenById[neuerKunde.id] = neuerKunde;
            resolve(neuerKunde);
          },
        });
      }),
    });
    const projektPicker = mountChipPicker(body.querySelector('#f-projekt-host'), {
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

    if (isEdit) {
      body.querySelector('#f-status').addEventListener('change', (e) => {
        body.querySelector('#storno-grund-section').hidden = e.target.value !== 'storniert';
      });
    }

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

    function getEffectiveSettings(projektId) {
      const projekt = projekte.find((p) => p.id === projektId);
      return resolveMarkeSettings(settings, markenById[projekt?.markeId]);
    }
    function docOpts() {
      const notizenLive = body.querySelector('textarea[name="notizen"]')?.value ?? data.notizen ?? '';
      const kundeIdLive = kundePicker.getValue() || data.kundeId;
      const projektIdLive = projektPicker.getValue() || data.projektId;
      const betreffLive = body.querySelector('input[name="betreff"]')?.value ?? data.betreff ?? '';
      return {
        settings: getEffectiveSettings(projektIdLive), art: 'Lieferschein', nummer: data.nummer, datum: data.datum,
        kunde: kundenById[kundeIdLive], betreff: betreffLive,
        projekt: projekte.find((p) => p.id === projektIdLive)?.titel || '',
        introText: 'hiermit liefern wir folgende Positionen:',
        positionen: editor.getPositionen(), ohnePreise: true,
        closingText: notizenLive,
        zeigeUnterschriftsfeld: true, zweiteUnterschriftLabel: 'Ware erhalten (Kunde)',
        unterschriftKunde: sigDataUrl || (sigPad && !sigPad.isEmpty() ? sigPad.getDataUrl() : null),
      };
    }
    mountDocPreviewToggle({ body, getDocOpts: docOpts, settings, defaultView: settings.dokStandardansicht });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Lieferschein ${data.nummer} wirklich löschen?`)) return;
        await remove('lieferscheine', data.id);
        toast('Lieferschein gelöscht');
        close();
        render(container);
      });
      body.querySelector('#btn-print').addEventListener('click', () => {
        printDokument({ bodyHtml: buildDocHtml(docOpts()), settings, buildPdfBlob: () => buildDocPdfBlob(docOpts()) });
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Lieferschein ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unseren Lieferschein ${data.nummer}.\n\nMit freundlichen Grüßen\n${getEffectiveSettings(data.projektId).firmenname}`,
            filename: `Lieferschein-${data.nummer}.pdf`,
            zeigeAgbOptionen: true,
            kundeIstPrivatperson: !!kunde?.istPrivatperson,
            projektId: data.projektId || '',
            buildPdfBlob: (anhaenge) => buildDocPdfBlob({ ...docOpts(), anhaenge }),
          });
        });
      }
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          sendDocumentViaWhatsApp({
            phone: kunde?.telefon,
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unser Lieferschein ${data.nummer}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${getEffectiveSettings(data.projektId).firmenname}`,
            pdfBlob: await buildDocPdfBlob(docOpts()),
            filename: `Lieferschein-${data.nummer}.pdf`,
          });
        });
      }
    }

    body.querySelector('#ls-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.nummer = (fd.get('nummer') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.datum = fd.get('datum') || todayISO();
      updated.betreff = (fd.get('betreff') || '').toString().trim();
      updated.notizen = (fd.get('notizen') || '').toString().trim();
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
      updated.positionen = editor.getPositionen();

      if (!isEdit) {
        const currentSettings = await getSettings();
        const { nummer: autoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
          currentSettings.lieferscheinPrefix, { datum: currentSettings.lieferscheinNummerDatum, zaehler: currentSettings.lieferscheinNummerZaehler }
        );
        if (!updated.nummer) updated.nummer = autoNummer;
        await setSettings({ lieferscheinNummerDatum: nDatum, lieferscheinNummerZaehler: nZaehler });
      }

      await put('lieferscheine', updated);
      toast(isEdit ? 'Lieferschein aktualisiert' : 'Lieferschein angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
