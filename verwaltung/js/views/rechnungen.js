import { getAll, put, remove, getSettings, setSettings, resolveMarkeSettings, STEUERARTEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextDailyNummer, toast, calcTotals, nimmDokumentVorbelegung, excelFileToCsvText } from '../utils.js';
import { openModal, confirmDelete, mountChipPicker } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printDokument, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { buildXRechnungBlob, xRechnungFilename } from '../xrechnung.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { generateAngebotFromStichpunkte } from '../ai.js';
import { mountTextbausteinPicker } from '../textbausteine.js';
import { createBulkSelect } from '../bulkselect.js';
import { mountSignaturePad } from '../signature.js';
import * as lexoffice from '../lexoffice.js';
import { downloadCsv, exportDokumenteAlsPdf } from '../docexport.js';
import * as journal from '../journal.js';

const STATUS_LABEL = { offen: 'Offen', teilbezahlt: 'Teilbezahlt', bezahlt: 'Bezahlt', storniert: 'Storniert' };
const STATUS_BADGE = { offen: 'badge-warn', teilbezahlt: 'badge-accent', bezahlt: 'badge-success', storniert: 'badge-danger' };
const RECHNUNGSTYP_LABEL = { rechnung: 'Rechnung', abschlag: 'Abschlagsrechnung' };
const ZAHLUNGSARTEN = [
  { id: 'ueberweisung', titel: 'Überweisung' },
  { id: 'bar', titel: 'Barzahlung' },
  { id: 'ec', titel: 'EC-/Kartenzahlung' },
  { id: 'sonstige', titel: 'Sonstige' },
];
const GRUENDE_STORNO = [
  { id: 'fehler', titel: 'Fehler in der Rechnung' },
  { id: 'auftrag_storniert', titel: 'Auftrag durch Kunden storniert' },
  { id: 'doppelt', titel: 'Doppelt erstellt' },
  { id: 'korrektur', titel: 'Preis-/Positionskorrektur nötig' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

function normalizeRechnungStatus(text) {
  const t = (text || '').trim().toLowerCase();
  if (['teilbezahlt', 'partial'].includes(t)) return 'teilbezahlt';
  if (['bezahlt', 'paid', 'bezahlt.'].includes(t)) return 'bezahlt';
  if (['storniert', 'cancelled', 'storno'].includes(t)) return 'storniert';
  return 'offen';
}

// Bulk-Import ganzer Rechnungen für die Migration bestehender Rechnungslisten
// aus Excel - analog zum Angebote-Import. Importierte Rechnungen bleiben
// bewusst unversendet (versendet:false), damit sie nicht sofort GoBD-gesperrt
// sind und sich Fehler noch korrigieren lassen; die Rechnungsnummer selbst
// wird trotzdem auf Eindeutigkeit geprüft, da GoBD lückenlose, eindeutige
// Nummern verlangt. Der Kunde muss bereits existieren (kein automatisches
// Anlegen, um keine Dubletten durch Tippfehler zu erzeugen).
function parseRechnungenCsv(text, kunden, defaultSteuersatz) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^kunde(nname)?$/i.test(cols[0] || '')) continue;
    const [kundenname, datum, faelligAm, betreff, nettoRaw, ustRaw, statusRaw, nummer, bezahltAm] = cols;
    if (!kundenname) { errors.push(`${line} (kein Kundenname)`); continue; }
    const kunde = kunden.find((k) => (k.firma || '').trim().toLowerCase() === kundenname.trim().toLowerCase());
    if (!kunde) { errors.push(`${line} (Kunde "${kundenname}" nicht gefunden - erst in Werkora anlegen)`); continue; }
    const netto = Number(String(nettoRaw || '0').replace(/\./g, '').replace(',', '.')) || 0;
    rows.push({
      kundeId: kunde.id, datum: datum || todayISO(), faelligAm: faelligAm || '', betreff: betreff || '',
      netto, steuersatz: ustRaw ? Number(String(ustRaw).replace(',', '.')) || defaultSteuersatz : defaultSteuersatz,
      status: normalizeRechnungStatus(statusRaw), nummer: nummer || '', bezahltAm: bezahltAm || '',
    });
  }
  return { rows, errors };
}

