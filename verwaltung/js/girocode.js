// GiroCode / EPC-QR-Code (EPC069-12 "SEPA Credit Transfer QR Code") für
// Rechnungs-PDFs - der in Deutschland/Österreich übliche, von praktisch
// jeder Banking-App direkt scannbare Überweisungs-QR-Code: Empfänger/IBAN/
// BIC/Betrag werden beim Scannen automatisch in die Überweisungsmaske
// übernommen, der Kunde muss nur noch bestätigen.
//
// Format-Referenz (offizielle Spezifikation der European Payments Council):
// 12 durch Zeilenumbruch (\n) getrennte Felder, in genau dieser Reihenfolge:
//   1. Service-Tag "BCD"
//   2. Versionsnummer "002"
//   3. Zeichensatz "1" (UTF-8)
//   4. Identifikation "SCT" (SEPA Credit Transfer)
//   5. BIC des Empfängers
//   6. Name des Empfängers (max. 70 Zeichen)
//   7. IBAN des Empfängers (max. 34 Zeichen)
//   8. Betrag als "EUR<Betrag>", z.B. "EUR123.45" (Punkt als Dezimaltrennzeichen, kein Tausendertrennzeichen)
//   9. Verwendungszweck-Kennung (hier leer)
//  10. Verwendungszweck strukturiert (hier leer, wir nutzen unstrukturiert)
//  11. Verwendungszweck unstrukturiert (max. 140 Zeichen) - hier Rechnungsnummer + Kundenname
//  12. Hinweis des Empfängers an den Zahler (hier leer)
import { renderQrPngDataUrl } from './qrcode.js';

function kuerzeAufLaenge(text, maxLaenge) {
  return (text || '').toString().trim().slice(0, maxLaenge);
}

/**
 * Baut den EPC069-12-Textinhalt für den GiroCode. betrag muss eine positive
 * Zahl in EUR sein (kaufmännisch auf 2 Nachkommastellen gerundet). Gibt null
 * zurück, wenn die für einen gültigen GiroCode zwingenden Felder (IBAN,
 * Empfängername, Betrag > 0) fehlen - der Aufrufer zeigt dann bewusst
 * keinen QR-Code, statt einen ungültigen zu erzeugen.
 */
export function baueGirocodePayload({ empfaenger, iban, bic, betrag, verwendungszweck }) {
  const ibanOhneLeerzeichen = (iban || '').replace(/\s+/g, '').toUpperCase();
  const betragNum = Number(betrag);
  if (!ibanOhneLeerzeichen || !empfaenger || !Number.isFinite(betragNum) || betragNum <= 0) {
    return null;
  }
  const betragFormatiert = `EUR${betragNum.toFixed(2)}`;
  const zeilen = [
    'BCD',
    '002',
    '1',
    'SCT',
    kuerzeAufLaenge(bic, 11),
    kuerzeAufLaenge(empfaenger, 70),
    kuerzeAufLaenge(ibanOhneLeerzeichen, 34),
    betragFormatiert,
    '',
    '',
    kuerzeAufLaenge(verwendungszweck, 140),
    '',
  ];
  return zeilen.join('\n');
}

/**
 * Rendert den GiroCode-Payload als PNG-Data-URL (für jsPDF addImage()).
 * Nutzt den gemeinsamen QR-Renderer aus qrcode.js (derselbe ZXing-Writer
 * wie bisher) - jsPDF kann SVG nicht direkt einbetten, daher der
 * Canvas-Umweg zu PNG dort. Gibt null zurück, wenn die QR-Bibliothek nicht
 * geladen werden konnte oder die Erzeugung fehlschlägt - der Aufrufer lässt
 * den QR-Code dann einfach weg, statt das ganze PDF scheitern zu lassen.
 */
export async function erzeugeGirocodeDataUrl(payload, groesse = 300) {
  return renderQrPngDataUrl(payload, groesse);
}
