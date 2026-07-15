import { formatCurrency, formatDate } from './utils.js';

export function buildLohnzettelPdfBlob({ settings, mitarbeiter, monat, ergebnis, steuerklasse, kirchensteuerSatz, kinderlos }) {
  if (!window.jspdf) {
    throw new Error('PDF-Bibliothek konnte nicht geladen werden.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 18;
  const rightX = 192;
  let y = 20;

  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text(settings.firmenname || '', marginX, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(15);
  doc.text('Entgeltabrechnung', rightX, y, { align: 'right' });

  y += 10;
  doc.setFontSize(9);
  doc.setTextColor(60);
  const [jahr, mon] = (monat || '').split('-');
  const monatsname = new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date(Number(jahr) || 2026, (Number(mon) || 1) - 1, 1));
  const metaRows = [
    ['Mitarbeiter:', mitarbeiter.name],
    mitarbeiter.personalnummer ? ['Personalnr.:', mitarbeiter.personalnummer] : null,
    ['Abrechnungsmonat:', `${monatsname} ${jahr}`],
    ['Steuerklasse:', steuerklasse],
    ['Kirchensteuer:', kirchensteuerSatz ? `${(kirchensteuerSatz * 100).toFixed(0)}%` : 'keine'],
    ['Kinderlos (PV-Zuschlag):', kinderlos ? 'Ja' : 'Nein'],
  ].filter(Boolean);
  metaRows.forEach((row, i) => {
    doc.text(row[0], marginX, y + i * 5);
    doc.text(String(row[1] ?? ''), marginX + 55, y + i * 5);
  });
  y += metaRows.length * 5 + 8;

  doc.autoTable({
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [['Bezeichnung', 'Betrag']],
    body: [
      ['Bruttogehalt (inkl. Zulagen)', formatCurrency(ergebnis.brutto)],
      ['./. Lohnsteuer (Näherung)', formatCurrency(ergebnis.lohnsteuer)],
      ['./. Solidaritätszuschlag', formatCurrency(ergebnis.soli)],
      ['./. Kirchensteuer', formatCurrency(ergebnis.kirchensteuer)],
      ['./. Rentenversicherung (AN-Anteil)', formatCurrency(ergebnis.sv.rv)],
      ['./. Arbeitslosenversicherung (AN-Anteil)', formatCurrency(ergebnis.sv.av)],
      ['./. Krankenversicherung (AN-Anteil)', formatCurrency(ergebnis.sv.kv)],
      ['./. Pflegeversicherung (AN-Anteil)', formatCurrency(ergebnis.sv.pv)],
      ['./. Sonstige Abzüge', formatCurrency(ergebnis.sonstigeAbzuege)],
    ],
    styles: { fontSize: 9.5, cellPadding: 2.4 },
    headStyles: { fillColor: [15, 27, 45] },
    columnStyles: { 1: { halign: 'right' } },
  });
  y = doc.lastAutoTable.finalY + 6;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Auszahlungsbetrag (Netto):', marginX, y);
  doc.text(formatCurrency(ergebnis.netto), rightX, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  y += 12;

  doc.setFillColor(250, 235, 200);
  doc.rect(marginX, y - 4, rightX - marginX, 22, 'F');
  doc.setFontSize(8);
  doc.setTextColor(90, 60, 10);
  const disclaimer = 'Hinweis: Diese Abrechnung ist eine unverbindliche, näherungsweise Schätzung (u.a. Steuerzonen-Näherung, gerundete SV-Sätze) und keine zertifizierte Lohnabrechnung. Sie ersetzt nicht die Prüfung durch einen Steuerberater/ein Lohnbüro und ist nicht für ELSTER-Meldungen, SV-Meldungen oder DEÜV geeignet.';
  const lines = doc.splitTextToSize(disclaimer, rightX - marginX - 6);
  doc.text(lines, marginX + 3, y);

  return doc.output('blob');
}
