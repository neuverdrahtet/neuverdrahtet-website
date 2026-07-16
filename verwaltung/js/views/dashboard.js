import { getAll, put, getSettings } from '../db.js';
import { uid, formatCurrency, formatDate, todayISO, escapeHtml, getCurrentMitarbeiterId, toast } from '../utils.js';

const CHART_UMSATZ_COLOR = '#1f8a4c';
const CHART_AUSGABEN_COLOR = '#ef4444';
const WEATHER_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function lastNMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
  }
  return out;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    if (v <= s * magnitude) return s * magnitude;
  }
  return 10 * magnitude;
}

function buildLineChart(months, umsatz, ausgaben) {
  const width = 680;
  const height = 230;
  const pad = { top: 12, right: 14, bottom: 26, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...umsatz, ...ausgaben));
  const xStep = innerW / Math.max(1, months.length - 1);
  const xScale = (i) => pad.left + i * xStep;
  const yScale = (v) => pad.top + innerH - (v / max) * innerH;
  const pathFor = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');

  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = (max / gridCount) * i;
    const y = yScale(v);
    return `
      <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
      <text x="${pad.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-mute)">${formatCurrency(v).replace(',00', '')}</text>
    `;
  }).join('');

  const xLabels = months.map((m, i) => (i % 2 === 0 || months.length <= 6
    ? `<text x="${xScale(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="var(--text-mute)">${m.label}</text>`
    : '')).join('');

  const markers = (arr, color) => arr.map((v, i) => `
    <circle cx="${xScale(i).toFixed(1)}" cy="${yScale(v).toFixed(1)}" r="3.5" fill="${color}">
      <title>${months[i].label}: ${formatCurrency(v)}</title>
    </circle>
  `).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block" role="img" aria-label="Umsatz und Ausgaben je Monat">
      ${gridLines}
      ${xLabels}
      <path d="${pathFor(ausgaben)}" fill="none" stroke="${CHART_AUSGABEN_COLOR}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5,4"/>
      <path d="${pathFor(umsatz)}" fill="none" stroke="${CHART_UMSATZ_COLOR}" stroke-width="2" stroke-linecap="round"/>
      ${markers(ausgaben, CHART_AUSGABEN_COLOR)}
      ${markers(umsatz, CHART_UMSATZ_COLOR)}
    </svg>
  `;
}

async function loadWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,weathercode&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wetterdienst nicht erreichbar');
  return res.json();
}

export async function render(container) {
  const [rechnungen, projekte, termine, kunden, spalten, mahnungen, ausgaben, aufgaben, mitarbeiter, settings] = await Promise.all([
    getAll('rechnungen'), getAll('projekte'), getAll('termine'), getAll('kunden'), getAll('kanbanSpalten'),
    getAll('mahnungen'), getAll('ausgaben'), getAll('aufgaben'), getAll('mitarbeiter'), getSettings(),
  ]);
  const today = todayISO();
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));

  const offen = rechnungen.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt');
  const ueberfaellig = offen.filter((r) => r.faelligAm && r.faelligAm < today);
  const offenSumme = offen.reduce((s, r) => s + (r.brutto || 0), 0);
  const ueberfaelligSumme = ueberfaellig.reduce((s, r) => s + (r.brutto || 0), 0);
  const aktiveProjekte = projekte.filter((p) => !spaltenById[p.status]?.geschlossen);

  // --- Cashflow-Score ---
  const imMahnverfahren = offen.filter((r) => mahnungen.some((m) => m.rechnungId === r.id));
  const imZahlungsziel = offen.filter((r) => !imMahnverfahren.includes(r) && (!r.faelligAm || r.faelligAm >= today));
  const alleAktuell = rechnungen.filter((r) => r.status === 'bezahlt');
  const scoreBase = imZahlungsziel.length + imMahnverfahren.length;
  const score = scoreBase === 0 ? 100 : Math.round((imZahlungsziel.length / scoreBase) * 100);
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warn)' : 'var(--danger)';
  const scoreLabel = score >= 80 ? 'Gesund' : score >= 50 ? 'Beobachten' : 'Kritisch';

  // --- Umsatz & Ausgaben chart (12 months) ---
  const months = lastNMonths(12);
  const umsatzByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
  const ausgabenByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
  for (const r of rechnungen) {
    const key = (r.datum || '').slice(0, 7);
    if (key in umsatzByMonth) umsatzByMonth[key] += Number(r.netto) || 0;
  }
  for (const a of ausgaben) {
    const key = (a.datum || '').slice(0, 7);
    if (key in ausgabenByMonth) ausgabenByMonth[key] += Number(a.betragNetto) || 0;
  }
  const umsatzSeries = months.map((m) => umsatzByMonth[m.key]);
  const ausgabenSeries = months.map((m) => ausgabenByMonth[m.key]);

  // --- Today's Termine ---
  const heute = termine.filter((t) => {
    const s = (t.start || '').slice(0, 10);
    const e = (t.ende || '').slice(0, 10) || s;
    return today >= s && today <= e;
  }).sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  // --- Aufgaben widget ---
  let currentMa = getCurrentMitarbeiterId();
  const meineAufgaben = aufgaben.filter((a) => a.status !== 'erledigt' && (!currentMa || a.zugewiesenAn === currentMa)).slice(0, 6);

  container.innerHTML = `
    <div class="view-header"><h1>Dashboard</h1></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${kunden.length}</div><div class="kpi-label">Kunden</div></div>
      <div class="kpi-card"><div class="kpi-value">${aktiveProjekte.length}</div><div class="kpi-label">Aktive Projekte</div></div>
      <div class="kpi-card kpi-warn"><div class="kpi-value">${offen.length}</div><div class="kpi-label">Offene Rechnungen &middot; ${formatCurrency(offenSumme)}</div></div>
      <div class="kpi-card kpi-danger"><div class="kpi-value">${ueberfaellig.length}</div><div class="kpi-label">Überfällig &middot; ${formatCurrency(ueberfaelligSumme)}</div></div>
    </div>

    <div class="dash-layout">
      <div class="dash-main">
        <div class="card">
          <div class="dash-score-row">
            <div>
              <div class="text-mute" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase">Zahlungseingang</div>
              <h2 style="margin:2px 0 2px">Cashflow: ${scoreLabel}</h2>
              <p class="text-mute" style="margin:0;font-size:12.5px">Anteil Rechnungen im Zahlungsziel ohne Mahnverfahren</p>
            </div>
            <div class="dash-score-gauge" style="--score-color:${scoreColor}">
              <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" stroke-width="8"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="${scoreColor}" stroke-width="8" stroke-linecap="round"
                  stroke-dasharray="${(score / 100 * 213.6).toFixed(1)} 213.6" transform="rotate(-90 40 40)"/></svg>
              <span>${score}</span>
            </div>
          </div>
          <div class="dash-score-stats">
            <div><span class="badge badge-success">✓</span> Im Zahlungsziel<strong>${formatCurrency(imZahlungsziel.reduce((s, r) => s + r.brutto, 0))}</strong><span class="text-mute">${imZahlungsziel.length} Rechnungen</span></div>
            <div><span class="badge badge-warn">!</span> Im Mahnverfahren<strong>${formatCurrency(imMahnverfahren.reduce((s, r) => s + r.brutto, 0))}</strong><span class="text-mute">${imMahnverfahren.length} Rechnungen</span></div>
            <div><span class="badge badge-success">✓</span> Bezahlt<strong>${formatCurrency(alleAktuell.reduce((s, r) => s + r.brutto, 0))}</strong><span class="text-mute">${alleAktuell.length} Rechnungen</span></div>
          </div>
          <p class="hint"><a href="#/rechnungen">Alle Rechnungen →</a></p>
        </div>

        <div class="card">
          <div class="flex-row" style="justify-content:space-between;margin-bottom:6px">
            <h2 style="margin:0">Umsatz &amp; Ausgaben</h2>
            <div class="cal-legend" style="margin:0">
              <span class="cal-legend-item"><span class="cal-legend-dot" style="background:${CHART_UMSATZ_COLOR}"></span>Umsatz</span>
              <span class="cal-legend-item"><span class="cal-legend-dot" style="background:${CHART_AUSGABEN_COLOR}"></span>Ausgaben</span>
            </div>
          </div>
          ${buildLineChart(months, umsatzSeries, ausgabenSeries)}
        </div>

        <div class="card">
          <div class="flex-row" style="justify-content:space-between;margin-bottom:10px">
            <h2 style="margin:0">Projekt-Pipeline</h2>
            <a class="text-mute" href="#/projekte" style="font-size:12.5px">Alle Projekte →</a>
          </div>
          <div class="dash-pipeline">
            ${spalten.map((s) => {
              const count = projekte.filter((p) => p.status === s.id).length;
              return `<a class="dash-pipeline-col" href="#/projekte"><span class="count">${count}</span><span class="label">${escapeHtml(s.titel)}</span></a>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="dash-side">
        <div class="card" id="wetter-card">
          <p class="text-mute" style="margin:0">Wetter wird geladen ...</p>
        </div>

        <div class="card">
          <h2>Schnellzugriff</h2>
          <div class="dash-quicklinks">
            <a class="btn" href="#/kalender">📅 Neuer Termin</a>
            <a class="btn" href="#/kunden">👥 Neuer Kunde</a>
            <a class="btn" href="#/projekte">📁 Neues Projekt</a>
          </div>
        </div>

        <div class="card">
          <h2>Meine Aufgaben</h2>
          <div class="search-bar" style="margin-bottom:8px">
            <input type="text" id="dash-aufgabe-input" placeholder="Neue Aufgabe hinzufügen ...">
            <button class="btn btn-primary" id="dash-aufgabe-add">+</button>
          </div>
          ${!currentMa ? '<p class="hint">Wähle in Aufgaben, wer du bist, um „Meine Aufgaben" zu sehen.</p>' : ''}
          <div id="dash-aufgaben-list">
            ${meineAufgaben.length === 0 ? '<p class="text-mute">Keine offenen Aufgaben.</p>' : `
              <ul class="cal-event-list">
                ${meineAufgaben.map((a) => `<li><span>${escapeHtml(a.titel)}</span><span class="text-mute">${formatDate(a.faelligAm)}</span></li>`).join('')}
              </ul>
            `}
          </div>
          <p class="hint"><a href="#/aufgaben">Alle Aufgaben →</a></p>
        </div>

        <div class="card">
          <h2>Team</h2>
          <div class="dash-team">
            ${mitarbeiter.length === 0 ? '<p class="text-mute">Keine Mitarbeiter angelegt.</p>' : mitarbeiter.map((m) => `
              <div class="dash-team-member">
                <span class="dash-avatar" style="background:${m.farbe || '#f0a020'}">${escapeHtml((m.name || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase())}</span>
                ${escapeHtml(m.name)}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
            <h2 style="margin:0">Heutige Termine</h2>
            <span class="text-mute">${heute.length} Termine</span>
          </div>
          ${heute.length === 0 ? '<p class="text-mute">Keine Termine heute.</p>' : `
            <ul class="cal-event-list">
              ${heute.map((t) => `
                <li>
                  <div><strong>${escapeHtml(t.titel)}</strong><div class="text-mute">${(t.start || '').slice(11, 16)}${t.kundeId && kundenById[t.kundeId] ? ' · ' + escapeHtml(kundenById[t.kundeId].firma) : ''}</div></div>
                  <a class="btn btn-sm" href="#/kalender">Öffnen</a>
                </li>
              `).join('')}
            </ul>
          `}
        </div>
      </div>
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

  container.querySelector('#dash-aufgabe-add').addEventListener('click', async () => {
    const input = container.querySelector('#dash-aufgabe-input');
    const titel = input.value.trim();
    if (!titel) return;
    await put('aufgaben', {
      id: uid(), titel, beschreibung: '', zugewiesenAn: currentMa || '', erstelltVon: currentMa || '',
      faelligAm: '', prioritaet: 'normal', status: 'offen', projektId: '', kundeId: '', createdAt: new Date().toISOString(), erledigtAm: '',
    });
    toast('Aufgabe angelegt', 'success');
    render(container);
  });

  const wetterCard = container.querySelector('#wetter-card');
  loadWeather(settings.wetterLat || 51.4556, settings.wetterLng || 7.0116).then((data) => {
    const cw = data.current_weather;
    const icon = WEATHER_ICON[cw.weathercode] || '🌡️';
    const idx = data.hourly.time.findIndex((t) => t === cw.time) + 1;
    const nextHours = data.hourly.time.slice(Math.max(idx, 0), Math.max(idx, 0) + 6);
    const nextTemps = data.hourly.temperature_2m.slice(Math.max(idx, 0), Math.max(idx, 0) + 6);
    const nextCodes = data.hourly.weathercode.slice(Math.max(idx, 0), Math.max(idx, 0) + 6);
    wetterCard.innerHTML = `
      <div class="flex-row" style="justify-content:space-between">
        <h2 style="margin:0">Wetter</h2>
        <span class="text-mute" style="font-size:12px">${escapeHtml(settings.wetterOrt || '')}</span>
      </div>
      <div class="dash-weather-now">
        <span class="dash-weather-icon">${icon}</span>
        <span class="dash-weather-temp">${Math.round(cw.temperature)}°</span>
      </div>
      <div class="dash-weather-hours">
        ${nextHours.map((t, i) => `
          <div>
            <div class="text-mute">${t.slice(11, 16)}</div>
            <div>${WEATHER_ICON[nextCodes[i]] || '🌡️'}</div>
            <div>${Math.round(nextTemps[i])}°</div>
          </div>
        `).join('')}
      </div>
    `;
  }).catch(() => {
    wetterCard.innerHTML = `<h2>Wetter</h2><p class="text-mute">Wetterdaten aktuell nicht verfügbar.</p>`;
  });
}
