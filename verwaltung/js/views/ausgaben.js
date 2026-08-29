import { getAll, put, remove, getSettings, KALK_KATEGORIEN, USTSAETZE } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, compressImage, toast, toCsv, downloadTextFile } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openBelegImport, guessAusgabenKategorie } from '../belegimport.js';
import { buildZipBlob } from '../zipwriter.js';
import { downloadBlob } from '../docexport.js';
import { createBulkSelect } from '../bulkselect.js';
import { analyzeBeleg } from '../ai.js';
import { FIREBASE_ENABLED, uploadBlobToStorage } from '../blobstore.js';
import * as journal from '../journal.js';

export const KATEGORIEN = ['Material', 'Werkzeug/Maschinen', 'Fahrzeug/Sprit', 'Miete', 'Versicherung', 'Büro/Verwaltung', 'Werbung/Marketing', 'Personal', 'Sonstiges'];
const KALK_KATEGORIEN_AUSGABEN = KALK_KATEGORIEN.filter((k) => k.id !== 'lohn');
const KATEGORIE_BADGE_CLASS = {
  'Material': 'badge-kat-material',
  'Werkzeug/Maschinen': 'badge-kat-werkzeug',
  'Fahrzeug/Sprit': 'badge-kat-fahrzeug',
  'Miete': 'badge-kat-miete',
  'Versicherung': 'badge-kat-versicherung',
  'Büro/Verwaltung': 'badge-kat-buero',
  'Werbung/Marketing': 'badge-kat-werbung',
  'Personal': 'badge-kat-personal',
  'Sonstiges': 'badge-kat-sonstiges',
};

