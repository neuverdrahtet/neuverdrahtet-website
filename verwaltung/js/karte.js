import { put } from './db.js';
import { escapeHtml } from './utils.js';
import { geocode } from './geocode.js';
import { TERMIN_TYPEN } from './db.js';

function typInfo(typId) {
  return TERMIN_TYPEN.find((t) => t.id === typId) || TERMIN_TYPEN[0];
}

/**
 * Mounts a Leaflet map of Termine-with-Ort into `viewEl` in a split layout:
 * map on one side, a clickable list + detail panel (Kunde/Mitarbeiter/Ort)
 * on the other. Clicking a marker or a list entry shows the details and
 * keeps both sides in sync. Returns a refresh() to call whenever the tab
 * becomes visible (re-geocodes anything not cached yet and redraws).
 */
export function mountKarte(viewEl, { termine, kundenById, mitarbeiterById = {}, settings }) {
  let mapInstance = null;
  let markersByTerminId = new Map();
  let selectedId = null;

  function mitarbeiterNamesFor(t) {
    return (t.mitarbeiterIds || []).map((id) => mitarbeiterById[id]?.name).filter(Boolean);
  }

  function renderDetail(t) {
    const detailHost = viewEl.querySelector('#karte-detail-card');
    if (!detailHost) return;
    if (!t) {
      detailHost.innerHTML = '<p class="text-mute">Auf einen Marker oder Eintrag in der Liste klicken, um Details zu sehen.</p>';
      return;
    }
    const kunde = kundenById[t.kundeId];
    const mitarbeiterNamen = mitarbeiterNamesFor(t);
    const farbe = t.farbe || typInfo(t.typ).farbe;
    detailHost.innerHTML = `
      <div class="flex-row" style="align-items:center;gap:8px;margin-bottom:8px">
        <span class="color-dot" style="background:${escapeHtml(farbe)}"></span>
        <strong>${escapeHtml(t.titel)}</strong>
      </div>
      <div class="text-mute" style="font-size:12.5px;margin-bottom:10px">
        ${(t.start || '').slice(0, 10)}${(t.start || '').slice(11, 16) ? ' · ' + t.start.slice(11, 16) : ''}${(t.ende || '').slice(11, 16) ? ' – ' + t.ende.slice(11, 16) : ''}
      </div>
      <div class="karte-detail-row"><span class="text-mute">Kunde</span><span>${kunde ? escapeHtml(kunde.firma) : '–'}</span></div>
      <div class="karte-detail-row"><span class="text-mute">Mitarbeiter</span><span>${mitarbeiterNamen.length ? mitarbeiterNamen.map(escapeHtml).join(', ') : '–'}</span></div>
      <div class="karte-detail-row"><span class="text-mute">Ort</span><span>${escapeHtml(t.ort || '–')}</span></div>
    `;
  }

  function selectTermin(t) {
    selectedId = t.id;
    renderDetail(t);
    viewEl.querySelectorAll('.karte-list-item').forEach((el) => el.classList.toggle('active', el.dataset.id === t.id));
    const marker = markersByTerminId.get(t.id);
    if (marker && mapInstance) {
      mapInstance.setView(marker.getLatLng(), Math.max(mapInstance.getZoom(), 13));
    }
  }

  function renderList(withCoords) {
    const listHost = viewEl.querySelector('#karte-list');
    if (!listHost) return;
    listHost.innerHTML = withCoords.length === 0
      ? '<p class="text-mute">Keine Termine mit Standort.</p>'
      : withCoords.map((t) => {
          const kunde = kundenById[t.kundeId];
          const farbe = t.farbe || typInfo(t.typ).farbe;
          return `
            <div class="karte-list-item ${t.id === selectedId ? 'active' : ''}" data-id="${t.id}">
              <span class="color-dot" style="background:${escapeHtml(farbe)}"></span>
              <div class="karte-list-item-body">
                <strong>${escapeHtml(t.titel)}</strong>
                <div class="text-mute" style="font-size:11.5px">${(t.start || '').slice(0, 10)}${kunde ? ' · ' + escapeHtml(kunde.firma) : ''}</div>
              </div>
            </div>
          `;
        }).join('');
    listHost.querySelectorAll('.karte-list-item').forEach((el) => {
      el.addEventListener('click', () => {
        const t = withCoords.find((x) => x.id === el.dataset.id);
        if (t) selectTermin(t);
      });
    });
  }

  async function refresh() {
    const statusEl = viewEl.querySelector('#karte-status');
    const mapEl = viewEl.querySelector('#map');
    if (!statusEl || !mapEl) return;
    if (!window.L) { statusEl.textContent = 'Kartenbibliothek konnte nicht geladen werden.'; return; }

    const mitOrt = termine.filter((t) => t.ort?.trim()).slice(0, 60);
    if (mitOrt.length === 0) {
      statusEl.textContent = 'Keine Termine mit hinterlegtem Ort gefunden.';
    }

    const center = [settings.wetterLat || 51.4556, settings.wetterLng || 7.0116];
    if (!mapInstance) {
      mapInstance = window.L.map(mapEl).setView(center, 11);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
      }).addTo(mapInstance);
    } else {
      mapInstance.setView(center, 11);
      mapInstance.eachLayer((layer) => { if (layer instanceof window.L.CircleMarker) mapInstance.removeLayer(layer); });
    }
    setTimeout(() => mapInstance.invalidateSize(), 50);

    const toGeocode = mitOrt.filter((t) => !(t.lat && t.lng));
    for (let i = 0; i < toGeocode.length; i++) {
      const t = toGeocode[i];
      statusEl.textContent = `Adressen werden geladen ... (${i + 1}/${toGeocode.length})`;
      try {
        const pos = await geocode(t.ort);
        if (pos) {
          t.lat = pos.lat;
          t.lng = pos.lng;
          await put('termine', t);
        }
      } catch (err) {
        // ignore single geocoding failures, continue with the rest
      }
    }

    const withCoords = mitOrt.filter((t) => t.lat && t.lng);
    statusEl.textContent = withCoords.length
      ? `${withCoords.length} Termin(e) mit Standort auf der Karte. Adressen werden einmalig geokodiert und dann gespeichert.`
      : 'Keine Standorte konnten ermittelt werden.';

    markersByTerminId = new Map();
    const bounds = [];
    withCoords.forEach((t) => {
      const farbe = t.farbe || typInfo(t.typ).farbe;
      const marker = window.L.circleMarker([t.lat, t.lng], {
        radius: 8, color: farbe, fillColor: farbe, fillOpacity: 0.7, weight: 2,
      }).addTo(mapInstance);
      marker.on('click', () => selectTermin(t));
      markersByTerminId.set(t.id, marker);
      bounds.push([t.lat, t.lng]);
    });
    if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });

    renderList(withCoords);
    const stillSelected = withCoords.find((t) => t.id === selectedId);
    renderDetail(stillSelected || null);
  }

  return { refresh };
}

export const KARTE_TAB_HTML = `
  <div id="karte-view" hidden>
    <div class="karte-split">
      <div class="karte-map-col">
        <div class="card">
          <p class="hint" id="karte-status">Termine mit Ort werden geladen ...</p>
          <div id="map" style="height:560px;border-radius:var(--radius);"></div>
        </div>
      </div>
      <div class="karte-list-col">
        <div class="card" id="karte-detail-card">
          <p class="text-mute">Auf einen Marker oder Eintrag in der Liste klicken, um Details zu sehen.</p>
        </div>
        <div class="card">
          <h2 style="font-size:14px;margin:0 0 8px">Termine mit Standort</h2>
          <div id="karte-list"></div>
        </div>
      </div>
    </div>
  </div>
`;
