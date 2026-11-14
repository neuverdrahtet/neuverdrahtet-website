// Zusammengefasster Navigationspunkt "Dokumente" (14.11.2026, auf Dannys
// Wunsch, Muster siehe tabbedView.js) - fasst Angebote, Auftragsbestätigung,
// Rechnungen, Lieferscheine, Gutschriften, Briefe und Mahnungen als Reiter
// zusammen, jeweils mit dem unveränderten Original-View. Datei bewusst NICHT
// "dokumente.js" genannt - dieser Name ist bereits das gemeinsame Berichte-/
// Datei-Upload-Modul (siehe js/dokumente.js), keine Namenskollision gewollt.
import { renderTabbedView } from '../tabbedView.js';
import { render as renderAngebote } from './angebote.js';
import { render as renderAuftragsbestaetigung } from './auftragsbestaetigung.js';
import { render as renderRechnungen } from './rechnungen.js';
import { render as renderLieferscheine } from './lieferscheine.js';
import { render as renderGutschriften } from './gutschriften.js';
import { render as renderBriefe } from './briefe.js';
import { render as renderMahnungen } from './mahnungen.js';

const TABS = [
  { id: 'angebote', label: '📄 Angebote', render: (host) => renderAngebote(host) },
  { id: 'auftragsbestaetigung', label: '✅ Auftragsbestätigung', render: (host) => renderAuftragsbestaetigung(host) },
  { id: 'rechnungen', label: '💶 Rechnungen', render: (host) => renderRechnungen(host) },
  { id: 'lieferscheine', label: '📦 Lieferscheine', render: (host) => renderLieferscheine(host) },
  { id: 'gutschriften', label: '💳 Gutschriften', render: (host) => renderGutschriften(host) },
  { id: 'briefe', label: '✉️ Briefe', render: (host) => renderBriefe(host) },
  { id: 'mahnungen', label: '⚠️ Mahnungen', render: (host) => renderMahnungen(host) },
];

export async function render(container, route) {
  await renderTabbedView(container, route, { titel: 'Dokumente', tabs: TABS });
}
