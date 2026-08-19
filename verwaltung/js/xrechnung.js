// Erzeugt aus einer Rechnung eine XRechnung-XML (UBL 2.1 Invoice, EN 16931 /
// XRechnung 3.0 konform in Struktur und Pflichtfeldern). Ergänzt die
// bestehende PDF-Rechnung um die seit 2025 für B2B-Rechnungen in Deutschland
// zunehmend verbindliche elektronische Fassung. Best-Effort: vor produktivem
// Versand an öffentliche Auftraggeber (Leitweg-ID nötig) oder bei hohem
// Rechnungsvolumen mit dem kostenlosen KoSIT-Validator gegenprüfen.

const STEUER_KATEGORIE = {
  regel: 'S',
  kleinunternehmer: 'E',
  'reverse-charge': 'AE',
  'ig-lieferung': 'K',
  export: 'G',
};

const STEUER_GRUND = {
  kleinunternehmer: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  'reverse-charge': 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.',
  'ig-lieferung': 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b i.V.m. § 6a UStG.',
  export: 'Steuerfreie Ausfuhrlieferung gemäß § 4 Nr. 1a UStG.',
};

const EINHEIT_CODE = {
  'stk.': 'C62', 'stk': 'C62', 'stück': 'C62', 'stueck': 'C62', 'psch.': 'C62', 'pauschal': 'C62',
  'std.': 'HUR', 'std': 'HUR', 'stunde': 'HUR', 'stunden': 'HUR', 'h': 'HUR',
  'm': 'MTR', 'lfm': 'MTR', 'm²': 'MTK', 'm2': 'MTK', 'qm': 'MTK', 'm³': 'MTQ', 'm3': 'MTQ', 'cbm': 'MTQ',
  'kg': 'KGM', 't': 'TNE', 'l': 'LTR', 'satz': 'SET', 'set': 'SET', 'tag': 'DAY', 'tage': 'DAY',
};

