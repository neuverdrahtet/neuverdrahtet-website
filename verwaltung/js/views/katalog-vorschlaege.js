import { getAll, put, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, formatDateTime, toast } from '../utils.js';
import { getSession } from '../auth.js';

// Ergebnisse der wöchentlichen automatischen Katalog-Aktualisierung (siehe
// cloudflare-worker/worker.js, runKatalogAktualisierung): recherchiert per
// KI-Web-Suche aktuelle Marktpreise für einen Ausschnitt des Katalogs und
// schlägt vereinzelt fehlende Standardpositionen vor. WICHTIG: der
// Cloudflare-Worker ändert dabei NIE direkt den Katalog - jedes Ergebnis
// landet nur hier als Vorschlag. Erst "Übernehmen" wendet die Änderung
// tatsächlich auf den Katalog an.
const STATUS_LABEL = { offen: 'Offen', uebernommen: 'Übernommen', abgelehnt: 'Abgelehnt' };
const STATUS_BADGE = { offen: 'badge-warn', uebernommen: 'badge-success', abgelehnt: 'badge-danger' };

function normName(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function render(container) {
  let vorschlaege = await getAll('katalogVorschlaege');
  const katalog = await getAll('katalog');
  const katalogById = Object.fromEntries(katalog.map((k) => [k.id, k]));
  const settings = await getSettings();
  vorschlaege.sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));

  const offenCount = vorschlaege.filter((v) => v.status === 'offen').length;

  container.innerHTML = `
    <div class="view-header">
      <h1>Katalog-Vorschläge</h1>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card ${offenCount ? 'kpi-warn' : ''}">
        <div class="kpi-value">${offenCount}</div>
        <div class="kpi-label">Offen · wartet auf Prüfung</div>
      </div>
      <div class="kpi-card kpi-success">
        <div class="kpi-value">${vorschlaege.filter((v) => v.status === 'uebernommen').length}</div>
        <div class="kpi-label">Übernommen</div>
      </div>
      <div class="kpi-card kpi-danger">
        <div class="kpi-value">${vorschlaege.filter((v) => v.status === 'abgelehnt').length}</div>
        <div class="kpi-label">Abgelehnt</div>
      </div>
    </div>
    <p class="hint">
      Ergebnisse der wöchentlichen automatischen Katalog-Prüfung (KI-Web-Recherche zu aktuellen Marktpreisen, jeden Montag).
      <strong>Nichts wird automatisch im Katalog geändert</strong> - erst "Übernehmen" wendet einen Vorschlag tatsächlich an, "Ablehnen" verwirft ihn folgenlos.
    </p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  async function ablehnen(v) {
    const session = getSession();
    const updated = { ...v, status: 'abgelehnt', bearbeitetAm: new Date().toISOString(), bearbeitetVon: session?.name || session?.role || '' };
    await put('katalogVorschlaege', updated);
    Object.assign(v, updated);
    toast('Vorschlag abgelehnt', 'success');
    renderTable();
  }

  async function uebernehmen(v) {
    const session = getSession();
    try {
      if (v.typ === 'preis') {
        const item = katalogById[v.katalogId];
        if (!item) {
          toast('Der zugehörige Katalog-Eintrag existiert nicht mehr.', 'danger');
          return;
        }
        const updatedItem = { ...item, preis: Number(v.neuerPreis) || 0 };
        await put('katalog', updatedItem);
        katalogById[v.katalogId] = updatedItem;
      } else {
        // Sicherheitsnetz gegen Dubletten: der wöchentliche Recherche-Lauf
        // sieht pro Durchgang nur einen Ausschnitt des Katalogs und kann
        // trotz Gegenmaßnahmen im Prompt vereinzelt einen längst
        // vorhandenen Artikel/eine Leistung als "fehlend" vorschlagen -
        // deshalb hier zusätzlich lokal gegen den kompletten (bereits
        // geladenen) Katalog prüfen, bevor ein neuer Eintrag entsteht.
        const moeglichesDuplikat = katalog.find((k) => normName(k.bezeichnung) === normName(v.bezeichnung));
        if (moeglichesDuplikat && !window.confirm(`Im Katalog existiert bereits ein Eintrag mit dem Namen "${moeglichesDuplikat.bezeichnung}" (${formatCurrency(moeglichesDuplikat.preis)}). Trotzdem einen neuen, zusätzlichen Eintrag anlegen?`)) {
          return;
        }
        const neuerEintrag = {
          id: uid(), typ: v.typVorschlag === 'leistung' ? 'leistung' : 'artikel', bezeichnung: v.bezeichnung,
          beschreibung: v.begruendung || '', einheit: v.einheit || (v.typVorschlag === 'leistung' ? 'Std.' : 'Stk.'),
          gewerk: v.gewerk || '', einkaufspreis: 0, aufschlagProzent: 0, preis: Number(v.neuerPreis) || 0,
          steuersatz: settings.standardSteuersatz, komponenten: [], bestandTracking: false, bestand: 0, mindestbestand: 0,
        };
        await put('katalog', neuerEintrag);
        katalogById[neuerEintrag.id] = neuerEintrag;
      }
      const updated = { ...v, status: 'uebernommen', bearbeitetAm: new Date().toISOString(), bearbeitetVon: session?.name || session?.role || '' };
      await put('katalogVorschlaege', updated);
      Object.assign(v, updated);
      toast('Vorschlag übernommen', 'success');
      renderTable();
    } catch (err) {
      toast(`Fehler beim Übernehmen: ${err.message}`, 'danger');
    }
  }

  function beschreibungFuer(v) {
    if (v.typ === 'preis') {
      return `Preis-Update: <strong>${escapeHtml(v.bezeichnung)}</strong><div class="text-mute">${formatCurrency(v.alterPreis)} → ${formatCurrency(v.neuerPreis)}</div>`;
    }
    return `Neue Position: <strong>${escapeHtml(v.bezeichnung)}</strong> (${v.typVorschlag === 'leistung' ? 'Leistung' : 'Material'}, ${escapeHtml(v.einheit || '')}, ${formatCurrency(v.neuerPreis)})${v.begruendung ? `<div class="text-mute">${escapeHtml(v.begruendung)}</div>` : ''}`;
  }

  function renderTable() {
    if (vorschlaege.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Noch keine Katalog-Vorschläge. Die wöchentliche automatische Prüfung läuft jeden Montag.</div>';
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Datum</th><th>Vorschlag</th><th>Quelle</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${vorschlaege.map((v, i) => `
            <tr>
              <td>${formatDate(v.erstelltAm)}</td>
              <td>${beschreibungFuer(v)}</td>
              <td class="text-mute">${escapeHtml(v.quelle || '')}</td>
              <td><span class="badge ${STATUS_BADGE[v.status] || ''}">${escapeHtml(STATUS_LABEL[v.status] || v.status || '')}</span>${v.bearbeitetVon ? `<div class="text-mute">${escapeHtml(v.bearbeitetVon)}, ${formatDateTime(v.bearbeitetAm)}</div>` : ''}</td>
              <td class="actions-cell">
                ${v.status === 'offen' ? `
                  <button class="btn btn-sm btn-success" data-uebernehmen="${i}">Übernehmen</button>
                  <button class="btn btn-sm btn-danger" data-ablehnen="${i}">Ablehnen</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('[data-uebernehmen]').forEach((btn) => btn.addEventListener('click', () => uebernehmen(vorschlaege[Number(btn.dataset.uebernehmen)])));
    tableHost.querySelectorAll('[data-ablehnen]').forEach((btn) => btn.addEventListener('click', () => ablehnen(vorschlaege[Number(btn.dataset.ablehnen)])));
  }

  renderTable();
}
