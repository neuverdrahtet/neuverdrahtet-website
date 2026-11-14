// Zusammengefasster Navigationspunkt "Aufträge & Service" (14.11.2026, auf
// Dannys Wunsch, Muster siehe tabbedView.js) - fasst Aufträge, Service-
// aufträge und Wartungen & Prüfungen als Reiter zusammen, jeweils mit dem
// unveränderten Original-View.
import { renderTabbedView } from '../tabbedView.js';
import { render as renderAuftraege } from './auftraege.js';
import { render as renderServiceauftraege } from './serviceauftraege.js';
import { render as renderWartung } from './wartung.js';

const TABS = [
  { id: 'auftraege', label: '🧰 Aufträge', render: (host) => renderAuftraege(host) },
  { id: 'serviceauftraege', label: '📦 Serviceaufträge', render: (host) => renderServiceauftraege(host) },
  { id: 'wartung', label: '🛡️ Wartungen & Prüfungen', render: (host) => renderWartung(host) },
];

export async function render(container, route) {
  await renderTabbedView(container, route, { titel: 'Aufträge & Service', tabs: TABS });
}
