import { formatCurrency, formatDate, escapeHtml } from './utils.js';

export function printHtml(bodyHtml) {
  const root = document.getElementById('print-root');
  root.innerHTML = `<div class="print-doc">${bodyHtml}</div>`;
  setTimeout(() => window.print(), 60);
}

window.addEventListener('afterprint', () => {
  const root = document.getElementById('print-root');
  if (root) root.innerHTML = '';
});

function kundeAdresse(kunde) {
  if (!kunde) return '';
  return [
    kunde.firma,
    kunde.ansprechpartner,
    kunde.strasse,
    [kunde.plz, kunde.ort].filter(Boolean).join(' '),
  ].filter(Boolean).map(escapeHtml).join('<br>');
}

export function buildDocHtml({
  settings,
  art,
  nummer,
  datum,
  refLabel,
  refValue,
  kunde,
  betreff,
  introText,
  positionen,
  totals,
  closingText,
  showPositions = true,
}) {
  const absender = [
    settings.firmenname,
    settings.strasse,
    settings.plzOrt,
  ].filter(Boolean).map(escapeHtml).join(' · ');

  let positionsHtml = '';
  if (showPositions && positionen && positionen.length) {
    const rows = positionen.map((p, i) => {
      const menge = Number(p.menge) || 0;
      const preis = Number(p.einzelpreis) || 0;
      const summe = menge * preis;
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.bezeichnung)}${p.beschreibung ? `<br><span style="color:#666;font-size:11px">${escapeHtml(p.beschreibung)}</span>` : ''}</td>
        <td>${menge}</td>
        <td>${escapeHtml(p.einheit || '')}</td>
        <td>${formatCurrency(preis)}</td>
        <td>${p.steuersatz}%</td>
        <td style="text-align:right">${formatCurrency(summe)}</td>
      </tr>`;
    }).join('');
    positionsHtml = `<table>
      <thead><tr><th>#</th><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>USt.</th><th style="text-align:right">Netto</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  let totalsHtml = '';
  if (totals) {
    const steuerRows = Object.entries(totals.steuerGruppen || {})
      .filter(([rate]) => Number(rate) > 0)
      .map(([rate, netto]) => `<div class="row"><span>zzgl. ${rate}% USt.</span><span>${formatCurrency(netto * (Number(rate) / 100))}</span></div>`)
      .join('');
    totalsHtml = `<div class="print-totals">
      <div class="row"><span>Netto</span><span>${formatCurrency(totals.netto)}</span></div>
      ${steuerRows}
      <div class="row grand"><span>Gesamt${art === 'RECHNUNG' || art === 'MAHNUNG' ? ' (brutto)' : ''}</span><span>${formatCurrency(totals.brutto)}</span></div>
    </div>`;
  }

  return `
    <div class="print-header">
      <div>
        <div style="font-size:11px;color:#666;margin-bottom:16px">${absender}</div>
        <div style="font-size:13px;line-height:1.5">${kundeAdresse(kunde)}</div>
      </div>
      <div style="text-align:right;font-size:12px;line-height:1.6">
        <div><strong>${escapeHtml(settings.firmenname || '')}</strong></div>
        <div>${escapeHtml(settings.strasse || '')}</div>
        <div>${escapeHtml(settings.plzOrt || '')}</div>
        <div>${escapeHtml(settings.telefon || '')}</div>
        <div>${escapeHtml(settings.email || '')}</div>
        ${settings.ustId ? `<div>USt-ID: ${escapeHtml(settings.ustId)}</div>` : ''}
      </div>
    </div>
    <h1>${escapeHtml(art)} ${escapeHtml(nummer)}</h1>
    <div style="font-size:13px;margin-bottom:10px">
      <div><strong>Datum:</strong> ${formatDate(datum)}</div>
      ${refLabel ? `<div><strong>${escapeHtml(refLabel)}:</strong> ${escapeHtml(refValue)}</div>` : ''}
    </div>
    ${betreff ? `<p><strong>${escapeHtml(betreff)}</strong></p>` : ''}
    ${introText ? `<p style="white-space:pre-wrap">${escapeHtml(introText)}</p>` : ''}
    ${positionsHtml}
    ${totalsHtml}
    ${settings.kleinunternehmer ? '<p style="font-size:11px;margin-top:10px">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>' : ''}
    ${closingText ? `<p style="white-space:pre-wrap;margin-top:16px">${escapeHtml(closingText)}</p>` : ''}
    <div class="print-footer">
      ${escapeHtml(settings.firmenname || '')} · ${escapeHtml(settings.strasse || '')} · ${escapeHtml(settings.plzOrt || '')}
      ${settings.iban ? ` · IBAN: ${escapeHtml(settings.iban)}` : ''}
      ${settings.bic ? ` · BIC: ${escapeHtml(settings.bic)}` : ''}
      ${settings.bank ? ` · ${escapeHtml(settings.bank)}` : ''}
      ${settings.steuernummer ? ` · Steuernr.: ${escapeHtml(settings.steuernummer)}` : ''}
    </div>
  `;
}
