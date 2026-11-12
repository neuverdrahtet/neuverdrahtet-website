// Eigene Projektfotos (vom Inhaber bereitgestellt, Metadaten inkl. GPS entfernt).
// Bildunterschriften beschreiben nur, was zu sehen ist – keine erfundenen Orte,
// Kunden oder Projektdetails. Dateien: public/assets/img/projekte/<id>-klein|gross.webp
import { readFileSync } from 'node:fs';

const MASSE = JSON.parse(readFileSync(new URL('./foto-masse.json', import.meta.url), 'utf8'));

const LISTE = [
  { id: 'zaehlerschrank-verdrahtung', alt: 'Geöffneter Zählerschrank mit neu verdrahteten Unterverteilungen, Sammelschienen, Überspannungsschutz und drei Zählerplätzen', titel: 'Zählerschrank während der Verdrahtung', leistungen: ['zaehlerschrank-unterverteilung', 'elektroinstallation'] },
  { id: 'zaehlerschrank-fertig', alt: 'Fertig montierter, abgedeckter Zählerschrank mit beschrifteten Unterverteilungen und drei Zählern', titel: 'Zählerschrank nach Fertigstellung', leistungen: ['zaehlerschrank-unterverteilung', 'elektrosanierung', 'wallbox-ladeinfrastruktur'] },
  { id: 'pv-neubau-montage', alt: 'Photovoltaikanlage auf dem Dach eines Neubaus, Gerüst an der Fassade während der Montage', titel: 'PV-Anlage auf einem Neubau', leistungen: ['photovoltaik-batteriespeicher'] },
  { id: 'pv-einfamilienhaus-geruest', alt: 'Einfamilienhaus mit neu montierten Solarmodulen, Gerüst mit Absturzsicherung an der Traufe', titel: 'PV-Montage mit Gerüst und Absturzsicherung', leistungen: ['photovoltaik-batteriespeicher'] },
  { id: 'pv-einfamilienhaus', alt: 'Photovoltaikanlage auf dem Dach eines Einfamilienhauses bei blauem Himmel', titel: 'Fertige PV-Anlage', leistungen: ['photovoltaik-batteriespeicher'] },
  { id: 'pv-stehfalzdach-abend', alt: 'Photovoltaikanlage auf einem Stehfalz-Blechdach in der Abenddämmerung', titel: 'PV-Anlage auf Stehfalzdach', leistungen: ['photovoltaik-batteriespeicher'] },
  { id: 'pv-speicher-wechselrichter', alt: 'Hybrid-Wechselrichter mit modularen Batteriespeichern und zwei Überspannungsschutz-Gehäusen, Leitungen in weißen Kabelkanälen geführt', titel: 'Wechselrichter und Batteriespeicher', leistungen: ['photovoltaik-batteriespeicher'] },
  { id: 'elektro-leitungsfuehrung', alt: 'Rohbauwand mit sauber gebündelter Leitungsführung um eine Türöffnung und markierten Anschlusspunkten', titel: 'Leitungsführung in der Rohinstallation', leistungen: ['elektroinstallation', 'elektrosanierung'] },
  { id: 'elektro-kuechenwand', alt: 'Küchenwand im Rohbau mit eingezeichneten Positionen für Herd, Spüle und Schränke und neu verlegten Leitungen', titel: 'Küchenwand: Anschlüsse nach Planung', leistungen: ['elektroinstallation', 'komplettsanierung'] },
  { id: 'sanierung-wohnraum-rohbau', alt: 'Entkernter Wohnraum mit neuen Fenstern, frischen Leitungsschlitzen und Werkzeug der Elektroinstallation', titel: 'Elektrosanierung im entkernten Wohnraum', leistungen: ['elektrosanierung', 'wohnungssanierung'] },
  { id: 'sanierung-bad-rohbau', alt: 'Raum im Rohbauzustand mit Elektro-Rohinstallation, offener Decke und verpackter Badewanne zur Montage', titel: 'Rohbauphase vor dem Badausbau', leistungen: ['badsanierung', 'komplettsanierung'] },
  { id: 'rueckbau-decke-offen', alt: 'Entkernter Raum mit entfernter Deckenverkleidung, freiliegender Holzlattung und Dampfbremse', titel: 'Rückbau: Decke geöffnet', leistungen: ['rueckbau-entkernung', 'komplettsanierung', 'trockenbau-innenausbau'] },
  { id: 'boden-holzdielen-tuer', alt: 'Renovierter Raum mit dunklem Holzdielenboden, weißen Sockelleisten und Balkontür', titel: 'Dunkler Dielenboden mit Sockelleisten', leistungen: ['bodenlegearbeiten', 'wohnungssanierung', 'renovierung-mieterwechsel'] },
  { id: 'boden-holzdielen-fenster', alt: 'Heller Raum mit zwei bodentiefen Fenstern und durchgehend verlegtem dunklem Holzboden', titel: 'Bodenbelag nach der Renovierung', leistungen: ['bodenlegearbeiten', 'renovierung-mieterwechsel'] },
  { id: 'raum-strukturwand', alt: 'Renovierter Raum mit Strukturwand aus Wellenpaneelen, weißen Wänden und dunklem Holzboden', titel: 'Wandgestaltung und Boden', leistungen: ['bodenlegearbeiten', 'maler-tapezierarbeiten', 'trockenbau-innenausbau', 'wohnungssanierung'] },
  { id: 'bad-dusche', alt: 'Modernisiertes Duschbad mit weißen Wandfliesen, Falttüren-Duschabtrennung und Waschtisch mit Unterschrank', titel: 'Duschbad nach der Modernisierung', leistungen: ['badsanierung', 'fliesenarbeiten', 'wohnungssanierung'] },
  { id: 'bad-waschtisch', alt: 'Waschtisch vor gefliestem Vorwandelement mit Ablage, Spiegel mit Beleuchtung und Steckdosen außerhalb des Spritzbereichs', titel: 'Vorwand mit Ablage und Waschtisch', leistungen: ['badsanierung', 'fliesenarbeiten'] },
  { id: 'bad-wc', alt: 'Wand-WC vor weiß gefliester Vorwand, großformatige dunkle Bodenfliesen und Handtuchheizkörper', titel: 'Wand-WC und großformatige Bodenfliesen', leistungen: ['badsanierung', 'fliesenarbeiten'] },
  { id: 'bad-uebersicht', alt: 'Kompaktes Duschbad mit Waschtisch, Spiegel und Duschabtrennung aus Glas', titel: 'Kompaktes Duschbad', leistungen: ['badsanierung'] },
  { id: 'sanierung-verputzt', alt: 'Sanierter Raum mit glatt verputzten Wänden, gespachtelter Decke und gesetzten Elektrodosen', titel: 'Verputzt und bereit für Boden und Anstrich', leistungen: ['trockenbau-innenausbau', 'maler-tapezierarbeiten', 'wohnungssanierung'] },
];

