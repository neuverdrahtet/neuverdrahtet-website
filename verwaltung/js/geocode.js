// Geocoding via OpenStreetMap Nominatim (free, no API key). Please respect the
// usage policy (max ~1 req/s, no bulk geocoding): https://operations.osmfoundation.org/policies/nominatim/
let lastRequestAt = 0;

async function throttle() {
  const wait = 1100 - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export async function geocode(address) {
  if (!address?.trim()) return null;
  await throttle();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Geocoding fehlgeschlagen');
  const data = await res.json();
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}
