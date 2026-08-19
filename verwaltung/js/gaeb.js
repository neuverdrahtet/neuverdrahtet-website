// GAEB DA XML (Format 90ff., z.B. X83 Leistungsverzeichnis / P83 Angebot) -
// Austauschformat für Leistungsverzeichnisse zwischen Architekten/Ausschreibern
// und Handwerksbetrieben. Best-effort: deckt den in der Praxis üblichen
// flachen Aufbau (eine Positionsliste ohne tiefe Titel-Hierarchie) ab.
// Vor einer echten Vergabeeinreichung empfiehlt sich ein Test-Import in der
// vom Empfänger genutzten Software (z.B. ORCA AVA, California, iTWO).

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function amount(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

/**
 * Erzeugt ein GAEB DA XML 3.3 "Angebot" (Award) aus den Positionen eines
 * bestehenden Angebots - zum Zurücksenden eines bepreisten Leistungs-
 * verzeichnisses an einen Architekten/Ausschreiber.
 */
export function buildGaebXml({ projektName, nummer, datum, positionen, settings }) {
  // Überschrift-Zeilen (reine Abschnittstitel ohne Menge/Preis) werden hier
  // nicht mit exportiert - dieser einfache Exporter bildet nur flache Items
  // ab, keine GAEB-"Titel"-Gliederungsebenen; ein Item mit Menge/Preis 0
  // wäre nur eine bedeutungslose Leerzeile im Leistungsverzeichnis.
  const items = (positionen || []).filter((p) => p.typ !== 'ueberschrift').map((p, i) => {
    const menge = Number(p.menge) || 0;
    const preis = Number(p.einzelpreis) || 0;
    const gesamt = menge * preis;
    const rnoPart = (p.posNr || String(i + 1)).replace(/[^0-9.]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') || String(i + 1);
    return `
        <Item RNoPart="${xmlEscape(rnoPart)}">
          <Qty>${menge.toFixed(3)}</Qty>
          <QU>${xmlEscape(p.einheit || 'Stk')}</QU>
          <UP>${amount(preis)}</UP>
          <IT>${amount(gesamt)}</IT>
          <Description>
            <OutlineText><OutlIndTxt><TextOutlIndTxt><span>${xmlEscape(p.bezeichnung)}</span>${p.beschreibung ? `<span>${xmlEscape(p.beschreibung)}</span>` : ''}</TextOutlIndTxt></OutlIndTxt></OutlineText>
          </Description>
        </Item>`;
  }).join('');

  const gesamtsumme = (positionen || []).reduce((sum, p) => sum + (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0), 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA86/3.3" DAVersion="3.3">
  <PrjInfo>
    <NamePrj>${xmlEscape(projektName || nummer || '')}</NamePrj>
    <Info><Date>${xmlEscape(datum || '')}</Date></Info>
  </PrjInfo>
  <Award>
    <DP>
      <Doc>
        <NamePrj>${xmlEscape(projektName || nummer || '')}</NamePrj>
        <Contents>${settings?.firmenname ? `Angebot von ${xmlEscape(settings.firmenname)}` : 'Angebot'}</Contents>
      </Doc>
    </DP>
    <BoQ>
      <BoQInfo>
        <Name>${xmlEscape(nummer || 'Angebot')}</Name>
        <UnitTotal unitTotalValue="${amount(gesamtsumme)}" unitTotalType="net"/>
      </BoQInfo>
      <BoQBody>
        <Itemlist>${items}
        </Itemlist>
      </BoQBody>
    </BoQ>
  </Award>
</GAEB>
`;
}

export function buildGaebBlob(opts) {
  return new Blob([buildGaebXml(opts)], { type: 'application/xml' });
}

export function gaebFilename(nummer) {
  return `GAEB-${(nummer || 'Angebot').replace(/[^a-z0-9-]/gi, '')}.x83`;
}

function textOf(el, selector) {
  const found = el.querySelector(selector);
  return found ? found.textContent.trim() : '';
}

/**
 * Liest ein empfangenes GAEB-Leistungsverzeichnis (X83, ohne Preise) und
 * liefert die Positionen für ein neues Angebot - Einzelpreis bleibt 0 und
 * muss vom Nutzer kalkuliert werden.
 */
export function parseGaebXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return { positionen: [], projektName: '', error: 'Die Datei ist keine gültige GAEB-XML-Datei.' };

  const projektName = textOf(doc, 'PrjInfo > NamePrj') || textOf(doc, 'Doc > NamePrj') || '';
  const items = Array.from(doc.querySelectorAll('Item'));
  const positionen = items.map((item, i) => {
    const rnoPart = item.getAttribute('RNoPart') || String(i + 1);
    const menge = Number((textOf(item, 'Qty') || '0').replace(',', '.')) || 0;
    const einheit = textOf(item, 'QU') || '';
    const spans = Array.from(item.querySelectorAll('Description span')).map((s) => s.textContent.trim()).filter(Boolean);
    const bezeichnung = spans[0] || textOf(item, 'Description') || `Position ${rnoPart}`;
    const beschreibung = spans.slice(1).join('\n');
    return { posNr: rnoPart, bezeichnung, beschreibung, einheit, menge, einzelpreis: 0, steuersatz: 19 };
  });
  return { positionen, projektName, error: null };
}
