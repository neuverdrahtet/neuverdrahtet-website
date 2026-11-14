// Zusammengefasster Navigationspunkt "Finanzen" (14.11.2026, auf Dannys
// Wunsch, Muster siehe tabbedView.js) - fasst Ausgaben, Buchhaltung und
// Auswertungen als Reiter zusammen, jeweils mit dem unveränderten
// Original-View. Zahlungsabgleich bewusst NICHT mit aufgenommen (von Danny
// nicht genannt, Route ohnehin aktuell auf [] gesetzt/ungenutzt - siehe
// ROUTE_ROLLEN.zahlungsabgleich in db.js).
import { renderTabbedView } from '../tabbedView.js';
import { render as renderAusgaben } from './ausgaben.js';
import { render as renderBuchhaltung } from './buchhaltung.js';
import { render as renderAuswertungen } from './auswertungen.js';

const TABS = [
  { id: 'ausgaben', label: '💸 Ausgaben', render: (host) => renderAusgaben(host) },
  { id: 'buchhaltung', label: '📊 Buchhaltung', render: (host) => renderBuchhaltung(host) },
  { id: 'auswertungen', label: '📈 Auswertungen', render: (host) => renderAuswertungen(host) },
];

export async function render(container, route) {
  await renderTabbedView(container, route, { titel: 'Finanzen', tabs: TABS });
}