function openStornoGrundDialog(nummer, onConfirm) {
  const { body: dBody, close: dClose } = openModal({
    title: `Rechnung ${nummer} stornieren`,
    bodyHtml: `
      <form id="storno-grund-form">
        <p class="hint">Die Positionen werden mit negativem Betrag als neue, eigenständige Stornorechnung angelegt.</p>
        <div class="field"><label>Grund der Stornierung</label>
          <select name="stornoGrund">${GRUENDE_STORNO.map((g) => `<option value="${g.id}">${escapeHtml(g.titel)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Notiz (optional)</label><input type="text" name="stornoGrundText"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="btn-storno-abbrechen">Abbrechen</button>
          <button type="submit" class="btn btn-danger">Stornorechnung erstellen</button>
        </div>
      </form>
    `,
  });
  dBody.querySelector('#btn-storno-abbrechen').addEventListener('click', dClose);
  dBody.querySelector('#storno-grund-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const grund = fd.get('stornoGrund') || '';
    const grundText = (fd.get('stornoGrundText') || '').toString().trim();
    dClose();
    onConfirm(grund, grundText);
  });
}

export async function render(container, route) {
  let [rechnungen, kunden, projekte, katalog, settings, zeiterfassung, vorlagen, textbausteine, marken] = await Promise.all([
    getAll('rechnungen'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('zeiterfassung'), getAll('vorlagen'), getAll('textbausteine'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  rechnungen.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = rechnungen;
  const today = todayISO();

  // Buchungssatz-Sync ist ein Komfort-Feature (doppelte Buchführung in der
  // Buchhaltung-Seite) - ein Fehler dabei darf das eigentliche Speichern der
  // Rechnung nie verhindern.
  async function syncBuchung(r) {
    try { await journal.syncBuchungFuerRechnung(r, settings); } catch { /* siehe oben */ }
  }

  function exportOptsFor(r) {
    const istAbschlag = r.rechnungstyp === 'abschlag';
    const kunde = kundenById[r.kundeId];
    const projekt = projekte.find((p) => p.id === r.projektId);
    const istBar = r.zahlungsart === 'bar';
    const totals = calcTotals(r.positionen);
    return {
      settings: resolveMarkeSettings(settings, markenById[projekt?.markeId]), art: istAbschlag ? 'Abschlagsrechnung' : 'Rechnung', nummer: r.nummer, datum: r.datum,
      leistungsdatum: r.leistungsdatum || r.datum,
      refLabel: 'Zahlbar bis', refValue: formatDate(r.faelligAm),
      kunde, betreff: r.betreff, projekt: projekt?.titel || '',
      introText: 'wir bedanken uns für Ihren Auftrag und stellen Ihnen wie folgt in Rechnung:',
      positionen: r.positionen, totals,
      steuerHinweis: STEUERARTEN.find((s) => s.id === r.steuerart)?.hinweis || '',
      aufbewahrungsHinweis: kunde?.istPrivatperson
        ? 'Hinweis gemäß § 14 Abs. 4 Nr. 9 UStG: Als Privatperson sind Sie verpflichtet, diese Rechnung sowie zugehörige Zahlungsbelege im Zusammenhang mit dieser Werklieferung/Leistung 2 Jahre lang aufzubewahren.'
        : '',
      closingText: (r.notizen || '') +
        (r.skontoProzent > 0
          ? `\n\nBei Zahlung bis zum ${formatDate(addDays(r.datum, r.skontoTage || 0))} (${r.skontoTage || 0} Tage) gewähren wir ${r.skontoProzent}% Skonto (Skontobetrag: ${formatCurrency(Math.round(totals.brutto * r.skontoProzent) / 100)}).`
          : '') +
        `\n\nBitte überweisen Sie den Rechnungsbetrag bis zum ${formatDate(r.faelligAm)} auf unser unten genanntes Konto.`,
      abschlaege: !istAbschlag && r.verrechneteAbschlaege?.length ? r.verrechneteAbschlaege : undefined,
      faelligAm: r.faelligAm, steuerart: r.steuerart || 'regel',
      zeigeUnterschriftsfeld: istBar,
      unterschriftKunde: r.unterschriftKunde || null,
      zeigeZweiteUnterschrift: istBar,
      unterschriftMitarbeiter: r.unterschriftMitarbeiter || null,
      zweiteUnterschriftLabel: 'Unterschrift Mitarbeiter',
    };
  }
  function exportFilename(r) {
    return `${r.rechnungstyp === 'abschlag' ? 'Abschlagsrechnung' : 'Rechnung'}-${(r.nummer || r.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  }
  async function exportPdf(items, zipFilename) {
    if (items.length === 0) { toast('Keine Rechnungen zum Exportieren', 'info'); return; }
    if (items.length > 1) toast(`${items.length} PDFs werden erstellt ...`, 'info');
    await exportDokumenteAlsPdf(items, { buildPdfBlob: (r) => buildDocPdfBlob(exportOptsFor(r)), filenameFor: exportFilename, zipFilename });
  }
  function exportCsv(items) {
    if (items.length === 0) { toast('Keine Rechnungen zum Exportieren', 'info'); return; }
    const rows = [['Nummer', 'Kunde', 'Rechnungsart', 'Datum', 'Fällig am', 'Status', 'Zahlungsart', 'Netto', 'USt.', 'Brutto']];
    for (const r of items) {
      rows.push([r.nummer, kundenById[r.kundeId]?.firma || '', RECHNUNGSTYP_LABEL[r.rechnungstyp] || 'Rechnung', formatDate(r.datum), formatDate(r.faelligAm), STATUS_LABEL[r.status] || r.status, ZAHLUNGSARTEN.find((z) => z.id === r.zahlungsart)?.titel || '', r.netto, r.steuer, r.brutto]);
    }
    downloadCsv(rows, 'Rechnungen-Export.csv');
  }

  const bulk = createBulkSelect('rechnungen', {
    label: 'Rechnungen',
    deleteFn: async (id) => {
      await remove('rechnungen', id);
      const r = rechnungen.find((x) => x.id === id);
      if (r) await syncBuchung({ ...r, status: 'geloescht' });
    },
    extraActions: [
      { id: 'bulk-export-pdf', label: '📄 Als PDF', onClick: (ids) => exportPdf(rechnungen.filter((r) => ids.includes(r.id)), 'Rechnungen-Auswahl.zip') },
      { id: 'bulk-export-csv', label: '📊 Als CSV', onClick: (ids) => exportCsv(rechnungen.filter((r) => ids.includes(r.id))) },
    ],
  });

  const nichtStorniert = rechnungen.filter((r) => r.status !== 'storniert');
  const kpiOffen = nichtStorniert.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt');
  const kpiUeberfaellig = kpiOffen.filter((r) => r.faelligAm && r.faelligAm < today);
  const kpiBezahlt = nichtStorniert.filter((r) => r.status === 'bezahlt');
  const summe = (list) => list.reduce((s, r) => s + (r.brutto || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <h1>Rechnungen</h1>
      <div class="actions">
        <button class="btn" id="btn-import">⇪ Rechnungen importieren</button>
        <button class="btn" id="btn-export-pdf-alle">📄 Alle als PDF</button>
        <button class="btn" id="btn-export-csv-alle">📊 Alle als CSV</button>
        <button class="btn btn-primary" id="btn-new">+ Neue Rechnung</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card kpi-clickable kpi-accent" id="kpi-offen">
        <div class="kpi-value">${formatCurrency(summe(kpiOffen))}</div>
        <div class="kpi-label">Offen · ${kpiOffen.length} Rechnung(en)</div>
      </div>
      <div class="kpi-card kpi-clickable kpi-danger" id="kpi-ueberfaellig">
        <div class="kpi-value">${formatCurrency(summe(kpiUeberfaellig))}</div>
        <div class="kpi-label">Überfällig · ${kpiUeberfaellig.length} Rechnung(en)</div>
      </div>
      <div class="kpi-card kpi-clickable kpi-success" id="kpi-bezahlt">
        <div class="kpi-value">${formatCurrency(summe(kpiBezahlt))}</div>
        <div class="kpi-label">Bezahlt · ${kpiBezahlt.length} Rechnung(en)</div>
      </div>
      <div class="kpi-card kpi-clickable" id="kpi-alle">
        <div class="kpi-value">${formatCurrency(summe(nichtStorniert))}</div>
        <div class="kpi-label">Gesamt · ${nichtStorniert.length} Rechnung(en)</div>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Nummer oder Kunde ...">
      <select id="status-filter">
        <option value="">Alle Status</option>
        <option value="offen-alle">Offen (inkl. teilbezahlt)</option>
        <option value="ueberfaellig">Überfällig</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const status = container.querySelector('#status-filter').value;
    filtered = rechnungen.filter((r) => {
      const istOffen = r.status === 'offen' || r.status === 'teilbezahlt';
      if (status === 'offen-alle' && !istOffen) return false;
      else if (status === 'ueberfaellig' && !(istOffen && r.faelligAm && r.faelligAm < today)) return false;
      else if (status && status !== 'offen-alle' && status !== 'ueberfaellig' && r.status !== status) return false;
      if (!q) return true;
      return [r.nummer, kundenById[r.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Rechnungen erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Typ</th><th>Datum</th><th>Fällig am</th><th>Status</th><th class="text-right">Brutto</th></tr></thead>
        <tbody>
          ${filtered.map((r) => {
            const overdue = (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < today;
            const abschlagsSumme = (r.verrechneteAbschlaege || []).reduce((s, a) => s + (a.betrag || 0), 0);
            return `
            <tr data-id="${r.id}">
              ${bulk.rowCell(r.id, !!r.versendet)}
              <td>${escapeHtml(r.nummer)}</td>
              <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
              <td><span class="badge ${r.rechnungstyp === 'abschlag' ? 'badge-warn' : ''}">${escapeHtml(RECHNUNGSTYP_LABEL[r.rechnungstyp] || 'Rechnung')}</span>${r.verrechnetIn ? `<div class="text-mute" style="font-size:11px">verrechnet in ${escapeHtml(r.verrechnetIn)}</div>` : ''}</td>
              <td>${formatDate(r.datum)}</td>
              <td>${formatDate(r.faelligAm)}</td>
              <td>
                <span class="badge ${STATUS_BADGE[r.status] || 'badge'}" ${r.stornoVonNummer && (r.stornoGrund || r.stornoGrundText) ? `title="${escapeHtml([GRUENDE_STORNO.find((g) => g.id === r.stornoGrund)?.titel, r.stornoGrundText].filter(Boolean).join(' – '))}"` : ''}>${STATUS_LABEL[r.status] || r.status}</span>
                ${overdue ? '<span class="badge badge-danger">überfällig</span>' : ''}
              </td>
              <td class="text-right">${formatCurrency(r.brutto)}${abschlagsSumme ? `<div class="text-mute" style="font-size:11px">Rest: ${formatCurrency(r.brutto - abschlagsSumme)}</div>` : ''}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
      <div class="tt-card-list">
        ${filtered.map((r) => {
          const overdue = (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < today;
          return `
            <div class="tt-card" data-id="${r.id}">
              <div class="tt-card-top">
                <span class="tt-card-meta">${formatDate(r.datum)}</span>
                <span class="badge ${overdue ? 'badge-danger' : (STATUS_BADGE[r.status] || 'badge')}">${overdue ? 'Überfällig' : (STATUS_LABEL[r.status] || r.status)}</span>
              </div>
              <div class="tt-card-title-row"><span>${escapeHtml(r.nummer)} – ${escapeHtml(RECHNUNGSTYP_LABEL[r.rechnungstyp] || 'Rechnung')}</span></div>
              <div class="tt-card-bottom">
                <span class="tt-card-sub"><span class="tt-card-icon" style="width:18px;height:18px;font-size:10px;vertical-align:-4px;margin-right:5px">🏢</span>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</span>
                <span class="tt-card-amount">${formatCurrency(r.brutto)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    tableHost.querySelectorAll('tbody tr, .tt-card').forEach((row) => {
      row.addEventListener('click', () => openForm(rechnungen.find((r) => r.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        rechnungen = rechnungen.filter((r) => !ids.includes(r.id));
        filtered = filtered.filter((r) => !ids.includes(r.id));
        renderTable();
      },
    });
  }

  function pickLexofficeContact(contacts, firma) {
    return new Promise((resolve) => {
      const { body, close } = openModal({
        title: `lexoffice-Kontakt für "${firma}" wählen`,
        bodyHtml: `
          <p class="hint">Es gibt mehrere passende Kontakte in lexoffice. Bitte den richtigen wählen.</p>
          <div class="cal-event-list">
            ${contacts.map((c) => `
              <button type="button" class="btn" style="display:block;width:100%;text-align:left;margin-bottom:6px" data-id="${escapeHtml(c.id)}">
                ${escapeHtml(c.company?.name || [c.person?.firstName, c.person?.lastName].filter(Boolean).join(' ') || c.id)}
              </button>
            `).join('')}
          </div>
          <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" id="btn-cancel">Abbrechen</button></div>
        `,
      });
      body.querySelectorAll('button[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => { close(); resolve(btn.dataset.id); });
      });
      body.querySelector('#btn-cancel').addEventListener('click', () => { close(); resolve(null); });
    });
  }

  /**
   * Überträgt eine bereits im Programm erstellte Rechnung (mit eigenen Preisen)
   * als Rechnungsentwurf nach lexoffice - unabhängig vom Zeiterfassung/
   * Verwendungen-Export in der Projekt-Akte, der eigene lexoffice-Artikel
   * voraussetzt. Hier gehen die Positionen als "custom"-Zeilen mit dem hier
   * gepflegten Preis direkt mit, kein lexoffice-Artikelabgleich nötig.
   */
  async function uebertrageAnLexoffice(rechnung) {
    if (!(await lexoffice.isConfigured())) {
      toast('Bitte zuerst in den Einstellungen den lexoffice-API-Key hinterlegen.', 'danger');
      return;
    }
    const kunde = kundenById[rechnung.kundeId];
    if (!kunde) { toast('Dieser Rechnung ist kein Kunde zugewiesen.', 'danger'); return; }
    if (!rechnung.positionen || rechnung.positionen.length === 0) {
      toast('Diese Rechnung hat keine Positionen.', 'danger');
      return;
    }

    let contactId = kunde.lexofficeContactId;
    if (!contactId) {
      let contacts;
      try {
        contacts = await lexoffice.searchContacts(kunde.firma);
      } catch (err) {
        toast(err.message, 'danger');
        return;
      }
      if (contacts.length === 1) {
        contactId = contacts[0].id;
      } else if (contacts.length === 0) {
        toast(`Kein lexoffice-Kontakt für "${kunde.firma}" gefunden. Bitte in lexoffice anlegen.`, 'danger');
        return;
      } else {
        contactId = await pickLexofficeContact(contacts, kunde.firma);
        if (!contactId) return;
      }
      const updatedKunde = { ...kunde, lexofficeContactId: contactId };
      await put('kunden', updatedKunde);
      kundenById[kunde.id] = updatedKunde;
    }

    const lineItems = rechnung.positionen.filter((p) => p.typ !== 'ueberschrift').map((p) => ({
      type: 'custom',
      name: p.bezeichnung || 'Position',
      description: p.beschreibung || undefined,
      quantity: Number(p.menge) || 0,
      unitName: p.einheit || 'Stück',
      unitPrice: { currency: 'EUR', netAmount: Number(p.einzelpreis) || 0, taxRatePercentage: Number(p.steuersatz) || 0 },
    }));

    try {
      const result = await lexoffice.createInvoiceDraft({
        contactId, lineItems, remark: rechnung.betreff || `Rechnung ${rechnung.nummer}`,
      });
      const persisted = { ...rechnung, lexofficeId: result.id, lexofficeExportedAt: new Date().toISOString() };
      await put('rechnungen', persisted);
      await syncBuchung(persisted);
      Object.assign(rechnung, persisted);
      toast('Rechnungsentwurf in lexoffice erstellt.', 'success');
      if (result?.id) window.open(`https://app.lexoffice.io/rechnungen/edit/${result.id}`, '_blank', 'noopener');
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  function markActiveKpi() {
    const status = container.querySelector('#status-filter').value;
    const idByStatus = { 'offen-alle': 'kpi-offen', ueberfaellig: 'kpi-ueberfaellig', bezahlt: 'kpi-bezahlt', '': 'kpi-alle' };
    container.querySelectorAll('.kpi-card').forEach((el) => el.classList.remove('kpi-active'));
    const active = container.querySelector(`#${idByStatus[status] || 'kpi-alle'}`);
    if (active) active.classList.add('kpi-active');
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#status-filter').addEventListener('change', () => { markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-offen').addEventListener('click', () => { container.querySelector('#status-filter').value = 'offen-alle'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-ueberfaellig').addEventListener('click', () => { container.querySelector('#status-filter').value = 'ueberfaellig'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-bezahlt').addEventListener('click', () => { container.querySelector('#status-filter').value = 'bezahlt'; markActiveKpi(); applyFilter(); });
  container.querySelector('#kpi-alle').addEventListener('click', () => { container.querySelector('#status-filter').value = ''; markActiveKpi(); applyFilter(); });
  // Direktsprung von den Dashboard-Kacheln ("Offene Rechnungen"/"Überfällig")
  // per #/rechnungen/offen bzw. #/rechnungen/ueberfaellig - Filter direkt
  // vorbelegen, damit die Liste sofort das zeigt, was auf der Kachel stand.
  if (route === 'offen' || route === 'ueberfaellig') container.querySelector('#status-filter').value = route === 'offen' ? 'offen-alle' : 'ueberfaellig';
  markActiveKpi();
  // Direktsprung auf eine einzelne Rechnung, z.B. aus der Kundenakte/Projekt-
  // Akte per #/rechnungen/<id> - öffnet das Formular sofort statt nur die Liste.
  if (route && route !== 'offen' && route !== 'ueberfaellig') {
    const zielRechnung = rechnungen.find((r) => r.id === route);
    if (zielRechnung) openForm(zielRechnung);
  }
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export-pdf-alle').addEventListener('click', () => exportPdf(filtered, 'Rechnungen-Export.zip'));
  container.querySelector('#btn-export-csv-alle').addEventListener('click', () => exportCsv(filtered));
  container.querySelector('#btn-import').addEventListener('click', () => openRechnungenImport());

  function openRechnungenImport() {
    const { body, close } = openModal({
      title: 'Rechnungen importieren',
      wide: true,
      bodyHtml: `
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>Kundenname;Rechnungsdatum (JJJJ-MM-TT);Fällig am (JJJJ-MM-TT);Betreff;Nettobetrag;USt-Satz;Status;Rechnungsnummer;Bezahlt am (JJJJ-MM-TT)</code> – nur Kundenname ist Pflicht, alles andere optional. Der Kunde muss bereits als Kunde in Werkora existieren (Name muss exakt übereinstimmen). Je Zeile wird eine Rechnung mit einer einzelnen Pauschalposition angelegt - für Rechnungen mit mehreren Einzelpositionen bitte stattdessen einzeln anlegen und dort "aus CSV/Excel importieren" bei den Positionen nutzen. Ohne Rechnungsnummer wird automatisch fortlaufend nummeriert; eine angegebene Nummer wird auf Eindeutigkeit geprüft (GoBD). Importierte Rechnungen bleiben unversendet/bearbeitbar. Status: offen/teilbezahlt/bezahlt/storniert (ohne Angabe: offen). Eine optionale Kopfzeile wird erkannt.</p>
        <div class="field" style="margin-bottom:10px">
          <label>CSV- oder Excel-Datei</label>
          <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </div>
        <div class="field">
          <label>oder CSV-Text einfügen</label>
          <textarea id="import-text" style="min-height:160px;font-family:monospace" placeholder="Mustermann GmbH;2026-01-15;2026-01-29;Elektroinstallation Neubau;4500;19;offen;;"></textarea>
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
      const { rows, errors } = parseRechnungenCsv(text, kunden, settings.standardSteuersatz);
      // GoBD verlangt eindeutige Rechnungsnummern - vorgegebene Nummern hier
      // gegen bestehende UND bereits in dieser Import-Charge verwendete Nummern
      // prüfen, statt sie stillschweigend zu duplizieren.
      const belegteNummern = new Set(rechnungen.map((r) => (r.nummer || '').trim().toLowerCase()));
      const gueltigeRows = [];
      for (const row of rows) {
        if (row.nummer && belegteNummern.has(row.nummer.trim().toLowerCase())) {
          errors.push(`Rechnungsnummer "${row.nummer}" ist bereits vergeben - Zeile übersprungen.`);
          continue;
        }
        if (row.nummer) belegteNummern.add(row.nummer.trim().toLowerCase());
        gueltigeRows.push(row);
      }
      if (gueltigeRows.length === 0) {
        body.querySelector('#import-preview').textContent = errors.length
          ? `Keine gültigen Zeilen gefunden:\n${errors.join('\n')}`
          : 'Keine gültigen Zeilen gefunden.';
        return;
      }
      let currentSettings = await getSettings();
      for (const row of gueltigeRows) {
        const positionen = [{
          id: uid(), bezeichnung: row.betreff || 'Pauschalposition', beschreibung: '',
          einheit: 'Psch.', menge: 1, einzelpreis: row.netto, steuersatz: row.steuersatz,
        }];
        const totals = calcTotals(positionen);
        let nummer = row.nummer;
        if (!nummer) {
          const next = nextDailyNummer(currentSettings.rechnungPrefix, { datum: currentSettings.rechnungNummerDatum, zaehler: currentSettings.rechnungNummerZaehler });
          nummer = next.nummer;
          currentSettings = { ...currentSettings, rechnungNummerDatum: next.datum, rechnungNummerZaehler: next.zaehler };
        }
        const rechnung = {
          id: uid(), nummer, kundeId: row.kundeId, projektId: '', angebotId: null, auftragsbestaetigungId: null,
          datum: row.datum, leistungsdatum: row.datum, faelligAm: row.faelligAm || addDays(row.datum, settings.zahlungszielTage || 14),
          status: row.status, betreff: row.betreff, notizen: '', positionen, bezahltAm: row.status === 'bezahlt' ? (row.bezahltAm || row.datum) : '',
          createdAt: new Date().toISOString(), versendet: false, versendetAm: '', stornoVonNummer: '', storniertDurchNummer: '',
          steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel', rechnungstyp: 'rechnung',
          verrechneteAbschlaege: [], verrechnetIn: '', skontoProzent: settings.skontoProzentStandard || 0, skontoTage: settings.skontoTageStandard || 0,
          zahlungsart: 'ueberweisung', unterschriftKunde: '', unterschriftMitarbeiter: '',
          netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto,
        };
        await put('rechnungen', rechnung);
        await syncBuchung(rechnung);
        rechnungen.push(rechnung);
      }
      await setSettings({ rechnungNummerDatum: currentSettings.rechnungNummerDatum, rechnungNummerZaehler: currentSettings.rechnungNummerZaehler });
      toast(`${gueltigeRows.length} Rechnung(en) importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen` : ''}`, 'success');
      close();
      applyFilter();
    });
  }

  // Kommt der Nutzer über den "+ Rechnung"-Schnellknopf aus der Projekt-Akte,
  // liegt hier eine Vorbelegung bereit - Formular direkt vorausgefüllt öffnen.
  const rechnungVorbelegung = nimmDokumentVorbelegung();
  if (rechnungVorbelegung) openForm(null, rechnungVorbelegung);

  function openForm(r, prefill) {
    const isEdit = !!r;
    const data = r || {
      id: uid(), nummer: '', kundeId: prefill?.kundeId || '', projektId: prefill?.projektId || '', angebotId: prefill?.angebotId || null, auftragsbestaetigungId: prefill?.auftragsbestaetigungId || null, datum: todayISO(), leistungsdatum: todayISO(),
      faelligAm: addDays(todayISO(), settings.zahlungszielTage || 14),
      status: 'offen', betreff: prefill?.betreff || '', notizen: '', positionen: prefill?.positionen || [], bezahltAm: '', createdAt: new Date().toISOString(),
      versendet: false, versendetAm: '', stornoVonNummer: '', storniertDurchNummer: '',
      steuerart: prefill?.steuerart || (settings.kleinunternehmer ? 'kleinunternehmer' : 'regel'),
      rechnungstyp: 'rechnung', verrechneteAbschlaege: [], verrechnetIn: '',
      skontoProzent: settings.skontoProzentStandard || 0, skontoTage: settings.skontoTageStandard || 0,
      zahlungsart: 'ueberweisung', unterschriftKunde: '', unterschriftMitarbeiter: '',
    };
    const locked = isEdit && !!data.versendet;
    const abschlaegeChecked = new Set((data.verrechneteAbschlaege || []).map((a) => a.rechnungId));
    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.rechnungPrefix, { datum: settings.rechnungNummerDatum, zaehler: settings.rechnungNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Rechnung ${data.nummer}` : 'Neue Rechnung',
      wide: true,
      bodyHtml: `
        <form id="re-form">
          ${locked ? `<p class="hint">🔒 Versendet am ${formatDate(data.versendetAm)} – gesperrt (GoBD). ${data.stornoVonNummer ? `Stornorechnung zu ${escapeHtml(data.stornoVonNummer)}.` : ''} ${data.stornoVonNummer && (data.stornoGrund || data.stornoGrundText) ? `Grund: ${escapeHtml([GRUENDE_STORNO.find((g) => g.id === data.stornoGrund)?.titel, data.stornoGrundText].filter(Boolean).join(' – '))}.` : ''} ${data.storniertDurchNummer ? `Storniert durch ${escapeHtml(data.storniertDurchNummer)}.` : ''}</p>` : ''}
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Kunde *</label><div id="f-kunde-host"></div></div>
            <div class="field"><label>Projekt</label><div id="f-projekt-host"></div></div>
            <div class="field"><label>Rechnungsdatum</label><input type="date" name="datum" value="${data.datum}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Leistungsdatum</label><input type="date" name="leistungsdatum" value="${data.leistungsdatum || data.datum}" ${locked ? 'disabled' : ''}><span class="hint mb-0">Datum der Leistungserbringung/Lieferung (Pflichtangabe nach § 14 Abs. 4 Nr. 6 UStG) – kann vom Rechnungsdatum abweichen.</span></div>
            <div class="field"><label>Fällig am</label><input type="date" name="faelligAm" value="${data.faelligAm}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Skonto (%)</label><input type="number" step="0.1" min="0" name="skontoProzent" value="${data.skontoProzent || 0}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Skonto-Frist (Tage)</label><input type="number" min="0" name="skontoTage" value="${data.skontoTage || 0}" ${locked ? 'disabled' : ''}><span class="hint mb-0">0 % = kein Skonto-Hinweis auf der Rechnung.</span></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Steuerart</label>
              <select name="steuerart" id="f-steuerart" ${locked ? 'disabled' : ''}>${STEUERARTEN.map((s) => `<option value="${s.id}" ${s.id === (data.steuerart || 'regel') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Rechnungsart</label>
              <select name="rechnungstyp" id="f-rechnungstyp" ${locked ? 'disabled' : ''}>
                <option value="rechnung" ${(data.rechnungstyp || 'rechnung') === 'rechnung' ? 'selected' : ''}>Rechnung / Schlussrechnung</option>
                <option value="abschlag" ${data.rechnungstyp === 'abschlag' ? 'selected' : ''}>Abschlagsrechnung</option>
              </select>
            </div>
            <div class="field"><label>Zahlungsart</label>
              <select name="zahlungsart" id="f-zahlungsart" ${locked ? 'disabled' : ''}>${ZAHLUNGSARTEN.map((z) => `<option value="${z.id}" ${z.id === (data.zahlungsart || 'ueberweisung') ? 'selected' : ''}>${escapeHtml(z.titel)}</option>`).join('')}</select>
              <span class="hint mb-0">Bei Barzahlung müssen Kunde und Mitarbeiter unten unterschreiben.</span>
            </div>
            ${isEdit ? `
              <div class="field"><label>Status</label>
                <select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
              </div>
              <div class="field"><label>Bezahlt am</label><input type="date" name="bezahltAm" value="${data.bezahltAm || ''}"></div>
            ` : ''}
          </div>
          <div class="divider"></div>
          ${!locked ? `
            <div class="flex-row flex-wrap" style="margin-bottom:10px">
              <button type="button" class="btn btn-sm" id="btn-zeit-uebernehmen">⏱️ Offene Zeiterfassung übernehmen</button>
              <button type="button" class="btn btn-sm" id="btn-ki-erstellen">✨ Mit KI aus Stichpunkten erstellen</button>
            </div>
          ` : ''}
          <div id="pos-host"></div>
          ${!locked ? '<div id="tb-picker-host"></div>' : ''}
          <div id="abschlaege-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen</label><textarea name="notizen" ${locked ? 'disabled' : ''}>${escapeHtml(data.notizen || '')}</textarea></div>
          <div id="bar-sig-section" ${(data.zahlungsart || 'ueberweisung') === 'bar' ? '' : 'hidden'}>
            <div class="divider"></div>
            <h2 style="font-size:14px;margin:0 0 8px">Unterschriften (Barzahlung)</h2>
            <p class="hint">Bei Barzahlung müssen Kunde und Mitarbeiter den Erhalt der Zahlung hier auf dem Bildschirm/Tablet bestätigen. Beim Ausdrucken erscheinen zusätzlich immer leere Unterschriftslinien zum handschriftlichen Unterschreiben.</p>
            <div class="flex-row flex-wrap" style="gap:20px">
              <div id="sig-host-kunde" style="flex:1;min-width:260px"></div>
              <div id="sig-host-mitarbeiter" style="flex:1;min-width:260px"></div>
            </div>
          </div>
          <div class="modal-actions">
            ${isEdit && !locked ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit && locked && data.status !== 'storniert' ? '<button type="button" class="btn btn-danger" id="btn-storno">Stornieren</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-xrechnung" title="E-Rechnung im XRechnung-Format (UBL-XML)">XRechnung (XML)</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            ${isEdit ? `<button type="button" class="btn" id="btn-lexoffice-transfer">🧾 ${data.lexofficeId ? 'In lexoffice öffnen' : 'An lexoffice übertragen'}</button>` : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

mountChipPicker(body.querySelector('#f-kunde-host'), {
      name: 'kundeId', icon: '🏢', title: 'Kunde wählen', placeholder: '– Kunde wählen –',
      items: kunden, selectedId: data.kundeId, disabled: locked,
      itemLabel: (k) => k.firma, itemSub: (k) => [k.plz, k.ort].filter(Boolean).join(' '),
    });
    mountChipPicker(body.querySelector('#f-projekt-host'), {
      name: 'projektId', icon: '🔧', title: 'Projekt wählen', placeholder: '– Projekt wählen –',
      items: projekte, selectedId: data.projektId, disabled: locked,
      itemLabel: (p) => p.titel, itemSub: (p) => kundenById[p.kundeId]?.firma || '',
    });

    let editor = createPositionsEditor({
      host: body.querySelector('#pos-host'),
      katalog,
      positionen: data.positionen,
      defaultSteuersatz: settings.standardSteuersatz,
      vorlagen,
      readOnly: locked,
    });

    function mountSigSection(host, initialUrl, label) {
      let pad = null;
      let url = initialUrl || '';
      function renderView() {
        if (locked) {
          host.innerHTML = url
            ? `<div class="field"><label>${escapeHtml(label)}</label><img src="${url}" alt="${escapeHtml(label)}" style="max-width:260px;max-height:110px;border:1px solid var(--border);border-radius:6px;background:#fff;display:block"></div>`
            : `<div class="field"><label>${escapeHtml(label)}</label><p class="hint">Keine Unterschrift hinterlegt.</p></div>`;
          return;
        }
        if (url) {
          pad = null;
          host.innerHTML = `
            <div class="field">
              <label>${escapeHtml(label)}</label>
              <img src="${url}" alt="${escapeHtml(label)}" style="max-width:260px;max-height:110px;border:1px solid var(--border);border-radius:6px;background:#fff;display:block">
              <button type="button" class="btn btn-sm btn-sig-neu" style="margin-top:6px;align-self:flex-start">Neu unterschreiben</button>
            </div>
          `;
          host.querySelector('.btn-sig-neu').addEventListener('click', () => { url = ''; renderView(); });
        } else {
          pad = mountSignaturePad(host, { label });
        }
      }
      renderView();
      return { getDataUrl: () => url || (pad && !pad.isEmpty() ? pad.getDataUrl() : '') };
    }
    const sigKunde = mountSigSection(body.querySelector('#sig-host-kunde'), data.unterschriftKunde, 'Unterschrift Kunde');
    const sigMitarbeiter = mountSigSection(body.querySelector('#sig-host-mitarbeiter'), data.unterschriftMitarbeiter, 'Unterschrift Mitarbeiter');
    body.querySelector('#f-zahlungsart').addEventListener('change', (e) => {
      body.querySelector('#bar-sig-section').hidden = e.target.value !== 'bar';
    });

    if (!locked) {
      mountTextbausteinPicker(body.querySelector('#tb-picker-host'), {
        textbausteine, kategorie: 'rechnung',
        onInsert: (text) => {
          const field = body.querySelector('textarea[name="notizen"]');
          field.value = field.value ? field.value + '\n\n' + text : text;
        },
      });
      body.querySelector('#f-steuerart').addEventListener('change', (e) => {
        if (e.target.value !== 'regel') {
          for (const p of editor.getPositionen()) p.steuersatz = 0;
          editor.refresh();
        }
      });

      function renderAbschlaegeHost() {
        const host = body.querySelector('#abschlaege-host');
        const typ = body.querySelector('#f-rechnungstyp').value;
        const projektId = body.querySelector('[name="projektId"]').value;
        if (typ !== 'rechnung') { host.innerHTML = ''; return; }
        const kandidaten = rechnungen.filter((r) =>
          r.rechnungstyp === 'abschlag' && r.id !== data.id && r.status !== 'storniert' &&
          (!projektId || r.projektId === projektId) && (!r.verrechnetIn || r.verrechnetIn === data.nummer)
        );
        if (kandidaten.length === 0) { host.innerHTML = ''; return; }
        host.innerHTML = `
          <div class="divider"></div>
          <h2 style="font-size:13px;margin:0 0 8px">Abschlagszahlungen berücksichtigen (Schlussrechnung)</h2>
          <div class="tag-list">
            ${kandidaten.map((r) => `
              <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                <input type="checkbox" class="abschlag-check" value="${r.id}" ${abschlaegeChecked.has(r.id) ? 'checked' : ''}>
                ${escapeHtml(r.nummer)} · ${formatCurrency(r.brutto)}
              </label>
            `).join('')}
          </div>
        `;
        host.querySelectorAll('.abschlag-check').forEach((chk) => {
          chk.addEventListener('change', () => {
            if (chk.checked) abschlaegeChecked.add(chk.value);
            else abschlaegeChecked.delete(chk.value);
          });
        });
      }
      renderAbschlaegeHost();
      body.querySelector('#f-rechnungstyp').addEventListener('change', renderAbschlaegeHost);
      body.querySelector('[name="projektId"]').addEventListener('change', renderAbschlaegeHost);
      body._getAbschlaegeChecked = () => Array.from(abschlaegeChecked);
    }

    let uebernommeneZeitIds = [];
    if (!locked) {
      body.querySelector('#btn-ki-erstellen').addEventListener('click', async () => {
        const stichpunkte = window.prompt('Stichpunkte für die Rechnung:');
        if (!stichpunkte || !stichpunkte.trim()) return;
        const btn = body.querySelector('#btn-ki-erstellen');
        btn.disabled = true;
        btn.textContent = 'KI erstellt Vorschlag ...';
        try {
          const kundeId = body.querySelector('[name="kundeId"]').value;
          const kunde = kundenById[kundeId];
          const result = await generateAngebotFromStichpunkte({ stichpunkte, kundeName: kunde?.firma, katalog });
          if (result.betreff) body.querySelector('input[name="betreff"]').value = result.betreff;
          if (result.einleitung) {
            const notizenField = body.querySelector('textarea[name="notizen"]');
            notizenField.value = result.einleitung + (notizenField.value ? '\n\n' + notizenField.value : '');
          }
          const neuePositionen = [...editor.getPositionen(), ...(result.positionen || []).map((p) => ({ ...p, id: uid() }))];
          editor = createPositionsEditor({
            host: body.querySelector('#pos-host'), katalog, positionen: neuePositionen,
            defaultSteuersatz: settings.standardSteuersatz, vorlagen,
          });
          toast(`${(result.positionen || []).length} Positionen von der KI übernommen`, 'success');
        } catch (err) {
          toast(err.message, 'danger');
        }
        btn.disabled = false;
        btn.textContent = '✨ Mit KI aus Stichpunkten erstellen';
      });

      body.querySelector('#btn-zeit-uebernehmen').addEventListener('click', async () => {
        const projektId = body.querySelector('[name="projektId"]').value;
        if (!projektId) { toast('Bitte zuerst ein Projekt wählen', 'danger'); return; }
        const offen = zeiterfassung.filter((z) => z.projektId === projektId && !z.abgerechnet);
        if (offen.length === 0) { toast('Keine offenen Zeiten für dieses Projekt', 'info'); return; }
        const totalMinutes = offen.reduce((s, z) => s + (z.dauerMinuten || 0), 0);
        const stunden = Math.round((totalMinutes / 60) * 100) / 100;
        const projekt = projekte.find((p) => p.id === projektId);
        const neuePositionen = [...editor.getPositionen(), {
          id: uid(), bezeichnung: `Arbeitszeit ${projekt?.titel || ''}`, beschreibung: '',
          einheit: 'Std.', menge: stunden, einzelpreis: settings.stundensatz || 0, steuersatz: settings.standardSteuersatz,
        }];
        uebernommeneZeitIds = offen.map((z) => z.id);
        Object.assign(editor, createPositionsEditor({
          host: body.querySelector('#pos-host'), katalog, positionen: neuePositionen, defaultSteuersatz: settings.standardSteuersatz, vorlagen,
        }));
        toast(`${stunden} Std. aus ${offen.length} Zeiteinträgen übernommen`, 'success');
      });
    }

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      const deleteBtn = body.querySelector('#btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirmDelete(`Rechnung ${data.nummer} in den Papierkorb verschieben?`)) return;
          await remove('rechnungen', data.id);
          await syncBuchung({ ...data, status: 'geloescht' });
          toast('Rechnung in den Papierkorb verschoben');
          close();
          render(container);
        });
      }
      const stornoBtn = body.querySelector('#btn-storno');
      if (stornoBtn) {
        stornoBtn.addEventListener('click', () => {
          openStornoGrundDialog(data.nummer, async (stornoGrund, stornoGrundText) => {
            const currentSettings = await getSettings();
            const { nummer: stornoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
              currentSettings.rechnungPrefix, { datum: currentSettings.rechnungNummerDatum, zaehler: currentSettings.rechnungNummerZaehler }
            );
            await setSettings({ rechnungNummerDatum: nDatum, rechnungNummerZaehler: nZaehler });
            const stornoPositionen = data.positionen.map((p) => ({ ...p, id: uid(), menge: -(Number(p.menge) || 0) }));
            const stornoTotals = calcTotals(stornoPositionen);
            const storno = {
              id: uid(), nummer: stornoNummer, kundeId: data.kundeId, projektId: data.projektId, angebotId: null,
              datum: todayISO(), faelligAm: todayISO(), status: 'storniert', betreff: `Stornorechnung zu ${data.nummer}`,
              notizen: '', positionen: stornoPositionen, bezahltAm: '', createdAt: new Date().toISOString(),
              versendet: true, versendetAm: new Date().toISOString(), stornoVonNummer: data.nummer, storniertDurchNummer: '',
              netto: stornoTotals.netto, steuer: stornoTotals.steuer, brutto: stornoTotals.brutto,
              stornoGrund, stornoGrundText,
            };
            await put('rechnungen', storno);
            await syncBuchung(storno);
            const stornierteOriginal = { ...data, status: 'storniert', storniertDurchNummer: stornoNummer };
            await put('rechnungen', stornierteOriginal);
            await syncBuchung(stornierteOriginal);
            toast(`Stornorechnung ${stornoNummer} angelegt`, 'success');
            close();
            render(container);
          });
        });
      }
      function getEffectiveSettings() {
        const projekt = projekte.find((p) => p.id === data.projektId);
        return resolveMarkeSettings(settings, markenById[projekt?.markeId]);
      }
      function docOpts() {
        const totals = editor.getTotals();
        const istAbschlag = data.rechnungstyp === 'abschlag';
        const kunde = kundenById[data.kundeId];
        const zahlungsartLive = body.querySelector('#f-zahlungsart')?.value || data.zahlungsart || 'ueberweisung';
        const istBar = zahlungsartLive === 'bar';
        const notizenLive = body.querySelector('textarea[name="notizen"]')?.value ?? data.notizen ?? '';
        return {
          settings: getEffectiveSettings(), art: istAbschlag ? 'Abschlagsrechnung' : 'Rechnung', nummer: data.nummer, datum: data.datum,
          leistungsdatum: data.leistungsdatum || data.datum,
          refLabel: 'Zahlbar bis', refValue: formatDate(data.faelligAm),
          kunde, betreff: data.betreff,
          projekt: projekte.find((p) => p.id === data.projektId)?.titel || '',
          introText: 'wir bedanken uns für Ihren Auftrag und stellen Ihnen wie folgt in Rechnung:',
          positionen: editor.getPositionen(), totals,
          steuerHinweis: STEUERARTEN.find((s) => s.id === data.steuerart)?.hinweis || '',
          aufbewahrungsHinweis: kunde?.istPrivatperson
            ? 'Hinweis gemäß § 14 Abs. 4 Nr. 9 UStG: Als Privatperson sind Sie verpflichtet, diese Rechnung sowie zugehörige Zahlungsbelege im Zusammenhang mit dieser Werklieferung/Leistung 2 Jahre lang aufzubewahren.'
            : '',
          closingText: notizenLive +
            (data.skontoProzent > 0
              ? `\n\nBei Zahlung bis zum ${formatDate(addDays(data.datum, data.skontoTage || 0))} (${data.skontoTage || 0} Tage) gewähren wir ${data.skontoProzent}% Skonto (Skontobetrag: ${formatCurrency(Math.round(totals.brutto * data.skontoProzent) / 100)}).`
              : '') +
            `\n\nBitte überweisen Sie den Rechnungsbetrag bis zum ${formatDate(data.faelligAm)} auf unser unten genanntes Konto.`,
          abschlaege: !istAbschlag && data.verrechneteAbschlaege?.length ? data.verrechneteAbschlaege : undefined,
          faelligAm: data.faelligAm, steuerart: data.steuerart || 'regel',
          zeigeUnterschriftsfeld: istBar,
          unterschriftKunde: sigKunde.getDataUrl() || null,
          zeigeZweiteUnterschrift: istBar,
          unterschriftMitarbeiter: sigMitarbeiter.getDataUrl() || null,
          zweiteUnterschriftLabel: 'Unterschrift Mitarbeiter',
        };
      }
      async function markVersendetUndSperren() {
        if (data.versendet) return;
        const persisted = { ...data, versendet: true, versendetAm: new Date().toISOString() };
        await put('rechnungen', persisted);
        await syncBuchung(persisted);
        Object.assign(data, persisted);
        toast('Rechnung wurde versendet und ist nun GoBD-gesperrt (nur noch per Storno korrigierbar).', 'info');
        close();
        openForm({ ...data });
      }
      body.querySelector('#btn-print').addEventListener('click', async () => {
        await printDokument({ bodyHtml: buildDocHtml(docOpts()), settings, buildPdfBlob: () => buildDocPdfBlob(docOpts()) });
        if (!locked) await markVersendetUndSperren();
      });
      body.querySelector('#btn-xrechnung').addEventListener('click', () => {
        const blob = buildXRechnungBlob(docOpts());
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = xRechnungFilename(data.nummer);
        a.click();
        URL.revokeObjectURL(url);
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Rechnung ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unsere Rechnung ${data.nummer}, fällig am ${formatDate(data.faelligAm)}.\n\nMit freundlichen Grüßen\n${getEffectiveSettings().firmenname}`,
            filename: `Rechnung-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(docOpts()),
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
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unsere Rechnung ${data.nummer} (fällig am ${formatDate(data.faelligAm)}). Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${getEffectiveSettings().firmenname}`,
            pdfBlob: await buildDocPdfBlob(docOpts()),
            filename: `Rechnung-${data.nummer}.pdf`,
          });
          if (!locked) await markVersendetUndSperren();
        });
      }
      body.querySelector('#btn-lexoffice-transfer').addEventListener('click', () => {
        if (data.lexofficeId) {
          window.open(`https://app.lexoffice.io/rechnungen/edit/${data.lexofficeId}`, '_blank', 'noopener');
          return;
        }
        uebertrageAnLexoffice(data);
      });
    }

    body.querySelector('#re-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      if (!locked) {
        updated.nummer = (fd.get('nummer') || '').toString().trim();
        updated.kundeId = fd.get('kundeId') || '';
        updated.projektId = fd.get('projektId') || '';
        updated.datum = fd.get('datum') || todayISO();
        updated.leistungsdatum = fd.get('leistungsdatum') || updated.datum;
        updated.faelligAm = fd.get('faelligAm') || '';
        updated.betreff = (fd.get('betreff') || '').toString().trim();
        updated.notizen = (fd.get('notizen') || '').toString().trim();
        updated.steuerart = fd.get('steuerart') || 'regel';
        updated.rechnungstyp = fd.get('rechnungstyp') || 'rechnung';
        updated.skontoProzent = Number(fd.get('skontoProzent')) || 0;
        updated.skontoTage = Number(fd.get('skontoTage')) || 0;
        updated.zahlungsart = fd.get('zahlungsart') || 'ueberweisung';
        updated.unterschriftKunde = sigKunde.getDataUrl() || '';
        updated.unterschriftMitarbeiter = sigMitarbeiter.getDataUrl() || '';
      }
      if (isEdit) {
        updated.status = fd.get('status') || data.status;
        updated.bezahltAm = fd.get('bezahltAm') || '';
      }
      if (!updated.kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }

      if (updated.steuerart && updated.steuerart !== 'regel') {
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
          currentSettings.rechnungPrefix, { datum: currentSettings.rechnungNummerDatum, zaehler: currentSettings.rechnungNummerZaehler }
        );
        if (!updated.nummer) updated.nummer = autoNummer;
        await setSettings({ rechnungNummerDatum: nDatum, rechnungNummerZaehler: nZaehler });
      }

      if (!locked) {
        const nummerNorm = (updated.nummer || '').trim().toLowerCase();
        const dupe = rechnungen.some((r) => r.id !== updated.id && (r.nummer || '').trim().toLowerCase() === nummerNorm);
        if (dupe) { toast(`Rechnungsnummer "${updated.nummer}" ist bereits vergeben – GoBD verlangt eindeutige Nummern.`, 'danger'); return; }
      }

      if (!locked) {
        const previousIds = (data.verrechneteAbschlaege || []).map((a) => a.rechnungId);
        if (updated.rechnungstyp === 'rechnung') {
          const checkedIds = body._getAbschlaegeChecked ? body._getAbschlaegeChecked() : [];
          updated.verrechneteAbschlaege = checkedIds.map((id) => {
            const ar = rechnungen.find((r) => r.id === id);
            return { rechnungId: id, nummer: ar?.nummer || '', betrag: ar?.brutto || 0 };
          });
          for (const id of checkedIds) {
            if (previousIds.includes(id)) continue;
            const ar = rechnungen.find((r) => r.id === id);
            if (ar) await put('rechnungen', { ...ar, verrechnetIn: updated.nummer });
          }
          for (const id of previousIds) {
            if (checkedIds.includes(id)) continue;
            const ar = rechnungen.find((r) => r.id === id);
            if (ar) await put('rechnungen', { ...ar, verrechnetIn: '' });
          }
        } else {
          updated.verrechneteAbschlaege = [];
          for (const id of previousIds) {
            const ar = rechnungen.find((r) => r.id === id);
            if (ar) await put('rechnungen', { ...ar, verrechnetIn: '' });
          }
        }
      }

      await put('rechnungen', updated);
      await syncBuchung(updated);
      for (const zid of uebernommeneZeitIds) {
        const z = zeiterfassung.find((e) => e.id === zid);
        if (z) await put('zeiterfassung', { ...z, abgerechnet: true });
      }
      toast(isEdit ? 'Rechnung aktualisiert' : 'Rechnung angelegt', 'success');
      close();
      render(container);
    });
  }

  applyFilter();
}
