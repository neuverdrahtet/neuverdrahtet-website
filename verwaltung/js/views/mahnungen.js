import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, daysBetween, toast, calcTotals } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';

const STUFE_TEXT = {
  1: (settings, frist) => `wir müssen Sie leider daran erinnern, dass die unten genannte Rechnung noch nicht beglichen wurde. Wir bitten Sie, den offenen Betrag innerhalb der nächsten ${frist} Tage auf unser Konto zu überweisen. Sollten Sie bereits gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.`,
  2: (settings, frist) => `trotz unserer Zahlungserinnerung konnten wir bislang keinen Zahlungseingang zur unten genannten Rechnung feststellen. Wir bitten Sie dringend, den offenen Betrag zzgl. Mahngebühr innerhalb der nächsten ${frist} Tage zu begleichen.`,
  3: (settings, frist) => `trotz mehrfacher Zahlungsaufforderung ist der offene Betrag weiterhin nicht bei uns eingegangen. Wir fordern Sie hiermit letztmalig auf, den Gesamtbetrag zzgl. Mahngebühr innerhalb von ${frist} Tagen zu begleichen. Andernfalls sehen wir uns gezwungen, weitere Schritte zur Beitreibung der Forderung einzuleiten.`,
};

export async function render(container) {
  let [rechnungen, kunden, mahnungen, settings] = await Promise.all([
    getAll('rechnungen'), getAll('kunden'), getAll('mahnungen'), getSettings(),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const rechnungenById = Object.fromEntries(rechnungen.map((r) => [r.id, r]));
  const today = todayISO();

  const overdue = rechnungen
    .filter((r) => (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < today)
    .map((r) => {
      const stufeCount = mahnungen.filter((m) => m.rechnungId === r.id).length;
      return { r, stufeCount, nextStufe: Math.min(stufeCount + 1, 3), tageUeberfaellig: daysBetween(r.faelligAm, today) };
    })
    .sort((a, b) => b.tageUeberfaellig - a.tageUeberfaellig);

  mahnungen.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

  container.innerHTML = `
    <div class="view-header"><h1>Mahnungen</h1></div>

    <div class="card">
      <h2>Überfällige Rechnungen</h2>
      ${overdue.length === 0 ? '<p class="text-mute">Aktuell keine überfälligen Rechnungen.</p>' : `
        <table class="data-table">
          <thead><tr><th>Rechnung</th><th>Kunde</th><th>Fällig am</th><th>Tage überfällig</th><th>Bisherige Mahnungen</th><th class="text-right">Betrag</th><th></th></tr></thead>
          <tbody>
            ${overdue.map(({ r, stufeCount, nextStufe, tageUeberfaellig }) => `
              <tr>
                <td>${escapeHtml(r.nummer)}</td>
                <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
                <td>${formatDate(r.faelligAm)}</td>
                <td><span class="badge badge-danger">${tageUeberfaellig} Tage</span></td>
                <td>${stufeCount}</td>
                <td class="text-right">${formatCurrency(r.brutto)}</td>
                <td><button class="btn btn-sm btn-primary btn-create-mahnung" data-rid="${r.id}" data-stufe="${nextStufe}">Mahnung Stufe ${nextStufe}</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div class="card">
      <h2>Erstellte Mahnungen</h2>
      ${mahnungen.length === 0 ? '<p class="text-mute">Noch keine Mahnungen erstellt.</p>' : `
        <table class="data-table">
          <thead><tr><th>Rechnung</th><th>Kunde</th><th>Stufe</th><th>Datum</th><th class="text-right">Mahngebühr</th><th></th></tr></thead>
          <tbody>
            ${mahnungen.map((m) => {
              const rech = rechnungenById[m.rechnungId];
              return `
              <tr data-id="${m.id}">
                <td>${escapeHtml(rech?.nummer || '–')}</td>
                <td>${escapeHtml(kundenById[rech?.kundeId]?.firma || '')}</td>
                <td><span class="badge badge-warn">Stufe ${m.stufe}</span></td>
                <td>${formatDate(m.datum)}</td>
                <td class="text-right">${formatCurrency(m.gebuehr)}</td>
                <td>
                  <button class="btn btn-sm btn-edit-mahnung" data-id="${m.id}">Bearbeiten</button>
                  <button class="btn btn-sm btn-print-mahnung" data-id="${m.id}">Drucken</button>
                  ${kundenById[rech?.kundeId]?.email ? `<button class="btn btn-sm btn-email-mahnung" data-id="${m.id}">E-Mail</button>` : ''}
                  ${kundenById[rech?.kundeId]?.telefon ? `<button class="btn btn-sm btn-whatsapp-mahnung" data-id="${m.id}">WhatsApp</button>` : ''}
                  <button class="btn btn-sm btn-danger btn-del-mahnung" data-id="${m.id}">Löschen</button>
                </td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  container.querySelectorAll('.btn-create-mahnung').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rechnung = rechnungenById[btn.dataset.rid];
      openForm(rechnung, Number(btn.dataset.stufe));
    });
  });
  container.querySelectorAll('.btn-edit-mahnung').forEach((btn) => {
    btn.addEventListener('click', () => openEditForm(mahnungen.find((m) => m.id === btn.dataset.id)));
  });
  container.querySelectorAll('.btn-print-mahnung').forEach((btn) => {
    btn.addEventListener('click', () => printMahnung(mahnungen.find((m) => m.id === btn.dataset.id)));
  });
  container.querySelectorAll('.btn-email-mahnung').forEach((btn) => {
    btn.addEventListener('click', () => emailMahnung(mahnungen.find((m) => m.id === btn.dataset.id)));
  });
  container.querySelectorAll('.btn-whatsapp-mahnung').forEach((btn) => {
    btn.addEventListener('click', () => whatsappMahnung(mahnungen.find((m) => m.id === btn.dataset.id)));
  });
  container.querySelectorAll('.btn-del-mahnung').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('Mahnung wirklich löschen?')) return;
      await remove('mahnungen', btn.dataset.id);
      toast('Mahnung gelöscht');
      render(container);
    });
  });

  function mahnungDocOpts(m) {
    const rech = rechnungenById[m.rechnungId];
    const kunde = kundenById[rech?.kundeId];
    const positionen = [
      { bezeichnung: `Offener Betrag Rechnung ${rech?.nummer || ''}`, menge: 1, einheit: '', einzelpreis: rech?.brutto || 0, steuersatz: 0 },
      { bezeichnung: 'Mahngebühr', menge: 1, einheit: '', einzelpreis: m.gebuehr || 0, steuersatz: 0 },
    ];
    return {
      settings, art: `${m.stufe}. Mahnung`, nummer: rech?.nummer || '', datum: m.datum,
      refLabel: 'Neue Zahlungsfrist', refValue: formatDate(m.neueFrist),
      kunde, betreff: `Zahlungserinnerung zu Rechnung ${rech?.nummer || ''} vom ${formatDate(rech?.datum)}`,
      introText: m.text,
      positionen, totals: calcTotals(positionen),
      closingText: '',
    };
  }

  function printMahnung(m) {
    if (!m) return;
    printHtml(buildDocHtml(mahnungDocOpts(m)));
  }

  function emailMahnung(m) {
    if (!m) return;
    const rech = rechnungenById[m.rechnungId];
    const kunde = kundenById[rech?.kundeId];
    openEmailComposer({
      to: kunde?.email || '',
      subject: `${m.stufe}. Mahnung zu Rechnung ${rech?.nummer || ''}`,
      bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\n${m.text}\n\nMit freundlichen Grüßen\n${settings.firmenname}`,
      filename: `Mahnung-${m.stufe}-${rech?.nummer || ''}.pdf`,
      buildPdfBlob: () => buildDocPdfBlob(mahnungDocOpts(m)),
    });
  }

  function whatsappMahnung(m) {
    if (!m) return;
    const rech = rechnungenById[m.rechnungId];
    const kunde = kundenById[rech?.kundeId];
    sendDocumentViaWhatsApp({
      phone: kunde?.telefon,
      text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei die ${m.stufe}. Mahnung zu Rechnung ${rech?.nummer || ''}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${settings.firmenname}`,
      pdfBlob: buildDocPdfBlob(mahnungDocOpts(m)),
      filename: `Mahnung-${m.stufe}-${rech?.nummer || ''}.pdf`,
    });
  }

  function openForm(rechnung, stufe) {
    const frist = settings.mahnfristTage || 10;
    const gebuehr = settings.mahnGebuehr?.[stufe] ?? 0;
    const data = {
      id: uid(), rechnungId: rechnung.id, stufe, datum: today,
      neueFrist: addDays(today, frist), gebuehr,
      text: STUFE_TEXT[stufe] ? STUFE_TEXT[stufe](settings, frist) : '',
      createdAt: new Date().toISOString(),
    };
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

  function openEditForm(m) {
    const rech = rechnungenById[m.rechnungId];
    const { body, close } = openModal({
      title: `Mahnung Stufe ${m.stufe} bearbeiten – ${rech?.nummer || ''}`,
      wide: true,
      bodyHtml: `
        <form id="mahn-edit-form">
          <p class="text-mute">Rechnung ${escapeHtml(rech?.nummer || '')} · ${escapeHtml(kundenById[rech?.kundeId]?.firma || '')} · Betrag ${formatCurrency(rech?.brutto)}</p>
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
    body.querySelector('#btn-delete-mahn').addEventListener('click', async () => {
      if (!confirmDelete('Mahnung wirklich löschen?')) return;
      await remove('mahnungen', m.id);
      toast('Mahnung gelöscht');
      close();
      render(container);
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
