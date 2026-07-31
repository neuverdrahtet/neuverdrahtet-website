import { getAll, put, remove, getSettings, KONTEN_KLASSEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const KLASSE_LABEL = Object.fromEntries(KONTEN_KLASSEN.map((k) => [k.id, k.titel]));

const BUCH_NAV = [
  { id: 'uebersicht', icon: '📊', label: 'Übersicht' },
  { id: 'kontenplan', icon: '📒', label: 'Kontenplan' },
  { id: 'journal', icon: '📓', label: 'Journal' },
  { id: 'bilanz', icon: '⚖️', label: 'Bilanz & GuV' },
  { id: 'offeneposten', icon: '📬', label: 'Offene Posten' },
  { id: 'ustva', icon: '🧾', label: 'USt.-Voranmeldung' },
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

  function renderOffenePosten() {
    const host = container.querySelector('#offeneposten-host');
    const today = todayISO();
    const offene = rechnungen
      .filter((r) => r.status === 'offen' || r.status === 'teilbezahlt')
      .sort((a, b) => (a.faelligAm || '').localeCompare(b.faelligAm || ''));
    const summe = offene.reduce((s, r) => s + (r.brutto || 0), 0);
    host.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${offene.length}</div><div class="kpi-label">Offene Rechnungen</div></div>
        <div class="kpi-card kpi-warn"><div class="kpi-value">${formatCurrency(summe)}</div><div class="kpi-label">Summe offen (brutto)</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Nummer</th><th>Kunde</th><th>Fällig am</th><th>Status</th><th class="text-right">Betrag (brutto)</th></tr></thead>
        <tbody>
          ${offene.map((r) => {
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

  renderContent();
  renderKontenplan();
  renderJournal();
  renderBilanz();
  renderOffenePosten();
  renderUstva();
}
