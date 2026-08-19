import { getAll, getSettings, TERMIN_TYPEN } from '../db.js';
import { escapeHtml, formatCurrency, formatDate, todayISO, localDateStr, openDokumentMitVorbelegung } from '../utils.js';
import { mountKarte } from '../karte.js';

// Tagesfokussierte Startseite (Ergänzung zum bestehenden, eher betriebswirt-
// schaftlich orientierten Dashboard): "Was ist heute los, wo sind die
// Einsätze, was braucht gerade Aufmerksamkeit (offene Angebote, fällige
// Rechnungen)?" - inspiriert von der ToolTime-Tagesübersicht.
function typInfo(typId) {
  return TERMIN_TYPEN.find((t) => t.id === typId) || TERMIN_TYPEN[0];
}

function formatMinuten(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}min`;
}

export async function render(container) {
  const [termine, kunden, mitarbeiter, projekte, zeiterfassung, angebote, rechnungen, mahnungen, settings] = await Promise.all([
    getAll('termine'), getAll('kunden'), getAll('mitarbeiter'), getAll('projekte'), getAll('zeiterfassung'),
    getAll('angebote'), getAll('rechnungen'), getAll('mahnungen'), getSettings(),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const today = todayISO();

  const termineHeute = termine.filter((t) => {
    const s = (t.start || '').slice(0, 10);
    const e = (t.ende || '').slice(0, 10) || s;
    return today >= s && today <= e;
  }).sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  const mitarbeiterImEinsatz = new Set(termineHeute.flatMap((t) => t.mitarbeiterIds || []));
  const erfassteMinutenHeute = zeiterfassung.filter((e) => e.datum === today).reduce((s, e) => s + (e.dauerMinuten || 0), 0);

  const offen = rechnungen.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt');
  const ueberfaellig = offen.filter((r) => r.faelligAm && r.faelligAm < today).sort((a, b) => (a.faelligAm || '').localeCompare(b.faelligAm || ''));

  const angeboteOffen = angebote.filter((a) => a.status === 'versendet').sort((a, b) => (a.gueltigBis || '').localeCompare(b.gueltigBis || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Tagesübersicht</h1>
      <span class="text-mute">${new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</span>
    </div>

    <div class="kpi-grid">
      <a class="kpi-card" href="#/plantafel/tag/${today}"><div class="kpi-value">${termineHeute.length}</div><div class="kpi-label">Termine heute</div></a>
      <div class="kpi-card"><div class="kpi-value">${mitarbeiterImEinsatz.size}</div><div class="kpi-label">Mitarbeiter im Einsatz</div></div>
      <div class="kpi-card"><div class="kpi-value">${formatMinuten(erfassteMinutenHeute)}</div><div class="kpi-label">Erfasste Zeit heute</div></div>
      <a class="kpi-card ${ueberfaellig.length ? 'kpi-danger' : ''}" href="#/rechnungen/ueberfaellig"><div class="kpi-value">${ueberfaellig.length}</div><div class="kpi-label">Überfällige Rechnungen</div></a>
    </div>

    <div class="dash-layout">
      <div class="dash-main">
        <div class="card">
          <h2 style="margin-top:0">Einsätze heute auf der Karte</h2>
          <div class="karte-split">
            <div class="karte-map-col">
              <p class="hint" id="karte-status">Termine mit Ort werden geladen ...</p>
              <div id="map" style="height:420px;border-radius:var(--radius);"></div>
            </div>
            <div class="karte-list-col">
              <div class="card" id="karte-detail-card">
                <p class="text-mute">Auf einen Marker oder Eintrag in der Liste klicken, um Details zu sehen.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
            <h2 style="margin:0">Termine heute</h2>
            <a class="text-mute" href="#/termine" style="font-size:12.5px">Alle Termine →</a>
          </div>
          ${termineHeute.length === 0 ? '<p class="text-mute">Keine Termine heute.</p>' : `
            <ul class="cal-event-list">
              ${termineHeute.map((t) => {
                const farbe = t.farbe || typInfo(t.typ).farbe;
                const kunde = kundenById[t.kundeId];
                const mitarbeiterNamen = (t.mitarbeiterIds || []).map((id) => mitarbeiterById[id]?.name).filter(Boolean).join(', ');
                return `
                  <li style="border-left:3px solid ${farbe}">
                    <div>
                      <strong>${escapeHtml(t.titel)}</strong>
                      <div class="text-mute">${(t.start || '').slice(11, 16) || '--:--'} Uhr${kunde ? ' · ' + escapeHtml(kunde.firma) : ''}${mitarbeiterNamen ? ' · ' + escapeHtml(mitarbeiterNamen) : ''}${t.ort ? ' · ' + escapeHtml(t.ort) : ''}</div>
                    </div>
                    ${t.kundeId ? `<button type="button" class="btn btn-sm btn-rechnung" data-kunde="${t.kundeId}" data-projekt="${t.projektId || ''}">Rechnung erstellen</button>` : ''}
                  </li>
                `;
              }).join('')}
            </ul>
          `}
        </div>
      </div>

      <div class="dash-side">
        <div class="card">
          <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
            <h2 style="margin:0">Offene Angebote</h2>
            <span class="text-mute">${angeboteOffen.length}</span>
          </div>
          ${angeboteOffen.length === 0 ? '<p class="text-mute">Keine offenen Angebote.</p>' : `
            <ul class="cal-event-list">
              ${angeboteOffen.slice(0, 8).map((a) => `
                <li>
                  <div><strong>${escapeHtml(a.nummer)}</strong><div class="text-mute">${escapeHtml(kundenById[a.kundeId]?.firma || '')}${a.gueltigBis ? ' · gültig bis ' + formatDate(a.gueltigBis) : ''}</div></div>
                  <span>${formatCurrency(a.brutto)}</span>
                </li>
              `).join('')}
            </ul>
          `}
          <p class="hint"><a href="#/angebote">Alle Angebote →</a></p>
        </div>

        <div class="card">
          <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
            <h2 style="margin:0">Fällige Rechnungen</h2>
            <span class="text-mute">${offen.length}</span>
          </div>
          ${offen.length === 0 ? '<p class="text-mute">Keine offenen Rechnungen.</p>' : `
            <ul class="cal-event-list">
              ${[...offen].sort((a, b) => (a.faelligAm || '').localeCompare(b.faelligAm || '')).slice(0, 8).map((r) => {
                const istUeberfaellig = r.faelligAm && r.faelligAm < today;
                return `
                  <li>
                    <div><strong>${escapeHtml(r.nummer)}</strong><div class="text-mute">${escapeHtml(kundenById[r.kundeId]?.firma || '')}${r.faelligAm ? ' · fällig ' + formatDate(r.faelligAm) : ''}</div></div>
                    <span class="badge ${istUeberfaellig ? 'badge-danger' : ''}">${formatCurrency(r.brutto)}</span>
                  </li>
                `;
              }).join('')}
            </ul>
          `}
          <p class="hint"><a href="#/rechnungen/offen">Alle offenen Rechnungen →</a></p>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.btn-rechnung').forEach((btn) => {
    btn.addEventListener('click', () => {
      openDokumentMitVorbelegung('rechnungen', { kundeId: btn.dataset.kunde, projektId: btn.dataset.projekt || '' });
    });
  });

  const karte = mountKarte(container, { termine: termineHeute, kundenById, mitarbeiterById, settings });
  karte.refresh();
}
