import { formatCurrency, formatDate, formatDateTime, hexToRgb } from './utils.js';

function logoFormat(dataUrl) {
  const m = /^data:image\/(png|jpe?g)/i.exec(dataUrl || '');
  if (!m) return null;
  return /jpe?g/i.test(m[1]) ? 'JPEG' : 'PNG';
}

const LOGO_SIZES = {
  klein: { maxW: 40, maxH: 20 },
  mittel: { maxW: 62, maxH: 30 },
  gross: { maxW: 86, maxH: 42 },
};

/** Zeichnet das Logo (oder ersatzweise den Firmennamen) an der eingestellten Position im Kopfbereich. */
function drawHeaderLogo(doc, settings, marginX, rightX, y) {
  const position = settings.dokLogoPosition || 'links';
  const { maxW, maxH } = LOGO_SIZES[settings.dokLogoGroesse] || LOGO_SIZES.mittel;
  const fmt = logoFormat(settings.logoDataUrl);
  if (!fmt) {
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    if (position === 'rechts') doc.text(settings.firmenname || '', rightX, y + 4, { align: 'right' });
    else if (position === 'mittig') doc.text(settings.firmenname || '', (marginX + rightX) / 2, y + 4, { align: 'center' });
    else doc.text(settings.firmenname || '', marginX, y + 4, { align: 'left' });
    doc.setFont(undefined, 'normal');
    return;
  }
  try {
    const props = doc.getImageProperties(settings.logoDataUrl);
    const scale = Math.min(maxW / props.width, maxH / props.height, 1);
    const drawW = props.width * scale;
    const drawH = props.height * scale;
    let logoX;
    if (position === 'rechts') logoX = rightX - drawW;
    else if (position === 'mittig') logoX = marginX + ((rightX - marginX) - drawW) / 2;
    else logoX = marginX;
    doc.addImage(settings.logoDataUrl, fmt, logoX, y - 4, drawW, drawH);
  } catch (err) { /* ignore broken logo data */ }
}

/** Titel/Datum im Kopfbereich weichen bei rechts positioniertem Logo auf die linke Seite aus, damit nichts überlappt. */
function headerCounterpart(settings, marginX, rightX) {
  return settings.dokLogoPosition === 'rechts' ? { x: marginX, align: 'left' } : { x: rightX, align: 'right' };
}

function addFooter(doc, settings, marginX, rightX) {
  const pageCount = doc.internal.getNumberOfPages();
  const zusatztext = (settings.dokFooterZusatztext || '').trim();
  const spalten = [];
  if (settings.dokFooterFirmendaten !== false) {
    spalten.push([
      settings.firmenname,
      [settings.strasse, settings.plzOrt].filter(Boolean).join(', '),
      settings.telefon,
      settings.email,
      settings.website,
    ].filter(Boolean));
  }
  if (settings.dokFooterSteuerdaten !== false) {
    spalten.push([
      settings.ustId ? `USt-IdNr.: ${settings.ustId}` : '',
      settings.steuernummer ? `Steuernummer: ${settings.steuernummer}` : '',
      settings.inhaber ? `Inhaber: ${settings.inhaber}` : '',
    ].filter(Boolean));
  }
  if (settings.dokFooterBankverbindung !== false) {
    spalten.push([
      settings.inhaber, settings.bank,
      settings.iban ? `IBAN: ${settings.iban}` : '',
      settings.bic ? `BIC: ${settings.bic}` : '',
    ].filter(Boolean));
  }

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(210);
    doc.line(marginX, 279, rightX, 279);
    doc.setFontSize(7.5);
    doc.setTextColor(120);

    let footerY = 282;
    if (zusatztext) {
      const lines = doc.splitTextToSize(zusatztext, rightX - marginX);
      doc.text(lines, marginX, footerY);
      footerY += lines.length * 3.3 + 1.5;
    }

    const footerLineHeight = 3.3;
    if (spalten.length) {
      const gap = (rightX - marginX) / spalten.length;
      spalten.forEach((col, ci) => {
        col.forEach((line, li) => doc.text(String(line), marginX + ci * gap, footerY + li * footerLineHeight));
      });
    }

    if (settings.dokFooterSeitenzahl !== false) doc.text(`Seite ${i}/${pageCount}`, rightX, footerY, { align: 'right' });
  }
}

