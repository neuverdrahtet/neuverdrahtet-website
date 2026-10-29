// Materialliste pro Auftrag (Projekt/Serviceauftrag) - eine Abhak-Checkliste
// für das benötigte Material, damit ein Techniker vor der Fahrt zum Einsatz
// sieht, was mitzunehmen ist.
//
// Zwei unterschiedliche Quellen, je nachdem ob eine Kalkulation vorliegt:
//  - Projekte haben über ihre(s) Angebot(e) echte Kalkulationspositionen -
//    die Materialliste wird daraus automatisch abgeleitet (sammleMaterial-
//    AusAngeboten/aktualisiereMaterialliste).
//  - Serviceaufträge haben KEINE Kalkulationsgrundlage (kein angebotId/
//    positionen-Feld im Datenmodell) - dort wird die Materialliste frei per
//    Text eingetragen (baueFreieMaterialliste/materiallisteAlsText), genau
//    wie die bestehende Checkliste in serviceauftraege.js
//    (baueChecklistenPunkte/checklistenPunkteAlsText).
//
// Beide Quellen landen im selben Format ({titel, erledigt, menge?, einheit?})
// und nutzen dieselbe Checkbox-Darstellung (renderMaterialChecklistHtml).
import { escapeHtml } from './utils.js';

/**
 * Fasst aus allen ANGENOMMENEN Angeboten eines Projekts die Material-
 * Positionen (Katalogartikel mit typ='artikel', keine Leistungen/Geräte)
 * zusammen. Mehrfach vorkommende Artikel (z.B. Haupt- + Nachtragsangebot)
 * werden mengenmäßig aufsummiert.
 */
export function sammleMaterialAusAngeboten(angebote, katalogById) {
  const summeByKatalogId = new Map();
  for (const angebot of angebote || []) {
    if (angebot.status !== 'angenommen') continue;
    for (const pos of angebot.positionen || []) {
      if (!pos.katalogId) continue;
      const artikel = katalogById?.[pos.katalogId];
      if (!artikel || artikel.typ !== 'artikel') continue;
      const menge = Number(pos.menge) || 0;
      const bisherige = summeByKatalogId.get(pos.katalogId);
      if (bisherige) bisherige.menge += menge;
      else {
        summeByKatalogId.set(pos.katalogId, {
          katalogId: pos.katalogId,
          titel: pos.bezeichnung || artikel.bezeichnung || 'Artikel',
          einheit: pos.einheit || artikel.einheit || '',
          menge,
        });
      }
    }
  }
  return [...summeByKatalogId.values()];
}

/**
 * Übernimmt eine frisch aus den Angeboten abgeleitete Materialliste in die
 * bestehende: bereits abgehakte Positionen (Abgleich über katalogId) bleiben
 * abgehakt, Positionen, die in der aktuellen Kalkulation nicht mehr
 * vorkommen, fallen weg (die Liste bildet immer den aktuellen Kalkulations-
 * stand ab).
 */
export function aktualisiereMaterialliste(bisherige, neueRohliste) {
  const erledigtByKatalogId = Object.fromEntries((bisherige || []).map((p) => [p.katalogId, !!p.erledigt]));
  return (neueRohliste || []).map((p) => ({ ...p, erledigt: !!erledigtByKatalogId[p.katalogId] }));
}

/**
 * Freie Texteingabe (eine Zeile = eine Position) -> Checkliste, für
 * Serviceaufträge ohne Kalkulationsgrundlage. Zeilen dürfen optional mit
 * "[x] "/"[ ] " beginnen (z.B. beim Zurückkopieren aus materiallisteAlsText).
 * Bereits abgehakte Positionen (Abgleich über den Titeltext) bleiben beim
 * Bearbeiten abgehakt.
 */
export function baueFreieMaterialliste(zeilenText, vorherigePositionen) {
  const vorherigeByTitel = Object.fromEntries((vorherigePositionen || []).map((p) => [p.titel, p]));
  return (zeilenText || '')
    .split('\n')
    .map((zeile) => zeile.replace(/^\[[xX ]?\]\s*/, '').trim())
    .filter(Boolean)
    .map((titel) => (vorherigeByTitel[titel] ? { ...vorherigeByTitel[titel] } : { titel, erledigt: false }));
}

/** Kehrfunktion zu baueFreieMaterialliste() - zum Vorbelegen des Textarea-Editors. */
export function materiallisteAlsText(positionen) {
  return (positionen || []).map((p) => `${p.erledigt ? '[x]' : '[ ]'} ${materialZeilenTitel(p)}`).join('\n');
}

function materialZeilenTitel(p) {
  if (!p.menge) return p.titel;
  return `${p.titel} (${p.menge}${p.einheit ? ` ${p.einheit}` : ''})`;
}

/**
 * Rendert eine Materialliste als Checkbox-Liste. Jede Checkbox trägt
 * data-index = Position in "positionen" (so wie übergeben, unsortiert) -
 * der aufrufende Code bindet den change-Handler und persistiert selbst
 * (siehe Verwendung in projekte.js/serviceauftraege.js).
 */
export function renderMaterialChecklistHtml(positionen, { checkboxClass = 'material-item-toggle' } = {}) {
  if (!positionen || !positionen.length) {
    return '<p class="text-mute">Keine Materialliste vorhanden.</p>';
  }
  return `
    <ul style="list-style:none;padding:0;margin:0">
      ${positionen.map((p, i) => `
        <li style="padding:3px 0">
          <label class="field-checkbox">
            <input type="checkbox" class="${checkboxClass}" data-index="${i}" ${p.erledigt ? 'checked' : ''}>
            <span${p.erledigt ? ' style="text-decoration:line-through;color:#888"' : ''}>${escapeHtml(materialZeilenTitel(p))}</span>
          </label>
        </li>
      `).join('')}
    </ul>
  `;
}