function openBelegAnsicht(beleg) {
  if (beleg?.url) {
    window.open(beleg.url, '_blank', 'noopener');
  } else if (beleg instanceof Blob) {
    const url = URL.createObjectURL(beleg);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

export async function render(container) {
  let [ausgaben, settings, projekte, kunden] = await Promise.all([getAll('ausgaben'), getSettings(), getAll('projekte'), getAll('kunden')]);
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  ausgaben.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  let filtered = ausgaben;
  const jahrOptionen = Array.from(new Set(ausgaben.map((a) => (a.datum || '').slice(0, 4)).filter(Boolean))).sort().reverse();
  const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function imQuartal(datum, q) {
    if (!q) return true;
    const monat = Number((datum || '').slice(5, 7));
    return monat >= (Number(q) - 1) * 3 + 1 && monat <= Number(q) * 3;
  }
  const bulk = createBulkSelect('ausgaben', {
    label: 'Ausgaben',
    deleteFn: async (id) => {
      await remove('ausgaben', id);
      try { await journal.entferneBuchungFuerAusgabe(id); } catch { /* Verbuchung ist ein Komfort-Feature */ }
    },
  });

  const heute = todayISO();

  container.innerHTML = `
    <div class="view-header">
      <h1>Ausgaben</h1>
      <div class="actions">
        <button class="btn" id="btn-beleg-import">⇪ Belege importieren (ZIP)</button>
        <button class="btn" id="btn-beleg-scan">📷 Beleg scannen</button>
        <input type="file" id="beleg-scan-input" accept="image/*" capture="environment" hidden>
        <button class="btn" id="btn-export">⇩ Export (CSV)</button>
        <button class="btn" id="btn-export-belege">⇩ Belege exportieren (ZIP)</button>
        <button class="btn" id="btn-ausgaben-pruefen">🔍 Ausgaben prüfen</button>
        <button class="btn btn-primary" id="btn-new">+ Ausgabe erfassen</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value" id="kpi-periode-wert">–</div>
        <div class="kpi-label" id="kpi-periode-label">–</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" id="kpi-jahr-wert">–</div>
        <div class="kpi-label" id="kpi-jahr-label">–</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" id="kpi-gesamt-wert">–</div>
        <div class="kpi-label">Gesamt · ${ausgaben.length} Ausgabe(n)</div>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Beschreibung/Lieferant ...">
      <select id="filter-kategorie"><option value="">Alle Kategorien</option>${KATEGORIEN.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
      <select id="filter-kunde"><option value="">Alle Kunden</option>${kunden.map((k) => `<option value="${k.id}">${escapeHtml(k.firma)}</option>`).join('')}</select>
      <select id="filter-jahr"><option value="">Alle Jahre</option>${jahrOptionen.map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
      <select id="filter-quartal">
        <option value="">Ganzes Jahr</option>
        <option value="1">1. Quartal</option>
        <option value="2">2. Quartal</option>
        <option value="3">3. Quartal</option>
        <option value="4">4. Quartal</option>
      </select>
      <select id="filter-monat">
        <option value="">Alle Monate</option>
        ${MONATSNAMEN.map((name, i) => `<option value="${String(i + 1).padStart(2, '0')}">${name}</option>`).join('')}
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const kategorie = container.querySelector('#filter-kategorie').value;
    const kundeId = container.querySelector('#filter-kunde').value;
    const jahrFilter = container.querySelector('#filter-jahr').value;
    const quartalFilter = container.querySelector('#filter-quartal').value;
    const monatFilter = container.querySelector('#filter-monat').value;
    filtered = ausgaben.filter((a) => {
      if (kategorie && a.kategorie !== kategorie) return false;
      if (kundeId && a.kundeId !== kundeId) return false;
      if (jahrFilter && (a.datum || '').slice(0, 4) !== jahrFilter) return false;
      if (monatFilter && (a.datum || '').slice(5, 7) !== monatFilter) return false;
      if (!monatFilter && quartalFilter && !imQuartal(a.datum, quartalFilter)) return false;
      if (!q) return true;
      return [a.beschreibung, a.lieferant, kundenById[a.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    updateKpis(jahrFilter, quartalFilter, monatFilter);
    renderTable();
  }

  // Die drei Kennzahlen-Kacheln oben folgen der Jahr-/Quartal-/Monat-Auswahl
  // statt immer nur den aktuellen Kalendermonat zu zeigen - so stimmen die
  // Zahlen auch, wenn z.B. "2025" und "Januar" oder "2. Quartal" gewählt ist.
  function updateKpis(jahrFilter, quartalFilter, monatFilter) {
    const aktJahr = jahrFilter || heute.slice(0, 4);
    let periodeLabel, periodeSumme;
    if (monatFilter) {
      periodeLabel = `${MONATSNAMEN[Number(monatFilter) - 1]} ${aktJahr}`;
      periodeSumme = ausgaben.filter((a) => (a.datum || '').slice(0, 4) === aktJahr && (a.datum || '').slice(5, 7) === monatFilter).reduce((s, a) => s + (a.betragBrutto || 0), 0);
    } else if (quartalFilter) {
      periodeLabel = `${quartalFilter}. Quartal ${aktJahr}`;
      periodeSumme = ausgaben.filter((a) => (a.datum || '').slice(0, 4) === aktJahr && imQuartal(a.datum, quartalFilter)).reduce((s, a) => s + (a.betragBrutto || 0), 0);
    } else if (jahrFilter) {
      periodeLabel = `Jahr ${aktJahr}`;
      periodeSumme = ausgaben.filter((a) => (a.datum || '').slice(0, 4) === aktJahr).reduce((s, a) => s + (a.betragBrutto || 0), 0);
    } else {
      periodeLabel = 'Diesen Monat';
      periodeSumme = ausgaben.filter((a) => (a.datum || '').startsWith(heute.slice(0, 7))).reduce((s, a) => s + (a.betragBrutto || 0), 0);
    }
    const jahrSumme = ausgaben.filter((a) => (a.datum || '').slice(0, 4) === aktJahr).reduce((s, a) => s + (a.betragBrutto || 0), 0);
    const gesamtSumme = ausgaben.reduce((s, a) => s + (a.betragBrutto || 0), 0);
    container.querySelector('#kpi-periode-wert').textContent = formatCurrency(periodeSumme);
    container.querySelector('#kpi-periode-label').textContent = periodeLabel;
    container.querySelector('#kpi-jahr-wert').textContent = formatCurrency(jahrSumme);
    container.querySelector('#kpi-jahr-label').textContent = `Jahr ${aktJahr} gesamt`;
    container.querySelector('#kpi-gesamt-wert').textContent = formatCurrency(gesamtSumme);
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Ausgaben erfasst.</div>`;
      return;
    }
    const summe = filtered.reduce((s, a) => s + (a.betragBrutto || 0), 0);
    tableHost.innerHTML = `
      <p class="hint">Summe: ${formatCurrency(summe)}</p>
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th>Kunde</th><th>Projekt</th><th class="text-right">Betrag (brutto)</th><th></th></tr></thead>
        <tbody>
          ${filtered.map((a) => `
            <tr data-id="${a.id}">
              ${bulk.rowCell(a.id)}
              <td>${formatDate(a.datum)}</td>
              <td><span class="badge ${KATEGORIE_BADGE_CLASS[a.kategorie] || ''}">${escapeHtml(a.kategorie)}</span></td>
              <td>${escapeHtml(a.beschreibung || '')}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || '')}</td>
              <td>${escapeHtml(projekteById[a.projektId]?.titel || '')}</td>
              <td class="text-right">${formatCurrency(a.betragBrutto)}</td>
              <td>${a.beleg ? '📎' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(ausgaben.find((a) => a.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        ausgaben = ausgaben.filter((a) => !ids.includes(a.id));
        filtered = filtered.filter((a) => !ids.includes(a.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#filter-kategorie').addEventListener('change', applyFilter);
  container.querySelector('#filter-kunde').addEventListener('change', applyFilter);
  container.querySelector('#filter-jahr').addEventListener('change', applyFilter);
  container.querySelector('#filter-quartal').addEventListener('change', (e) => {
    if (e.target.value) container.querySelector('#filter-monat').value = '';
    applyFilter();
  });
  container.querySelector('#filter-monat').addEventListener('change', (e) => {
    if (e.target.value) container.querySelector('#filter-quartal').value = '';
    applyFilter();
  });
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export').addEventListener('click', () => {
    const header = ['Datum', 'Kategorie', 'Beschreibung', 'Lieferant', 'Betrag netto', 'USt.-Satz', 'Betrag brutto', 'Bezahlt mit'];
    const rows = [header, ...filtered.map((a) => [
      a.datum || '', a.kategorie || '', a.beschreibung || '', a.lieferant || '',
      a.betragNetto ?? '', a.steuersatz ?? '', a.betragBrutto ?? '', a.bezahltMit || '',
    ])];
    downloadTextFile(`neuverdrahtet-ausgaben-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast('Export erstellt', 'success');
  });
  container.querySelector('#btn-export-belege').addEventListener('click', async () => {
    const mitBeleg = filtered.filter((a) => a.beleg);
    if (mitBeleg.length === 0) { toast('Keine Ausgabe mit angehängtem Beleg in der aktuellen Auswahl', 'info'); return; }
    const exportBtn = container.querySelector('#btn-export-belege');
    exportBtn.disabled = true;
    try {
      const usedNames = new Set();
      const files = [];
      for (let i = 0; i < mitBeleg.length; i++) {
        const a = mitBeleg[i];
        exportBtn.textContent = `Lade Belege ... (${i + 1}/${mitBeleg.length})`;
        let blob;
        if (a.beleg instanceof Blob) {
          blob = a.beleg;
        } else if (a.beleg?.url) {
          try {
            blob = await (await fetch(a.beleg.url)).blob();
          } catch {
            continue; // einzelner Beleg nicht abrufbar (z.B. noch nicht hochgeladen) - überspringen statt Export abzubrechen
          }
        } else {
          continue;
        }
        const mime = blob.type || a.beleg?.mime || '';
        const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : /^image\//.test(mime) ? 'jpg' : 'bin';
        const lieferant = (a.lieferant || a.kategorie || 'Beleg').replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().replace(/\s+/g, '-');
        let name = `${a.datum || 'ohne-datum'}_${lieferant}_${(a.betragBrutto || 0).toFixed(2).replace('.', ',')}EUR.${ext}`;
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.');
          name = `${name.slice(0, dot)}-${i + 1}${name.slice(dot)}`;
        }
        usedNames.add(name);
        files.push({ name, blob });
      }
      if (files.length === 0) { toast('Keine Belegdateien abrufbar', 'danger'); return; }
      downloadBlob(await buildZipBlob(files), `neuverdrahtet-belege-${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`${files.length} Beleg(e) exportiert`, 'success');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = '⇩ Belege exportieren (ZIP)';
    }
  });
  container.querySelector('#btn-beleg-import').addEventListener('click', () => {
    openBelegImport({ onImported: () => render(container) });
  });
  container.querySelector('#btn-ausgaben-pruefen').addEventListener('click', () => openAusgabenPruefung());

  // "Ausgaben prüfen": findet mögliche Duplikate (gleiches Datum/Betrag/
  // Lieferant - z.B. wenn dieselbe ZIP-Datei versehentlich zweimal
  // importiert wurde), unvollständige Einträge (Betrag 0 - typisch für lose
  // importierte Belegfotos ohne erkennbaren Betrag) und Ausgaben, die noch
  // als "Sonstiges" laufen, obwohl Lieferant/Beschreibung inzwischen einer
  // konkreteren Kategorie zuordenbar wären (z.B. weil die Erkennung erst
  // später ergänzt wurde).
  function openAusgabenPruefung() {
    const dupKey = (a) => `${a.datum}|${Number(a.betragBrutto).toFixed(2)}|${(a.lieferant || '').trim().toLowerCase()}`;
    const dupGroups = Array.from(
      ausgaben.filter((a) => Number(a.betragBrutto) > 0).reduce((map, a) => {
        const key = dupKey(a);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);
        return map;
      }, new Map()).values()
    ).filter((g) => g.length > 1);

    const unvollstaendig = ausgaben.filter((a) => !Number(a.betragBrutto));
    const kategorieVerbesserbar = ausgaben
      .filter((a) => a.kategorie === 'Sonstiges')
      .map((a) => ({ a, vorschlag: guessAusgabenKategorie(`${a.lieferant || ''} ${a.beschreibung || ''}`) }))
      .filter(({ vorschlag }) => vorschlag !== 'Sonstiges');
    // Ohne Kunde/Projekt: kein Fehler an sich (allgemeine Kosten wie Miete/
    // Versicherung/Büromaterial brauchen keine Zuordnung) - hier trotzdem
    // auflisten, damit gezielt geprüft werden kann, ob einzelne davon
    // eigentlich einem Projekt zugeordnet gehören (z.B. für die
    // Nachkalkulation). Ohne Betrag bereits oben gelistet, daher hier
    // ausgeschlossen, um nicht doppelt zu erscheinen.
    const ohneZuordnung = ausgaben.filter((a) => Number(a.betragBrutto) > 0 && !a.kundeId && !a.projektId);
    const OHNE_ZUORDNUNG_LIMIT = 30;

    const { body, close } = openModal({
      title: 'Ausgaben prüfen',
      wide: true,
      bodyHtml: `
        <h2 style="font-size:14px;margin:0 0 8px">Mögliche Duplikate (${dupGroups.length} Gruppe${dupGroups.length === 1 ? '' : 'n'})</h2>
        ${dupGroups.length === 0 ? '<p class="text-mute">Keine Ausgaben mit identischem Datum/Betrag/Lieferant gefunden.</p>' : `
          <p class="hint">Gleiches Datum, gleicher Betrag, gleicher Lieferant – prüfe vor dem Löschen, ob es wirklich Duplikate sind (der erste Eintrag je Gruppe ist vorausgewählt zum Behalten).</p>
          ${dupGroups.map((g, gi) => `
            <div class="card" style="margin-bottom:8px;padding:10px">
              <strong>${formatDate(g[0].datum)} · ${formatCurrency(g[0].betragBrutto)} · ${escapeHtml(g[0].lieferant || '– kein Lieferant –')}</strong>
              <table class="data-table" style="margin-top:6px">
                <thead><tr><th></th><th>Kategorie</th><th>Beschreibung</th><th></th></tr></thead>
                <tbody>
                  ${g.map((a, ai) => `
                    <tr>
                      <td><input type="checkbox" class="ausg-dup-del" data-gi="${gi}" data-ai="${ai}" ${ai === 0 ? '' : 'checked'}></td>
                      <td>${escapeHtml(a.kategorie)}</td>
                      <td>${escapeHtml(a.beschreibung || '')}${ai === 0 ? ' <span class="text-mute">(bleibt erhalten)</span>' : ''}</td>
                      <td>${a.beleg ? `<button type="button" class="btn btn-sm ausg-beleg-ansehen" data-id="${a.id}" title="Beleg ansehen">📎</button>` : ''}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        `}
        <div class="divider"></div>
        <h2 style="font-size:14px;margin:0 0 8px">Kategorie "Sonstiges" könnte konkreter sein (${kategorieVerbesserbar.length})</h2>
        ${kategorieVerbesserbar.length === 0 ? '<p class="text-mute">Keine Verbesserungsvorschläge gefunden.</p>' : `
          <p class="hint">Anhand von Lieferant/Beschreibung erkennbar einer konkreteren Kategorie zuordenbar.</p>
          <ul class="cal-event-list">
            ${kategorieVerbesserbar.map(({ a, vorschlag }) => `<li><span>${formatDate(a.datum)} · ${escapeHtml(a.lieferant || a.beschreibung || '')}</span><span class="text-mute">Sonstiges → ${escapeHtml(vorschlag)}</span></li>`).join('')}
          </ul>
          <button type="button" class="btn btn-sm btn-primary" id="btn-fix-kategorie" style="margin-top:8px">Kategorie automatisch übernehmen (${kategorieVerbesserbar.length})</button>
        `}
        <div class="divider"></div>
        <h2 style="font-size:14px;margin:0 0 8px">Unvollständige Einträge ohne Betrag (${unvollstaendig.length})</h2>
        ${unvollstaendig.length === 0 ? '<p class="text-mute">Keine Ausgaben mit Betrag 0 gefunden.</p>' : `
          <p class="hint">Typisch für lose importierte Belegfotos, bei denen Betrag/Lieferant nicht automatisch erkannt werden konnten – bitte einzeln öffnen und ergänzen. Anklicken zum Bearbeiten.</p>
          <ul class="cal-event-list">
            ${unvollstaendig.map((a) => `<li class="ausg-unvollst-row" data-id="${a.id}" style="cursor:pointer"><span>${formatDate(a.datum)} · ${escapeHtml(a.beschreibung || a.lieferant || '(ohne Angaben)')}</span><span>${a.beleg ? `<button type="button" class="btn btn-sm ausg-beleg-ansehen" data-id="${a.id}" title="Beleg ansehen">📎</button>` : ''}</span></li>`).join('')}
          </ul>
        `}
        <div class="divider"></div>
        <h2 style="font-size:14px;margin:0 0 8px">Ohne Kunde/Projekt-Zuordnung (${ohneZuordnung.length})</h2>
        ${ohneZuordnung.length === 0 ? '<p class="text-mute">Alle Ausgaben mit Betrag sind einem Kunden/Projekt zugeordnet oder allgemeine Kosten.</p>' : `
          <p class="hint">Kein Fehler an sich – allgemeine Kosten (Miete, Versicherung, Büromaterial) brauchen keine Zuordnung. Zur gezielten Prüfung, ob einzelne davon eigentlich einem Projekt zugeordnet gehören (z.B. für die Nachkalkulation). Anklicken zum Zuordnen.${ohneZuordnung.length > OHNE_ZUORDNUNG_LIMIT ? ` Zeigt die ersten ${OHNE_ZUORDNUNG_LIMIT} von ${ohneZuordnung.length}.` : ''}</p>
          <ul class="cal-event-list">
            ${ohneZuordnung.slice(0, OHNE_ZUORDNUNG_LIMIT).map((a) => `<li class="ausg-unvollst-row" data-id="${a.id}" style="cursor:pointer"><span>${formatDate(a.datum)} · ${escapeHtml(a.kategorie)} · ${escapeHtml(a.lieferant || a.beschreibung || '')}</span><span>${formatCurrency(a.betragBrutto)} ${a.beleg ? `<button type="button" class="btn btn-sm ausg-beleg-ansehen" data-id="${a.id}" title="Beleg ansehen">📎</button>` : ''}</span></li>`).join('')}
          </ul>
        `}
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Schließen</button>
          ${dupGroups.length > 0 ? '<button type="button" class="btn btn-danger" id="btn-ausg-dup-delete">Ausgewählte Duplikate löschen</button>' : ''}
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#btn-fix-kategorie')?.addEventListener('click', async () => {
      for (const { a, vorschlag } of kategorieVerbesserbar) {
        const updated = { ...a, kategorie: vorschlag };
        await put('ausgaben', updated);
        Object.assign(a, updated);
      }
      toast(`${kategorieVerbesserbar.length} Ausgabe(n) neu kategorisiert`, 'success');
      close();
      render(container);
    });
    body.querySelectorAll('.ausg-unvollst-row').forEach((row) => {
      row.addEventListener('click', () => {
        close();
        openForm(unvollstaendig.find((a) => a.id === row.dataset.id) || ohneZuordnung.find((a) => a.id === row.dataset.id));
      });
    });
    body.querySelectorAll('.ausg-beleg-ansehen').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = dupGroups.flat().find((x) => x.id === btn.dataset.id)
          || unvollstaendig.find((x) => x.id === btn.dataset.id)
          || ohneZuordnung.find((x) => x.id === btn.dataset.id);
        if (a) openBelegAnsicht(a.beleg);
      });
    });
    body.querySelector('#btn-ausg-dup-delete')?.addEventListener('click', async () => {
      const zuLoeschen = [];
      body.querySelectorAll('.ausg-dup-del:checked').forEach((chk) => {
        const g = dupGroups[Number(chk.dataset.gi)];
        const a = g[Number(chk.dataset.ai)];
        if (a) zuLoeschen.push(a);
      });
      if (zuLoeschen.length === 0) { toast('Keine Duplikate ausgewählt', 'info'); return; }
      if (!confirmDelete(`${zuLoeschen.length} Ausgabe(n) in den Papierkorb verschieben?`)) return;
      for (const a of zuLoeschen) {
        await remove('ausgaben', a.id);
        try { await journal.entferneBuchungFuerAusgabe(a.id); } catch { /* Verbuchung ist ein Komfort-Feature */ }
      }
      toast(`${zuLoeschen.length} Ausgabe(n) in den Papierkorb verschoben`, 'success');
      close();
      render(container);
    });
  }

  const belegScanInput = container.querySelector('#beleg-scan-input');
  container.querySelector('#btn-beleg-scan').addEventListener('click', () => belegScanInput.click());
  belegScanInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    belegScanInput.value = '';
    if (!file) return;
    const scanBtn = container.querySelector('#btn-beleg-scan');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Beleg wird analysiert ...';
    try {
      const belegBlob = await compressImage(file, { maxWidth: 1400 });
      const imageDataUrl = await blobToDataUrl(await compressImage(file, { maxWidth: 1000, quality: 0.7 }));
      let prefill = { beleg: belegBlob };
      try {
        const result = await analyzeBeleg({ imageDataUrl, kategorien: KATEGORIEN });
        const kategorie = KATEGORIEN.includes(result.kategorie) ? result.kategorie : 'Sonstiges';
        const unsicher = !result.lesbar || !result.kategorieSicher;
        const datum = /^\d{4}-\d{2}-\d{2}$/.test(result.datum || '') ? result.datum : todayISO();
        const steuersatz = [0, 7, 19].includes(Number(result.steuersatz)) ? Number(result.steuersatz) : 19;
        prefill = {
          ...prefill,
          datum,
          kategorie,
          beschreibung: `${unsicher ? '⚠️ Bitte prüfen: ' : ''}${result.beschreibung || ''}`.trim(),
          lieferant: result.haendler || '',
          betragNetto: Number(result.betragNetto) || 0,
          steuersatz,
          betragBrutto: calcBrutto(Number(result.betragNetto) || 0, steuersatz),
        };
        toast(unsicher ? 'Beleg gescannt – bitte Angaben prüfen' : 'Beleg erkannt', unsicher ? 'info' : 'success');
      } catch (err) {
        toast(`KI-Erkennung fehlgeschlagen (${err.message}) – bitte manuell ausfüllen`, 'danger');
      }
      openForm(null, { prefill });
    } catch (err) {
      toast(err.message, 'danger');
    }
    scanBtn.disabled = false;
    scanBtn.textContent = '📷 Beleg scannen';
  });

  function calcBrutto(netto, steuersatz) {
    return Math.round(Number(netto) * (1 + Number(steuersatz) / 100) * 100) / 100;
  }

  function openForm(a, { prefill } = {}) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), datum: todayISO(), kategorie: KATEGORIEN[0], beschreibung: '', lieferant: '',
      betragNetto: 0, steuersatz: settings.standardSteuersatz, betragBrutto: 0, bezahltMit: 'überweisung', beleg: null,
      projektId: '', kundeId: '', kalkKategorie: '',
      bezahlstatus: '', faelligAm: '', bezahltAm: '', istInvestition: false,
      ...prefill,
    };
    const istOffeneKreditorenRechnung = isEdit && data.bezahlstatus === 'offen';
    const { body, close } = openModal({
      title: isEdit ? 'Ausgabe bearbeiten' : 'Neue Ausgabe',
      bodyHtml: `
        <form id="ausgabe-form">
          <div class="form-grid">
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Kategorie</label>
              <select name="kategorie" id="ausgabe-kategorie">${KATEGORIEN.map((k) => `<option value="${k}" ${k === data.kategorie ? 'selected' : ''}>${k}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Beschreibung</label><input name="beschreibung" id="ausgabe-beschreibung" value="${escapeHtml(data.beschreibung || '')}"></div>
            <div class="field"><label>Lieferant</label><input name="lieferant" id="ausgabe-lieferant" value="${escapeHtml(data.lieferant || '')}"></div>
            <div class="field"><label>Bezahlt mit</label>
              <select name="bezahltMit">
                <option value="überweisung" ${data.bezahltMit === 'überweisung' ? 'selected' : ''}>Überweisung</option>
                <option value="karte" ${data.bezahltMit === 'karte' ? 'selected' : ''}>Karte</option>
                <option value="bar" ${data.bezahltMit === 'bar' ? 'selected' : ''}>Bar</option>
                <option value="lastschrift" ${data.bezahltMit === 'lastschrift' ? 'selected' : ''}>Lastschrift</option>
              </select>
            </div>
            <div class="field"><label>Betrag netto (€)</label><input type="number" step="0.01" min="0" name="betragNetto" value="${data.betragNetto}"></div>
            <div class="field"><label>USt.-Satz (%)</label>
              <select name="steuersatz">
                ${USTSAETZE.map((s) => `<option value="${s.wert}" ${Number(data.steuersatz) === s.wert ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId" id="ausgabe-kunde"><option value="">– keinem Kunden zugeordnet –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt / Auftrag (für Nachkalkulation)</label>
              <select name="projektId" id="ausgabe-projekt"><option value="">– keinem Projekt zugeordnet –</option>${projekte.map((p) => `<option value="${p.id}" data-kunde="${p.kundeId || ''}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kalkulations-Kategorie</label>
              <select name="kalkKategorie" id="ausgabe-kalkkategorie" ${data.projektId ? '' : 'disabled'}>
                <option value="">–</option>
                ${KALK_KATEGORIEN_AUSGABEN.map((k) => `<option value="${k.id}" ${k.id === data.kalkKategorie ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}
              </select>
            </div>
            <div class="field col-span-2"><label>Beleg (Foto oder PDF)</label>
              <input type="file" accept="image/*,application/pdf" id="beleg-input">
              <div id="beleg-preview">${data.beleg ? '<a href="#" class="btn btn-sm" id="beleg-view-link">📎 Beleg ansehen</a>' : ''}</div>
            </div>
            ${istOffeneKreditorenRechnung ? `
              <div class="card col-span-2" style="background:#fff6e0;border-color:#f0d78c">
                <p class="mb-0">⚠️ Diese Ausgabe ist als offene Lieferantenrechnung erfasst${data.faelligAm ? ` - fällig am ${escapeHtml(data.faelligAm)}` : ''}. Sie wird erst als Betriebsausgabe verbucht, wenn sie als bezahlt markiert wird.</p>
              </div>
              <div class="field"><label>Bezahlt am</label><input type="date" id="ausgabe-bezahlt-am" value="${todayISO()}"></div>
              <div class="field"><button type="button" class="btn btn-primary" id="btn-jetzt-bezahlt" style="margin-top:22px">Jetzt als bezahlt markieren</button></div>
            ` : `
              <div class="field col-span-2">
                <label><input type="checkbox" name="nochNichtBezahlt" id="ausgabe-offen-checkbox" ${data.bezahlstatus === 'offen' ? 'checked' : ''}> Diese Ausgabe ist noch nicht bezahlt (Lieferantenrechnung)</label>
              </div>
              <div class="col-span-2" id="ausgabe-faellig-section" ${data.bezahlstatus === 'offen' ? '' : 'hidden'}>
                <div class="field"><label>Fällig am</label><input type="date" name="faelligAm" value="${data.faelligAm || ''}"></div>
              </div>
              <div class="field col-span-2">
                <label><input type="checkbox" id="ausgabe-investition-checkbox" ${data.istInvestition ? 'checked' : ''}> Diese Ausgabe ist eine Anschaffung für das Anlagevermögen (Abschreibung über mehrere Jahre statt Sofortaufwand)</label>
              </div>
            `}
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            ${istOffeneKreditorenRechnung ? '' : '<button type="submit" class="btn btn-primary">Speichern</button>'}
          </div>
        </form>
      `,
    });

    if (!istOffeneKreditorenRechnung) {
      body.querySelector('#ausgabe-offen-checkbox').addEventListener('change', (e) => {
        body.querySelector('#ausgabe-faellig-section').hidden = !e.target.checked;
      });
    } else {
      body.querySelector('#btn-jetzt-bezahlt').addEventListener('click', async () => {
        const bezahltAm = body.querySelector('#ausgabe-bezahlt-am').value || todayISO();
        const updated = { ...data, bezahlstatus: 'bezahlt', bezahltAm };
        await put('ausgaben', updated);
        try { await journal.syncBuchungFuerAusgabe(updated, settings); } catch { /* Verbuchung ist ein Komfort-Feature, darf das Speichern nicht blockieren */ }
        toast('Ausgabe als bezahlt markiert', 'success');
        close();
        render(container);
      });
    }

    body.querySelector('#ausgabe-projekt').addEventListener('change', (e) => {
      body.querySelector('#ausgabe-kalkkategorie').disabled = !e.target.value;
      const kundeSelect = body.querySelector('#ausgabe-kunde');
      const projektKundeId = e.target.selectedOptions[0]?.dataset.kunde || '';
      if (projektKundeId && !kundeSelect.value) kundeSelect.value = projektKundeId;
    });

    // Kategorie automatisch aus Lieferant/Beschreibung vorschlagen (gleiche
    // Erkennung wie beim Belege-Import) - nur solange der Nutzer die
    // Kategorie noch nicht selbst per Hand geändert hat, damit ein bewusst
    // gewählter Wert nicht überschrieben wird.
    const kategorieSelect = body.querySelector('#ausgabe-kategorie');
    let kategorieManuellGewaehlt = isEdit;
    kategorieSelect.addEventListener('change', () => { kategorieManuellGewaehlt = true; });
    const kategorieAutoErkennen = () => {
      if (kategorieManuellGewaehlt) return;
      const text = `${body.querySelector('#ausgabe-lieferant').value} ${body.querySelector('#ausgabe-beschreibung').value}`.trim();
      if (!text) return;
      const erkannt = guessAusgabenKategorie(text);
      if (erkannt !== 'Sonstiges' && KATEGORIEN.includes(erkannt)) kategorieSelect.value = erkannt;
    };
    body.querySelector('#ausgabe-lieferant').addEventListener('input', kategorieAutoErkennen);
    body.querySelector('#ausgabe-beschreibung').addEventListener('input', kategorieAutoErkennen);

    // newBelegBlob ist nur gesetzt, wenn der Nutzer gerade eine neue Datei
    // ausgewählt hat (entweder über den Datei-Input oder - noch nicht
    // gespeichert - über den "Beleg scannen"-Vorschlag). Ein bereits
    // gespeicherter Beleg im Firebase-Modus liegt als {url,path,...} vor,
    // kein Blob - der wird beim Speichern unverändert übernommen.
    let newBelegBlob = data.beleg instanceof Blob ? data.beleg : null;
    const belegViewLink = body.querySelector('#beleg-view-link');
    if (belegViewLink) {
      belegViewLink.addEventListener('click', (e) => {
        e.preventDefault();
        openBelegAnsicht(data.beleg);
      });
    }
    body.querySelector('#beleg-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        newBelegBlob = file.type === 'application/pdf' ? file : await compressImage(file, { maxWidth: 1400 });
        body.querySelector('#beleg-preview').innerHTML = '<span class="badge badge-success">Beleg hinzugefügt (wird beim Speichern übernommen)</span>';
      } catch (err) {
        toast(err.message, 'danger');
      }
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Ausgabe in den Papierkorb verschieben?')) return;
        await remove('ausgaben', data.id);
        try { await journal.entferneBuchungFuerAusgabe(data.id); } catch { /* Verbuchung ist ein Komfort-Feature */ }
        toast('Ausgabe in den Papierkorb verschoben');
        close();
        render(container);
      });
    }
    body.querySelector('#ausgabe-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.datum = fd.get('datum') || data.datum;
      updated.kategorie = fd.get('kategorie') || KATEGORIEN[0];
      updated.beschreibung = (fd.get('beschreibung') || '').toString().trim();
      updated.lieferant = (fd.get('lieferant') || '').toString().trim();
      updated.bezahltMit = fd.get('bezahltMit') || 'überweisung';
      updated.betragNetto = Number(fd.get('betragNetto')) || 0;
      updated.steuersatz = Number(fd.get('steuersatz')) || 0;
      updated.betragBrutto = calcBrutto(updated.betragNetto, updated.steuersatz);
      if (newBelegBlob) {
        updated.beleg = FIREBASE_ENABLED ? await uploadBlobToStorage(`ausgaben/${data.id}`, newBelegBlob) : newBelegBlob;
      } else {
        updated.beleg = data.beleg || null;
      }
      updated.projektId = fd.get('projektId') || '';
      updated.kundeId = fd.get('kundeId') || '';
      updated.kalkKategorie = updated.projektId ? (fd.get('kalkKategorie') || '') : '';
      const nochNichtBezahlt = body.querySelector('#ausgabe-offen-checkbox')?.checked || false;
      updated.bezahlstatus = nochNichtBezahlt ? 'offen' : '';
      updated.faelligAm = nochNichtBezahlt ? (fd.get('faelligAm') || '') : '';
      updated.bezahltAm = nochNichtBezahlt ? '' : updated.bezahltAm || '';
      updated.istInvestition = body.querySelector('#ausgabe-investition-checkbox')?.checked || false;
      await put('ausgaben', updated);
      try { await journal.syncBuchungFuerAusgabe(updated, settings); } catch { /* Verbuchung ist ein Komfort-Feature, darf das Speichern nicht blockieren */ }

      if (updated.istInvestition && !isEdit) {
        // Als Anlagevermögen markiert: keine eigene Aufwandsbuchung (siehe
        // Guard in journal.js erzeugeBuchungenFuerAusgabe) - stattdessen
        // Übergabe an ein vorausgefülltes Neue-Anlage-Formular in der
        // Buchhaltung, wo Nutzungsdauer/GWG ergänzt werden.
        try {
          sessionStorage.setItem('nv-anlage-prefill', JSON.stringify({
            bezeichnung: updated.beschreibung || updated.lieferant || '',
            lieferant: updated.lieferant || '',
            anschaffungsdatum: updated.datum,
            anschaffungswertNetto: updated.betragNetto,
            steuersatz: updated.steuersatz,
            bezahltMit: updated.bezahltMit === 'bar' ? 'bar' : 'überweisung',
            ausgabeId: updated.id,
          }));
        } catch { /* sessionStorage evtl. nicht verfügbar */ }
        toast('Ausgabe erfasst - bitte im Anlagenverzeichnis mit Nutzungsdauer ergänzen', 'success');
        close();
        window.location.hash = '#/buchhaltung';
        return;
      }
      toast(isEdit ? 'Ausgabe aktualisiert' : 'Ausgabe erfasst', 'success');
      close();
      render(container);
    });
  }

  applyFilter();
}
