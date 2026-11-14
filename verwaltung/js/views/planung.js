// Zusammengefasster Navigationspunkt "Planung & Zeit" (14.11.2026, auf
// Dannys Wunsch, Muster siehe tabbedView.js) - fasst Plantafel, Termine,
// Aufgaben und Zeiterfassung als Reiter zusammen, jeweils mit dem
// unveränderten Original-View.
import { renderTabbedView } from '../tabbedView.js';
import { render as renderPlantafel } from './plantafel.js';
import { render as renderTermine } from './termineliste.js';
import { render as renderAufgaben } from './aufgaben.js';
import { render as renderZeiterfassung } from './zeiterfassung.js';

const TABS = [
  { id: 'plantafel', label: '🗓️ Plantafel', render: (host) => renderPlantafel(host) },
  { id: 'termine', label: '📋 Termine', render: (host) => renderTermine(host) },
  { id: 'aufgaben', label: '✅ Aufgaben', render: (host) => renderAufgaben(host) },
  { id: 'zeiterfassung', label: '⏱️ Zeiterfassung', render: (host) => renderZeiterfassung(host) },
];

export async function render(container, route) {
  await renderTabbedView(container, route, { titel: 'Planung & Zeit', tabs: TABS });
}
