import { render as renderProjekte } from './projekte.js';

/** Eigene Seite: Projekte, aber nur Bereich "Service" (Aufträge/Wartung haben eigene Reiter). */
export async function render(container) {
  return renderProjekte(container, { bereichScope: ['service'], titel: 'Service' });
}
