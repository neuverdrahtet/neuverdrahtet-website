import { formatCurrency, formatDate, formatDateTime, hexToRgb } from './utils.js';
import { loadJsPdf } from './vendorLoader.js';

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

export async function buildDocPdfBlob(opts) {
  await loadJsPdf();
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
    opts.leistungsdatum ? ['Leistungsdatum:', formatDate(opts.leistungsdatum)] : null,
    opts.refLabel ? [`${opts.refLabel}:`, opts.refValue] : null,
  ].filter(Boolean);
  doc.setFontSize(9);
  doc.setTextColor(60);
  metaRows.forEach((row, i) => {
    const my = y + 6 + i * 4.6;
    const valueText = String(row[1] ?? '');
    // Label-Position hängt von der tatsächlichen Textbreite von Label bzw.
    // Wert ab (nicht von einem festen Abstand) - sonst überlappen sich bei
    // langen Dokumentarten wie "Auftragsbestätigung-Nr.:" Label und Wert.
    if (titleAlign === 'right') {
      const valueW = doc.getTextWidth(valueText);
      doc.text(row[0], titleX - valueW - 3, my, { align: 'right' });
      doc.text(valueText, titleX, my, { align: 'right' });
    } else {
      const labelW = doc.getTextWidth(row[0]);
      doc.text(row[0], titleX, my, { align: 'left' });
      doc.text(valueText, titleX + labelW + 3, my, { align: 'left' });
    }
  });

  y += 6 + metaRows.length * 4.6 + 6;

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
      body: opts.positionen.map((p, i) => (p.typ === 'ueberschrift'
        ? [{ content: p.bezeichnung || '', colSpan: 6, styles: { fontStyle: 'bold' } }]
        : [
          p.posNr || String(i + 1),
          p.bezeichnung || '',
          String(p.menge ?? ''),
          p.einheit || '',
          formatCurrency(p.einzelpreis),
          formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0)),
        ])),
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

  if (opts.aufbewahrungsHinweis) {
    doc.setFontSize(8);
    const aufbLines = doc.splitTextToSize(opts.aufbewahrungsHinweis, 174);
    doc.text(aufbLines, marginX, y);
    y += aufbLines.length * 3.6 + 4;
  }

  if (opts.closingText) {
    doc.setFontSize(baseFont);
    const lines = doc.splitTextToSize(opts.closingText, 174);
    doc.text(lines, marginX, y);
    y += lines.length * 5 + 4;
  }

  if (opts.zeigeUnterschriftsfeld) {
    const maxY = 270;
    if (y > maxY - 34) { doc.addPage(); y = 20; }
    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text('Ort, Datum: ______________________________', marginX, y);
    y += 12;
    const sigW = 70, sigH = 22;
    const col2X = marginX + sigW + 16;
    if (opts.unterschriftKunde) {
      try { doc.addImage(opts.unterschriftKunde, 'PNG', marginX, y - sigH + 4, sigW, sigH); } catch (err) { /* ignore broken signature data */ }
    }
    if (opts.zeigeZweiteUnterschrift && opts.unterschriftMitarbeiter) {
      try { doc.addImage(opts.unterschriftMitarbeiter, 'PNG', col2X, y - sigH + 4, sigW, sigH); } catch (err) { /* ignore broken signature data */ }
    }
    doc.setDrawColor(160);
    doc.line(marginX, y, marginX + sigW, y);
    if (opts.zeigeZweiteUnterschrift) doc.line(col2X, y, col2X + sigW, y);
    y += 4;
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text('Unterschrift Kunde', marginX, y);
    if (opts.zeigeZweiteUnterschrift) doc.text(opts.zweiteUnterschriftLabel || 'Unterschrift Mitarbeiter', col2X, y);
  }

  addFooter(doc, opts.settings, marginX, rightX);

  return doc.output('blob');
}

/** Zeichnet ein zweispaltiges Label/Wert-Raster (z.B. Geräte-Steckbrief, Messwerte). */
function drawKopfdatenBlock(doc, block, marginX, rightX, y, baseFont, maxY) {
  const felder = (block.felder || []).filter((f) => f.wert);
  if (!felder.length) return y;
  if (y > maxY - 16) { doc.addPage(); y = 20; }
  if (block.titel) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    doc.text(block.titel, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 6;
  }
  const colW = (rightX - marginX - 10) / 2;
  let col = 0;
  felder.forEach((f) => {
    if (col === 0 && y > maxY - 10) { doc.addPage(); y = 20; }
    const x = marginX + col * (colW + 10);
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(f.label || '', x, y);
    doc.setFontSize(baseFont);
    doc.setTextColor(20);
    doc.text(String(f.wert ?? ''), x, y + 4.5);
    if (col === 1) y += 10;
    col = 1 - col;
  });
  if (col === 1) y += 10;
  return y + 4;
}

