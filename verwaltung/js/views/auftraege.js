import { render as renderProjekte } from './projekte.js';

/** Eigene Seite: Projekte, aber nur Bereich "Aufträge" und "Wartungen & Prüfungen" (ohne Service). */
export async function render(container) {
  return renderProjekte(container, { bereichScope: ['auftrag', 'wartung'], titel: 'Aufträge & Wartungen' });
}
