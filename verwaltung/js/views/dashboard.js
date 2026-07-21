import { getAll, put, getSettings } from '../db.js';
import { uid, formatDate, todayISO, escapeHtml, getCurrentMitarbeiterId, toast } from '../utils.js';

const WEATHER_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

async function loadWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,weathercode&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wetterdienst nicht erreichbar');
  return res.json();
}

export async function render(container) {
  const [projekte, termine, kunden, spalten, aufgaben, mitarbeiter, settings, katalog] = await Promise.all([
    getAll('projekte'), getAll('termine'), getAll('kunden'), getAll('kanbanSpalten'),
    getAll('aufgaben'), getAll('mitarbeiter'), getSettings(), getAll('katalog'),
  ]);
  const niedrigBestand = katalog
    .filter((k) => k.typ === 'artikel' && k.bestandTracking && Number(k.bestand ?? 0) <= Number(k.mindestbestand ?? 0))
    .sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''));
  const today = todayISO();
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));

  const aktiveProjekte = projekte.filter((p) => !spaltenById[p.status]?.geschlossen);

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
      <div class="kpi-card"><div class="kpi-value">${heute.length}</div><div class="kpi-label">Termine heute</div></div>
      <div class="kpi-card"><div class="kpi-value">${meineAufgaben.length}</div><div class="kpi-label">Offene Aufgaben</div></div>
    </div>

    <div class="dash-layout">
      <div class="dash-main">
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
            <a class="btn" href="#/plantafel">📅 Neuer Termin</a>
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
                  <a class="btn btn-sm" href="#/plantafel">Öffnen</a>
                </li>
              `).join('')}
            </ul>
          `}
        </div>
      </div>
    </div>

    ${niedrigBestand.length ? `
      <div class="card">
        <h2>Niedriger Lagerbestand <span class="badge badge-danger">${niedrigBestand.length}</span></h2>
        <table class="data-table">
          <thead><tr><th>Artikel</th><th class="text-right">Bestand</th><th class="text-right">Mindestbestand</th></tr></thead>
          <tbody>
            ${niedrigBestand.map((k) => `
              <tr>
                <td>${escapeHtml(k.bezeichnung)}</td>
                <td class="text-right">${Number(k.bestand ?? 0)} ${escapeHtml(k.einheit || '')}</td>
                <td class="text-right">${Number(k.mindestbestand ?? 0)} ${escapeHtml(k.einheit || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p class="hint"><a href="#/katalog">→ Zu Artikel &amp; Leistungen</a></p>
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