/** Zeichnet eine Liste von Ja/Nein-Fragen mit farblich hervorgehobener Antwort. */
function drawJaNeinBlock(doc, block, marginX, rightX, y, baseFont, maxY) {
  const antworten = (block.antworten || []).filter((a) => a.frage);
  if (!antworten.length) return y;
  if (y > maxY - 12) { doc.addPage(); y = 20; }
  if (block.titel) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    doc.text(block.titel, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 6;
  }
  doc.setFontSize(baseFont);
  antworten.forEach((a) => {
    if (y > maxY) { doc.addPage(); y = 20; }
    doc.setTextColor(20);
    const label = `${a.frage}: `;
    doc.text(label, marginX, y);
    const labelW = doc.getTextWidth(label);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...(a.antwort === 'ja' ? [31, 138, 76] : [192, 57, 43]));
    doc.text(a.antwort === 'ja' ? 'Ja' : 'Nein', marginX + labelW, y);
    doc.setFont(undefined, 'normal');
    y += 5.5;
  });
  return y + 3;
}

/** Zeichnet eine Liste abhakbarer Punkte (Sichtprüfung, Ergebnis, ...) als [X]/[ ]. */
function drawChecklisteBlock(doc, block, marginX, rightX, y, baseFont, maxY) {
  const punkte = (block.punkte || []).filter((p) => p.punkt);
  if (!punkte.length) return y;
  if (y > maxY - 12) { doc.addPage(); y = 20; }
  if (block.titel) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    doc.text(block.titel, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 6;
  }
  doc.setFontSize(baseFont);
  doc.setTextColor(20);
  punkte.forEach((p) => {
    if (y > maxY) { doc.addPage(); y = 20; }
    doc.text(`${p.checked ? '[X]' : '[ ]'} ${p.punkt}`, marginX, y);
    y += 5.5;
  });
  return y + 3;
}

/** Zeichnet eine frei konfigurierte Tabelle mit optionaler Produkt-Berechnung (z.B. RPZ = B*A*E). */
function drawTabelleBlock(doc, block, marginX, rightX, y, baseFont, accentRgb, maxY) {
  const spalten = block.spalten || [];
  const rows = (block.rows || []).filter((r) => spalten.some((s) => r[s]));
  if (!spalten.length || !rows.length) return y;
  if (y > maxY - 20) { doc.addPage(); y = 20; }
  if (block.titel) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    doc.text(block.titel, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 6;
  }
  const head = block.ergebnisSpalte ? [...spalten, block.ergebnisSpalte] : [...spalten];
  const body = rows.map((row) => {
    const cells = spalten.map((s) => (row[s] ?? '').toString());
    if (block.ergebnisSpalte) {
      const zahlen = spalten.slice(1).map((s) => Number(row[s]) || 0);
      const produkt = zahlen.length ? zahlen.reduce((a, b) => a * b, 1) : '';
      cells.push(produkt === '' ? '' : String(produkt));
    }
    return cells;
  });
  doc.autoTable({
    startY: y,
    margin: { left: marginX, right: marginX, bottom: 24 },
    head: [head],
    body,
    styles: { fontSize: Math.max(7, baseFont - 1), cellPadding: 2.2 },
    headStyles: { fillColor: accentRgb },
  });
  return doc.lastAutoTable.finalY + 8;
}

