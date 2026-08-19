import { getAll } from '../db.js';
import { escapeHtml, formatCurrency, todayISO, addDays } from '../utils.js';

function barRow(label, value, max, formatValue, href) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `
    <div class="auswertung-row${href ? ' auswertung-row-link' : ''}" ${href ? `data-href="${href}"` : ''}>
      <div class="auswertung-row-label">${escapeHtml(label)}</div>
      <div class="auswertung-row-bar"><div class="auswertung-row-fill" style="width:${pct}%"></div></div>
      <div class="auswertung-row-value">${formatValue(value)}</div>
    </div>
  `;
}

export async function render(container) {
  const [rechnungen, angebote, zeiterfassung, kunden, mitarbeiter, projekte, ausgaben, marken] = await Promise.all([
    getAll('rechnungen'), getAll('angebote'), getAll('zeiterfassung'), getAll('kunden'), getAll('mitarbeiter'),
    getAll('projekte'), getAll('ausgaben'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));

  // --- Top-Kunden nach Umsatz (alle nicht-stornierten Rechnungen) ---
  const umsatzByKunde = {};
  for (const r of rechnungen) {
    if (r.status === 'storniert' || !r.kundeId) continue;
    umsatzByKunde[r.kundeId] = (umsatzByKunde[r.kundeId] || 0) + (Number(r.brutto) || 0);
  }
  const topKunden = Object.entries(umsatzByKunde)
    .map(([kundeId, summe]) => ({ kundeId, summe, name: kundenById[kundeId]?.firma || 'Unbekannt' }))
    .sort((a, b) => b.summe - a.summe)
    .slice(0, 10);
  const topKundenMax = Math.max(1, ...topKunden.map((k) => k.summe));

  // --- Auslastung je Mitarbeiter (Zeiterfassung der letzten 30 Tage) ---
  const seit = addDays(todayISO(), -30);
  const minutenByMitarbeiter = {};
  for (const z of zeiterfassung) {
    if (!z.mitarbeiterId || !z.datum || z.datum < seit) continue;
    minutenByMitarbeiter[z.mitarbeiterId] = (minutenByMitarbeiter[z.mitarbeiterId] || 0) + (Number(z.dauerMinuten) || 0);
  }
  const auslastung = Object.entries(minutenByMitarbeiter)
    .map(([mitarbeiterId, minuten]) => ({ mitarbeiterId, stunden: minuten / 60, name: mitarbeiterById[mitarbeiterId]?.name || 'Unbekannt' }))
    .sort((a, b) => b.stunden - a.stunden);
  const auslastungMax = Math.max(1, ...auslastung.map((a) => a.stunden));

  // --- Angebot-Annahmequote ---
  const angebotStatusCount = { entwurf: 0, versendet: 0, angenommen: 0, abgelehnt: 0 };
  for (const a of angebote) {
    if (a.status in angebotStatusCount) angebotStatusCount[a.status] += 1;
  }
  const entschieden = angebotStatusCount.angenommen + angebotStatusCount.abgelehnt;
  const annahmequote = entschieden > 0 ? Math.round((angebotStatusCount.angenommen / entschieden) * 100) : null;

  // --- Umsatz/Ausgaben je Marke (Rechnung/Ausgabe -> Projekt -> Marke; ohne
  // Projektbezug lässt sich eine Ausgabe/Rechnung keiner Marke zuordnen) ---
  const STANDARD_LABEL = 'Standard (Hauptfirma)';
  const OHNE_PROJEKT_LABEL = 'Ohne Projektbezug';
  function markeLabelFuerProjekt(projektId) {
    const projekt = projekteById[projektId];
    if (!projekt) return OHNE_PROJEKT_LABEL;
    return markenById[projekt.markeId]?.name || STANDARD_LABEL;
  }
  const umsatzByMarke = {};
  for (const r of rechnungen) {
    if (r.status === 'storniert') continue;
    const label = markeLabelFuerProjekt(r.projektId);
    umsatzByMarke[label] = (umsatzByMarke[label] || 0) + (Number(r.brutto) || 0);
  }
  const ausgabenByMarke = {};
  for (const a of ausgaben) {
    const label = markeLabelFuerProjekt(a.projektId);
    ausgabenByMarke[label] = (ausgabenByMarke[label] || 0) + (Number(a.betragBrutto) || 0);
  }
  const markenLabels = Array.from(new Set([...Object.keys(umsatzByMarke), ...Object.keys(ausgabenByMarke)]))
    .sort((a, b) => (umsatzByMarke[b] || 0) - (umsatzByMarke[a] || 0));
  const markenAuswertung = markenLabels.map((label) => ({
    label, umsatz: umsatzByMarke[label] || 0, ausgabenSumme: ausgabenByMarke[label] || 0,
  }));
  const markenUmsatzMax = Math.max(1, ...markenAuswertung.map((m) => m.umsatz));

  container.innerHTML = `
    <div class="view-header">
      <h1>Auswertungen</h1>
    </div>

      <div class="card">
        <h2>Angebot-Annahmequote</h2>
        ${annahmequote === null ? `
          <p class="text-mute">Noch keine angenommenen oder abgelehnten Angebote vorhanden.</p>
        ` : `
          <div class="flex-row" style="align-items:baseline;gap:16px;flex-wrap:wrap">
            <div style="font-size:36px;font-weight:700;color:${annahmequote >= 60 ? 'var(--success)' : annahmequote >= 35 ? 'var(--warn)' : 'var(--danger)'}">${annahmequote}%</div>
            <div class="text-mute" style="font-size:13px">
              ${angebotStatusCount.angenommen} angenommen &middot; ${angebotStatusCount.abgelehnt} abgelehnt
              ${angebotStatusCount.versendet ? ` &middot; ${angebotStatusCount.versendet} noch offen` : ''}
              ${angebotStatusCount.entwurf ? ` &middot; ${angebotStatusCount.entwurf} im Entwurf` : ''}
            </div>
          </div>
        `}
      </div>

      ${marken.length > 0 ? `
        <div class="card">
          <h2>Umsatz &amp; Ausgaben nach Marke</h2>
          <p class="hint">Zuordnung läuft über das Projekt einer Rechnung/Ausgabe. Ohne verknüpftes Projekt lässt sich der Betrag keiner Marke zuordnen.</p>
          ${markenAuswertung.length === 0 ? '<p class="text-mute">Noch keine Rechnungen oder Ausgaben vorhanden.</p>' : `
            <div class="auswertung-liste">
              ${markenAuswertung.map((m) => barRow(m.label, m.umsatz, markenUmsatzMax, formatCurrency)).join('')}
            </div>
            <table class="data-table" style="margin-top:12px">
              <thead><tr><th>Marke</th><th class="text-right">Umsatz</th><th class="text-right">Ausgaben</th><th class="text-right">Übrig</th></tr></thead>
              <tbody>
                ${markenAuswertung.map((m) => `
                  <tr>
                    <td>${escapeHtml(m.label)}</td>
                    <td class="text-right">${formatCurrency(m.umsatz)}</td>
                    <td class="text-right">${formatCurrency(m.ausgabenSumme)}</td>
                    <td class="text-right">${formatCurrency(m.umsatz - m.ausgabenSumme)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      ` : ''}

      <div class="card">
        <h2>Top-Kunden nach Umsatz</h2>
        ${topKunden.length === 0 ? '<p class="text-mute">Noch keine Rechnungen vorhanden.</p>' : `
          <div class="auswertung-liste">
            ${topKunden.map((k) => barRow(k.name, k.summe, topKundenMax, formatCurrency, `#/kunden/${k.kundeId}`)).join('')}
          </div>
        `}
      </div>

      <div class="card">
        <h2>Auslastung je Mitarbeiter <span class="text-mute" style="font-size:12px;font-weight:400">(letzte 30 Tage)</span></h2>
        ${auslastung.length === 0 ? '<p class="text-mute">Noch keine Zeiterfassung in diesem Zeitraum.</p>' : `
          <div class="auswertung-liste">
            ${auslastung.map((a) => barRow(a.name, a.stunden, auslastungMax, (v) => `${v.toFixed(1)} Std.`)).join('')}
          </div>
        `}
      </div>
  `;

  container.querySelectorAll('.auswertung-row-link[data-href]').forEach((row) => {
    row.addEventListener('click', () => { window.location.hash = row.dataset.href; });
  });
}
