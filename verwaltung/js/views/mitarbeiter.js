import { getAll, put, remove, clearStore, syncMitarbeiterOeffentlich, getSettings, ZUGRIFFSROLLEN, TERMIN_TYPEN } from '../db.js';
import { uid, escapeHtml, formatDate, toast, toCsv, downloadTextFile, excelFileToCsvText, readTextAutoEncoding, farbeAusText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { renderDokumenteSection } from '../dokumente.js';
import { createBulkSelect } from '../bulkselect.js';
import { FIREBASE_ENABLED, inviteEmployee, revokeInvite, revokeUserAccess, getEmployeeAuthStatus } from '../employeeAuth.js';

const STATUS_TYPEN = ['krank', 'urlaub', 'schulung', 'baustelle'];
const ABWESENHEIT_TYPEN = ['urlaub', 'krank', 'schulung'];

const MA_FELDER = [
  'name', 'personalnummer', 'rolle', 'telefon', 'email', 'strasse', 'plz', 'ort',
  'geburtsdatum', 'eintrittsdatum', 'austrittsdatum', 'vertragsart', 'wochenstunden',
  'stundenlohn', 'gehaltMonatlich', 'urlaubsanspruchTage', 'iban', 'steuerId',
  'sozialversicherungsnummer', 'krankenkasse', 'notfallkontaktName', 'notfallkontaktTelefon', 'notizen',
];
const MA_HEADER = [
  'Name', 'Personalnummer', 'Rolle', 'Telefon', 'E-Mail', 'Straße', 'PLZ', 'Ort',
  'Geburtsdatum', 'Eintrittsdatum', 'Austrittsdatum', 'Vertragsart', 'Wochenstunden',
  'Stundenlohn', 'Gehalt monatlich', 'Urlaubsanspruch (Tage)', 'IBAN', 'Steuer-ID',
  'Sozialversicherungsnr.', 'Krankenkasse', 'Notfallkontakt Name', 'Notfallkontakt Telefon', 'Notizen',
];

function parseMitarbeiterCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const delimiter = line.includes(';') ? ';' : ',';
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^name$/i.test(cols[0] || '')) continue;
    const [name, ...rest] = cols;
    if (!name) { errors.push(line); continue; }
    const row = { id: uid(), name, vertragsart: 'Vollzeit', zugriffsrolle: 'mitarbeiter' };
    MA_FELDER.slice(1).forEach((feld, i) => { row[feld] = rest[i] || ''; });
    if (row.vertragsart === '') row.vertragsart = 'Vollzeit';
    rows.push(row);
  }
  return { rows, errors };
}

function currentStatusFor(termine, mitarbeiterId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const active = termine.find((t) => {
    if (!t.mitarbeiterIds?.includes(mitarbeiterId) || !STATUS_TYPEN.includes(t.typ)) return false;
    const start = (t.start || '').slice(0, 10);
    const ende = (t.ende || '').slice(0, 10) || start;
    return start <= todayStr && todayStr <= ende;
  });
  return active ? TERMIN_TYPEN.find((tt) => tt.id === active.typ) : null;
}

