import { getAll } from '../db.js';
import { formatCurrency, formatDate, todayISO, escapeHtml } from '../utils.js';

export async function render(container) {
  const [rechnungen, projekte, termine, kunden] = await Promise.all([
    getAll('rechnungen'), getAll('projekte'), getAll('termine'), getAll('kunden'),
  ]);
  const today = todayISO();

  const offen = rechnungen.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt');
  const ueberfaellig = offen.filter((r) => r.faelligAm && r.faelligAm < today);
  const offenSumme = offen.reduce((s, r) => s + (r.brutto || 0), 0);
  const ueberfaelligSumme = ueberfaellig.reduce((s, r) => s + (r.brutto || 0), 0);
  const aktiveProjekte = projekte.filter((p) => p.status !== 'abgeschlossen');
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));

  const in7Tage = new Date();
  in7Tage.setDate(in7Tage.getDate() + 7);
  const in7TageISO = in7Tage.toISOString().slice(0, 10);
  const anstehend = termine
    .filter((t) => t.start && t.start.slice(0, 10) >= today && t.start.slice(0, 10) <= in7TageISO)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 8);

  container.innerHTML = `
    <div class="view-header"><h1>Dashboard</h1></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${kunden.length}</div><div class="kpi-label">Kunden</div></div>
      <div class="kpi-card"><div class="kpi-value">${aktiveProjekte.length}</div><div class="kpi-label">Aktive Projekte</div></div>
      <div class="kpi-card kpi-warn"><div class="kpi-value">${offen.length}</div><div class="kpi-label">Offene Rechnungen &middot; ${formatCurrency(offenSumme)}</div></div>
      <div class="kpi-card kpi-danger"><div class="kpi-value">${ueberfaellig.length}</div><div class="kpi-label">Überfällig &middot; ${formatCurrency(ueberfaelligSumme)}</div></div>
    </div>

    <div class="card">
      <h2>Anstehende Termine (7 Tage)</h2>
      ${anstehend.length === 0 ? '<p class="text-mute">Keine Termine in den nächsten 7 Tagen.</p>' : `
        <ul class="cal-event-list">
          ${anstehend.map((t) => `
            <li>
              <div>
                <strong>${escapeHtml(t.titel)}</strong>
                <div class="text-mute">${formatDate(t.start)}${t.kundeId && kundenById[t.kundeId] ? ' · ' + escapeHtml(kundenById[t.kundeId].firma) : ''}</div>
              </div>
              <a class="btn btn-sm" href="#/kalender">Öffnen</a>
            </li>
          `).join('')}
        </ul>
      `}
    </div>

    ${ueberfaellig.length ? `
      <div class="card">
        <h2>Überfällige Rechnungen</h2>
        <table class="data-table">
          <thead><tr><th>Nummer</th><th>Kunde</th><th>Fällig am</th><th>Betrag</th></tr></thead>
          <tbody>
            ${ueberfaellig.map((r) => `
              <tr>
                <td>${escapeHtml(r.nummer)}</td>
                <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
                <td>${formatDate(r.faelligAm)}</td>
                <td>${formatCurrency(r.brutto)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p class="hint"><a href="#/mahnungen">→ Zu den Mahnungen</a></p>
      </div>
    ` : ''}
  `;
}
