import { render as renderProjekte } from './projekte.js';

/** Eigene Seite: Projekte, aber nur Bereich "Wartungen & Prüfungen" (Aufträge/Service haben eigene Reiter). */
export async function render(container) {
  return renderProjekte(container, { bereichScope: ['wartung'], titel: 'Wartungen & Prüfungen' });
}
