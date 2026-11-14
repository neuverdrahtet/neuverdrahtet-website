// Zusammengefasster Navigationspunkt "Team & Mitarbeiter" (14.11.2026, auf
// Dannys Wunsch, Muster siehe tabbedView.js) - fasst Mitarbeiter, Teams &
// Kolonnen, Benefits & Gesamtkosten, Subunternehmer, Geräte & Flotten,
// Urlaub & Krankmeldung, Reisekosten und Performance & Bonus als Reiter
// zusammen, jeweils mit dem unveränderten Original-View.
import { renderTabbedView } from '../tabbedView.js';
import { render as renderMitarbeiter } from './mitarbeiter.js';
import { render as renderTeams } from './teams.js';
import { render as renderBenefits } from './benefits.js';
import { render as renderSubunternehmer } from './subunternehmer.js';
import { render as renderGeraete } from './geraete.js';
import { render as renderUrlaubsantraege } from './urlaubsantraege.js';
import { render as renderReisekosten } from './reisekosten.js';
import { render as renderPerformance } from './performance.js';

const TABS = [
  { id: 'mitarbeiter', label: '🧑‍🔧 Mitarbeiter', render: (host) => renderMitarbeiter(host) },
  { id: 'teams', label: '👥 Teams & Kolonnen', render: (host) => renderTeams(host) },
  { id: 'benefits', label: '🎁 Benefits & Gesamtkosten', render: (host) => renderBenefits(host) },
  { id: 'subunternehmer', label: '🤝 Subunternehmer', render: (host) => renderSubunternehmer(host) },
  { id: 'geraete', label: '🛠️ Geräte & Flotten', render: (host) => renderGeraete(host) },
  { id: 'urlaubsantraege', label: '🏖️ Urlaub & Krankmeldung', render: (host) => renderUrlaubsantraege(host) },
  { id: 'reisekosten', label: '🧳 Reisekosten', render: (host) => renderReisekosten(host) },
  { id: 'performance', label: '📈 Performance & Bonus', render: (host) => renderPerformance(host) },
];

export async function render(container, route) {
  await renderTabbedView(container, route, { titel: 'Team & Mitarbeiter', tabs: TABS });
}
