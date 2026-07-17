import { getAll, getSettings } from '../db.js';
import { escapeHtml, formatCurrency, formatDate } from '../utils.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function deNum(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',');
}
function buSchluessel(steuersatz) {
  if (Number(steuersatz) === 19) return '9';
  if (Number(steuersatz) === 7) return '8';
  return '';
}
function ddmm(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function render(container) {
  const [rechnungen, ausgaben, kunden, projekte, settings] = await Promise.all([
    getAll('rechnungen'), getAll('ausgaben'), getAll('kunden'), getAll('projekte'), getSettings(),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  function ausgabeBezug(a) {
    return [kundenById[a.kundeId]?.firma, projekteById[a.projektId]?.titel].filter(Boolean).join(' / ');
  }

  const bezahlteRechnungen = rechnungen.filter((r) => r.status === 'bezahlt' && (r.bezahltAm || r.datum));
  const jahre = new Set([
    ...bezahlteRechnungen.map((r) => (r.bezahltAm || r.datum).slice(0, 4)),
    ...ausgaben.map((a) => (a.datum || '').slice(0, 4)),
  ]);
  jahre.add(String(new Date().getFullYear()));
  const jahrOptions = Array.from(jahre).filter(Boolean).sort().reverse();

  let jahr = String(new Date().getFullYear());

  container.innerHTML = `
    <div class="view-header">
      <h1>Buchhaltung</h1>
      <div class="actions">
        <select id="jahr-select">${jahrOptions.map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
      </div>
    </div>
    <div class="card" style="background:#fff6e0;border-color:#f0d78c">
      <p class="mb-0">⚠️ <strong>Kein Ersatz für professionelle Buchhaltung/Steuerberatung.</strong> Diese Übersicht ist eine vereinfachte Zusammenstellung nach Zufluss/Abfluss (bezahlte Rechnungen, erfasste Ausgaben) auf Basis deiner Eingaben. USt.-Voranmeldung, ELSTER-Übermittlung und die endgültige Kontenzuordnung übernimmt weiterhin dein Steuerberater / deine Steuerberaterin.</p>
    </div>
    <div id="content-host"></div>
  `;

  container.querySelector('#jahr-select').addEventListener('change', (e) => {
    jahr = e.target.value;
    renderContent();
  });

  const host = container.querySelector('#content-host');

  function renderContent() {
    const einnahmenJahr = bezahlteRechnungen.filter((r) => (r.bezahltAm || r.datum).slice(0, 4) === jahr);
    const ausgabenJahr = ausgaben.filter((a) => (a.datum || '').slice(0, 4) === jahr);

    const einnahmenBrutto = einnahmenJahr.reduce((s, r) => s + (r.brutto || 0), 0);
    const einnahmenNetto = einnahmenJahr.reduce((s, r) => s + (r.netto || 0), 0);
    const vereinnahmteUst = einnahmenJahr.reduce((s, r) => s + (r.steuer || 0), 0);
    const ausgabenBrutto = ausgabenJahr.reduce((s, a) => s + (a.betragBrutto || 0), 0);
    const ausgabenNetto = ausgabenJahr.reduce((s, a) => s + (a.betragNetto || 0), 0);
    const gezahlteUst = ausgabenBrutto - ausgabenNetto;
    const ueberschuss = einnahmenBrutto - ausgabenBrutto;
    const ustSaldo = vereinnahmteUst - gezahlteUst;

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const ein = einnahmenJahr.filter((r) => (r.bezahltAm || r.datum).slice(5, 7) === mm).reduce((s, r) => s + (r.brutto || 0), 0);
      const aus = ausgabenJahr.filter((a) => (a.datum || '').slice(5, 7) === mm).reduce((s, a) => s + (a.betragBrutto || 0), 0);
      return { monat: MONTHS[i], ein, aus, saldo: ein - aus };
    });

    host.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(einnahmenBrutto)}</div><div class="kpi-label">Einnahmen (brutto, bezahlt)</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(ausgabenBrutto)}</div><div class="kpi-label">Ausgaben (brutto)</div></div>
        <div class="kpi-card ${ueberschuss >= 0 ? '' : 'kpi-danger'}"><div class="kpi-value">${formatCurrency(ueberschuss)}</div><div class="kpi-label">Überschuss (vereinfacht)</div></div>
        <div class="kpi-card kpi-warn"><div class="kpi-value">${formatCurrency(ustSaldo)}</div><div class="kpi-label">USt.-Saldo (vereinnahmt ./. gezahlt)</div></div>
      </div>

      <div class="card">
        <h2>Monatsübersicht ${jahr}</h2>
        <table class="data-table">
          <thead><tr><th>Monat</th><th class="text-right">Einnahmen</th><th class="text-right">Ausgaben</th><th class="text-right">Saldo</th></tr></thead>
          <tbody>
            ${monthly.map((m) => `
              <tr>
                <td>${m.monat}</td>
                <td class="text-right">${formatCurrency(m.ein)}</td>
                <td class="text-right">${formatCurrency(m.aus)}</td>
                <td class="text-right">${formatCurrency(m.saldo)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Export</h2>
        <p class="hint">CSV-Export für deinen Steuerberater bzw. Import in Buchhaltungssoftware. Der DATEV-Format-Export ist ein bestmöglicher Standardaufbau (Buchungsstapel EXTF) – bitte vor dem ersten produktiven Einsatz gemeinsam mit deinem Steuerberater die Kontenzuordnung (aktuell: Erlöskonto ${escapeHtml(settings.datevErloesKonto)}, Aufwandskonto ${escapeHtml(settings.datevAufwandKonto)}, einstellbar in den Einstellungen) prüfen.</p>
        <div class="flex-row flex-wrap">
          <button class="btn" id="btn-export-csv">Einfacher CSV-Export</button>
          <button class="btn" id="btn-export-datev">DATEV-Format-Export (Buchungsstapel)</button>
        </div>
      </div>
    `;

    host.querySelector('#btn-export-csv').addEventListener('click', () => {
      const rows = [['Datum', 'Typ', 'Beschreibung', 'Netto', 'USt.', 'Brutto']];
      for (const r of einnahmenJahr) {
        rows.push([r.bezahltAm || r.datum, 'Einnahme', `Rechnung ${r.nummer} – ${kundenById[r.kundeId]?.firma || ''}`, deNum(r.netto), deNum(r.steuer), deNum(r.brutto)]);
      }
      for (const a of ausgabenJahr) {
        const bezug = ausgabeBezug(a);
        rows.push([a.datum, 'Ausgabe', `${a.kategorie}: ${a.beschreibung || ''}${bezug ? ` (${bezug})` : ''}`, deNum(a.betragNetto), deNum(a.betragBrutto - a.betragNetto), deNum(a.betragBrutto)]);
      }
      const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      downloadFile(csv, `buchhaltung-${jahr}.csv`, 'text/csv;charset=utf-8');
    });

    host.querySelector('#btn-export-datev').addEventListener('click', () => {
      downloadFile(buildDatevCsv({ einnahmenJahr, ausgabenJahr, kundenById, settings, jahr }), `datev-buchungsstapel-${jahr}.csv`, 'text/csv;charset=windows-1252');
    });
  }

  function buildDatevCsv({ einnahmenJahr, ausgabenJahr, kundenById, settings, jahr }) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}000`;
    const header1 = [
      '"EXTF"', 700, 21, '"Buchungsstapel"', 12, stamp, '', '', '', '',
      settings.datevBeraterNr || '', settings.datevMandantNr || '',
      `${jahr}0101`, 4, `${jahr}0101`, `${jahr}1231`,
      `"Buchungsstapel ${jahr}"`, '', 1, 0, 0, '"EUR"',
    ].join(';');
    const header2 = [
      'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz',
      'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext',
    ].map((h) => `"${h}"`).join(';');

    const rows = [];
    for (const r of einnahmenJahr) {
      const datum = r.bezahltAm || r.datum;
      rows.push([
        deNum(r.brutto), 'H', 'EUR', '', '', '',
        settings.datevErloesKonto, '', buSchluessel(19), ddmm(datum), `"${r.nummer}"`, '', '',
        `"${(kundenById[r.kundeId]?.firma || 'Kunde').replace(/"/g, "'")}"`,
      ].join(';'));
    }
    for (const a of ausgabenJahr) {
      const bezug = ausgabeBezug(a);
      const buchungstext = `${a.beschreibung || a.kategorie || ''}${bezug ? ` (${bezug})` : ''}`;
      rows.push([
        deNum(a.betragBrutto), 'S', 'EUR', '', '', '',
        settings.datevAufwandKonto, '', buSchluessel(a.steuersatz), ddmm(a.datum), `"${a.kategorie}"`, '', '',
        `"${buchungstext.replace(/"/g, "'")}"`,
      ].join(';'));
    }

    return [header1, header2, ...rows].join('\r\n');
  }

  renderContent();
}