function unitCode(einheit) {
  return EINHEIT_CODE[(einheit || '').trim().toLowerCase()] || 'C62';
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function isoDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function amount(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function splitPlzOrt(plzOrt) {
  const m = /^(\d{4,5})\s+(.+)$/.exec((plzOrt || '').trim());
  return m ? { plz: m[1], ort: m[2] } : { plz: '', ort: (plzOrt || '').trim() };
}

function party({ name, strasse, plz, ort, ustId, steuernummer, telefon, email }) {
  const taxSchemes = [];
  if (ustId) taxSchemes.push(`<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(ustId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  if (steuernummer) taxSchemes.push(`<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(steuernummer)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  const contactLines = [];
  if (telefon) contactLines.push(`<cbc:Telephone>${xmlEscape(telefon)}</cbc:Telephone>`);
  if (email) contactLines.push(`<cbc:ElectronicMail>${xmlEscape(email)}</cbc:ElectronicMail>`);
  return `
      <cac:PartyName><cbc:Name>${xmlEscape(name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(strasse)}</cbc:StreetName>
        <cbc:CityName>${xmlEscape(ort)}</cbc:CityName>
        <cbc:PostalZone>${xmlEscape(plz)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${taxSchemes.join('\n      ')}
      <cac:PartyLegalEntity><cbc:RegistrationName>${xmlEscape(name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      ${contactLines.length ? `<cac:Contact>${contactLines.join('')}</cac:Contact>` : ''}`;
}

/**
 * opts entspricht weitgehend docOpts()/mahnungDocOpts() aus den Rechnungs-
 * Views, ergänzt um die Rohfelder faelligAm (ISO-Datum) und steuerart (id aus
 * STEUERARTEN), die docpdf.js nicht braucht, für die XML aber nötig sind.
 */
export function buildXRechnungXml(opts) {
  const { settings, kunde, positionen, totals, steuerart } = opts;
  const kategorie = STEUER_KATEGORIE[steuerart] || 'S';
  const grund = STEUER_GRUND[steuerart];
  const verkaeufer = splitPlzOrt(settings.plzOrt);
  const kaeufer = { plz: kunde?.plz || '', ort: kunde?.ort || '' };

  const steuerGruppen = Object.entries(totals.steuerGruppen || {}).map(([satz, netto]) => {
    const satzNum = Number(satz);
    const zeilenKategorie = steuerart === 'regel' ? (satzNum === 0 ? 'Z' : 'S') : kategorie;
    return { satz: satzNum, netto, kategorie: zeilenKategorie };
  });
  if (!steuerGruppen.length) steuerGruppen.push({ satz: 0, netto: totals.netto || 0, kategorie });

  const taxSubtotals = steuerGruppen.map(({ satz, netto, kategorie: k }) => `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="EUR">${amount(netto)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="EUR">${amount(netto * satz / 100)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${k}</cbc:ID>
          <cbc:Percent>${satz}</cbc:Percent>
          ${k !== 'S' && grund ? `<cbc:TaxExemptionReason>${xmlEscape(grund)}</cbc:TaxExemptionReason>` : ''}
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`).join('');

  // Überschrift-Zeilen (reine Abschnittstitel ohne Menge/Preis) sind keine
  // gültigen XRechnung-Rechnungspositionen und werden hier nicht mit
  // exportiert - eine InvoiceLine mit Menge/Preis 0 wäre nach EN16931 ein
  // bedeutungsloser bzw. ungültiger Eintrag.
  const lines = (positionen || []).filter((p) => p.typ !== 'ueberschrift').map((p, i) => {
    const netto = (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0);
    const satz = Number(p.steuersatz) || 0;
    const zeilenKategorie = steuerart === 'regel' ? (satz === 0 ? 'Z' : 'S') : kategorie;
    return `
  <cac:InvoiceLine>
    <cbc:ID>${xmlEscape(p.posNr || String(i + 1))}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${unitCode(p.einheit)}">${Number(p.menge) || 0}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${amount(netto)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEscape(p.bezeichnung)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${zeilenKategorie}</cbc:ID>
        <cbc:Percent>${satz}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${amount(p.einzelpreis)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join('');

  const buyerRef = kunde?.kundennummer || kunde?.firma || kunde?.ansprechpartner || opts.nummer;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(opts.nummer)}</cbc:ID>
  <cbc:IssueDate>${isoDate(opts.datum)}</cbc:IssueDate>
  <cbc:DueDate>${isoDate(opts.faelligAm)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${opts.betreff ? `<cbc:Note>${xmlEscape(opts.betreff)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${xmlEscape(buyerRef)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>${party({
      name: settings.firmenname, strasse: settings.strasse, plz: verkaeufer.plz, ort: verkaeufer.ort,
      ustId: settings.ustId, steuernummer: settings.steuernummer, telefon: settings.telefon, email: settings.email,
    })}
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>${party({
      name: kunde?.firma || kunde?.ansprechpartner || '', strasse: kunde?.strasse, plz: kaeufer.plz, ort: kaeufer.ort,
      telefon: kunde?.telefon, email: kunde?.email,
    })}
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${settings.iban ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${xmlEscape(settings.iban)}</cbc:ID>
      ${settings.inhaber ? `<cbc:Name>${xmlEscape(settings.inhaber)}</cbc:Name>` : ''}
      ${settings.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${xmlEscape(settings.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ''}
  <cac:PaymentTerms>
    <cbc:Note>Zahlbar bis zum ${isoDate(opts.faelligAm)}</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amount(totals.steuer)}</cbc:TaxAmount>${taxSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amount(totals.netto)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amount(totals.netto)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amount(totals.brutto)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${amount(totals.brutto)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>
`;
}

export function buildXRechnungBlob(opts) {
  return new Blob([buildXRechnungXml(opts)], { type: 'application/xml' });
}

export function xRechnungFilename(nummer) {
  return `XRechnung-${(nummer || 'Rechnung').replace(/[^a-z0-9-]/gi, '')}.xml`;
}