/** Zeichnet die Tageseinträge eines Bautagebuchs als Tabelle (Datum/Wetter/Personen/Vorkommnisse). */
function drawTagesprotokollBlock(doc, eintraege, marginX, rightX, y, baseFont, accentRgb, maxY) {
  const rows = (eintraege || []).filter((r) => r.wetter || r.personen || r.vorkommnisse);
  if (!rows.length) return y;
  if (y > maxY - 20) { doc.addPage(); y = 20; }
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(20);
  doc.text('Bautagebuch – Tageseinträge', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;
  doc.autoTable({
    startY: y,
    margin: { left: marginX, right: marginX, bottom: 24 },
    head: [['Datum', 'Wetter', 'Personen vor Ort', 'Vorkommnisse/Besonderheiten']],
    body: rows.map((r) => [formatDate(r.datum) || '', r.wetter || '', r.personen ?? '', r.vorkommnisse || '']),
    styles: { fontSize: Math.max(7, baseFont - 1), cellPadding: 2.2 },
    headStyles: { fillColor: accentRgb },
  });
  return doc.lastAutoTable.finalY + 8;
}

/** Zeichnet ein 2-spaltiges Fotoraster ab der aktuellen Y-Position, seitenumbruchsicher. */
function drawFotoGrid(doc, fotos, marginX, rightX, y, maxY) {
  const fotoW = (rightX - marginX - 6) / 2;
  const fotoH = 55;
  fotos.forEach((dataUrl, i) => {
    const col = i % 2;
    if (col === 0 && y + fotoH > maxY) { doc.addPage(); y = 20; }
    const x = marginX + col * (fotoW + 6);
    try {
      const fmtFoto = logoFormat(dataUrl) || 'JPEG';
      doc.addImage(dataUrl, fmtFoto, x, y, fotoW, fotoH, undefined, 'FAST');
    } catch (err) { /* ignore broken photo data */ }
    if (col === 1) y += fotoH + 6;
  });
  if (fotos.length % 2 === 1) y += fotoH + 6;
  return y + 2;
}

export async function buildBerichtPdfBlob({
  settings, titel, untertitel, text, datum, raeume, fotos,
  unterschriftKunde, unterschriftMitarbeiter, unterschriften,
  kopfdaten, jaNeinAntworten, checklisteAntworten, tabellenAbschnitte, tagesprotokoll,
}) {
  await loadJsPdf();
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

  const maxY = 270;
  (kopfdaten || []).forEach((block) => { y = drawKopfdatenBlock(doc, block, marginX, rightX, y, baseFont, maxY); });
  (jaNeinAntworten || []).forEach((block) => { y = drawJaNeinBlock(doc, block, marginX, rightX, y, baseFont, maxY); });
  (tabellenAbschnitte || []).forEach((block) => { y = drawTabelleBlock(doc, block, marginX, rightX, y, baseFont, accentRgb, maxY); });
  y = drawTagesprotokollBlock(doc, tagesprotokoll, marginX, rightX, y, baseFont, accentRgb, maxY);

  doc.setFontSize(baseFont);
  doc.setTextColor(20);
  const bodyLines = doc.splitTextToSize(text || '', rightX - marginX);
  const lineHeight = 5;
  bodyLines.forEach((line) => {
    if (y > maxY) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, marginX, y);
    y += lineHeight;
  });
  y += 3;

  (checklisteAntworten || []).forEach((block) => { y = drawChecklisteBlock(doc, block, marginX, rightX, y, baseFont, maxY); });

  const raeumeGefuellt = (raeume || []).filter((r) => r.raum || r.beschreibung || r.laenge || r.breite);
  if (raeumeGefuellt.length) {
    if (y > maxY - 20) { doc.addPage(); y = 20; }
    y += 4;
    const mitMassen = raeumeGefuellt.some((r) => r.laenge || r.breite);
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX, bottom: 24 },
      head: mitMassen
        ? [['Raum / Bereich', 'Länge (m)', 'Breite (m)', 'm²', 'Beschreibung / Zustand']]
        : [['Raum / Bereich', 'Beschreibung / Zustand']],
      body: raeumeGefuellt.map((r) => {
        if (!mitMassen) return [r.raum || '', r.beschreibung || ''];
        const m2 = (Number(r.laenge) || 0) * (Number(r.breite) || 0);
        return [r.raum || '', r.laenge ? String(r.laenge) : '', r.breite ? String(r.breite) : '', m2 ? m2.toFixed(2) : '', r.beschreibung || ''];
      }),
      styles: { fontSize: Math.max(7, baseFont - 1), cellPadding: 2.2 },
      headStyles: { fillColor: accentRgb },
      columnStyles: mitMassen ? {} : { 0: { cellWidth: 50 } },
    });
    y = doc.lastAutoTable.finalY + 8;

    const raeumeMitFotos = raeumeGefuellt.filter((r) => (r.fotos || []).filter(Boolean).length);
    raeumeMitFotos.forEach((r) => {
      if (y > maxY - 20) { doc.addPage(); y = 20; }
      doc.setFontSize(9.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(20);
      doc.text(`Fotos – ${r.raum || 'Raum'}`, marginX, y);
      doc.setFont(undefined, 'normal');
      y += 5;
      y = drawFotoGrid(doc, r.fotos.filter(Boolean), marginX, rightX, y, maxY);
    });
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
    y = drawFotoGrid(doc, fotosGefuellt, marginX, rightX, y, maxY);
  }

  const unterschriftenListe = (unterschriften && unterschriften.length)
    ? unterschriften.filter((u) => u.dataUrl)
    : [
        unterschriftKunde ? { label: 'Unterschrift Kunde', dataUrl: unterschriftKunde } : null,
        unterschriftMitarbeiter ? { label: 'Unterschrift Mitarbeiter', dataUrl: unterschriftMitarbeiter } : null,
      ].filter(Boolean);
  if (unterschriftenListe.length) {
    const sigW = 70, sigH = 26, gap = 16;
    for (let rowStart = 0; rowStart < unterschriftenListe.length; rowStart += 2) {
      const sigRow = unterschriftenListe.slice(rowStart, rowStart + 2);
      if (y + sigH + 12 > maxY) {
        doc.addPage();
        y = 20;
      }
      y += 8;
      sigRow.forEach((u, i) => {
        const x = marginX + i * (sigW + gap);
        try { doc.addImage(u.dataUrl, 'PNG', x, y, sigW, sigH); } catch (err) { /* ignore broken signature data */ }
      });
      y += sigH + 2;
      doc.setDrawColor(160);
      sigRow.forEach((u, i) => {
        const x = marginX + i * (sigW + gap);
        doc.line(x, y, x + sigW, y);
      });
      y += 4;
      doc.setFontSize(8);
      doc.setTextColor(110);
      sigRow.forEach((u, i) => {
        const x = marginX + i * (sigW + gap);
        doc.text(u.label, x, y);
      });
    }
  }

  addFooter(doc, settings, marginX, rightX);

  return doc.output('blob');
}
