import { put } from './db.js';
import { escapeHtml } from './utils.js';
import { geocode } from './geocode.js';
import { TERMIN_TYPEN } from './db.js';

function typInfo(typId) {
  return TERMIN_TYPEN.find((t) => t.id === typId) || TERMIN_TYPEN[0];
}

/**
 * Mounts a Leaflet map of Termine-with-Ort into `viewEl` (expects it to
 * contain #karte-status and #map). Returns a refresh() to call whenever the
 * tab becomes visible (re-geocodes anything not cached yet and redraws markers).
 */
export function mountKarte(viewEl, { termine, kundenById, settings }) {
  let mapInstance = null;

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

    const bounds = [];
    withCoords.forEach((t) => {
      const farbe = t.farbe || typInfo(t.typ).farbe;
      const marker = window.L.circleMarker([t.lat, t.lng], {
        radius: 8, color: farbe, fillColor: farbe, fillOpacity: 0.7, weight: 2,
      }).addTo(mapInstance);
      const kunde = kundenById[t.kundeId];
      marker.bindPopup(`
        <strong>${escapeHtml(t.titel)}</strong><br>
        ${(t.start || '').slice(0, 10)}${(t.start || '').slice(11, 16) ? ' ' + t.start.slice(11, 16) : ''}<br>
        ${kunde ? escapeHtml(kunde.firma) + '<br>' : ''}
        ${escapeHtml(t.ort)}
      `);
      bounds.push([t.lat, t.lng]);
    });
    if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }

  return { refresh };
}

export const KARTE_TAB_HTML = `
  <div id="karte-view" hidden>
    <div class="card">
      <p class="hint" id="karte-status">Termine mit Ort werden geladen ...</p>
      <div id="map" style="height:520px;border-radius:var(--radius);"></div>
    </div>
  </div>
`;
