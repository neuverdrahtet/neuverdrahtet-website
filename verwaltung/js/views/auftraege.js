import { render as renderProjekte } from './projekte.js';

/** Eigene Seite: Projekte, aber nur Bereich "Aufträge" (Service/Wartung haben eigene Reiter). */
export async function render(container) {
  return renderProjekte(container, { bereichScope: ['auftrag'], titel: 'Aufträge' });
}
