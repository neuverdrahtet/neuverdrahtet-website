import { formatDateTime, hexToRgb } from './utils.js';

function logoFormat(dataUrl) {
  const m = /^data:image\/(png|jpe?g)/i.exec(dataUrl || '');
  if (!m) return null;
  return /jpe?g/i.test(m[1]) ? 'JPEG' : 'PNG';
}

function addFooter(doc, settings, marginX, rightX) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(210);
    doc.line(marginX, 279, rightX, 279);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    const col1 = [
      settings.firmenname,
      [settings.strasse, settings.plzOrt].filter(Boolean).join(', '),
      settings.telefon,
      settings.email,
      settings.website,
    ].filter(Boolean);
    const col2 = [
      settings.ustId ? `USt-IdNr.: ${settings.ustId}` : '',
      settings.steuernummer ? `Steuernummer: ${settings.steuernummer}` : '',
      settings.inhaber ? `Inhaber: ${settings.inhaber}` : '',
    ].filter(Boolean);
    const col3 = [
      settings.inhaber, settings.bank,
      settings.iban ? `IBAN: ${settings.iban}` : '',
      settings.bic ? `BIC: ${settings.bic}` : '',
    ].filter(Boolean);
    const colX = [marginX, marginX + 62, marginX + 124];
    const footerLineHeight = 3.3;
    [col1, col2, col3].forEach((col, ci) => {
      col.forEach((line, li) => doc.text(String(line), colX[ci], 282 + li * footerLineHeight));
    });
    doc.text(`Seite ${i}/${pageCount}`, rightX, 282, { align: 'right' });
  }
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

  const fmt = logoFormat(settings.logoDataUrl);
  if (fmt) {
    try {
      const props = doc.getImageProperties(settings.logoDataUrl);
      const logoColW = 74, maxW = 62, maxH = 30;
      const scale = Math.min(maxW / props.width, maxH / props.height, 1);
      const drawW = props.width * scale;
      const drawH = props.height * scale;
      const logoX = marginX + Math.max(0, (logoColW - drawW) / 2);
      doc.addImage(settings.logoDataUrl, fmt, logoX, y - 4, drawW, drawH);
    } catch (err) { /* ignore broken logo data */ }
  } else {
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(20);
    doc.text(settings.firmenname || '', marginX, y + 4);
    doc.setFont(undefined, 'normal');
  }

  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(formatDateTime(datum || new Date().toISOString()), rightX, y, { align: 'right' });

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