export function buildDocPdfBlob(opts) {
  if (!window.jspdf) {
    throw new Error('PDF-Bibliothek konnte nicht geladen werden.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 18;
  const rightX = 192;
  let y = 20;
  const accentRgb = hexToRgb(opts.settings.dokAkzentfarbe);
  const baseFont = Number(opts.settings.dokSchriftgroesse) || 10;

  // --- Header: logo (an eingestellter Position) + Titel & Meta-Box (Gegenposition) ---
  drawHeaderLogo(doc, opts.settings, marginX, rightX, y);

  const { x: titleX, align: titleAlign } = headerCounterpart(opts.settings, marginX, rightX);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(20);
  doc.text(opts.art, titleX, y, { align: titleAlign });
  doc.setFont(undefined, 'normal');

  const metaRows = [
    [`${opts.art}-Nr.:`, opts.nummer],
    opts.kunde?.kundennummer ? ['Kundennr.:', opts.kunde.kundennummer] : null,
    ['Datum:', formatDate(opts.datum)],
    opts.refLabel ? [`${opts.refLabel}:`, opts.refValue] : null,
  ].filter(Boolean);
  doc.setFontSize(9);
  doc.setTextColor(60);
  metaRows.forEach((row, i) => {
    const my = y + 6 + i * 4.6;
    if (titleAlign === 'right') {
      doc.text(row[0], titleX - 32, my, { align: 'left' });
      doc.text(String(row[1] ?? ''), titleX, my, { align: 'right' });
    } else {
      doc.text(row[0], titleX, my, { align: 'left' });
      doc.text(String(row[1] ?? ''), titleX + 32, my, { align: 'right' });
    }
  });

  y += 30;

  // --- Sender line + recipient ---
  const absender = [opts.settings.firmenname, opts.settings.strasse, opts.settings.plzOrt].filter(Boolean).join(' · ');
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(absender, marginX, y);
  doc.setDrawColor(180);
  doc.line(marginX, y + 1, marginX + doc.getTextWidth(absender), y + 1);

  const kundeLines = [
    opts.kunde?.firma, opts.kunde?.ansprechpartner, opts.kunde?.strasse,
    [opts.kunde?.plz, opts.kunde?.ort].filter(Boolean).join(' '),
  ].filter(Boolean);
  doc.setFontSize(10.5);
  doc.setTextColor(20);
  kundeLines.forEach((line, i) => doc.text(String(line), marginX, y + 8 + i * 5));

  y += 8 + kundeLines.length * 5 + 12;

  if (opts.betreff) {
    doc.setFontSize(baseFont);
    doc.setTextColor(20);
    doc.text(`Gerne bieten wir Ihnen an: ${opts.betreff}`, marginX, y);
    y += 5.5;
  }
  if (opts.projekt) {
    doc.setFontSize(baseFont);
    doc.text(`Für das Projekt: ${opts.projekt}`, marginX, y);
    y += 5.5;
  }
  y += 4;

  if (opts.introText) {
    doc.setFontSize(baseFont);
    const lines = doc.splitTextToSize(opts.introText, 174);
    doc.text(lines, marginX, y);
    y += lines.length * 5 + 4;
  }

  if (opts.positionen && opts.positionen.length) {
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX, bottom: 24 },
      head: [['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzel €', 'Gesamt €']],
      body: opts.positionen.map((p, i) => [
        p.posNr || String(i + 1),
        p.bezeichnung || '',
        String(p.menge ?? ''),
        p.einheit || '',
        formatCurrency(p.einzelpreis),
        formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0)),
      ]),
      styles: { fontSize: Math.max(7, baseFont - 1), cellPadding: 2.2 },
      headStyles: { fillColor: accentRgb },
      columnStyles: { 0: { cellWidth: 14 } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (opts.totals) {
    doc.setFontSize(10);
    doc.text(`Netto: ${formatCurrency(opts.totals.netto)}`, rightX, y, { align: 'right' });
    y += 5;
    Object.entries(opts.totals.steuerGruppen || {})
      .filter(([rate]) => Number(rate) > 0)
      .forEach(([rate, netto]) => {
        doc.text(`zzgl. ${rate}% USt.: ${formatCurrency(netto * (Number(rate) / 100))}`, rightX, y, { align: 'right' });
        y += 5;
      });
    doc.setFont(undefined, 'bold');
    doc.text(`Gesamt: ${formatCurrency(opts.totals.brutto)}`, rightX, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    y += 8;

    if (opts.abschlaege && opts.abschlaege.length) {
      doc.setFontSize(9);
      opts.abschlaege.forEach((a) => {
        doc.text(`Abzgl. Abschlagsrechnung ${a.nummer}: -${formatCurrency(a.betrag)}`, rightX, y, { align: 'right' });
        y += 4.5;
      });
      const restbetrag = opts.totals.brutto - opts.abschlaege.reduce((s, a) => s + (a.betrag || 0), 0);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(`Noch zu zahlen: ${formatCurrency(restbetrag)}`, rightX, y, { align: 'right' });
      doc.setFont(undefined, 'normal');
      y += 6;
    }
    y += 2;
  }

  const steuerHinweisText = opts.steuerHinweis || (opts.settings.kleinunternehmer ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : '');
  if (steuerHinweisText) {
    doc.setFontSize(8);
    const hinweisLines = doc.splitTextToSize(steuerHinweisText, 174);
    doc.text(hinweisLines, marginX, y);
    y += hinweisLines.length * 3.6 + 4;
  }

  if (opts.closingText) {
    doc.setFontSize(baseFont);
    const lines = doc.splitTextToSize(opts.closingText, 174);
    doc.text(lines, marginX, y);
  }

  addFooter(doc, opts.settings, marginX, rightX);

  return doc.output('blob');
}

export function buildBerichtPdfBlob({ settings, titel, untertitel, text, datum, raeume, fotos, unterschriftKunde, unterschriftMitarbeiter }) {
  if (!window.jspdf) {
    throw new Error('PDF-Bibliothek konnte nicht geladen werden.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 18;
  const rightX = 192;
  let y = 20;
  const accentRgb = hexToRgb(settings.dokAkzentfarbe);
  const baseFont = Number(settings.dokSchriftgroesse) || 10;

  drawHeaderLogo(doc, settings, marginX, rightX, y);

  const { x: dateX, align: dateAlign } = headerCounterpart(settings, marginX, rightX);
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(formatDateTime(datum || new Date().toISOString()), dateX, y, { align: dateAlign });

  y += 24;
  doc.setDrawColor(180);
  doc.line(marginX, y, rightX, y);
  y += 10;

  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(20);
  doc.text(titel || 'Bericht', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 7;

  if (untertitel) {
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(untertitel, marginX, y);
    y += 8;
  } else {
    y += 3;
  }

  doc.setFontSize(baseFont);
  doc.setTextColor(20);
  const bodyLines = doc.splitTextToSize(text || '', rightX - marginX);
  const lineHeight = 5;
  const maxY = 270;
  bodyLines.forEach((line) => {
    if (y > maxY) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, marginX, y);
    y += lineHeight;
  });

  const raeumeGefuellt = (raeume || []).filter((r) => r.raum || r.beschreibung);
  if (raeumeGefuellt.length) {
    if (y > maxY - 20) { doc.addPage(); y = 20; }
    y += 4;
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX, bottom: 24 },
      head: [['Raum / Bereich', 'Beschreibung / Zustand']],
      body: raeumeGefuellt.map((r) => [r.raum || '', r.beschreibung || '']),
      styles: { fontSize: Math.max(7, baseFont - 1), cellPadding: 2.2 },
      headStyles: { fillColor: accentRgb },
      columnStyles: { 0: { cellWidth: 50 } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  const fotosGefuellt = (fotos || []).filter(Boolean);
  if (fotosGefuellt.length) {
    if (y > maxY - 20) { doc.addPage(); y = 20; }
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    doc.text('Fotos', marginX, y);
    doc.setFont(undefined, 'normal');
    y += 6;
    const fotoW = (rightX - marginX - 6) / 2;
    const fotoH = 55;
    fotosGefuellt.forEach((dataUrl, i) => {
      const col = i % 2;
      if (col === 0 && y + fotoH > maxY) { doc.addPage(); y = 20; }
      const x = marginX + col * (fotoW + 6);
      try {
        const fmtFoto = logoFormat(dataUrl) || 'JPEG';
        doc.addImage(dataUrl, fmtFoto, x, y, fotoW, fotoH, undefined, 'FAST');
      } catch (err) { /* ignore broken photo data */ }
      if (col === 1) y += fotoH + 6;
    });
    if (fotosGefuellt.length % 2 === 1) y += fotoH + 6;
    y += 2;
  }

  if (unterschriftKunde || unterschriftMitarbeiter) {
    const sigW = 70, sigH = 26;
    const col1X = marginX, col2X = marginX + sigW + 16;
    if (y + sigH + 12 > maxY) {
      doc.addPage();
      y = 20;
    }
    y += 8;
    if (unterschriftKunde) {
      try { doc.addImage(unterschriftKunde, 'PNG', col1X, y, sigW, sigH); } catch (err) { /* ignore broken signature data */ }
    }
    if (unterschriftMitarbeiter) {
      try { doc.addImage(unterschriftMitarbeiter, 'PNG', col2X, y, sigW, sigH); } catch (err) { /* ignore broken signature data */ }
    }
    y += sigH + 2;
    doc.setDrawColor(160);
    doc.line(col1X, y, col1X + sigW, y);
    doc.line(col2X, y, col2X + sigW, y);
    y += 4;
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text('Unterschrift Kunde', col1X, y);
    doc.text('Unterschrift Mitarbeiter', col2X, y);
  }

  addFooter(doc, settings, marginX, rightX);

  return doc.output('blob');
}
