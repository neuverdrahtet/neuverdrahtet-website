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

/**
 * Baut die HTML-Druckvorschau (Browser-Druckdialog). Muss optisch dem
 * echten PDF aus docpdf.js entsprechen (gleicher Aufbau: Logo/Meta-Box,
 * Absender-Zeile, Empfänger, Positionstabelle, Summenblock, Fußzeile).
 */
export function buildDocHtml({
  settings,
  art,
  nummer,
  datum,
  refLabel,
  refValue,
  kunde,
  betreff,
  projekt,
  introText,
  positionen,
  totals,
  closingText,
  steuerHinweis,
  showPositions = true,
  abschlaege,
}) {
  const absender = [settings.firmenname, settings.strasse, settings.plzOrt].filter(Boolean).map(escapeHtml).join(' · ');

  const metaRows = [
    [`${art}-Nr.:`, nummer],
    kunde?.kundennummer ? ['Kundennr.:', kunde.kundennummer] : null,
    ['Datum:', formatDate(datum)],
    refLabel ? [`${refLabel}:`, refValue] : null,
  ].filter(Boolean);

  let positionsHtml = '';
  if (showPositions && positionen && positionen.length) {
    const rows = positionen.map((p, i) => {
      const menge = Number(p.menge) || 0;
      const preis = Number(p.einzelpreis) || 0;
      const summe = menge * preis;
      return `<tr>
        <td>${escapeHtml(p.posNr || String(i + 1))}</td>
        <td>${escapeHtml(p.bezeichnung)}${p.beschreibung ? `<br><span style="color:#666;font-size:11px">${escapeHtml(p.beschreibung)}</span>` : ''}</td>
        <td>${menge}</td>
        <td>${escapeHtml(p.einheit || '')}</td>
        <td>${formatCurrency(preis)}</td>
        <td style="text-align:right">${formatCurrency(summe)}</td>
      </tr>`;
    }).join('');
    positionsHtml = `<table>
      <thead><tr><th>Pos.</th><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>Einzel €</th><th style="text-align:right">Gesamt €</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  let totalsHtml = '';
  if (totals) {
    const steuerRows = Object.entries(totals.steuerGruppen || {})
      .filter(([rate]) => Number(rate) > 0)
      .map(([rate, netto]) => `<div class="row"><span>zzgl. ${rate}% USt.</span><span>${formatCurrency(netto * (Number(rate) / 100))}</span></div>`)
      .join('');
    const abschlagRows = (abschlaege || [])
      .map((a) => `<div class="row"><span>Abzgl. Abschlagsrechnung ${escapeHtml(a.nummer)}</span><span>-${formatCurrency(a.betrag)}</span></div>`)
      .join('');
    const restbetragRow = abschlaege && abschlaege.length
      ? `<div class="row grand"><span>Noch zu zahlen</span><span>${formatCurrency(totals.brutto - abschlaege.reduce((s, a) => s + (a.betrag || 0), 0))}</span></div>`
      : '';
    totalsHtml = `<div class="print-totals">
      <div class="row"><span>Netto</span><span>${formatCurrency(totals.netto)}</span></div>
      ${steuerRows}
      <div class="row grand"><span>Gesamt</span><span>${formatCurrency(totals.brutto)}</span></div>
      ${abschlagRows}
      ${restbetragRow}
    </div>`;
  }

  const logoOrName = settings.logoDataUrl
    ? `<img src="${settings.logoDataUrl}" alt="${escapeHtml(settings.firmenname || '')}" class="print-logo">`
    : `<div class="print-firmenname">${escapeHtml(settings.firmenname || '')}</div>`;

  return `
    <div class="print-header">
      ${logoOrName}
      <div class="print-meta">
        <div class="print-meta-title">${escapeHtml(art)}</div>
        ${metaRows.map((row) => `<div class="row"><span>${escapeHtml(row[0])}</span><span>${escapeHtml(String(row[1] ?? ''))}</span></div>`).join('')}
      </div>
    </div>
    <div class="print-absender">${absender}</div>
    <div class="print-empfaenger">${kundeAdresse(kunde)}</div>
    ${betreff ? `<p>Gerne bieten wir Ihnen an: <strong>${escapeHtml(betreff)}</strong></p>` : ''}
    ${projekt ? `<p>Für das Projekt: <strong>${escapeHtml(projekt)}</strong></p>` : ''}
    ${introText ? `<p style="white-space:pre-wrap">${escapeHtml(introText)}</p>` : ''}
    ${positionsHtml}
    ${totalsHtml}
    ${(steuerHinweis || (settings.kleinunternehmer ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : '')) ? `<p style="font-size:11px;margin-top:10px">${escapeHtml(steuerHinweis || 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')}</p>` : ''}
    ${closingText ? `<p style="white-space:pre-wrap;margin-top:16px">${escapeHtml(closingText)}</p>` : ''}
    <div class="print-footer">
      <div>
        ${[settings.firmenname, [settings.strasse, settings.plzOrt].filter(Boolean).join(', '), settings.telefon, settings.email].filter(Boolean).map(escapeHtml).join('<br>')}
      </div>
      <div>
        ${settings.ustId ? `USt-IdNr.: ${escapeHtml(settings.ustId)}<br>` : ''}
        ${settings.steuernummer ? `Steuernummer: ${escapeHtml(settings.steuernummer)}<br>` : ''}
        ${settings.inhaber ? `Inhaber: ${escapeHtml(settings.inhaber)}` : ''}
      </div>
      <div>
        ${[settings.inhaber, settings.bank].filter(Boolean).map(escapeHtml).join('<br>')}
        ${settings.iban ? `<br>IBAN: ${escapeHtml(settings.iban)}` : ''}
        ${settings.bic ? `<br>BIC: ${escapeHtml(settings.bic)}` : ''}
      </div>
    </div>
  `;
}
