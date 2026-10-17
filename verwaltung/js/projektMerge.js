import { getAll, put } from './db.js';

// Sammlungen, die ein Projekt per projektId referenzieren - beim Zusammenlegen
// zweier Projekte (Kanban: "Doppelte Anfragen prüfen", Projekte-Liste:
// "Duplikate zusammenführen") müssen diese Verweise auf das behaltene Projekt
// umgehängt werden, sonst würden z.B. Termine/Angebote am gelöschten
// Duplikat "hängen bleiben" und aus der Akte verschwinden. Eine gemeinsame
// Liste/Funktion für beide Merge-Wege, damit sie nicht wie bisher getrennt
// gepflegt werden und dabei auseinanderlaufen (eine Seite kannte z.B.
// "verwendungen" nicht, die andere hängte "dokumente" fälschlich über
// projektId statt bezugTyp/bezugId um, wodurch Dokumente beim Zusammenlegen
// über Kanban nie umgehängt wurden).
export const PROJEKT_REFERENZ_STORES = [
  'termine', 'aufgaben', 'emails', 'angebote', 'auftragsbestaetigungen', 'rechnungen',
  'mahnungen', 'ausgaben', 'zeiterfassung', 'verwendungen', 'fotos', 'aufmasse', 'nachrichten',
];

/** Hängt alle Verweise von alteProjektId auf neueProjektId um - über alle oben gelisteten Stores plus Dokumente (eigenes bezugTyp/bezugId-Schema). */
export async function verschiebeProjektReferenzen(alteProjektId, neueProjektId) {
  for (const store of PROJEKT_REFERENZ_STORES) {
    const rows = await getAll(store);
    const betroffen = rows.filter((r) => r.projektId === alteProjektId);
    for (const row of betroffen) {
      await put(store, { ...row, projektId: neueProjektId });
    }
  }
  const dokumente = await getAll('dokumente');
  const betroffeneDokumente = dokumente.filter((d) => d.bezugTyp === 'projekt' && d.bezugId === alteProjektId);
  for (const d of betroffeneDokumente) {
    await put('dokumente', { ...d, bezugId: neueProjektId });
  }
}
