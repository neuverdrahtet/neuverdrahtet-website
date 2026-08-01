import { getAll, put, remove, getSettings, setSettings, KONTEN_KLASSEN, ANLAGE_KATEGORIEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, toast, readTextAutoEncoding } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { erkenneDelimiter, parseCsv, bankbuchungSchluessel, zeilenZuBuchungen } from '../bankimport.js';
import * as bankabgleich from '../bankabgleich.js';
import * as journal from '../journal.js';
import { berechneJahresAfa, aktuellerRestbuchwert } from '../abschreibung.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const KLASSE_LABEL = Object.fromEntries(KONTEN_KLASSEN.map((k) => [k.id, k.titel]));

const BUCH_NAV = [
  { id: 'uebersicht', icon: '📊', label: 'Übersicht' },
  { id: 'kontenplan', icon: '📒', label: 'Kontenplan' },
  { id: 'journal', icon: '📓', label: 'Journal' },
  { id: 'bilanz', icon: '⚖️', label: 'Bilanz & GuV' },
  { id: 'offeneposten', icon: '📬', label: 'Offene Posten' },
  { id: 'ustva', icon: '🧾', label: 'USt.-Voranmeldung' },
  { id: 'kontoabgleich', icon: '🏦', label: 'Kontoabgleich' },
  { id: 'anlagenverzeichnis', icon: '🏗️', label: 'Anlagenverzeichnis' },
];
const RECHNUNG_STATUS_LABEL = { offen: 'Offen', teilbezahlt: 'Teilbezahlt', bezahlt: 'Bezahlt', storniert: 'Storniert' };

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

/** Summiert Buchungssätze je Konto einer bestimmten Kontenklasse, vorzeichenrichtig
 * nach deren Normalsaldo (Soll oder Haben) - z.B. für GuV, Bilanz, USt.-Voranmeldung. */
function summeJeKonto(buchungen, konten, klassen, normalsaldoSoll) {
  const summen = new Map();
  for (const b of buchungen) {
    for (const [kontoId, istSoll] of [[b.sollKontoId, true], [b.habenKontoId, false]]) {
      const k = konten.find((x) => x.id === kontoId);
      if (!k || !klassen.includes(k.klasse)) continue;
      const vorzeichen = istSoll === normalsaldoSoll ? 1 : -1;
      summen.set(k.id, (summen.get(k.id) || 0) + vorzeichen * b.betrag);
    }
  }
  return Array.from(summen.entries()).map(([kontoId, betrag]) => ({ konto: konten.find((k) => k.id === kontoId), betrag })).filter((z) => z.betrag);
}
function kontoSumme(zeilen, nummer) {
  return zeilen.find((z) => z.konto?.nummer === nummer)?.betrag || 0;
}
function letzterTagDesMonats(jahr, monat) {
  return new Date(Number(jahr), monat, 0).getDate();
}

