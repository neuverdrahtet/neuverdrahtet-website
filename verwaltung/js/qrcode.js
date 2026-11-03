import { loadZXing } from './vendorLoader.js';

/**
 * Rendert einen beliebigen Text-Payload als PNG-Data-URL. Nutzt ZXing
 * (bereits für GiroCode/Geräte-Kopplung vorinstalliert, siehe girocode.js/
 * views/geraete.js) - BrowserQRCodeSvgWriter liefert ein SVG-Element, das
 * hier über einen Canvas-Umweg zu PNG rasterisiert wird. Gibt null zurück,
 * wenn die QR-Bibliothek nicht geladen werden konnte oder die Erzeugung
 * fehlschlägt - der Aufrufer zeigt dann z.B. nur den reinen Text/Code an,
 * statt ganz abzubrechen.
 */
export async function renderQrPngDataUrl(payload, groesse = 240) {
  if (!payload) return null;
  try {
    await loadZXing();
    if (!window.ZXing) return null;
    const writer = new window.ZXing.BrowserQRCodeSvgWriter();
    const svg = writer.write(payload, groesse, groesse);
    const svgText = new XMLSerializer().serializeToString(svg);
    const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;

    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = groesse;
        canvas.height = groesse;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, groesse, groesse);
        ctx.drawImage(img, 0, 0, groesse, groesse);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = svgDataUrl;
    });
  } catch (err) {
    console.error('QR-Code konnte nicht erzeugt werden:', err);
    return null;
  }
}