const FARBEN = ['#f0a020', '#2b7fd6', '#1f8a4c', '#c0392b', '#8e44ad', '#16a085', '#d35400', '#2c3e50'];
const VERTRAGSARTEN = ['Vollzeit', 'Teilzeit', 'Minijob', 'Midijob', 'Werkstudent', 'Auszubildender', 'Praktikant', 'Kurzfristig beschäftigt', 'Geschäftsführer'];
const STEUERKLASSEN = ['1', '2', '3', '4', '5', '6'];
const KONFESSIONEN = [
  { id: '', titel: '– keine/konfessionslos –' },
  { id: 'ev', titel: 'Evangelisch' },
  { id: 'rk', titel: 'Römisch-katholisch' },
  { id: 'sonstige', titel: 'Sonstige (kirchensteuerpflichtig)' },
];
const MA_DOKUMENT_KATEGORIEN = [
  { id: 'bericht', titel: 'Bericht/Protokoll' },
  { id: 'vertrag', titel: 'Vertrag' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

function currentYearCount(termine, mitarbeiterId, typ) {
  const year = new Date().getFullYear();
  return termine.filter((t) =>
    t.typ === typ &&
    t.mitarbeiterIds?.includes(mitarbeiterId) &&
    Number((t.start || '').slice(0, 4)) === year
  ).length;
}

export async function render(container) {
  let [mitarbeiter, termine, marken, settings, zeiterfassung] = await Promise.all([getAll('mitarbeiter'), getAll('termine'), getAll('marken'), getSettings(), getAll('zeiterfassung')]);
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  marken.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  syncMitarbeiterOeffentlich().catch((err) => console.error('mitarbeiterOeffentlich-Sync fehlgeschlagen:', err));
  const bulk = createBulkSelect('mitarbeiter', { label: 'Mitarbeiter' });

  const statusHeute = mitarbeiter.map((m) => currentStatusFor(termine, m.id));
  const abwesendHeute = statusHeute.filter((s) => s && ['krank', 'urlaub', 'schulung'].includes(s.id)).length;
  const baustelleHeute = statusHeute.filter((s) => s && s.id === 'baustelle').length;

  container.innerHTML = `
    <div class="view-header">
      <h1>Mitarbeiter</h1>
      <div class="actions">
        <button class="btn" id="btn-export">⇩ Export (CSV)</button>
        <button class="btn" id="btn-import">⇪ Importieren</button>
        <button class="btn" id="btn-lohnvorbereitung">⇩ Lohnvorbereitung exportieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Mitarbeiter</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value">${mitarbeiter.length}</div>
        <div class="kpi-label">Team gesamt</div>
      </div>
      <div class="kpi-card kpi-accent">
        <div class="kpi-value">${baustelleHeute}</div>
        <div class="kpi-label">Auf Baustelle heute</div>
      </div>
      <div class="kpi-card kpi-warn">
        <div class="kpi-value">${abwesendHeute}</div>
        <div class="kpi-label">Abwesend heute (Urlaub/Krank/Schulung)</div>
      </div>
      <div class="kpi-card kpi-success">
        <div class="kpi-value">${mitarbeiter.length - abwesendHeute - baustelleHeute}</div>
        <div class="kpi-label">Verfügbar heute</div>
      </div>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (mitarbeiter.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Mitarbeiter angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th></th><th>Name</th><th>Rolle</th><th>Vertrag</th><th>Status heute</th><th>Urlaub (Jahr)</th><th>Telefon</th><th>E-Mail</th></tr></thead>
        <tbody>
          ${mitarbeiter.map((m) => {
            const genommen = currentYearCount(termine, m.id, 'urlaub');
            const anspruch = Number(m.urlaubsanspruchTage) || 0;
            const status = currentStatusFor(termine, m.id);
            return `
            <tr data-id="${m.id}">
              ${bulk.rowCell(m.id)}
              <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${m.farbe || '#f0a020'}"></span></td>
              <td>${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.rolle || '')}</td>
              <td>${escapeHtml(m.vertragsart || '')}</td>
              <td>${status ? `<span class="badge" style="background:${escapeHtml(status.farbe)}22;color:${escapeHtml(status.farbe)}">${escapeHtml(status.titel)}</span>` : '<span class="badge badge-success">Verfügbar</span>'}</td>
              <td>${anspruch ? `${genommen} / ${anspruch} Tage` : (genommen ? `${genommen} Tage` : '')}</td>
              <td>${escapeHtml(m.telefon || '')}</td>
              <td>${escapeHtml(m.email || '')}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(mitarbeiter.find((m) => m.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        mitarbeiter = mitarbeiter.filter((m) => !ids.includes(m.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export').addEventListener('click', () => {
    const rows = [MA_HEADER, ...mitarbeiter.map((m) => MA_FELDER.map((f) => m[f] ?? ''))];
    downloadTextFile(`neuverdrahtet-mitarbeiter-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast('Export erstellt', 'success');
  });
  container.querySelector('#btn-import').addEventListener('click', () => openImport());
  container.querySelector('#btn-lohnvorbereitung').addEventListener('click', () => openLohnvorbereitung());

  // Lohnvorbereitung: KEINE echte Lohnabrechnung (keine Steuer-/SV-Berechnung,
  // keine Meldungen an Finanzamt/Krankenkassen) - stellt nur die für einen
  // Monat benötigten Stammdaten + Ist-Stunden (aus Zeiterfassung) + Urlaubs-/
  // Krankheitstage (aus dem Kalender) zusammen, damit sie an Steuerberater/
  // Lohnbüro/externen Abrechnungsdienst übergeben werden können.
  function tageImMonat(termin, typ, monatStart, monatEnde) {
    if (termin.typ !== typ) return 0;
    const start = (termin.start || '').slice(0, 10);
    const ende = (termin.ende || '').slice(0, 10) || start;
    const von = start < monatStart ? monatStart : start;
    const bis = ende > monatEnde ? monatEnde : ende;
    if (von > bis) return 0;
    return Math.round((new Date(bis) - new Date(von)) / 86400000) + 1;
  }
  function openLohnvorbereitung() {
    const heute = new Date();
    const { body, close } = openModal({
      title: 'Lohnvorbereitung',
      wide: true,
      bodyHtml: `
        <div class="card" style="background:#fff6e0;border-color:#f0d78c;margin-bottom:10px">
          <p class="mb-0">⚠️ <strong>Keine echte Lohnabrechnung.</strong> Es werden keine Steuer-/Sozialversicherungsbeträge berechnet und keine Meldungen an Finanzamt/Krankenkassen übermittelt. Diese Übersicht stellt nur die vorhandenen Stammdaten und die Ist-Stunden/Abwesenheiten des Monats für die Übergabe an Steuerberater, Lohnbüro oder einen externen Abrechnungsdienst zusammen.</p>
        </div>
        <div class="flex-row" style="gap:10px;margin-bottom:10px">
          <select id="lv-monat">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === heute.getMonth() + 1 ? 'selected' : ''}>${['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][i]}</option>`).join('')}</select>
          <select id="lv-jahr">${[heute.getFullYear(), heute.getFullYear() - 1].map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
        </div>
        <div id="lv-host"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Schließen</button>
          <button type="button" class="btn btn-primary" id="btn-lv-export">⇩ Als CSV exportieren</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);

    function berechneZeilen() {
      const monat = Number(body.querySelector('#lv-monat').value);
      const jahr = Number(body.querySelector('#lv-jahr').value);
      const monatStart = `${jahr}-${String(monat).padStart(2, '0')}-01`;
      const letzterTag = new Date(jahr, monat, 0).getDate();
      const monatEnde = `${jahr}-${String(monat).padStart(2, '0')}-${String(letzterTag).padStart(2, '0')}`;
      const aktive = mitarbeiter.filter((m) => (!m.austrittsdatum || m.austrittsdatum >= monatStart) && (!m.eintrittsdatum || m.eintrittsdatum <= monatEnde));
      return aktive.map((m) => {
        const istMinuten = zeiterfassung.filter((e) => e.mitarbeiterId === m.id && e.datum >= monatStart && e.datum <= monatEnde).reduce((s, e) => s + (Number(e.dauerMinuten) || 0), 0);
        const urlaubstage = termine.filter((t) => t.mitarbeiterIds?.includes(m.id)).reduce((s, t) => s + tageImMonat(t, 'urlaub', monatStart, monatEnde), 0);
        const krankheitstage = termine.filter((t) => t.mitarbeiterIds?.includes(m.id)).reduce((s, t) => s + tageImMonat(t, 'krank', monatStart, monatEnde), 0);
        const fehlend = [
          !m.steuerId && 'Steuer-ID', !m.sozialversicherungsnummer && 'SV-Nummer', !m.steuerklasse && 'Steuerklasse',
          !m.krankenkasse && 'Krankenkasse', !m.iban && 'IBAN',
        ].filter(Boolean);
        return { m, istStunden: Math.round((istMinuten / 60) * 100) / 100, urlaubstage, krankheitstage, fehlend, monatStart, monatEnde };
      });
    }

    function renderLvTable() {
      const zeilen = berechneZeilen();
      body.querySelector('#lv-host').innerHTML = zeilen.length === 0 ? '<p class="text-mute">Keine im Zeitraum beschäftigten Mitarbeiter gefunden.</p>' : `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Beschäftigungsart</th><th class="text-right">Ist-Std.</th><th class="text-right">Urlaub (Tage)</th><th class="text-right">Krank (Tage)</th><th>Fehlende Angaben</th></tr></thead>
          <tbody>
            ${zeilen.map(({ m, istStunden, urlaubstage, krankheitstage, fehlend }) => `
              <tr>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(m.vertragsart || '')}</td>
                <td class="text-right">${istStunden}</td>
                <td class="text-right">${urlaubstage}</td>
                <td class="text-right">${krankheitstage}</td>
                <td>${fehlend.length ? `<span class="badge badge-warn">${fehlend.join(', ')}</span>` : '<span class="badge badge-success">vollständig</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    body.querySelector('#lv-monat').addEventListener('change', renderLvTable);
    body.querySelector('#lv-jahr').addEventListener('change', renderLvTable);
    body.querySelector('#btn-lv-export').addEventListener('click', () => {
      const zeilen = berechneZeilen();
      const header = ['Personalnummer', 'Name', 'Geburtsdatum', 'Straße', 'PLZ', 'Ort', 'Steuer-ID', 'SV-Nummer', 'Steuerklasse', 'Kinderfreibeträge', 'Konfession', 'Krankenversicherung', 'Krankenkasse', 'IBAN', 'Beschäftigungsart', 'Wochenstunden', 'Stundenlohn', 'Gehalt monatlich', 'Eintrittsdatum', 'Ist-Stunden Monat', 'Urlaubstage Monat', 'Krankheitstage Monat', 'Fehlende Angaben'];
      const rows = [header, ...zeilen.map(({ m, istStunden, urlaubstage, krankheitstage, fehlend }) => [
        m.personalnummer || '', m.name || '', m.geburtsdatum || '', m.strasse || '', m.plz || '', m.ort || '',
        m.steuerId || '', m.sozialversicherungsnummer || '', m.steuerklasse || '', m.kinderfreibetraege ?? 0,
        m.konfession || '', m.kvArt === 'privat' ? 'Privat' : 'Gesetzlich', m.krankenkasse || '', m.iban || '',
        m.vertragsart || '', m.wochenstunden ?? '', m.stundenlohn ?? '', m.gehaltMonatlich ?? '', m.eintrittsdatum || '',
        istStunden, urlaubstage, krankheitstage, fehlend.join('; '),
      ])];
      const { monatStart } = zeilen[0] || { monatStart: `${body.querySelector('#lv-jahr').value}-${String(body.querySelector('#lv-monat').value).padStart(2, '0')}` };
      downloadTextFile(`Lohnvorbereitung-${monatStart.slice(0, 7)}.csv`, toCsv(rows));
      toast('Export erstellt', 'success');
    });
    renderLvTable();
  }

  function openImport() {
    const { body, close } = openModal({
      title: 'Mitarbeiter importieren',
      wide: true,
      bodyHtml: `
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>${MA_HEADER.join(';')}</code> – nur Name ist Pflicht. Eine optionale Kopfzeile wird erkannt.</p>
        <div class="field" style="margin-bottom:10px">
          <label>CSV- oder Excel-Datei</label>
          <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </div>
        <div class="field">
          <label>oder CSV-Text einfügen</label>
          <textarea id="import-text" style="min-height:160px;font-family:monospace"></textarea>
        </div>
        <div class="field field-checkbox" style="margin-top:8px">
          <input type="checkbox" id="import-replace">
          <label for="import-replace">Bestehende Mitarbeiter vor dem Import löschen (vollständig ersetzen)</label>
        </div>
        <p class="hint" id="import-replace-warning" hidden>⚠️ Löscht unwiderruflich alle bisherigen Mitarbeiter. Bereits verknüpfte Projekte/Zeiterfassung bleiben erhalten, verweisen aber danach ggf. ins Leere.</p>
        <div id="import-preview" class="text-mute" style="margin-top:8px"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="btn-do-import">Importieren</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#import-replace').addEventListener('change', (e) => {
      body.querySelector('#import-replace-warning').hidden = !e.target.checked;
    });
    body.querySelector('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const isExcel = /\.xlsx?$/i.test(file.name);
      try {
        body.querySelector('#import-text').value = isExcel ? await excelFileToCsvText(file) : await readTextAutoEncoding(file);
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
    body.querySelector('#btn-do-import').addEventListener('click', async () => {
      const text = body.querySelector('#import-text').value;
      const { rows, errors } = parseMitarbeiterCsv(text);
      if (rows.length === 0) {
        body.querySelector('#import-preview').textContent = 'Keine gültigen Zeilen gefunden.';
        return;
      }
      if (body.querySelector('#import-replace').checked) {
        if (!confirmDelete(`Wirklich ALLE ${mitarbeiter.length} bestehenden Mitarbeiter löschen und durch ${rows.length} neue ersetzen?`)) return;
        await clearStore('mitarbeiter');
      }
      for (const row of rows) await put('mitarbeiter', row);
      toast(`${rows.length} Mitarbeiter importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen` : ''}`, 'success');
      close();
      render(container);
    });
  }

  function openAbwesenheitForm(mitarbeiterId, closeParent) {
    if (closeParent) closeParent();
    const heute = new Date().toISOString().slice(0, 10);
    const { body, close } = openModal({
      title: 'Abwesenheit eintragen',
      bodyHtml: `
        <form id="abw-form">
          <div class="form-grid">
            <div class="field"><label>Art *</label>
              <select name="typ" required>
                ${ABWESENHEIT_TYPEN.map((t) => {
                  const info = TERMIN_TYPEN.find((tt) => tt.id === t);
                  return `<option value="${t}">${escapeHtml(info?.titel || t)}</option>`;
                }).join('')}
              </select>
            </div>
            <div class="field"><label>Von *</label><input type="date" name="von" required value="${heute}"></div>
            <div class="field"><label>Bis</label><input type="date" name="bis" value="${heute}"></div>
            <div class="field col-span-2"><label>Notiz (optional)</label><input name="notiz" placeholder="z.B. Grund, Vertretung, ..."></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Eintragen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#abw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const typ = (fd.get('typ') || 'urlaub').toString();
      const von = (fd.get('von') || heute).toString();
      const bis = (fd.get('bis') || von).toString();
      const notiz = (fd.get('notiz') || '').toString().trim();
      const info = TERMIN_TYPEN.find((tt) => tt.id === typ);
      const neu = {
        id: uid(), titel: notiz || info?.titel || typ, typ,
        start: `${von}T00:00`, ende: bis < von ? von : bis,
        mitarbeiterIds: [mitarbeiterId], geraeteIds: [], flottenIds: [],
        kundeId: '', projektId: '', ort: '', notizen: '', farbe: '',
      };
      await put('termine', neu);
      termine.push(neu);
      toast(`${info?.titel || 'Eintrag'} gespeichert`, 'success');
      close();
      openForm(mitarbeiter.find((mm) => mm.id === mitarbeiterId));
    });
  }

  function openForm(m) {
    const isEdit = !!m;
    const neueId = uid();
    const data = m || {
      id: neueId, name: '', rolle: '', telefon: '', email: '', farbe: farbeAusText(neueId, FARBEN),
      personalnummer: '', geburtsdatum: '', strasse: '', plz: '', ort: '',
      eintrittsdatum: '', austrittsdatum: '', vertragsart: 'Vollzeit', wochenstunden: 40,
      stundenlohn: '', gehaltMonatlich: '', urlaubsanspruchTage: 30,
      iban: '', steuerId: '', sozialversicherungsnummer: '', krankenkasse: '',
      steuerklasse: '', kinderfreibetraege: 0, konfession: '', kvArt: 'gesetzlich',
      notfallkontaktName: '', notfallkontaktTelefon: '', notizen: '',
      zugangscode: '', zugriffsrolle: 'mitarbeiter', markeIds: [],
    };
    const urlaubGenommen = isEdit ? currentYearCount(termine, data.id, 'urlaub') : 0;
    const krankTage = isEdit ? currentYearCount(termine, data.id, 'krank') : 0;
    const schulungTage = isEdit ? currentYearCount(termine, data.id, 'schulung') : 0;
    const urlaubRest = (Number(data.urlaubsanspruchTage) || 0) - urlaubGenommen;
    const aktuellerStatus = isEdit ? currentStatusFor(termine, data.id) : null;
    const statusVerlauf = isEdit
      ? termine.filter((t) => t.mitarbeiterIds?.includes(data.id) && STATUS_TYPEN.includes(t.typ))
          .sort((a, b) => (b.start || '').localeCompare(a.start || '')).slice(0, 8)
      : [];

    const { body, close } = openModal({
      title: isEdit ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter',
      wide: true,
      bodyHtml: `
        <form id="ma-form">
          <h2 style="font-size:14px;margin:0 0 8px">Stammdaten</h2>
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
            <div class="field"><label>Personalnummer</label><input name="personalnummer" value="${escapeHtml(data.personalnummer || '')}"></div>
            <div class="field"><label>Rolle</label><input name="rolle" placeholder="z.B. Elektriker" value="${escapeHtml(data.rolle || '')}"></div>
            <div class="field"><label>Geburtsdatum</label><input type="date" name="geburtsdatum" value="${data.geburtsdatum || ''}"></div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field"><label>Straße & Hausnr.</label><input name="strasse" value="${escapeHtml(data.strasse || '')}"></div>
            <div class="field"><label>PLZ</label><input name="plz" value="${escapeHtml(data.plz || '')}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
          </div>

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Vertrag & Gehalt</h2>
          <div class="form-grid">
            <div class="field"><label>Vertragsart</label>
              <select name="vertragsart">${VERTRAGSARTEN.map((v) => `<option value="${v}" ${v === data.vertragsart ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Wochenstunden</label><input type="number" step="0.5" min="0" name="wochenstunden" value="${data.wochenstunden ?? ''}"></div>
            <div class="field"><label>Eintrittsdatum</label><input type="date" name="eintrittsdatum" value="${data.eintrittsdatum || ''}"></div>
            <div class="field"><label>Austrittsdatum</label><input type="date" name="austrittsdatum" value="${data.austrittsdatum || ''}"></div>
            <div class="field"><label>Stundenlohn (€, brutto)</label><input type="number" step="0.01" min="0" name="stundenlohn" value="${data.stundenlohn ?? ''}"></div>
            <div class="field"><label>Gehalt monatlich (€, brutto)</label><input type="number" step="0.01" min="0" name="gehaltMonatlich" value="${data.gehaltMonatlich ?? ''}"></div>
            <div class="field"><label>IBAN</label><input name="iban" value="${escapeHtml(data.iban || '')}"></div>
            <div class="field"><label>Steuer-ID</label><input name="steuerId" value="${escapeHtml(data.steuerId || '')}"></div>
            <div class="field"><label>Sozialversicherungsnr.</label><input name="sozialversicherungsnummer" value="${escapeHtml(data.sozialversicherungsnummer || '')}"></div>
            <div class="field"><label>Krankenkasse</label><input name="krankenkasse" value="${escapeHtml(data.krankenkasse || '')}"></div>
          </div>

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Für Lohnabrechnung (Übergabe an Steuerberater/Lohnbüro)</h2>
          <div class="form-grid">
            <div class="field"><label>Steuerklasse</label>
              <select name="steuerklasse"><option value="">– unbekannt –</option>${STEUERKLASSEN.map((s) => `<option value="${s}" ${s === data.steuerklasse ? 'selected' : ''}>${s}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kinderfreibeträge</label><input type="number" step="0.5" min="0" name="kinderfreibetraege" value="${data.kinderfreibetraege ?? 0}"></div>
            <div class="field"><label>Konfession (Kirchensteuer)</label>
              <select name="konfession">${KONFESSIONEN.map((k) => `<option value="${k.id}" ${k.id === (data.konfession || '') ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Krankenversicherung</label>
              <select name="kvArt">
                <option value="gesetzlich" ${data.kvArt !== 'privat' ? 'selected' : ''}>Gesetzlich</option>
                <option value="privat" ${data.kvArt === 'privat' ? 'selected' : ''}>Privat</option>
              </select>
            </div>
          </div>
          <p class="hint">Ersetzt keine echte Lohnabrechnung - dient nur zur vollständigen Übergabe der Stammdaten an Steuerberater/Lohnbüro/externen Abrechnungsdienst (siehe Mitarbeiter → "⇩ Lohnvorbereitung exportieren").</p>

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Urlaub & Krankheit</h2>
          <div class="form-grid">
            <div class="field"><label>Urlaubsanspruch (Tage/Jahr)</label><input type="number" min="0" name="urlaubsanspruchTage" value="${data.urlaubsanspruchTage ?? ''}"></div>
            ${isEdit ? `
              <div class="field"><label>Urlaub genommen (${new Date().getFullYear()})</label><input disabled value="${urlaubGenommen} Tage · Rest: ${urlaubRest}"></div>
              <div class="field"><label>Krankheitstage (${new Date().getFullYear()})</label><input disabled value="${krankTage} Tage"></div>
              <div class="field"><label>Schulungstage (${new Date().getFullYear()})</label><input disabled value="${schulungTage} Tage"></div>
            ` : '<p class="text-mute col-span-2">Urlaub/Krank/Schulung werden nach dem Anlegen aus der Plantafel berechnet.</p>'}
          </div>
          <p class="hint">Baustellen-Einsätze trägst du weiterhin über Kalender/Plantafel ein – sie werden hier automatisch gezählt.</p>
          ${isEdit ? `
            <div class="flex-row" style="margin:8px 0;align-items:center">
              <strong>Status heute:</strong>
              ${aktuellerStatus ? `<span class="badge" style="background:${escapeHtml(aktuellerStatus.farbe)}22;color:${escapeHtml(aktuellerStatus.farbe)}">${escapeHtml(aktuellerStatus.titel)}</span>` : '<span class="badge badge-success">Verfügbar</span>'}
              <span class="spacer"></span>
              <button type="button" class="btn btn-sm" id="btn-abwesenheit">+ Krank/Urlaub eintragen</button>
              <a class="btn btn-sm" id="link-zeituebersicht" href="#/zeiterfassung/${data.id}">📊 Zeitübersicht</a>
            </div>
            <h2 style="font-size:13px;margin:10px 0 6px">Letzte Einträge</h2>
            ${statusVerlauf.length ? `<ul class="cal-event-list">${statusVerlauf.map((t) => {
              const info = TERMIN_TYPEN.find((tt) => tt.id === t.typ);
              return `<li>
                <div>
                  <strong>${escapeHtml(info?.titel || t.typ)}</strong>
                  <div class="text-mute">${formatDate(t.start)}${t.ende && t.ende !== t.start ? ' – ' + formatDate(t.ende) : ''}${t.titel ? ' · ' + escapeHtml(t.titel) : ''}</div>
                </div>
                <span class="color-dot" style="background:${escapeHtml(info?.farbe || 'var(--border)')}"></span>
              </li>`;
            }).join('')}</ul>` : '<p class="text-mute">Noch keine Einträge (Urlaub/Krank/Schulung/Baustelle).</p>'}
          ` : ''}

          ${marken.length > 0 ? `
            <div class="divider"></div>
            <h2 style="font-size:14px;margin:0 0 8px">Marken-Freigabe</h2>
            <div class="tag-list">
              ${marken.map((mk) => `
                <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                  <input type="checkbox" name="markeIds" value="${mk.id}" ${data.markeIds?.includes(mk.id) ? 'checked' : ''}> ${escapeHtml(mk.name)}
                </label>
              `).join('')}
            </div>
            <p class="hint">Nichts ausgewählt = für alle Marken einsetzbar. Sonst bei Projekten/Terminen der anderen Marke(n) nicht mehr zur Auswahl auswählbar.</p>
          ` : ''}

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Zugang zur Verwaltung</h2>
          <div class="form-grid">
            ${FIREBASE_ENABLED ? '' : `<div class="field"><label>Eigener Zugangscode (optional)</label><input name="zugangscode" placeholder="leer = kein eigener Login" value="${escapeHtml(data.zugangscode || '')}"></div>`}
            <div class="field"><label>Zugriffsrolle</label>
              <select name="zugriffsrolle">${ZUGRIFFSROLLEN.map((r) => `<option value="${r.id}" ${r.id === (data.zugriffsrolle || 'mitarbeiter') ? 'selected' : ''}>${escapeHtml(r.titel)}</option>`).join('')}</select>
            </div>
            <p class="hint col-span-2">${escapeHtml(ZUGRIFFSROLLEN.find((r) => r.id === (data.zugriffsrolle || 'mitarbeiter'))?.beschreibung || '')}${FIREBASE_ENABLED ? '' : ' Wichtig: Diese App läuft rein lokal im Browser – der Code ist eine einfache Bedienungssperre, kein vollwertiger Server-Login.'}</p>
          </div>
          ${FIREBASE_ENABLED && isEdit ? '<div id="auth-status-host">Lädt Login-Status …</div>' : ''}
          ${FIREBASE_ENABLED && !isEdit ? '<p class="hint">Zugang per E-Mail-Login kannst du einrichten, sobald der Mitarbeiter gespeichert ist.</p>' : ''}

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Notfallkontakt</h2>
          <div class="form-grid">
            <div class="field"><label>Name</label><input name="notfallkontaktName" value="${escapeHtml(data.notfallkontaktName || '')}"></div>
            <div class="field"><label>Telefon</label><input name="notfallkontaktTelefon" value="${escapeHtml(data.notfallkontaktTelefon || '')}"></div>
          </div>

          <div class="divider"></div>
          <div class="form-grid">
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>

          ${isEdit ? `<div class="divider"></div><div id="dok-host"></div>` : ''}

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
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Mitarbeiter "${data.name}" in den Papierkorb verschieben?`)) return;
        await remove('mitarbeiter', data.id);
        toast('Mitarbeiter in den Papierkorb verschoben');
        close();
        render(container);
      });
      renderDokumenteSection(body.querySelector('#dok-host'), 'mitarbeiter', data.id, {
        kategorien: MA_DOKUMENT_KATEGORIEN, title: 'Dokumente (Vertrag, Ausweis, ...)',
        berichtContext: { settings, kunde: null, projekt: '', mitarbeiter: data.name },
      });
      body.querySelector('#btn-abwesenheit').addEventListener('click', () => openAbwesenheitForm(data.id, close));
      body.querySelector('#link-zeituebersicht').addEventListener('click', () => close());
      if (FIREBASE_ENABLED) renderAuthStatus(body, data);
    }
    body.querySelector('#ma-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      updated.kinderfreibetraege = Number(updated.kinderfreibetraege) || 0;
      updated.markeIds = fd.getAll('markeIds');
      if (!updated.name) return;
      await put('mitarbeiter', updated);
      toast(isEdit ? 'Mitarbeiter aktualisiert' : 'Mitarbeiter angelegt', 'success');
      close();
      render(container);
    });
  }

  async function renderAuthStatus(body, data) {
    const host = body.querySelector('#auth-status-host');
    if (!host) return;
    const status = await getEmployeeAuthStatus(data.id);

    function draw() {
      if (status.status === 'registered') {
        host.innerHTML = `
          <p class="hint">✅ Registriert mit <strong>${escapeHtml(status.email)}</strong> – kann sich anmelden.</p>
          <button type="button" class="btn btn-sm btn-danger" id="btn-revoke-access">Zugriff entziehen</button>
        `;
        host.querySelector('#btn-revoke-access').addEventListener('click', async () => {
          if (!confirmDelete('Zugriff wirklich entziehen? Der Mitarbeiter kann sich danach nicht mehr anmelden (das Firebase-Konto selbst bleibt bestehen, kann aber nichts mehr sehen).')) return;
          await revokeUserAccess(status.uid);
          toast('Zugriff entzogen', 'success');
          status.status = 'none';
          draw();
        });
      } else if (status.status === 'invited') {
        host.innerHTML = `
          <p class="hint">📧 Eingeladen mit <strong>${escapeHtml(status.email)}</strong> – wartet auf Registrierung durch den Mitarbeiter.</p>
          <button type="button" class="btn btn-sm" id="btn-revoke-invite">Einladung zurückziehen</button>
        `;
        host.querySelector('#btn-revoke-invite').addEventListener('click', async () => {
          await revokeInvite(status.email);
          toast('Einladung zurückgezogen', 'success');
          status.status = 'none';
          draw();
        });
      } else {
        host.innerHTML = `
          <div class="field"><label>E-Mail für Login-Einladung</label><input type="email" id="invite-email" placeholder="mitarbeiter@beispiel.de" value="${escapeHtml(data.email || '')}"></div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-invite">Zum Login einladen</button>
          <p class="hint">Der Mitarbeiter bekommt keine automatische E-Mail – bitte die Adresse selbst mitteilen. Registrierung erfolgt im Login-Bildschirm über "Als eingeladener Mitarbeiter registrieren".</p>
        `;
        host.querySelector('#btn-invite').addEventListener('click', async () => {
          const email = host.querySelector('#invite-email').value.trim();
          if (!email) return;
          const roleSelect = body.querySelector('select[name="zugriffsrolle"]');
          await inviteEmployee({ email, role: roleSelect.value, mitarbeiterId: data.id, name: data.name });
          toast('Einladung erstellt', 'success');
          status.status = 'invited';
          status.email = email;
          draw();
        });
      }
    }
    draw();
  }

  renderTable();
}
