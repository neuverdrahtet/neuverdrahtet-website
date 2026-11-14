// Zusammengefasster Navigationspunkt "Vorlagen & Katalog" (14.11.2026, auf
// Dannys Wunsch, Muster siehe tabbedView.js) - fasst Formulare, Artikel &
// Leistungen (Katalog) und Vorlagen als Reiter zusammen, jeweils mit dem
// unveränderten Original-View.
import { renderTabbedView } from '../tabbedView.js';
import { render as renderFormulare } from './formulare.js';
import { render as renderKatalog } from './katalog.js';
import { render as renderVorlagen } from './vorlagen.js';

const TABS = [
  { id: 'formulare', label: '📝 Formulare', render: (host) => renderFormulare(host) },
  { id: 'katalog', label: '🧾 Artikel & Leistungen', render: (host) => renderKatalog(host) },
  { id: 'vorlagen', label: '📑 Vorlagen', render: (host) => renderVorlagen(host) },
];

export async function render(container, route) {
  await renderTabbedView(container, route, { titel: 'Vorlagen & Katalog', tabs: TABS });
}
