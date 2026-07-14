import { formatCurrency, formatDate } from './utils.js';

export function buildDocPdfBlob(opts) {
  if (!window.jspdf) {
    throw new Error('PDF-Bibliothek konnte nicht geladen werden.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 18;
  const rightX = 192;
  let y = 20;

  const absender = [opts.settings.firmenname, opts.settings.strasse, opts.settings.plzOrt].filter(Boolean).join(' · ');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(absender, marginX, y);

  const kundeLines = [
    opts.kunde?.firma, opts.kunde?.ansprechpartner, opts.kunde?.strasse,
    [opts.kunde?.plz, opts.kunde?.ort].filter(Boolean).join(' '),
  ].filter(Boolean);
  doc.setFontSize(10.5);
  doc.setTextColor(20);
  kundeLines.forEach((line, i) => doc.text(String(line), marginX, y + 10 + i * 5));

  const rightLines = [
    opts.settings.firmenname, opts.settings.strasse, opts.settings.plzOrt,
    opts.settings.telefon, opts.settings.email,
    opts.settings.ustId ? `USt-ID: ${opts.settings.ustId}` : '',
  ].filter(Boolean);
  doc.setFontSize(9);
  rightLines.forEach((line, i) => doc.text(String(line), rightX, 20 + i * 5, { align: 'right' }));

  y = 20 + Math.max(kundeLines.length + 2, rightLines.length) * 5 + 12;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(20);
  doc.text(`${opts.art} ${opts.nummer}`, marginX, y);
  doc.setFont(undefined, 'normal');
  y += 8;

  doc.setFontSize(10);
  doc.text(`Datum: ${formatDate(opts.datum)}`, marginX, y);
  if (opts.refLabel) {
    y += 5;
    doc.text(`${opts.refLabel}: ${opts.refValue}`, marginX, y);
  }
  y += 9;

  if (opts.betreff) {
    doc.setFont(undefined, 'bold');
    doc.text(opts.betreff, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 7;
  }
  if (opts.introText) {
    const lines = doc.splitTextToSize(opts.introText, 174);
    doc.text(lines, marginX, y);
    y += lines.length * 5 + 4;
  }

  if (opts.positionen && opts.positionen.length) {
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [['#', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'USt.', 'Netto']],
      body: opts.positionen.map((p, i) => [
        String(i + 1),
        p.bezeichnung || '',
        String(p.menge ?? ''),
        p.einheit || '',
        formatCurrency(p.einzelpreis),
        `${p.steuersatz}%`,
        formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0)),
      ]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [15, 27, 45] },
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
    y += 10;
  }

  if (opts.settings.kleinunternehmer) {
    doc.setFontSize(8);
    doc.text('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', marginX, y);
    y += 6;
  }

  if (opts.closingText) {
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(opts.closingText, 174);
    doc.text(lines, marginX, y);
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  const footer = [
    opts.settings.firmenname, opts.settings.strasse, opts.settings.plzOrt,
    opts.settings.iban ? `IBAN: ${opts.settings.iban}` : '',
    opts.settings.bic ? `BIC: ${opts.settings.bic}` : '',
    opts.settings.steuernummer ? `Steuernr.: ${opts.settings.steuernummer}` : '',
  ].filter(Boolean).join(' · ');
  doc.text(doc.splitTextToSize(footer, 174), marginX, 287);

  return doc.output('blob');
}