export async function render(container) {
  let [rechnungen, ausgaben, kunden, projekte, settings] = await Promise.all([
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
    </div>
    <div class="settings-layout">
      <nav class="settings-nav" id="buch-nav">
        <div class="settings-nav-group">
          <h3>Buchhaltung</h3>
          ${BUCH_NAV.map((it) => `<button type="button" class="settings-nav-item" data-panel="${it.id}">${it.icon} ${escapeHtml(it.label)}</button>`).join('')}
        </div>
      </nav>
      <div class="settings-content" id="buch-content">
        <div class="settings-panel" data-panel="uebersicht" hidden>
          <div class="view-header">
            <h2 class="mb-0">Übersicht</h2>
            <div class="actions">
              <select id="jahr-select">${jahrOptions.map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
            </div>
          </div>
          <div class="card" style="background:#fff6e0;border-color:#f0d78c">
            <p class="mb-0">⚠️ <strong>Kein Ersatz für professionelle Buchhaltung/Steuerberatung.</strong> Diese Übersicht ist eine vereinfachte Zusammenstellung nach Zufluss/Abfluss (bezahlte Rechnungen, erfasste Ausgaben) auf Basis deiner Eingaben. USt.-Voranmeldung, ELSTER-Übermittlung und die endgültige Kontenzuordnung übernimmt weiterhin dein Steuerberater / deine Steuerberaterin.</p>
          </div>
          <div id="content-host"></div>
        </div>
        <div class="card settings-panel" data-panel="kontenplan" hidden>
          <h2>Kontenplan</h2>
          <p class="hint">Kern-Kontenplan nach SKR03 - frei erweiterbar. Ersetzt keine steuerliche Beratung; die endgültige Kontenzuordnung bleibt Aufgabe deines Steuerberaters.</p>
          <div id="kontenplan-host"></div>
        </div>
        <div class="card settings-panel" data-panel="journal" hidden>
          <div class="view-header">
            <h2 class="mb-0">Journal</h2>
            <div class="actions">
              <select id="journal-jahr-select">${jahrOptions.map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
              <select id="journal-konto-select"><option value="">Alle Konten</option></select>
              <button type="button" class="btn btn-primary" id="btn-buchung-neu">+ Manuelle Buchung</button>
            </div>
          </div>
          <p class="hint">Automatisch aus bezahlten Rechnungen und erfassten Ausgaben erzeugte Buchungssätze sind nicht direkt editierbar (nur über die Quelle korrigierbar) - nur manuell erfasste Buchungen lassen sich hier löschen.</p>
          <div id="journal-host"></div>
        </div>
        <div class="settings-panel" data-panel="bilanz" hidden>
          <div class="view-header">
            <h2 class="mb-0">Bilanz &amp; GuV</h2>
            <div class="actions">
              <label class="mb-0">GuV-Jahr <select id="bilanz-jahr-select">${jahrOptions.map((j) => `<option value="${j}">${j}</option>`).join('')}</select></label>
              <label class="mb-0">Bilanz-Stichtag <input type="date" id="bilanz-stichtag" value="${todayISO()}"></label>
            </div>
          </div>
          <div class="card" style="background:#fff6e0;border-color:#f0d78c">
            <p class="mb-0">⚠️ Vereinfachte Darstellung ohne Eröffnungsbilanz-/Vorjahres-Eigenkapital-Fortschreibung - der Jahresüberschuss wird als rechnerische Restgröße gezeigt. Ersetzt keine Steuerberatung; die endgültige Bilanzierung bleibt Aufgabe deines Steuerberaters.</p>
          </div>
          <div id="bilanz-host"></div>
        </div>
        <div class="card settings-panel" data-panel="offeneposten" hidden>
          <h2>Offene Posten (Debitoren)</h2>
          <p class="hint">Offene/teilbezahlte Ausgangsrechnungen, sortiert nach Fälligkeit. Kreditoren (Lieferantenrechnungen) werden aktuell nicht abgebildet, da Ausgaben in dieser App nur als bereits bezahlte Belege erfasst werden.</p>
          <div id="offeneposten-host"></div>
        </div>
        <div class="card settings-panel" data-panel="ustva" hidden>
          <div class="view-header">
            <h2 class="mb-0">USt.-Voranmeldung</h2>
            <div class="actions">
              <select id="ustva-jahr-select">${jahrOptions.map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
              <select id="ustva-periode-select"></select>
              <button class="btn" id="btn-export-ustva-csv">📊 Als CSV</button>
            </div>
          </div>
          <p class="hint">Voranmeldungszeitraum (monatlich/vierteljährlich) wird in Einstellungen → Finanzen &amp; Kalkulation festgelegt. Werte aus dem Journal, keine offizielle ELSTER-Kennziffern-Zuordnung - Übermittlung bleibt Aufgabe deines Steuerberaters.</p>
          <div id="ustva-host"></div>
        </div>
        <div class="card settings-panel" data-panel="kontoabgleich" hidden>
          <div class="view-header">
            <h2 class="mb-0">Kontoabgleich</h2>
            <div class="actions">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="kontoabgleich-nur-offene"> Nur unzugeordnete anzeigen</label>
              <button class="btn" id="btn-kontoabgleich-jetzt">🔄 Abgleich prüfen</button>
              <button class="btn btn-primary" id="btn-kontoauszug-import">⇪ Kontoauszug importieren (CSV)</button>
            </div>
          </div>
          <p class="hint">Kein Live-Bankzugang - lade den CSV-Export deines Online-Bankings hoch. Zahlungseingänge/-ausgänge werden automatisch gegen offene Rechnungen/Lieferantenrechnungen abgeglichen: eindeutige Treffer (Rechnungsnummer/Lieferant + passender Betrag) werden direkt übernommen, mehrdeutige Betragstreffer erscheinen als Vorschlag zur Bestätigung.</p>
          <div id="kontoabgleich-host"></div>
        </div>
        <div class="card settings-panel" data-panel="anlagenverzeichnis" hidden>
          <div class="view-header">
            <h2 class="mb-0">Anlagenverzeichnis</h2>
            <div class="actions">
              <select id="anlage-afa-jahr-select">${jahrOptions.map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
              <button class="btn" id="btn-afa-jetzt-buchen">📉 Abschreibungen jetzt buchen</button>
              <button class="btn btn-primary" id="btn-anlage-neu">+ Neue Anlage</button>
            </div>
          </div>
          <p class="hint">Größere Anschaffungen (Werkzeug, Maschinen, Fahrzeuge, Ausstattung) werden hier aktiviert und über die Nutzungsdauer linear abgeschrieben (AfA), statt sofort in voller Höhe als Aufwand gebucht zu werden. Geringwertige Wirtschaftsgüter (GWG, ≤ ${deNum(settings.gwgGrenzeNetto)} € netto) werden automatisch im Anschaffungsjahr sofort abgeschrieben. Ersetzt keine Steuerberatung.</p>
          <div id="anlagenverzeichnis-host"></div>
        </div>
      </div>
    </div>
  `;

  const nav = container.querySelector('#buch-nav');
  function showPanel(id) {
    container.querySelectorAll('.settings-panel').forEach((p) => { p.hidden = p.dataset.panel !== id; });
    nav.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
    try { sessionStorage.setItem('nv-buchhaltung-panel', id); } catch { /* ignore */ }
  }
  nav.querySelectorAll('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });
  const lastPanel = (() => { try { return sessionStorage.getItem('nv-buchhaltung-panel'); } catch { return null; } })();
  const allPanelIds = BUCH_NAV.map((it) => it.id);
  showPanel(allPanelIds.includes(lastPanel) ? lastPanel : BUCH_NAV[0].id);

  // Übergabe aus ausgaben.js: eine als "Investition" markierte Ausgabe landet
  // hier als vorausgefülltes Neue-Anlage-Formular (einmaliger Prefill-Schlüssel).
  try {
    const prefillRaw = sessionStorage.getItem('nv-anlage-prefill');
    if (prefillRaw) {
      sessionStorage.removeItem('nv-anlage-prefill');
      const prefill = JSON.parse(prefillRaw);
      showPanel('anlagenverzeichnis');
      openAnlageForm(null, { prefill });
    }
  } catch { /* sessionStorage evtl. nicht verfügbar */ }

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

    // --- Steuerschätzung (grob, auf Basis des vereinfachten Überschusses) ---
    const istKapitalgesellschaft = settings.rechtsform !== 'einzelunternehmen' && settings.rechtsform !== 'personengesellschaft';
    const gewerbeertragRoh = Math.max(0, ueberschuss);
    // §11 Abs.1 GewStG: Gewerbeertrag wird auf volle 100 € abgerundet.
    const gewerbeertragAbgerundet = Math.floor(gewerbeertragRoh / 100) * 100;
    // Freibetrag von 24.500 € gilt nur für Einzelunternehmen/Personengesellschaften, nicht für Kapitalgesellschaften.
    const gewerbesteuerFreibetrag = istKapitalgesellschaft ? 0 : 24500;
    const steuermessbetrag = Math.max(0, gewerbeertragAbgerundet - gewerbesteuerFreibetrag) * 0.035;
    const hebesatz = Number(settings.gewerbesteuerHebesatz) || 0;
    const gewerbesteuer = steuermessbetrag * (hebesatz / 100);
    // Körperschaftsteuer (15%) + Solidaritätszuschlag (5,5% der KSt) gelten nur für Kapitalgesellschaften;
    // bei Einzelunternehmen/Personengesellschaften wird der Gewinn stattdessen individuell über die
    // progressive Einkommensteuer der Inhaber besteuert - das lässt sich hier mangels weiterer
    // Einkommensdaten nicht seriös schätzen.
    const koerperschaftsteuer = istKapitalgesellschaft ? gewerbeertragRoh * 0.15 : 0;
    const soli = koerperschaftsteuer * 0.055;
    const steuerlastGesamt = gewerbesteuer + koerperschaftsteuer + soli;

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
        <h2>Steuerschätzung ${jahr}</h2>
        <p class="hint">Grobe Schätzung auf Basis des vereinfachten Überschusses oben - ohne Rückstellungen, Sonderabschreibungen, Verlustvorträge o.ä. Ersetzt nicht die Steuererklärung deines Steuerberaters.</p>
        <p class="hint">Gewerbeertrag (abgerundet auf volle 100 €): ${formatCurrency(gewerbeertragAbgerundet)}${gewerbesteuerFreibetrag ? ` · Freibetrag: ${formatCurrency(gewerbesteuerFreibetrag)}` : ''} · Steuermessbetrag (3,5%): ${formatCurrency(steuermessbetrag)}</p>
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-value">${formatCurrency(gewerbesteuer)}</div><div class="kpi-label">Gewerbesteuer (Hebesatz ${hebesatz}%)</div></div>
          ${istKapitalgesellschaft ? `
            <div class="kpi-card"><div class="kpi-value">${formatCurrency(koerperschaftsteuer)}</div><div class="kpi-label">Körperschaftsteuer (15%)</div></div>
            <div class="kpi-card"><div class="kpi-value">${formatCurrency(soli)}</div><div class="kpi-label">Solidaritätszuschlag (5,5%)</div></div>
          ` : `
            <div class="kpi-card"><div class="kpi-value">–</div><div class="kpi-label">Einkommensteuer (individuell, hier nicht berechenbar)</div></div>
          `}
          <div class="kpi-card kpi-warn"><div class="kpi-value">${formatCurrency(steuerlastGesamt)}</div><div class="kpi-label">Steuerlast gesamt (geschätzt)</div></div>
        </div>
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

  async function renderKontenplan() {
    const kontenHost = container.querySelector('#kontenplan-host');
    const konten = await getAll('konten');
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    const buchungen = await getAll('buchungen');

    kontenHost.innerHTML = `
      <div class="actions mb-2"><button class="btn btn-primary" id="btn-konto-neu">+ Neues Konto</button></div>
      <table class="data-table">
        <thead><tr><th>Nummer</th><th>Name</th><th>Klasse</th><th></th></tr></thead>
        <tbody>
          ${konten.map((k) => `
            <tr>
              <td>${escapeHtml(k.nummer)}</td>
              <td>${escapeHtml(k.name)}</td>
              <td>${escapeHtml(KLASSE_LABEL[k.klasse] || k.klasse)}</td>
              <td class="text-right">
                <button class="btn btn-sm" data-edit="${k.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-danger" data-delete="${k.id}">Löschen</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="4">Keine Konten vorhanden.</td></tr>'}
        </tbody>
      </table>
    `;

    kontenHost.querySelector('#btn-konto-neu').addEventListener('click', () => openKontoForm(null));
    kontenHost.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openKontoForm(konten.find((k) => k.id === btn.dataset.edit)));
    });
    kontenHost.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delete;
        const inUse = buchungen.some((b) => b.sollKontoId === id || b.habenKontoId === id);
        if (inUse) {
          toast('Dieses Konto wird bereits in Buchungssätzen verwendet und kann nicht gelöscht werden.', 'danger');
          return;
        }
        if (!confirmDelete('Konto wirklich löschen?')) return;
        await remove('konten', id);
        toast('Konto gelöscht', 'success');
        renderKontenplan();
      });
    });

    function openKontoForm(existing) {
      const isEdit = !!existing;
      const data = existing || { id: uid(), nummer: '', name: '', klasse: 'aufwand' };
      const { body, close } = openModal({
        title: isEdit ? 'Konto bearbeiten' : 'Neues Konto',
        bodyHtml: `
          <form id="konto-form">
            <div class="form-grid">
              <div class="field"><label>Nummer *</label><input name="nummer" required value="${escapeHtml(data.nummer)}"></div>
              <div class="field"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
              <div class="field col-span-2"><label>Klasse</label>
                <select name="klasse">${KONTEN_KLASSEN.map((k) => `<option value="${k.id}" ${k.id === data.klasse ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}</select>
              </div>
            </div>
            <div class="modal-actions">
              <span class="spacer"></span>
              <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
              <button type="submit" class="btn btn-primary">Speichern</button>
            </div>
          </form>
        `,
      });
      body.querySelector('#btn-cancel').addEventListener('click', close);
      body.querySelector('#konto-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const nummer = (fd.get('nummer') || '').toString().trim();
        const name = (fd.get('name') || '').toString().trim();
        if (!nummer || !name) return;
        await put('konten', { ...data, nummer, name, klasse: fd.get('klasse') || 'aufwand' });
        toast('Gespeichert', 'success');
        close();
        renderKontenplan();
      });
    }
  }

  async function renderJournal() {
    const journalHost = container.querySelector('#journal-host');
    const jahrSelect = container.querySelector('#journal-jahr-select');
    const kontoSelect = container.querySelector('#journal-konto-select');
    const konten = await getAll('konten');
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    const kontenById = Object.fromEntries(konten.map((k) => [k.id, k]));

    if (!kontoSelect.dataset.filled) {
      kontoSelect.insertAdjacentHTML('beforeend', konten.map((k) => `<option value="${k.id}">${escapeHtml(k.nummer)} – ${escapeHtml(k.name)}</option>`).join(''));
      kontoSelect.dataset.filled = '1';
    }

    const alleBuchungen = await getAll('buchungen');
    const jJahr = jahrSelect.value || String(new Date().getFullYear());
    const jKontoId = kontoSelect.value;
    let jBuchungen = alleBuchungen.filter((b) => (b.datum || '').slice(0, 4) === jJahr);
    jBuchungen.sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));

    function kontoLabel(id) {
      const k = kontenById[id];
      return k ? `${k.nummer} ${k.name}` : '(unbekanntes Konto)';
    }

    if (jKontoId) {
      // Kontenblatt: nur Buchungen, die dieses Konto auf Soll- oder Haben-Seite betreffen, mit laufendem Saldo.
      const konto = kontenById[jKontoId];
      const kontenblatt = jBuchungen.filter((b) => b.sollKontoId === jKontoId || b.habenKontoId === jKontoId);
      const normalsaldoSoll = konto?.klasse === 'aktiv' || konto?.klasse === 'aufwand';
      let saldo = 0;
      const zeilen = kontenblatt.map((b) => {
        const istSoll = b.sollKontoId === jKontoId;
        saldo += (istSoll === normalsaldoSoll ? 1 : -1) * b.betrag;
        return { b, istSoll, saldo };
      });
      journalHost.innerHTML = `
        <h3>Kontenblatt ${escapeHtml(konto?.nummer || '')} ${escapeHtml(konto?.name || '')}</h3>
        <table class="data-table">
          <thead><tr><th>Datum</th><th>Text</th><th>Gegenkonto</th><th class="text-right">Soll</th><th class="text-right">Haben</th><th class="text-right">Saldo</th></tr></thead>
          <tbody>
            ${zeilen.map(({ b, istSoll, saldo: s }) => `
              <tr>
                <td>${formatDate(b.datum)}</td>
                <td>${escapeHtml(b.text)}</td>
                <td>${escapeHtml(kontoLabel(istSoll ? b.habenKontoId : b.sollKontoId))}</td>
                <td class="text-right">${istSoll ? formatCurrency(b.betrag) : ''}</td>
                <td class="text-right">${!istSoll ? formatCurrency(b.betrag) : ''}</td>
                <td class="text-right">${formatCurrency(s)}</td>
              </tr>
            `).join('') || '<tr><td colspan="6">Keine Buchungen im gewählten Jahr.</td></tr>'}
          </tbody>
        </table>
      `;
      return;
    }

    journalHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Datum</th><th>Text</th><th>Soll</th><th>Haben</th><th class="text-right">Betrag</th><th></th></tr></thead>
        <tbody>
          ${jBuchungen.map((b) => `
            <tr>
              <td>${formatDate(b.datum)}</td>
              <td>${escapeHtml(b.text)}</td>
              <td>${escapeHtml(kontoLabel(b.sollKontoId))}</td>
              <td>${escapeHtml(kontoLabel(b.habenKontoId))}</td>
              <td class="text-right">${formatCurrency(b.betrag)}</td>
              <td class="text-right">${b.manuell ? `<button class="btn btn-sm btn-danger" data-delete-buchung="${b.id}">Löschen</button>` : ''}</td>
            </tr>
          `).join('') || '<tr><td colspan="6">Keine Buchungen im gewählten Jahr.</td></tr>'}
        </tbody>
      </table>
    `;
    journalHost.querySelectorAll('[data-delete-buchung]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Buchung wirklich löschen?')) return;
        await remove('buchungen', btn.dataset.deleteBuchung);
        toast('Buchung gelöscht', 'success');
        renderJournal();
      });
    });
  }

  container.querySelector('#journal-jahr-select').addEventListener('change', renderJournal);
  container.querySelector('#journal-konto-select').addEventListener('change', renderJournal);
  container.querySelector('#btn-buchung-neu').addEventListener('click', async () => {
    const konten = await getAll('konten');
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    const kontoOptions = konten.map((k) => `<option value="${k.id}">${escapeHtml(k.nummer)} – ${escapeHtml(k.name)}</option>`).join('');
    const { body, close } = openModal({
      title: 'Manuelle Buchung',
      bodyHtml: `
        <form id="buchung-form">
          <div class="form-grid">
            <div class="field"><label>Datum *</label><input type="date" name="datum" required value="${new Date().toISOString().slice(0, 10)}"></div>
            <div class="field"><label>Betrag (€) *</label><input type="number" step="0.01" min="0.01" name="betrag" required></div>
            <div class="field"><label>Soll-Konto *</label><select name="sollKontoId" required>${kontoOptions}</select></div>
            <div class="field"><label>Haben-Konto *</label><select name="habenKontoId" required>${kontoOptions}</select></div>
            <div class="field col-span-2"><label>Text *</label><input name="text" required placeholder="z.B. Privatentnahme"></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Buchen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#buchung-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const sollKontoId = fd.get('sollKontoId');
      const habenKontoId = fd.get('habenKontoId');
      const betrag = Number(fd.get('betrag')) || 0;
      const text = (fd.get('text') || '').toString().trim();
      if (!sollKontoId || !habenKontoId || sollKontoId === habenKontoId || betrag <= 0 || !text) {
        toast('Bitte Soll-/Haben-Konto (unterschiedlich), Betrag und Text angeben', 'danger');
        return;
      }
      await put('buchungen', {
        id: uid(), datum: fd.get('datum') || todayISO(), text, sollKontoId, habenKontoId, betrag,
        quelle: null, manuell: true, createdAt: new Date().toISOString(),
      });
      toast('Buchung gespeichert', 'success');
      close();
      renderJournal();
    });
  });

  async function renderBilanz() {
    const bilanzHost = container.querySelector('#bilanz-host');
    const guvJahr = container.querySelector('#bilanz-jahr-select').value || String(new Date().getFullYear());
    const stichtag = container.querySelector('#bilanz-stichtag').value || todayISO();
    const konten = await getAll('konten');
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    const alleBuchungen = await getAll('buchungen');

    // --- GuV: Erträge (Haben-Normalsaldo) minus Aufwendungen (Soll-Normalsaldo) des gewählten Jahres ---
    const guvBuchungen = alleBuchungen.filter((b) => (b.datum || '').slice(0, 4) === guvJahr);
    const ertraege = summeJeKonto(guvBuchungen, konten, ['ertrag'], false);
    const aufwendungen = summeJeKonto(guvBuchungen, konten, ['aufwand'], true);
    const summeErtraege = ertraege.reduce((s, z) => s + z.betrag, 0);
    const summeAufwendungen = aufwendungen.reduce((s, z) => s + z.betrag, 0);
    const jahresueberschuss = summeErtraege - summeAufwendungen;

    // --- Bilanz zum Stichtag: kumulierte Salden seit je, unabhängig vom GuV-Jahr ---
    const bilanzBuchungen = alleBuchungen.filter((b) => (b.datum || '') <= stichtag);
    const aktiva = summeJeKonto(bilanzBuchungen, konten, ['aktiv'], true);
    const passiva = summeJeKonto(bilanzBuchungen, konten, ['passiv'], false);
    const summeAktiva = aktiva.reduce((s, z) => s + z.betrag, 0);
    const summePassiva = passiva.reduce((s, z) => s + z.betrag, 0);
    // Jahresüberschuss als Rest-Eigenkapital: gleicht Aktiva/Passiva rechnerisch aus (siehe Hinweistext oben).
    const eigenkapitalRest = summeAktiva - summePassiva;

    function zeilenHtml(zeilen) {
      return zeilen.map((z) => `<tr><td>${escapeHtml(z.konto.nummer)} ${escapeHtml(z.konto.name)}</td><td class="text-right">${formatCurrency(z.betrag)}</td></tr>`).join('')
        || '<tr><td colspan="2">Keine Buchungen.</td></tr>';
    }

    bilanzHost.innerHTML = `
      <div class="card">
        <h3>GuV ${guvJahr}</h3>
        <table class="data-table">
          <thead><tr><th>Ertragskonten</th><th class="text-right">Betrag</th></tr></thead>
          <tbody>${zeilenHtml(ertraege)}</tbody>
        </table>
        <table class="data-table">
          <thead><tr><th>Aufwandskonten</th><th class="text-right">Betrag</th></tr></thead>
          <tbody>${zeilenHtml(aufwendungen)}</tbody>
        </table>
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-value">${formatCurrency(summeErtraege)}</div><div class="kpi-label">Summe Erträge</div></div>
          <div class="kpi-card"><div class="kpi-value">${formatCurrency(summeAufwendungen)}</div><div class="kpi-label">Summe Aufwendungen</div></div>
          <div class="kpi-card ${jahresueberschuss >= 0 ? '' : 'kpi-danger'}"><div class="kpi-value">${formatCurrency(jahresueberschuss)}</div><div class="kpi-label">Jahresüberschuss/-fehlbetrag</div></div>
        </div>
      </div>
      <div class="card">
        <h3>Bilanz zum ${formatDate(stichtag)}</h3>
        <div class="form-grid">
          <div>
            <table class="data-table">
              <thead><tr><th>Aktiva</th><th class="text-right">Betrag</th></tr></thead>
              <tbody>${zeilenHtml(aktiva)}</tbody>
              <tfoot><tr><td>Summe Aktiva</td><td class="text-right">${formatCurrency(summeAktiva)}</td></tr></tfoot>
            </table>
          </div>
          <div>
            <table class="data-table">
              <thead><tr><th>Passiva</th><th class="text-right">Betrag</th></tr></thead>
              <tbody>
                ${zeilenHtml(passiva)}
                <tr><td>Eigenkapital (Restgröße)</td><td class="text-right">${formatCurrency(eigenkapitalRest)}</td></tr>
              </tbody>
              <tfoot><tr><td>Summe Passiva</td><td class="text-right">${formatCurrency(summePassiva + eigenkapitalRest)}</td></tr></tfoot>
            </table>
          </div>
        </div>
      </div>
    `;
  }
  container.querySelector('#bilanz-jahr-select').addEventListener('change', renderBilanz);
  container.querySelector('#bilanz-stichtag').addEventListener('change', renderBilanz);

  async function renderOffenePosten() {
    const host = container.querySelector('#offeneposten-host');
    const today = todayISO();
    const offeneRechnungen = rechnungen
      .filter((r) => r.status === 'offen' || r.status === 'teilbezahlt')
      .sort((a, b) => (a.faelligAm || '').localeCompare(b.faelligAm || ''));
    const summeDebitoren = offeneRechnungen.reduce((s, r) => s + (r.brutto || 0), 0);

    const offeneAusgaben = ausgaben
      .filter((a) => a.bezahlstatus === 'offen')
      .sort((a, b) => (a.faelligAm || '').localeCompare(b.faelligAm || ''));
    const summeKreditoren = offeneAusgaben.reduce((s, a) => s + (a.betragBrutto || 0), 0);

    const konten = await getAll('konten');
    const alleBuchungen = await getAll('buchungen');
    const verbindlichkeitenSaldo = kontoSumme(summeJeKonto(alleBuchungen, konten, ['passiv'], false), '1600');

    host.innerHTML = `
      <h3>Debitoren</h3>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${offeneRechnungen.length}</div><div class="kpi-label">Offene Rechnungen</div></div>
        <div class="kpi-card kpi-warn"><div class="kpi-value">${formatCurrency(summeDebitoren)}</div><div class="kpi-label">Summe offen (brutto)</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Nummer</th><th>Kunde</th><th>Fällig am</th><th>Status</th><th class="text-right">Betrag (brutto)</th></tr></thead>
        <tbody>
          ${offeneRechnungen.map((r) => {
            const overdue = r.faelligAm && r.faelligAm < today;
            return `
              <tr${overdue ? ' style="color:var(--danger,#c0392b)"' : ''}>
                <td>${escapeHtml(r.nummer)}</td>
                <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
                <td>${formatDate(r.faelligAm)}${overdue ? ' ⚠️' : ''}</td>
                <td>${escapeHtml(RECHNUNG_STATUS_LABEL[r.status] || r.status)}</td>
                <td class="text-right">${formatCurrency(r.brutto)}</td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="5">Keine offenen Rechnungen.</td></tr>'}
        </tbody>
      </table>

      <h3 style="margin-top:24px">Kreditoren</h3>
      <p class="hint">Noch nicht bezahlte Lieferantenrechnungen. Konto 1600 (Verbindlichkeiten) Saldo laut Journal: ${formatCurrency(verbindlichkeitenSaldo)}.</p>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${offeneAusgaben.length}</div><div class="kpi-label">Offene Lieferantenrechnungen</div></div>
        <div class="kpi-card kpi-warn"><div class="kpi-value">${formatCurrency(summeKreditoren)}</div><div class="kpi-label">Summe offen (brutto)</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Lieferant</th><th>Beschreibung</th><th>Fällig am</th><th class="text-right">Betrag (brutto)</th></tr></thead>
        <tbody>
          ${offeneAusgaben.map((a) => {
            const overdue = a.faelligAm && a.faelligAm < today;
            return `
              <tr${overdue ? ' style="color:var(--danger,#c0392b)"' : ''}>
                <td>${escapeHtml(a.lieferant || '–')}</td>
                <td>${escapeHtml(a.beschreibung || a.kategorie || '')}</td>
                <td>${formatDate(a.faelligAm)}${overdue ? ' ⚠️' : ''}</td>
                <td class="text-right">${formatCurrency(a.betragBrutto)}</td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="4">Keine offenen Lieferantenrechnungen.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  async function ustvaZeitraeume() {
    const aktuelleSettings = await getSettings();
    const vierteljaehrlich = aktuelleSettings.ustvaZeitraum === 'vierteljaehrlich';
    if (vierteljaehrlich) {
      return { vierteljaehrlich, optionen: [1, 2, 3, 4].map((q) => ({ wert: q, label: `${q}. Quartal` })) };
    }
    return { vierteljaehrlich, optionen: MONTHS.map((m, i) => ({ wert: i + 1, label: m })) };
  }
  function periodenRange(jahr, vierteljaehrlich, periode) {
    const startMonat = vierteljaehrlich ? (periode - 1) * 3 + 1 : periode;
    const endMonat = vierteljaehrlich ? startMonat + 2 : periode;
    const von = `${jahr}-${String(startMonat).padStart(2, '0')}-01`;
    const bis = `${jahr}-${String(endMonat).padStart(2, '0')}-${String(letzterTagDesMonats(jahr, endMonat)).padStart(2, '0')}`;
    return { von, bis };
  }

  async function renderUstva() {
    const host = container.querySelector('#ustva-host');
    const jahrSelect = container.querySelector('#ustva-jahr-select');
    const periodeSelect = container.querySelector('#ustva-periode-select');
    const { vierteljaehrlich, optionen } = await ustvaZeitraeume();
    const optionenKey = vierteljaehrlich ? 'q' : 'm';
    if (periodeSelect.dataset.filled !== optionenKey) {
      periodeSelect.innerHTML = optionen.map((o) => `<option value="${o.wert}">${escapeHtml(o.label)}</option>`).join('');
      periodeSelect.dataset.filled = optionenKey;
    }

    const jahr = jahrSelect.value || String(new Date().getFullYear());
    const periode = Number(periodeSelect.value) || 1;
    const { von, bis } = periodenRange(jahr, vierteljaehrlich, periode);

    const konten = await getAll('konten');
    const alleBuchungen = await getAll('buchungen');
    const periodenBuchungen = alleBuchungen.filter((b) => (b.datum || '') >= von && (b.datum || '') <= bis);

    const erloese = summeJeKonto(periodenBuchungen, konten, ['ertrag'], false);
    const ust = summeJeKonto(periodenBuchungen, konten, ['passiv'], false);
    const vorsteuerZeilen = summeJeKonto(periodenBuchungen, konten, ['aktiv'], true).filter((z) => z.konto.nummer === '1571' || z.konto.nummer === '1576');

    const umsatz19 = kontoSumme(erloese, '8400');
    const umsatz7 = kontoSumme(erloese, '8300');
    const umsatzSteuerfrei = kontoSumme(erloese, '8125');
    const ust19 = kontoSumme(ust, '1776');
    const ust7 = kontoSumme(ust, '1771');
    const vorsteuer = vorsteuerZeilen.reduce((s, z) => s + z.betrag, 0);
    const zahllast = ust19 + ust7 - vorsteuer;

    host.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(umsatz19)}</div><div class="kpi-label">Umsätze 19 %</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(umsatz7)}</div><div class="kpi-label">Umsätze 7 %</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(umsatzSteuerfrei)}</div><div class="kpi-label">Steuerfreie Umsätze</div></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(ust19 + ust7)}</div><div class="kpi-label">Umsatzsteuer (19 %: ${formatCurrency(ust19)}, 7 %: ${formatCurrency(ust7)})</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(vorsteuer)}</div><div class="kpi-label">Abziehbare Vorsteuer</div></div>
        <div class="kpi-card ${zahllast >= 0 ? 'kpi-warn' : ''}"><div class="kpi-value">${formatCurrency(zahllast)}</div><div class="kpi-label">${zahllast >= 0 ? 'Zahllast' : 'Erstattung'}</div></div>
      </div>
      <p class="hint">Zeitraum: ${formatDate(von)} – ${formatDate(bis)}</p>
    `;

    container.querySelector('#btn-export-ustva-csv').onclick = () => {
      const rows = [
        ['Zeitraum', `${von} – ${bis}`],
        ['Umsätze 19 %', deNum(umsatz19)],
        ['Umsätze 7 %', deNum(umsatz7)],
        ['Steuerfreie Umsätze', deNum(umsatzSteuerfrei)],
        ['Umsatzsteuer 19 %', deNum(ust19)],
        ['Umsatzsteuer 7 %', deNum(ust7)],
        ['Abziehbare Vorsteuer', deNum(vorsteuer)],
        [zahllast >= 0 ? 'Zahllast' : 'Erstattung', deNum(Math.abs(zahllast))],
      ];
      const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      downloadFile(csv, `ustva-${jahr}-${vierteljaehrlich ? 'Q' + periode : String(periode).padStart(2, '0')}.csv`, 'text/csv;charset=utf-8');
    };
  }
  container.querySelector('#ustva-jahr-select').addEventListener('change', renderUstva);
  container.querySelector('#ustva-periode-select').addEventListener('change', renderUstva);

  function kontoabgleichZielLabel(b) {
    if (!b.matchTyp || !b.matchId) return '';
    if (b.matchTyp === 'rechnung') {
      const r = rechnungen.find((x) => x.id === b.matchId);
      return r ? `Rechnung ${r.nummer}${kundenById[r.kundeId]?.firma ? ` (${kundenById[r.kundeId].firma})` : ''}` : '';
    }
    const a = ausgaben.find((x) => x.id === b.matchId);
    return a ? `${a.lieferant || a.kategorie || 'Ausgabe'}` : '';
  }

  function kontoabgleichStatusBadge(b) {
    if (b.ignoriert) return '<span class="badge">🚫 Ignoriert</span>';
    if (b.matched) return `<span class="badge badge-success">✅ ${escapeHtml(kontoabgleichZielLabel(b))}</span>`;
    if (b.matchTyp && b.matchId) return `<span class="badge badge-warn">⚠️ Vorschlag: ${escapeHtml(kontoabgleichZielLabel(b))}</span>`;
    return '<span class="badge badge-danger">❌ nicht zugeordnet</span>';
  }

  function kontoabgleichManuelleAuswahl(b) {
    const optionen = b.betrag > 0
      ? rechnungen.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt')
        .map((r) => `<option value="rechnung:${r.id}">${escapeHtml(r.nummer)} (${formatCurrency(r.brutto)})</option>`).join('')
      : ausgaben.filter((a) => a.bezahlstatus === 'offen')
        .map((a) => `<option value="ausgabe:${a.id}">${escapeHtml(a.lieferant || a.kategorie || 'Ausgabe')} (${formatCurrency(a.betragBrutto)})</option>`).join('');
    return `<select class="kontoabgleich-manuell-select" data-id="${b.id}"><option value="">– manuell zuordnen –</option>${optionen}</select>`;
  }

  async function renderKontoabgleich() {
    const host = container.querySelector('#kontoabgleich-host');
    const nurOffene = container.querySelector('#kontoabgleich-nur-offene')?.checked;
    let alle = (await getAll('bankbuchungen')).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    if (nurOffene) alle = alle.filter((b) => !b.matched && !b.ignoriert);

    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Datum</th><th>Verwendungszweck</th><th>Empfänger/Auftraggeber</th><th class="text-right">Betrag</th><th>Status</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${alle.map((b) => `
            <tr>
              <td>${formatDate(b.datum)}</td>
              <td>${escapeHtml(b.verwendungszweck || '')}</td>
              <td>${escapeHtml(b.empfaenger || '')}</td>
              <td class="text-right">${formatCurrency(b.betrag)}</td>
              <td>${kontoabgleichStatusBadge(b)}</td>
              <td>
                ${b.matched || b.ignoriert ? '' : `
                  ${b.matchTyp && b.matchId
                    ? `<button type="button" class="btn btn-sm" data-action="bestaetigen" data-id="${b.id}">Bestätigen</button>
                       <button type="button" class="btn btn-sm" data-action="verwerfen" data-id="${b.id}">Verwerfen</button>`
                    : `${kontoabgleichManuelleAuswahl(b)}
                       <button type="button" class="btn btn-sm" data-action="manuell-zuordnen" data-id="${b.id}">Zuordnen</button>`}
                  <button type="button" class="btn btn-sm" data-action="ignorieren" data-id="${b.id}">Ignorieren</button>
                `}
              </td>
            </tr>
          `).join('') || `<tr><td colspan="6">${nurOffene ? 'Keine unzugeordneten Buchungen.' : 'Noch keine Buchungen importiert.'}</td></tr>`}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const b = (await getAll('bankbuchungen')).find((x) => x.id === id);
        if (!b) return;
        if (btn.dataset.action === 'bestaetigen') {
          if (!b.matchTyp || !b.matchId) return;
          await bankabgleich.uebernehmeZuordnung(b, { typ: b.matchTyp, id: b.matchId }, settings);
          toast('Zuordnung übernommen', 'success');
        } else if (btn.dataset.action === 'verwerfen') {
          await put('bankbuchungen', { ...b, matchTyp: null, matchId: null });
        } else if (btn.dataset.action === 'ignorieren') {
          await put('bankbuchungen', { ...b, ignoriert: true });
        } else if (btn.dataset.action === 'manuell-zuordnen') {
          const select = host.querySelector(`.kontoabgleich-manuell-select[data-id="${id}"]`);
          const val = select?.value;
          if (!val) { toast('Bitte zuerst eine Zuordnung auswählen', 'danger'); return; }
          const [typ, zielId] = val.split(':');
          await bankabgleich.uebernehmeZuordnung(b, { typ, id: zielId }, settings);
          toast('Zuordnung übernommen', 'success');
        }
        rechnungen = await getAll('rechnungen');
        ausgaben = await getAll('ausgaben');
        renderKontoabgleich();
        renderOffenePosten();
        renderJournal();
      });
    });
  }

  container.querySelector('#kontoabgleich-nur-offene').addEventListener('change', renderKontoabgleich);
  container.querySelector('#btn-kontoabgleich-jetzt').addEventListener('click', async () => {
    const { automatisch, vorschlaege } = await bankabgleich.laufeAbgleich(settings);
    rechnungen = await getAll('rechnungen');
    ausgaben = await getAll('ausgaben');
    toast(`${automatisch} automatisch zugeordnet, ${vorschlaege} Vorschläge zur Prüfung`, 'success');
    renderKontoabgleich();
    renderOffenePosten();
    renderJournal();
  });

  container.querySelector('#btn-kontoauszug-import').addEventListener('click', () => {
    const { body, close } = openModal({
      title: 'Kontoauszug importieren',
      wide: true,
      bodyHtml: `
        <div class="field"><label>CSV-Datei</label><input type="file" accept=".csv,text/csv" id="bank-csv-input"></div>
        <div id="bank-mapping-host"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="btn-bank-importieren" disabled>Importieren</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);

    let geparst = null;
    body.querySelector('#bank-csv-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await readTextAutoEncoding(file);
      const delimiter = erkenneDelimiter((text.split('\n')[0] || ''));
      const alleZeilen = parseCsv(text, delimiter);
      if (alleZeilen.length < 2) {
        toast('Konnte keine Datenzeilen in der Datei finden.', 'danger');
        return;
      }
      const header = alleZeilen[0];
      const rows = alleZeilen.slice(1);
      geparst = { header, rows };

      const gespeichert = settings.bankImportSpalten || {};
      const spaltenOptionen = (ausgewaehlt) => `<option value="">–</option>${header.map((h) => `<option value="${escapeHtml(h)}" ${h === ausgewaehlt ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}`;
      body.querySelector('#bank-mapping-host').innerHTML = `
        <p class="hint">${rows.length} Datenzeilen erkannt. Bitte die passenden Spalten zuordnen:</p>
        <div class="form-grid">
          <div class="field"><label>Datum-Spalte *</label><select id="map-datum">${spaltenOptionen(gespeichert.datum)}</select></div>
          <div class="field"><label>Betrag-Spalte *</label><select id="map-betrag">${spaltenOptionen(gespeichert.betrag)}</select></div>
          <div class="field"><label>Verwendungszweck-Spalte</label><select id="map-verwendungszweck">${spaltenOptionen(gespeichert.verwendungszweck)}</select></div>
          <div class="field"><label>Empfänger/Auftraggeber-Spalte</label><select id="map-empfaenger">${spaltenOptionen(gespeichert.empfaenger)}</select></div>
        </div>
        <table class="data-table">
          <thead><tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 3).map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      `;
      body.querySelector('#btn-bank-importieren').disabled = false;
    });

    body.querySelector('#btn-bank-importieren').addEventListener('click', async () => {
      if (!geparst) return;
      const mapping = {
        datum: body.querySelector('#map-datum').value,
        betrag: body.querySelector('#map-betrag').value,
        verwendungszweck: body.querySelector('#map-verwendungszweck').value,
        empfaenger: body.querySelector('#map-empfaenger').value,
      };
      if (!mapping.datum || !mapping.betrag) {
        toast('Bitte mindestens Datum- und Betrag-Spalte zuordnen', 'danger');
        return;
      }
      await setSettings({ bankImportSpalten: mapping });
      settings.bankImportSpalten = mapping;
      const neueBuchungen = zeilenZuBuchungen(geparst.rows, geparst.header, mapping);
      const bestehende = await getAll('bankbuchungen');
      const bestehendeSchluessel = new Set(bestehende.map((b) => bankbuchungSchluessel(b)));
      let neu = 0;
      let doppelt = 0;
      for (const b of neueBuchungen) {
        const schluessel = bankbuchungSchluessel(b);
        if (bestehendeSchluessel.has(schluessel)) { doppelt++; continue; }
        bestehendeSchluessel.add(schluessel);
        await put('bankbuchungen', { id: uid(), ...b, matched: false, matchTyp: null, matchId: null, ignoriert: false, createdAt: new Date().toISOString() });
        neu++;
      }
      const { automatisch, vorschlaege } = await bankabgleich.laufeAbgleich(settings);
      rechnungen = await getAll('rechnungen');
      ausgaben = await getAll('ausgaben');
      toast(`${neu} Buchungen importiert${doppelt ? `, ${doppelt} bereits vorhanden (übersprungen)` : ''} · ${automatisch} automatisch zugeordnet, ${vorschlaege} Vorschläge`, 'success');
      close();
      renderKontoabgleich();
      renderOffenePosten();
      renderJournal();
    });
  });

  async function renderAnlagenverzeichnis() {
    const host = container.querySelector('#anlagenverzeichnis-host');
    const heute = todayISO();
    const anlagen = (await getAll('anlagegueter')).sort((a, b) => (b.anschaffungsdatum || '').localeCompare(a.anschaffungsdatum || ''));
    const aktive = anlagen.filter((a) => a.status !== 'ausgeschieden');
    const summeAnschaffung = aktive.reduce((s, a) => s + (a.anschaffungswertNetto || 0), 0);
    const summeRestbuchwert = aktive.reduce((s, a) => s + aktuellerRestbuchwert(a, heute), 0);

    host.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${aktive.length}</div><div class="kpi-label">Aktive Anlagegüter</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(summeAnschaffung)}</div><div class="kpi-label">Anschaffungswert (Summe)</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatCurrency(summeRestbuchwert)}</div><div class="kpi-label">Restbuchwert (Summe)</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Bezeichnung</th><th>Kategorie</th><th>Anschaffungsdatum</th><th class="text-right">Anschaffungswert</th><th>Nutzungsdauer</th><th class="text-right">Jährl. AfA</th><th class="text-right">Restbuchwert</th><th>Status</th></tr></thead>
        <tbody>
          ${anlagen.map((a) => `
            <tr data-id="${a.id}" style="cursor:pointer">
              <td>${escapeHtml(a.bezeichnung)}</td>
              <td>${escapeHtml(a.kategorie || '')}${a.gwg ? ' <span class="badge">GWG</span>' : ''}</td>
              <td>${formatDate(a.anschaffungsdatum)}</td>
              <td class="text-right">${formatCurrency(a.anschaffungswertNetto)}</td>
              <td>${a.gwg ? 'Sofort' : `${a.nutzungsdauerJahre} Jahre`}</td>
              <td class="text-right">${formatCurrency(berechneJahresAfa(a))}</td>
              <td class="text-right">${formatCurrency(aktuellerRestbuchwert(a, heute))}</td>
              <td>${a.status === 'ausgeschieden' ? `<span class="badge">Ausgeschieden${a.ausgeschiedenAm ? ' ' + formatDate(a.ausgeschiedenAm) : ''}</span>` : '<span class="badge badge-success">Aktiv</span>'}</td>
            </tr>
          `).join('') || '<tr><td colspan="8">Noch keine Anlagegüter erfasst.</td></tr>'}
        </tbody>
      </table>
    `;
    host.querySelectorAll('tbody tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => openAnlageForm(anlagen.find((a) => a.id === row.dataset.id)));
    });
  }

  async function openAnlageForm(a, { prefill } = {}) {
    const isEdit = !!a;
    const [geraete, flotten] = await Promise.all([getAll('geraete'), getAll('flotten')]);
    const data = a || {
      id: uid(), bezeichnung: '', kategorie: ANLAGE_KATEGORIEN[0], anschaffungsdatum: todayISO(),
      anschaffungswertNetto: 0, steuersatz: settings.standardSteuersatz, restwert: 0,
      nutzungsdauerJahre: 8, gwg: false, bezahltMit: 'überweisung',
      geraetId: '', flotteId: '', ausgabeId: '', lieferant: '', notizen: '',
      status: 'aktiv', ausgeschiedenAm: '', createdAt: new Date().toISOString(),
      ...prefill,
    };
    const { body, close } = openModal({
      title: isEdit ? 'Anlage bearbeiten' : 'Neue Anlage',
      bodyHtml: `
        <form id="anlage-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Bezeichnung</label><input name="bezeichnung" required value="${escapeHtml(data.bezeichnung)}"></div>
            <div class="field"><label>Kategorie</label>
              <select name="kategorie">${ANLAGE_KATEGORIEN.map((k) => `<option value="${k}" ${k === data.kategorie ? 'selected' : ''}>${k}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Lieferant</label><input name="lieferant" value="${escapeHtml(data.lieferant || '')}"></div>
            <div class="field"><label>Anschaffungsdatum</label><input type="date" name="anschaffungsdatum" value="${data.anschaffungsdatum}"></div>
            <div class="field"><label>Anschaffungswert netto (€)</label><input type="number" step="0.01" min="0" name="anschaffungswertNetto" id="anlage-netto" value="${data.anschaffungswertNetto}"></div>
            <div class="field"><label>USt.-Satz (%)</label>
              <select name="steuersatz">
                <option value="19" ${Number(data.steuersatz) === 19 ? 'selected' : ''}>19 %</option>
                <option value="7" ${Number(data.steuersatz) === 7 ? 'selected' : ''}>7 %</option>
                <option value="0" ${Number(data.steuersatz) === 0 ? 'selected' : ''}>0 %</option>
              </select>
            </div>
            <div class="field"><label>Nutzungsdauer (Jahre)</label><input type="number" step="1" min="1" name="nutzungsdauerJahre" id="anlage-nutzungsdauer" value="${data.nutzungsdauerJahre}" ${data.gwg ? 'disabled' : ''}></div>
            <div class="field"><label>Restwert (€, optional)</label><input type="number" step="0.01" min="0" name="restwert" value="${data.restwert || 0}"></div>
            <div class="field col-span-2"><p class="hint mb-0">Richtwerte AfA-Tabelle: Werkzeug/Maschinen ca. 8 Jahre, Pkw ca. 6 Jahre, EDV ca. 3 Jahre, Büroausstattung ca. 13 Jahre.</p></div>
            <div class="field col-span-2">
              <label><input type="checkbox" id="anlage-gwg-checkbox" ${data.gwg ? 'checked' : ''}> Geringwertiges Wirtschaftsgut (GWG) - sofort in voller Höhe abschreiben</label>
            </div>
            <div class="field"><label>Bezahlt mit</label>
              <select name="bezahltMit">
                <option value="überweisung" ${data.bezahltMit === 'überweisung' ? 'selected' : ''}>Überweisung</option>
                <option value="bar" ${data.bezahltMit === 'bar' ? 'selected' : ''}>Bar</option>
              </select>
            </div>
            <div class="field"><label>Gerät/Fahrzeug verknüpfen (optional)</label>
              <select name="geraetFlotte" id="anlage-geraetflotte">
                <option value="">– keine Verknüpfung –</option>
                <optgroup label="Geräte">${geraete.map((g) => `<option value="geraet:${g.id}" data-anschaffungswert="${g.anschaffungswert || ''}" data-anschaffungsdatum="${g.anschaffungsdatum || ''}" ${data.geraetId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</optgroup>
                <optgroup label="Fahrzeuge">${flotten.map((f) => `<option value="flotte:${f.id}" data-anschaffungswert="${f.anschaffungswert || ''}" data-anschaffungsdatum="${f.anschaffungsdatum || ''}" ${data.flotteId === f.id ? 'selected' : ''}>${escapeHtml(f.bezeichnung)}</option>`).join('')}</optgroup>
              </select>
            </div>
            <div class="field col-span-2"><label>Notizen</label><input name="notizen" value="${escapeHtml(data.notizen || '')}"></div>
            ${isEdit && data.status === 'ausgeschieden' ? `
              <div class="card col-span-2" style="background:#fff6e0;border-color:#f0d78c">
                <p class="mb-0">⚠️ Diese Anlage ist ausgeschieden am ${escapeHtml(formatDate(data.ausgeschiedenAm))}. Der Restbuchwert wurde vollständig abgeschrieben.</p>
              </div>
            ` : isEdit ? `
              <div class="col-span-2" id="anlage-ausscheiden-section">
                <div class="field"><label>Anlage ausscheiden (Verkauf/Verschrottung/Diebstahl) am</label><input type="date" id="anlage-ausscheiden-am" value="${todayISO()}"></div>
                <button type="button" class="btn" id="btn-anlage-ausscheiden">Anlage ausscheiden - Restbuchwert vollständig abschreiben</button>
              </div>
            ` : ''}
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);

    if (isEdit && data.status !== 'ausgeschieden') {
      body.querySelector('#btn-anlage-ausscheiden').addEventListener('click', async () => {
        const ausgeschiedenAm = body.querySelector('#anlage-ausscheiden-am').value || todayISO();
        if (!confirmDelete(`Anlage "${data.bezeichnung}" zum ${ausgeschiedenAm} ausscheiden? Der verbleibende Restbuchwert wird vollständig abgeschrieben.`)) return;
        const updated = { ...data, status: 'ausgeschieden', ausgeschiedenAm };
        await put('anlagegueter', updated);
        try { await journal.syncAbschreibungenFuerAnlage(updated, settings, todayISO()); } catch { /* Buchung ist Komfort, darf Speichern nicht blockieren */ }
        toast('Anlage ausgeschieden', 'success');
        close();
        renderAnlagenverzeichnis();
        renderJournal();
        renderBilanz();
      });
    }

    function aktualisiereGwgVorschlag() {
      const netto = Number(body.querySelector('#anlage-netto').value) || 0;
      const checkbox = body.querySelector('#anlage-gwg-checkbox');
      if (!isEdit && netto > 0 && netto <= (settings.gwgGrenzeNetto || 800)) checkbox.checked = true;
      body.querySelector('#anlage-nutzungsdauer').disabled = checkbox.checked;
    }
    body.querySelector('#anlage-netto').addEventListener('input', aktualisiereGwgVorschlag);
    body.querySelector('#anlage-gwg-checkbox').addEventListener('change', aktualisiereGwgVorschlag);
    if (prefill) aktualisiereGwgVorschlag();

    // Verknüpftes Gerät/Fahrzeug hat einen Anschaffungswert/-datum hinterlegt:
    // nur zur Bequemlichkeit übernehmen, wenn im Anlage-Formular noch nichts
    // eingetragen ist (nicht destruktiv gegenüber bereits erfassten Werten).
    body.querySelector('#anlage-geraetflotte').addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      const nettoFeld = body.querySelector('#anlage-netto');
      const datumFeld = body.querySelector('input[name="anschaffungsdatum"]');
      if (opt?.dataset.anschaffungswert && !Number(nettoFeld.value)) {
        nettoFeld.value = opt.dataset.anschaffungswert;
        aktualisiereGwgVorschlag();
      }
      if (opt?.dataset.anschaffungsdatum && datumFeld.value === todayISO()) {
        datumFeld.value = opt.dataset.anschaffungsdatum;
      }
    });

    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Anlage "${data.bezeichnung}" wirklich löschen? Die zugehörigen Buchungen werden ebenfalls entfernt.`)) return;
        await remove('anlagegueter', data.id);
        await journal.entferneBuchungenFuerAnlage(data.id);
        toast('Anlage gelöscht');
        close();
        renderAnlagenverzeichnis();
        renderJournal();
        renderBilanz();
      });
    }

    body.querySelector('#anlage-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const [gfTyp, gfId] = (fd.get('geraetFlotte') || '').toString().split(':');
      const netto = Number(fd.get('anschaffungswertNetto')) || 0;
      const steuersatz = Number(fd.get('steuersatz')) || 0;
      const updated = {
        ...data,
        bezeichnung: (fd.get('bezeichnung') || '').toString().trim(),
        kategorie: fd.get('kategorie') || ANLAGE_KATEGORIEN[0],
        lieferant: (fd.get('lieferant') || '').toString().trim(),
        anschaffungsdatum: fd.get('anschaffungsdatum') || todayISO(),
        anschaffungswertNetto: netto,
        steuersatz,
        anschaffungswertBrutto: Math.round(netto * (1 + steuersatz / 100) * 100) / 100,
        nutzungsdauerJahre: Number(fd.get('nutzungsdauerJahre')) || 1,
        restwert: Number(fd.get('restwert')) || 0,
        gwg: body.querySelector('#anlage-gwg-checkbox').checked,
        bezahltMit: fd.get('bezahltMit') || 'überweisung',
        geraetId: gfTyp === 'geraet' ? gfId : '',
        flotteId: gfTyp === 'flotte' ? gfId : '',
        notizen: (fd.get('notizen') || '').toString().trim(),
      };
      if (!updated.bezeichnung) { toast('Bitte eine Bezeichnung angeben', 'danger'); return; }
      if (!updated.anschaffungswertNetto) { toast('Bitte einen Anschaffungswert angeben', 'danger'); return; }

      await put('anlagegueter', updated);
      try { await journal.syncBuchungFuerAnlage(updated, settings); } catch { /* Buchung ist Komfort, darf Speichern nicht blockieren */ }
      toast(isEdit ? 'Anlage aktualisiert' : 'Anlage angelegt', 'success');
      close();
      renderAnlagenverzeichnis();
      renderJournal();
      renderBilanz();
    });
  }

  container.querySelector('#btn-anlage-neu').addEventListener('click', () => openAnlageForm());
  container.querySelector('#btn-afa-jetzt-buchen').addEventListener('click', async () => {
    const jahr = container.querySelector('#anlage-afa-jahr-select').value;
    const bisDatum = `${jahr}-12-31`;
    const anlagen = await getAll('anlagegueter');
    let gebucht = 0;
    for (const a of anlagen.filter((x) => x.status !== 'ausgeschieden')) {
      await journal.syncAbschreibungenFuerAnlage(a, settings, bisDatum);
      gebucht++;
    }
    toast(`Abschreibungen für ${jahr} für ${gebucht} Anlage(n) gebucht/aktualisiert`, 'success');
    renderAnlagenverzeichnis();
    renderJournal();
    renderBilanz();
  });

  renderContent();
  renderKontenplan();
  renderJournal();
  renderBilanz();
  renderOffenePosten();
  renderUstva();
  renderKontoabgleich();
  renderAnlagenverzeichnis();
}
