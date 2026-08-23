import { formatCurrency, formatDate, escapeHtml, toast } from './utils.js';

export function printHtml(bodyHtml, settings) {
  const root = document.getElementById('print-root');
  const accent = settings?.dokAkzentfarbe || '#0f1b2d';
  const fontSize = Number(settings?.dokSchriftgroesse) || 10;
  root.innerHTML = `<div class="print-doc" style="--dok-akzent:${escapeHtml(accent)};--dok-fontsize:${fontSize}px">${bodyHtml}</div>`;
  setTimeout(() => window.print(), 60);
}

// Als Home-Bildschirm-App installiert (iOS "Zum Home-Bildschirm", Android
// PWA) läuft die Seite im "standalone"/"fullscreen" Anzeigemodus - dort
// unterstützen die meisten mobilen Browser (v.a. iOS Safari) window.print()
// nicht: der Aufruf tut dann einfach gar nichts, ohne Fehler. "Drucken/PDF"
// wirkte dadurch als würde nichts passieren. Dort stattdessen ein echtes PDF
// bauen und in einem neuen Tab öffnen - von dort aus lässt sich über das
// Teilen-/Drucken-Symbol der PDF-Ansicht drucken oder speichern.
function isStandaloneDisplay() {
  return window.navigator.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches;
}

/**
 * Druckt ein Dokument (Angebot/AB/Rechnung/Mahnung): öffnet im normalen
 * Browser-Tab den nativen Druckdialog (schnellster Weg zum Drucker), baut
 * aber im Home-Bildschirm-App-Modus stattdessen ein echtes PDF und öffnet es
 * in einem neuen Tab, da window.print() dort meist wirkungslos bleibt.
 */
export async function printDokument({ bodyHtml, settings, buildPdfBlob }) {
  if (!isStandaloneDisplay()) {
    printHtml(bodyHtml, settings);
    return;
  }
  try {
    const blob = await buildPdfBlob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    toast(err.message || 'PDF konnte nicht erstellt werden', 'danger');
  }
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
  leistungsdatum,
  aufbewahrungsHinweis,
  zeigeUnterschriftsfeld,
  unterschriftKunde,
  zeigeZweiteUnterschrift,
  unterschriftMitarbeiter,
  zweiteUnterschriftLabel,
}) {
  const absender = [settings.firmenname, settings.strasse, settings.plzOrt].filter(Boolean).map(escapeHtml).join(' · ');

  const metaRows = [
    [`${art}-Nr.:`, nummer],
    kunde?.kundennummer ? ['Kundennr.:', kunde.kundennummer] : null,
    ['Datum:', formatDate(datum)],
    leistungsdatum ? ['Leistungsdatum:', formatDate(leistungsdatum)] : null,
    refLabel ? [`${refLabel}:`, refValue] : null,
  ].filter(Boolean);

  let positionsHtml = '';
  if (showPositions && positionen && positionen.length) {
    const rows = positionen.map((p, i) => {
      if (p.typ === 'ueberschrift') {
        return `<tr><td colspan="6" style="font-weight:700;padding-top:10px">${escapeHtml(p.bezeichnung || '')}</td></tr>`;
      }
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

  const logoPosition = settings.dokLogoPosition || 'links';
  const logoGroesse = settings.dokLogoGroesse || 'mittel';
  const headerClass = `print-header pos-${logoPosition}`;

  const footerBloecke = [];
  if (settings.dokFooterFirmendaten !== false) {
    footerBloecke.push(`<div>${[settings.firmenname, [settings.strasse, settings.plzOrt].filter(Boolean).join(', '), settings.telefon, settings.email].filter(Boolean).map(escapeHtml).join('<br>')}</div>`);
  }
  if (settings.dokFooterSteuerdaten !== false) {
    footerBloecke.push(`<div>
      ${settings.ustId ? `USt-IdNr.: ${escapeHtml(settings.ustId)}<br>` : ''}
      ${settings.steuernummer ? `Steuernummer: ${escapeHtml(settings.steuernummer)}<br>` : ''}
      ${settings.inhaber ? `Inhaber: ${escapeHtml(settings.inhaber)}` : ''}
    </div>`);
  }
  if (settings.dokFooterBankverbindung !== false) {
    footerBloecke.push(`<div>
      ${[settings.inhaber, settings.bank].filter(Boolean).map(escapeHtml).join('<br>')}
      ${settings.iban ? `<br>IBAN: ${escapeHtml(settings.iban)}` : ''}
      ${settings.bic ? `<br>BIC: ${escapeHtml(settings.bic)}` : ''}
    </div>`);
  }

  return `
    <div class="${headerClass}">
      <div class="print-logo-col print-logo-${logoGroesse}">${logoOrName}</div>
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
    ${aufbewahrungsHinweis ? `<p style="font-size:11px;margin-top:4px">${escapeHtml(aufbewahrungsHinweis)}</p>` : ''}
    ${closingText ? `<p style="white-space:pre-wrap;margin-top:16px">${escapeHtml(closingText)}</p>` : ''}
    ${zeigeUnterschriftsfeld ? `
    <div class="print-unterschrift">
      <div class="print-unterschrift-ort">Ort, Datum: ____________________________</div>
      <div class="print-unterschrift-reihe">
        <div class="print-unterschrift-feld">
          ${unterschriftKunde ? `<img src="${unterschriftKunde}" class="print-unterschrift-bild" alt="Unterschrift Kunde">` : ''}
          <div class="print-unterschrift-linie"></div>
          <div class="print-unterschrift-label">Unterschrift Kunde</div>
        </div>
        ${zeigeZweiteUnterschrift ? `
        <div class="print-unterschrift-feld">
          ${unterschriftMitarbeiter ? `<img src="${unterschriftMitarbeiter}" class="print-unterschrift-bild" alt="${escapeHtml(zweiteUnterschriftLabel || 'Unterschrift Mitarbeiter')}">` : ''}
          <div class="print-unterschrift-linie"></div>
          <div class="print-unterschrift-label">${escapeHtml(zweiteUnterschriftLabel || 'Unterschrift Mitarbeiter')}</div>
        </div>` : ''}
      </div>
    </div>` : ''}
    <div class="print-footer">
      ${settings.dokFooterZusatztext ? `<div class="print-footer-zusatz">${escapeHtml(settings.dokFooterZusatztext)}</div>` : ''}
      <div class="print-footer-spalten">${footerBloecke.join('')}</div>
    </div>
  `;
}