export const FOTOS = LISTE.map((f) => ({ ...f, ...MASSE[f.id] }));
export const FOTO = Object.fromEntries(FOTOS.map((f) => [f.id, f]));

/** Vorher/Nachher desselben Raums. */
export const VORHER_NACHHER = {
  vorher: { id: 'sanierung-vorher', alt: 'Derselbe Raum vor der Sanierung: Rohwände mit Leitungen, offene Decke, Kleberreste auf dem Boden', ...MASSE['sanierung-vorher'] },
  nachher: { id: 'sanierung-nachher', alt: 'Derselbe Raum nach Elektro-, Putz- und Trockenbauarbeiten: glatte Wände, gespachtelte Decke, neue Fenster', ...MASSE['sanierung-nachher'] },
  titel: 'Ein Raum, zwei Zustände',
  text: 'Neue Elektroinstallation, Putz- und Trockenbauarbeiten aus einer Hand – vom entkernten Rohbau bis zur Übergabe für Boden und Anstrich.',
  leistungen: ['komplettsanierung', 'wohnungssanierung', 'trockenbau-innenausbau', 'elektrosanierung'],
};

/** Reihenfolge der Galerie auf Startseite und „Über uns“. */
export const GALERIE_START = ['zaehlerschrank-verdrahtung', 'pv-stehfalzdach-abend', 'bad-dusche', 'elektro-leitungsfuehrung', 'boden-holzdielen-tuer', 'pv-speicher-wechselrichter', 'zaehlerschrank-fertig', 'raum-strukturwand', 'rueckbau-decke-offen'];
