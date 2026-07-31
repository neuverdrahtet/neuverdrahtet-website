// Lädt die nicht als ES-Module verpackten Vendor-Bibliotheken erst bei
// tatsächlichem Bedarf nach, statt sie wie bisher blockierend auf jeder
// Seite mitzuladen. xlsx (860KB+), Leaflet und ZXing werden jeweils nur in
// einem einzigen, seltenen Feature gebraucht (Katalog-Import/-Export,
// Kartenansicht, QR/Barcode-Scanner) - vorher mussten alle drei komplett
// heruntergeladen sein, bevor main.js überhaupt anfangen konnte zu laden.

const cache = new Map();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Konnte ${src} nicht laden.`));
    document.head.appendChild(el);
  });
}

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Konnte ${href} nicht laden.`));
    document.head.appendChild(el);
  });
}

export function loadXlsx() {
  if (!cache.has('xlsx')) {
    cache.set('xlsx', window.XLSX ? Promise.resolve() : loadScript('js/vendor/xlsx.full.min.js'));
  }
  return cache.get('xlsx');
}

export function loadLeaflet() {
  if (!cache.has('leaflet')) {
    cache.set('leaflet', window.L ? Promise.resolve() : Promise.all([
      loadStylesheet('js/vendor/leaflet/leaflet.css'),
      loadScript('js/vendor/leaflet/leaflet.js'),
    ]));
  }
  return cache.get('leaflet');
}

export function loadZXing() {
  if (!cache.has('zxing')) {
    cache.set('zxing', window.ZXing ? Promise.resolve() : loadScript('js/vendor/zxing/zxing.min.js'));
  }
  return cache.get('zxing');
}

export function loadJsPdf() {
  if (!cache.has('jspdf')) {
    cache.set('jspdf', window.jspdf ? Promise.resolve() : loadScript('js/vendor/jspdf.umd.min.js')
      .then(() => loadScript('js/vendor/jspdf.plugin.autotable.min.js')));
  }
  return cache.get('jspdf');
}
