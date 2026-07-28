import { getAll } from '../db.js';
import { escapeHtml, formatCurrency, todayISO, addDays } from '../utils.js';

function barRow(label, value, max, formatValue) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `
    <div class="auswertung-row">
      <div class="auswertung-row-label">${escapeHtml(label)}</div>
      <div class="auswertung-row-bar"><div class="auswertung-row-fill" style="width:${pct}%"></div></div>
      <div class="auswertung-row-value">${formatValue(value)}</div>
    </div>
  `;
}

export async function render(container) {
  const [rechnungen, angebote, zeiterfassung, kunden, mitarbeiter] = await Promise.all([
    getAll('rechnungen'), getAll('angebote'), getAll('zeiterfassung'), getAll('kunden'), getAll('mitarbeiter'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));

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

      <div class="card">
        <h2>Top-Kunden nach Umsatz</h2>
        ${topKunden.length === 0 ? '<p class="text-mute">Noch keine Rechnungen vorhanden.</p>' : `
          <div class="auswertung-liste">
            ${topKunden.map((k) => barRow(k.name, k.summe, topKundenMax, formatCurrency)).join('')}
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
}
