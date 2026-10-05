import { getSettings } from '../db.js';
import { renderDokumenteSection, FIRMA_DOKUMENT_KATEGORIEN } from '../dokumente.js';

/**
 * Eigenständiger Reiter für allgemeine Geschäftsbriefe/-dokumente, die nicht
 * an einen bestimmten Kunden oder ein Projekt gebunden sind (z.B. an Behörden,
 * Lieferanten oder für interne Zwecke) - nutzt dieselbe "Bericht aus
 * Vorlage"-Funktion wie die Dokumente-Sektion einer Kundenakte, nur mit einem
 * eigenen, von Kunden/Projekten unabhängigen Ablage-Ort ('firma'/'allgemein').
 * Ein Brief zu einem bestimmten Kunden lässt sich weiterhin direkt in dessen
 * Kundenakte erstellen, dort bleibt er zusammen mit dessen anderen Unterlagen.
 */
export async function render(container) {
  const settings = await getSettings();
  container.innerHTML = `
    <div class="view-header">
      <h1>Briefe</h1>
    </div>
    <p class="hint">Allgemeine Geschäftsbriefe und Dokumente ohne Bezug zu einem bestimmten Kunden/Projekt. Einen Brief zu einem Kunden erstellst du weiterhin direkt in dessen Kundenakte unter "Dokumente" - dort bleibt er zusammen mit dessen übrigen Unterlagen.</p>
    <div id="dok-host"></div>
  `;
  renderDokumenteSection(container.querySelector('#dok-host'), 'firma', 'allgemein', {
    kategorien: FIRMA_DOKUMENT_KATEGORIEN,
    title: 'Briefe & allgemeine Dokumente',
    berichtContext: { settings, kunde: null, projekt: '' },
  });
}
