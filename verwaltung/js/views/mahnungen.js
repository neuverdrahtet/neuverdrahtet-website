import { getAll, put, remove, getSettings, setSettings, resolveMarkeSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, daysBetween, toast, calcTotals, offenerRestbetrag } from '../utils.js';
import { openModal, confirmDelete, mountChipPicker, openKundeSchnellanlage, openProjektSchnellanlage } from '../ui.js';
import { printDokument, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { createBulkSelect } from '../bulkselect.js';
import { downloadCsv, exportDokumenteAlsPdf } from '../docexport.js';
import * as google from '../google.js';

const STUFE_TEXT = {
  1: (settings, frist) => `wir müssen Sie leider daran erinnern, dass die unten genannte Rechnung noch nicht beglichen wurde. Wir bitten Sie, den offenen Betrag innerhalb der nächsten ${frist} Tage auf unser Konto zu überweisen. Sollten Sie bereits gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.`,
  2: (settings, frist) => `trotz unserer Zahlungserinnerung konnten wir bislang keinen Zahlungseingang zur unten genannten Rechnung feststellen. Wir bitten Sie dringend, den offenen Betrag zzgl. Mahngebühr innerhalb der nächsten ${frist} Tage zu begleichen.`,
  3: (settings, frist) => `trotz mehrfacher Zahlungsaufforderung ist der offene Betrag weiterhin nicht bei uns eingegangen. Wir fordern Sie hiermit letztmalig auf, den Gesamtbetrag zzgl. Mahngebühr innerhalb von ${frist} Tagen zu begleichen. Andernfalls sehen wir uns gezwungen, weitere Schritte zur Beitreibung der Forderung einzuleiten.`,
};

const GRUENDE_MAHNUNG_LOESCHEN = [
  { id: 'rechnung_bezahlt', titel: 'Rechnung wurde bezahlt' },
  { id: 'rechnung_storniert', titel: 'Rechnung wurde storniert' },
  { id: 'irrtuemlich', titel: 'Mahnung irrtümlich erstellt' },
  { id: 'ratenzahlung', titel: 'Ratenzahlung/Sondervereinbarung mit Kunde' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

function openMahnungGrundDialog(titel, onConfirm) {
  const { body: dBody, close: dClose } = openModal({
    title: titel,
    bodyHtml: `
      <form id="mahnung-grund-form">
        <p class="hint">Die Mahnung wird in den Papierkorb verschoben.</p>
        <div class="field"><label>Grund</label>
          <select name="loeschGrund">${GRUENDE_MAHNUNG_LOESCHEN.map((g) => `<option value="${g.id}">${escapeHtml(g.titel)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Notiz (optional)</label><input type="text" name="loeschGrundText"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="btn-mahnung-grund-abbrechen">Abbrechen</button>
          <button type="submit" class="btn btn-danger">In den Papierkorb verschieben</button>
        </div>
      </form>
    `,
  });
  dBody.querySelector('#btn-mahnung-grund-abbrechen').addEventListener('click', dClose);
  dBody.querySelector('#mahnung-grund-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const grund = fd.get('loeschGrund') || '';
    const grundText = (fd.get('loeschGrundText') || '').toString().trim();
    const grundLabel = GRUENDE_MAHNUNG_LOESCHEN.find((g) => g.id === grund)?.titel || '';
    dClose();
    onConfirm(grund, grundText, grundLabel);
  });
}

export async function render(container) {
  let [rechnungen, kunden, mahnungen, settings, projekte, marken] = await Promise.all([
    getAll('rechnungen'), getAll('kunden'), getAll('mahnungen'), getSettings(), getAll('projekte'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const rechnungenById = Object.fromEntries(rechnungen.map((r) => [r.id, r]));
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  function getEffectiveSettingsForMahnung(m) {
    const projekt = m.rechnungId ? projekteById[rechnungenById[m.rechnungId]?.projektId] : projekteById[m.projektId];
    return resolveMarkeSettings(settings, markenById[projekt?.markeId]);
  }
  // Mahnungen entstehen normalerweise automatisch aus einer bereits
  // bestehenden, überfälligen Rechnung (rechnungId gesetzt) - diese drei
  // Hilfsfunktionen lösen ZUSÄTZLICH den Fall einer MANUELLEN Mahnung ohne
  // Rechnung auf (14.11.2026, auf Dannys Wunsch, z.B. für alte Forderungen,
  // die nie als Rechnung in Werkora standen): dort trägt die Mahnung selbst
  // kundeId/projektId/manuelleBezeichnung/betrag statt sie von der
  // verknüpften Rechnung abzuleiten. Zentrale Stellen statt an jeder der
  // bisherigen "rechnungenById[m.rechnungId]"-Stellen den Fallback zu
  // wiederholen.
  function kundeFuerMahnung(m) {
    return m.rechnungId ? kundenById[rechnungenById[m.rechnungId]?.kundeId] : kundenById[m.kundeId];
  }
  function bezeichnungFuerMahnung(m) {
    const rech = rechnungenById[m.rechnungId];
    return rech ? `Rechnung ${rech.nummer}` : (m.manuelleBezeichnung || 'Manuelle Mahnung');
  }
  function betragFuerMahnung(m) {
    const rech = rechnungenById[m.rechnungId];
    return rech ? offenerRestbetrag(rech) : Number(m.betrag) || 0;
  }
  const today = todayISO();

  const overdue = rechnungen
    .filter((r) => (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < today)
    .map((r) => {
      const mahnungenFuerR = mahnungen.filter((m) => m.rechnungId === r.id).sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));
      const stufeCount = mahnungenFuerR.length;
      const letzte = mahnungenFuerR[mahnungenFuerR.length - 1];
      const wartetBis = letzte ? letzte.neueFrist : r.faelligAm;
      const bereit = !wartetBis || wartetBis < today;
      return { r, stufeCount, nextStufe: Math.min(stufeCount + 1, 3), tageUeberfaellig: daysBetween(r.faelligAm, today), bereit, wartetBis };
    })
    .sort((a, b) => b.tageUeberfaellig - a.tageUeberfaellig);
  const bereitCount = overdue.filter((o) => o.bereit).length;

  // Automatischer Mahnungsversand (Einstellungen → KI-Angebotserstellung,
  // Schalter "Fällige Mahnungen automatisch versenden"): läuft höchstens
  // einmal pro Kalendertag beim Öffnen dieser Ansicht, da es hier keinen
  // eigenen Server-Cron gibt - "automatisch" heißt hier "ohne dass jemand
  // jede Mahnung einzeln anklicken muss", nicht "rund um die Uhr im
  // Hintergrund". Legt neue Mahnungen erst NACH diesem Lauf angelegt an,
  // deshalb bei tatsächlicher Aktivität komplett neu rendern.
  if (await autoVersendeFaelligeMahnungen()) return render(container);

  mahnungen.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

  function exportFilename(m) {
    const rech = rechnungenById[m.rechnungId];
    return `Mahnung-Stufe${m.stufe}-${(rech?.nummer || m.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  }
  async function exportPdf(items, zipFilename) {
    if (items.length === 0) { toast('Keine Mahnungen zum Exportieren', 'info'); return; }
    if (items.length > 1) toast(`${items.length} PDFs werden erstellt ...`, 'info');
    await exportDokumenteAlsPdf(items, { buildPdfBlob: (m) => buildDocPdfBlob(mahnungDocOpts(m)), filenameFor: exportFilename, zipFilename });
  }
  function exportCsv(items) {
    if (items.length === 0) { toast('Keine Mahnungen zum Exportieren', 'info'); return; }
    const rows = [['Rechnung', 'Kunde', 'Stufe', 'Datum', 'Neue Zahlungsfrist', 'Mahngebühr', 'Rechnungsbetrag']];
    for (const m of items) {
      rows.push([bezeichnungFuerMahnung(m), kundeFuerMahnung(m)?.firma || '', m.stufe, formatDate(m.datum), formatDate(m.neueFrist), m.gebuehr, betragFuerMahnung(m)]);
    }
    downloadCsv(rows, 'Mahnungen-Export.csv');
  }

  const bulk = createBulkSelect('mahnungen', {
    label: 'Mahnungen',
    extraActions: [
      { id: 'bulk-export-pdf', label: '📄 Als PDF', onClick: (ids) => exportPdf(mahnungen.filter((m) => ids.includes(m.id)), 'Mahnungen-Auswahl.zip') },
      { id: 'bulk-export-csv', label: '📊 Als CSV', onClick: (ids) => exportCsv(mahnungen.filter((m) => ids.includes(m.id))) },
    ],
  });

  const summeUeberfaellig = overdue.reduce((s, o) => s + offenerRestbetrag(o.r), 0);
  // Manuelle Mahnungen (kein rechnungId) haben keine Rechnung mit einem
  // Zahlungsstatus, den man hier abfragen könnte - zählen deshalb immer als
  // "offen", bis sie gelöscht/in den Papierkorb verschoben werden.
  const offeneMahngebuehren = mahnungen
    .filter((m) => !m.rechnungId || ['offen', 'teilbezahlt'].includes(rechnungenById[m.rechnungId]?.status))
    .reduce((s, m) => s + (m.gebuehr || 0), 0);

  container.innerHTML = `
    <div class="view-header">
      <h1>Mahnungen</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-manuelle-mahnung">+ Manuelle Mahnung (ohne Rechnung)</button>
        <button class="btn" id="btn-export-pdf-alle">📄 Alle als PDF</button>
        <button class="btn" id="btn-export-csv-alle">📊 Alle als CSV</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card kpi-danger">
        <div class="kpi-value">${formatCurrency(summeUeberfaellig)}</div>
        <div class="kpi-label">Überfällig · ${overdue.length} Rechnung(en)</div>
      </div>
      <div class="kpi-card kpi-warn">
        <div class="kpi-value">${bereitCount}</div>
        <div class="kpi-label">Bereit für nächste Mahnstufe</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${mahnungen.length}</div>
        <div class="kpi-label">Erstellte Mahnungen gesamt</div>
      </div>
      <div class="kpi-card kpi-accent">
        <div class="kpi-value">${formatCurrency(offeneMahngebuehren)}</div>
        <div class="kpi-label">Offene Mahngebühren</div>
      </div>
    </div>

    <div class="card">
      <div class="view-header" style="margin-bottom:10px">
        <h2 style="margin:0">Überfällige Rechnungen</h2>
        ${bereitCount > 0 ? `<button class="btn btn-primary" id="btn-bulk-mahnung">Alle fälligen Mahnungen jetzt erstellen (${bereitCount})</button>` : ''}
      </div>
      ${overdue.length === 0 ? '<p class="text-mute">Aktuell keine überfälligen Rechnungen.</p>' : `
        <table class="data-table">
          <thead><tr><th>Rechnung</th><th>Kunde</th><th>Fällig am</th><th>Tage überfällig</th><th>Bisherige Mahnungen</th><th class="text-right">Betrag</th><th></th></tr></thead>
          <tbody>
            ${overdue.map(({ r, stufeCount, nextStufe, tageUeberfaellig, bereit, wartetBis }) => `
              <tr>
                <td>${escapeHtml(r.nummer)}</td>
                <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
                <td>${formatDate(r.faelligAm)}</td>
                <td><span class="badge badge-danger">${tageUeberfaellig} Tage</span></td>
                <td>${stufeCount}</td>
                <td class="text-right">${formatCurrency(offenerRestbetrag(r))}</td>
                <td>${bereit
                  ? `<button class="btn btn-sm btn-primary btn-create-mahnung" data-rid="${r.id}" data-stufe="${nextStufe}">Mahnung Stufe ${nextStufe}</button>`
                  : `<span class="badge" title="Zahlungsfrist der letzten Mahnung läuft noch">Wartet bis ${formatDate(wartetBis)}</span>`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div class="card">
      <h2>Erstellte Mahnungen</h2>
      <div id="mahnungen-table-host"></div>
    </div>
  `;

  function buildMahnungData(rechnung, stufe) {
    const frist = settings.mahnfristTage || 10;
    const gebuehr = settings.mahnGebuehr?.[stufe] ?? 0;
    return {
      id: uid(), rechnungId: rechnung.id, stufe, datum: today,
      neueFrist: addDays(today, frist), gebuehr,
      text: STUFE_TEXT[stufe] ? STUFE_TEXT[stufe](settings, frist) : '',
      createdAt: new Date().toISOString(),
    };
  }

  container.querySelector('#btn-export-pdf-alle').addEventListener('click', () => exportPdf(mahnungen, 'Mahnungen-Export.zip'));
  container.querySelector('#btn-export-csv-alle').addEventListener('click', () => exportCsv(mahnungen));

  const btnBulkMahnung = container.querySelector('#btn-bulk-mahnung');
  if (btnBulkMahnung) {
    btnBulkMahnung.addEventListener('click', async () => {
      const bereitEintraege = overdue.filter((o) => o.bereit);
      if (!confirmDelete(`${bereitEintraege.length} Mahnung(en) jetzt anlegen? Drucken/Versenden erfolgt danach einzeln über die Liste unten.`)) return;
      for (const { r, nextStufe } of bereitEintraege) {
        const neueMahnung = buildMahnungData(r, nextStufe);
        await put('mahnungen', neueMahnung);
        mahnungen.push(neueMahnung);
      }
      toast(`${bereitEintraege.length} Mahnung(en) erstellt`, 'success');
      render(container);
    });
  }

  container.querySelectorAll('.btn-create-mahnung').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rechnung = rechnungenById[btn.dataset.rid];
      openForm(rechnung, Number(btn.dataset.stufe));
    });
  });
  container.querySelector('#btn-manuelle-mahnung').addEventListener('click', () => openManuelleMahnungForm());

  const mahnungenTableHost = container.querySelector('#mahnungen-table-host');

  function renderMahnungenTable() {
    if (mahnungen.length === 0) {
      mahnungenTableHost.innerHTML = '<p class="text-mute">Noch keine Mahnungen erstellt.</p>';
      return;
    }
    mahnungenTableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Rechnung</th><th>Kunde</th><th>Stufe</th><th>Datum</th><th class="text-right">Mahngebühr</th><th></th></tr></thead>
        <tbody>
          ${mahnungen.map((m) => {
            const kunde = kundeFuerMahnung(m);
            return `
            <tr data-id="${m.id}">
              ${bulk.rowCell(m.id)}
              <td>${escapeHtml(bezeichnungFuerMahnung(m))}${!m.rechnungId ? ' <span class="badge">manuell</span>' : ''}</td>
              <td>${escapeHtml(kunde?.firma || '')}</td>
              <td><span class="badge badge-warn">Stufe ${m.stufe}</span></td>
              <td>${formatDate(m.datum)}</td>
              <td class="text-right">${formatCurrency(m.gebuehr)}</td>
              <td>
                <button class="btn btn-sm btn-edit-mahnung" data-id="${m.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-print-mahnung" data-id="${m.id}">Drucken</button>
                ${kunde?.email ? `<button class="btn btn-sm btn-email-mahnung" data-id="${m.id}">E-Mail</button>` : ''}
                ${kunde?.telefon ? `<button class="btn btn-sm btn-whatsapp-mahnung" data-id="${m.id}">WhatsApp</button>` : ''}
                <button class="btn btn-sm btn-danger btn-del-mahnung" data-id="${m.id}">Löschen</button>
              </td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    mahnungenTableHost.querySelectorAll('.btn-edit-mahnung').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openEditForm(mahnungen.find((m) => m.id === btn.dataset.id)); });
    });
    mahnungenTableHost.querySelectorAll('.btn-print-mahnung').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); printMahnung(mahnungen.find((m) => m.id === btn.dataset.id)); });
    });
    mahnungenTableHost.querySelectorAll('.btn-email-mahnung').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); emailMahnung(mahnungen.find((m) => m.id === btn.dataset.id)); });
    });
    mahnungenTableHost.querySelectorAll('.btn-whatsapp-mahnung').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); whatsappMahnung(mahnungen.find((m) => m.id === btn.dataset.id)); });
    });
    mahnungenTableHost.querySelectorAll('.btn-del-mahnung').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = mahnungen.find((mm) => mm.id === btn.dataset.id);
        openMahnungGrundDialog(`Mahnung${m ? ' Stufe ' + m.stufe : ''} löschen`, async (grund, grundText, grundLabel) => {
          if (m) await put('mahnungen', { ...m, loeschGrund: grund, loeschGrundText: grundText, loeschGrundLabel: grundLabel });
          await remove('mahnungen', btn.dataset.id);
          toast('Mahnung in den Papierkorb verschoben');
          mahnungen = mahnungen.filter((mm) => mm.id !== btn.dataset.id);
          renderMahnungenTable();
        });
      });
    });
    bulk.wire(mahnungenTableHost, {
      onChange: renderMahnungenTable,
      onDeleted: (ids) => {
        mahnungen = mahnungen.filter((m) => !ids.includes(m.id));
        renderMahnungenTable();
      },
    });
  }
  renderMahnungenTable();

  function mahnungDocOpts(m) {
    const kunde = kundeFuerMahnung(m);
    const bezeichnung = bezeichnungFuerMahnung(m);
    const rech = rechnungenById[m.rechnungId];
    const positionen = [
      { bezeichnung: `Offener Betrag ${bezeichnung}`, menge: 1, einheit: '', einzelpreis: betragFuerMahnung(m), steuersatz: 0 },
      { bezeichnung: 'Mahngebühr', menge: 1, einheit: '', einzelpreis: m.gebuehr || 0, steuersatz: 0 },
    ];
    return {
      settings: getEffectiveSettingsForMahnung(m), art: `${m.stufe}. Mahnung`, nummer: rech?.nummer || '', datum: m.datum,
      refLabel: 'Neue Zahlungsfrist', refValue: formatDate(m.neueFrist),
      kunde, betreff: rech ? `Zahlungserinnerung zu Rechnung ${rech.nummer} vom ${formatDate(rech.datum)}` : `Zahlungserinnerung zu ${bezeichnung}`,
      introText: m.text,
      positionen, totals: calcTotals(positionen),
      closingText: '',
    };
  }

  function printMahnung(m) {
    if (!m) return;
    printDokument({ bodyHtml: buildDocHtml(mahnungDocOpts(m)), settings, buildPdfBlob: () => buildDocPdfBlob(mahnungDocOpts(m)) });
  }

  function emailMahnung(m) {
    if (!m) return;
    const kunde = kundeFuerMahnung(m);
    const bezeichnung = bezeichnungFuerMahnung(m);
    openEmailComposer({
      to: kunde?.email || '',
      subject: `${m.stufe}. Mahnung zu ${bezeichnung}`,
      bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\n${m.text}\n\nMit freundlichen Grüßen\n${getEffectiveSettingsForMahnung(m).firmenname}`,
      filename: `Mahnung-${m.stufe}-${(bezeichnung || m.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
      buildPdfBlob: () => buildDocPdfBlob(mahnungDocOpts(m)),
    });
  }

  async function whatsappMahnung(m) {
    if (!m) return;
    const kunde = kundeFuerMahnung(m);
    const bezeichnung = bezeichnungFuerMahnung(m);
    sendDocumentViaWhatsApp({
      phone: kunde?.telefon,
      text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei die ${m.stufe}. Mahnung zu ${bezeichnung}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${getEffectiveSettingsForMahnung(m).firmenname}`,
      pdfBlob: await buildDocPdfBlob(mahnungDocOpts(m)),
      filename: `Mahnung-${m.stufe}-${(bezeichnung || m.id).replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
    });
  }

  // Legt für alle überfälligen Rechnungen mit erreichter nächster Mahnstufe
  // automatisch die Mahnung an UND versendet sie sofort per E-Mail - nur
  // wenn der Nutzer das in den Einstellungen aktiviert hat (Standard aus,
  // da hier echte E-Mails an Kunden rausgehen). Gibt true zurück, wenn
  // tatsächlich etwas angelegt wurde (Aufrufer sollte dann neu rendern).
  async function autoVersendeFaelligeMahnungen() {
    if (!settings.mahnungenAutoVersand) return false;
    const heute = todayISO();
    if (settings.mahnungenAutoVersandAm === heute) return false;
    const bereitEintraege = overdue.filter((o) => o.bereit);
    if (bereitEintraege.length === 0) {
      await setSettings({ mahnungenAutoVersandAm: heute });
      return false;
    }
    let gesendet = 0, keineEmail = 0, fehler = 0;
    for (const { r, nextStufe } of bereitEintraege) {
      const kunde = kundenById[r.kundeId];
      const neueMahnung = buildMahnungData(r, nextStufe);
      await put('mahnungen', neueMahnung);
      if (!kunde?.email) { keineEmail++; continue; }
      try {
        const blob = await buildDocPdfBlob(mahnungDocOpts(neueMahnung));
        await google.sendEmailWithAttachment({
          to: kunde.email,
          subject: `${neueMahnung.stufe}. Mahnung zu Rechnung ${r.nummer || ''}`,
          bodyText: `Hallo${kunde.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\n${neueMahnung.text}\n\nMit freundlichen Grüßen\n${getEffectiveSettingsForMahnung(neueMahnung).firmenname}`,
          attachmentName: `Mahnung-${neueMahnung.stufe}-${r.nummer || ''}.pdf`,
          attachmentBlob: blob,
        });
        gesendet++;
      } catch {
        fehler++;
      }
    }
    await setSettings({ mahnungenAutoVersandAm: heute });
    const teile = [];
    if (gesendet) teile.push(`${gesendet} automatisch versendet`);
    if (keineEmail) teile.push(`${keineEmail} angelegt, aber ohne E-Mail-Adresse nicht verschickt`);
    if (fehler) teile.push(`${fehler} fehlgeschlagen (bitte manuell versenden)`);
    if (teile.length) toast(`Mahnverfahren: ${teile.join(', ')}`, fehler ? 'info' : 'success');
    return true;
  }

  function openForm(rechnung, stufe) {
    const data = buildMahnungData(rechnung, stufe);
    const { body, close } = openModal({
      title: `Mahnung Stufe ${stufe} – ${rechnung.nummer}`,
      wide: true,
      bodyHtml: `
        <form id="mahn-form">
          <p class="text-mute">Rechnung ${escapeHtml(rechnung.nummer)} · ${escapeHtml(kundenById[rechnung.kundeId]?.firma || '')} · Betrag ${formatCurrency(rechnung.brutto)}</p>
          <div class="form-grid">
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Neue Zahlungsfrist</label><input type="date" name="neueFrist" value="${data.neueFrist}"></div>
            <div class="field"><label>Mahngebühr (€)</label><input type="number" step="0.01" min="0" name="gebuehr" value="${data.gebuehr}"></div>
            <div class="field col-span-2"><label>Text</label><textarea name="text" rows="6">${escapeHtml(data.text)}</textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern &amp; Drucken</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#mahn-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.datum = fd.get('datum') || today;
      updated.neueFrist = fd.get('neueFrist') || data.neueFrist;
      updated.gebuehr = Number(fd.get('gebuehr')) || 0;
      updated.text = (fd.get('text') || '').toString();
      await put('mahnungen', updated);
      toast('Mahnung erstellt', 'success');
      close();
      mahnungen.push(updated);
      printMahnung(updated);
      render(container);
    });
  }

  // Manuelle Mahnung OHNE verknüpfte Rechnung (14.11.2026, auf Dannys
  // Wunsch) - z.B. für eine alte Forderung, die nie als Rechnung in Werkora
  // angelegt wurde. rechnungId bleibt leer; Kunde/Projekt/Bezeichnung/
  // Betrag werden stattdessen direkt an der Mahnung selbst gespeichert
  // (siehe kundeFuerMahnung/bezeichnungFuerMahnung/betragFuerMahnung oben).
  function openManuelleMahnungForm() {
    const frist = settings.mahnfristTage || 10;
    const stufe = 1;
    const { body, close } = openModal({
      title: 'Manuelle Mahnung (ohne Rechnung)',
      wide: true,
      bodyHtml: `
        <form id="mahn-manuell-form">
          <p class="hint">Für Forderungen, die nicht als Rechnung in Werkora stehen (z.B. Altfälle). Kunde ist Pflicht, Projekt optional - beide lassen sich direkt hier neu anlegen, falls sie noch fehlen.</p>
          <div class="form-grid">
            <div class="field"><label>Kunde *</label><div id="f-mahn-kunde-host"></div></div>
            <div class="field"><label>Projekt (optional)</label><div id="f-mahn-projekt-host"></div></div>
            <div class="field col-span-2"><label>Bezeichnung der Forderung *</label><input name="bezeichnung" required placeholder="z.B. Rechnung Nr. 2024-0012 (alt, nicht in Werkora erfasst)"></div>
            <div class="field"><label>Offener Betrag (€) *</label><input type="number" step="0.01" min="0.01" name="betrag" required></div>
            <div class="field"><label>Mahnstufe</label>
              <select name="stufe">
                <option value="1">1. Mahnung</option>
                <option value="2">2. Mahnung</option>
                <option value="3">3. Mahnung</option>
              </select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${today}"></div>
            <div class="field"><label>Neue Zahlungsfrist</label><input type="date" name="neueFrist" value="${addDays(today, frist)}"></div>
            <div class="field"><label>Mahngebühr (€)</label><input type="number" step="0.01" min="0" name="gebuehr" value="${settings.mahnGebuehr?.[stufe] ?? 0}"></div>
            <div class="field col-span-2"><label>Text</label><textarea name="text" rows="6">${escapeHtml(STUFE_TEXT[stufe] ? STUFE_TEXT[stufe](settings, frist) : '')}</textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern &amp; Drucken</button>
          </div>
        </form>
      `,
    });
    const kundePicker = mountChipPicker(body.querySelector('#f-mahn-kunde-host'), {
      name: 'kundeId', icon: '🏢', title: 'Kunde wählen', placeholder: '– Kunde wählen –',
      items: kunden, selectedId: '',
      itemLabel: (k) => k.firma, itemSub: (k) => [k.plz, k.ort].filter(Boolean).join(' '),
      onCreateNew: () => new Promise((resolve) => {
        openKundeSchnellanlage({
          onCreated: (neuerKunde) => { kunden.push(neuerKunde); kundenById[neuerKunde.id] = neuerKunde; resolve(neuerKunde); },
        });
      }),
    });
    const projektPicker = mountChipPicker(body.querySelector('#f-mahn-projekt-host'), {
      name: 'projektId', icon: '🔧', title: 'Projekt wählen', placeholder: '– Projekt wählen –',
      items: projekte, selectedId: '',
      itemLabel: (p) => p.titel, itemSub: (p) => kundenById[p.kundeId]?.firma || '',
      onCreateNew: () => new Promise((resolve) => {
        openProjektSchnellanlage({
          kundeId: kundePicker.getValue(),
          onCreated: (neuesProjekt) => { projekte.push(neuesProjekt); projekteById[neuesProjekt.id] = neuesProjekt; resolve(neuesProjekt); },
        });
      }),
    });
    body.querySelector('select[name="stufe"]').addEventListener('change', (e) => {
      const neueStufe = Number(e.target.value);
      body.querySelector('[name="gebuehr"]').value = settings.mahnGebuehr?.[neueStufe] ?? 0;
      body.querySelector('[name="text"]').value = STUFE_TEXT[neueStufe] ? STUFE_TEXT[neueStufe](settings, frist) : '';
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#mahn-manuell-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const kundeId = kundePicker.getValue();
      if (!kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }
      const fd = new FormData(e.target);
      const betrag = Number(fd.get('betrag'));
      if (!(betrag > 0)) { toast('Bitte einen Betrag größer 0 angeben', 'danger'); return; }
      const neueMahnung = {
        id: uid(), rechnungId: '', kundeId, projektId: projektPicker.getValue() || '',
        manuelleBezeichnung: (fd.get('bezeichnung') || '').toString().trim(),
        betrag, stufe: Number(fd.get('stufe')) || 1,
        datum: fd.get('datum') || today, neueFrist: fd.get('neueFrist') || addDays(today, frist),
        gebuehr: Number(fd.get('gebuehr')) || 0, text: (fd.get('text') || '').toString(),
        createdAt: new Date().toISOString(),
      };
      await put('mahnungen', neueMahnung);
      toast('Manuelle Mahnung erstellt', 'success');
      close();
      mahnungen.push(neueMahnung);
      printMahnung(neueMahnung);
      render(container);
    });
  }

  function openEditForm(m) {
    const kunde = kundeFuerMahnung(m);
    const { body, close } = openModal({
      title: `Mahnung Stufe ${m.stufe} bearbeiten – ${escapeHtml(bezeichnungFuerMahnung(m))}`,
      wide: true,
      bodyHtml: `
        <form id="mahn-edit-form">
          <p class="text-mute">${escapeHtml(bezeichnungFuerMahnung(m))} · ${escapeHtml(kunde?.firma || '')} · Betrag ${formatCurrency(betragFuerMahnung(m))}</p>
          <div class="form-grid">
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${m.datum}"></div>
            <div class="field"><label>Neue Zahlungsfrist</label><input type="date" name="neueFrist" value="${m.neueFrist}"></div>
            <div class="field"><label>Mahngebühr (€)</label><input type="number" step="0.01" min="0" name="gebuehr" value="${m.gebuehr}"></div>
            <div class="field col-span-2"><label>Text</label><textarea name="text" rows="6">${escapeHtml(m.text || '')}</textarea></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-danger" id="btn-delete-mahn">Löschen</button>
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#btn-delete-mahn').addEventListener('click', () => {
      openMahnungGrundDialog(`Mahnung Stufe ${m.stufe} löschen`, async (grund, grundText, grundLabel) => {
        await put('mahnungen', { ...m, loeschGrund: grund, loeschGrundText: grundText, loeschGrundLabel: grundLabel });
        await remove('mahnungen', m.id);
        toast('Mahnung in den Papierkorb verschoben');
        close();
        render(container);
      });
    });
    body.querySelector('#mahn-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...m };
      updated.datum = fd.get('datum') || m.datum;
      updated.neueFrist = fd.get('neueFrist') || m.neueFrist;
      updated.gebuehr = Number(fd.get('gebuehr')) || 0;
      updated.text = (fd.get('text') || '').toString();
      await put('mahnungen', updated);
      toast('Mahnung aktualisiert', 'success');
      close();
      render(container);
    });
  }
}
