// Lokale Landingpages. Jede Seite hat eigenständige Inhalte: individuelle
// Einleitung, Stadtteile, berechnete Entfernung/Anfahrtszone und eine
// begründete Auswahl an Leistungsschwerpunkten. Bewusst KEINE Stadt×Leistung-
// Matrix (Doorway-Pages) und keine erfundenen Projekte oder Bewertungen.
// Sobald echte, freigegebene Projektberichte vorliegen, werden sie hier je Stadt ergänzt.

export const ORTSSEITEN = [
  {
    slug: 'essen',
    intro: [
      'Essen ist unser Hauptstandort. Von hier aus erreichen wir alle Stadtbezirke – vom Essener Norden mit Altenessen, Karnap und Katernberg bis in den grünen Süden nach Werden, Kettwig und Bredeney.',
      'Gerade in den dicht bebauten Stadtteilen mit vielen Mehrfamilienhäusern verbinden wir Elektrotechnik, Renovierung und Objektbetreuung: Wer einen Hausmeisterservice beauftragt, hat für die Elektroprüfung bei Mieterwechsel und die anschließende Renovierung denselben Ansprechpartner.',
    ],
    stadtteile: ['Rüttenscheid', 'Holsterhausen', 'Frohnhausen', 'Altenessen', 'Borbeck', 'Frintrop', 'Steele', 'Kray', 'Schonnebeck', 'Stoppenberg', 'Katernberg', 'Karnap', 'Huttrop', 'Bredeney', 'Werden', 'Kettwig', 'Heisingen', 'Kupferdreh', 'Überruhr', 'Burgaltendorf'],
    schwerpunkte: ['elektro-reparatur-stoerung', 'e-check', 'hausmeisterservice', 'renovierung-mieterwechsel', 'bodenlegearbeiten', 'entruempelung'],
  },
  {
    slug: 'muelheim-an-der-ruhr',
    intro: [
      'Mülheim an der Ruhr grenzt im Südwesten direkt an Essen. Die Wege nach Saarn, Speldorf oder Heißen sind kurz, sodass auch kleinere Aufträge und kurzfristige Wartungstermine gut planbar sind.',
      'Für Eigentümer von Ein- und Zweifamilienhäusern bieten wir in Mülheim vor allem Wartung und Modernisierung an: Wärmepumpenwartung, Wallbox-Installation, Zählerschrank-Erneuerung sowie Bad- und Bodensanierungen.',
    ],
    stadtteile: ['Altstadt', 'Saarn', 'Speldorf', 'Broich', 'Heißen', 'Dümpten', 'Styrum', 'Menden', 'Holthausen', 'Winkhausen'],
    schwerpunkte: ['waermepumpenwartung', 'wallbox-ladeinfrastruktur', 'zaehlerschrank-unterverteilung', 'badsanierung', 'bodenlegearbeiten'],
  },
  {
    slug: 'oberhausen',
    intro: [
      'Oberhausen liegt westlich von Essen, erreichbar über A40 und A42. Wir sind in allen drei Stadtbezirken tätig – Alt-Oberhausen, Sterkrade und Osterfeld.',
      'Für Vermieter und Verwaltungen in Oberhausen kombinieren wir Wohnungsübergaben, Elektroprüfung, Renovierung und Entrümpelung zu einem Ablauf, damit Wohnungen zwischen zwei Mietverhältnissen nicht unnötig lange leer stehen.',
    ],
    stadtteile: ['Alt-Oberhausen', 'Sterkrade', 'Osterfeld', 'Holten', 'Schmachtendorf', 'Lirich', 'Styrum', 'Alstaden', 'Königshardt'],
    schwerpunkte: ['wohnungsuebergabe-mieterwechsel', 'renovierung-mieterwechsel', 'e-check', 'entruempelung'],
  },
  {
    slug: 'gelsenkirchen',
    intro: [
      'Gelsenkirchen grenzt nördlich an Essen. Von Buer im Norden bis Ückendorf und Rotthausen im Süden liegen alle Stadtteile innerhalb unserer kurzen Anfahrtszonen.',
      'In älteren Mehrfamilienhäusern entsprechen Elektroanlagen oft nicht mehr dem heutigen Bedarf – etwa ohne Fehlerstrom-Schutzschalter oder mit zu wenigen Stromkreisen. Neben Elektrosanierungen übernehmen wir hier Treppenhausreinigung, Hausmeisterdienste und Winterdienst für Mehrfamilienhäuser.',
    ],
    stadtteile: ['Altstadt', 'Buer', 'Horst', 'Erle', 'Resse', 'Hassel', 'Schalke', 'Bismarck', 'Ückendorf', 'Rotthausen', 'Bulmke-Hüllen', 'Scholven'],
    schwerpunkte: ['elektrosanierung', 'treppenhausreinigung', 'hausmeisterservice', 'winterdienst'],
  },
  {
    slug: 'bottrop',
    intro: [
      'Bottrop liegt nordwestlich von Essen und reicht mit Kirchhellen weit in den ländlicheren Norden. Damit gehören sowohl städtische Mehrfamilienhäuser als auch Einfamilienhäuser mit Garten zu unserem Einsatzgebiet.',
      'In Kirchhellen und Grafenwald sind Gartenpflege, Photovoltaik mit Speicher und Wallbox-Installationen typische Themen, in der Innenstadt Renovierung und Objektservice.',
    ],
    stadtteile: ['Stadtmitte', 'Eigen', 'Batenbrock', 'Boy', 'Fuhlenbrock', 'Vonderort', 'Welheim', 'Ebel', 'Kirchhellen', 'Grafenwald', 'Feldhausen'],
    schwerpunkte: ['photovoltaik-batteriespeicher', 'wallbox-ladeinfrastruktur', 'gartenpflege', 'wohnungssanierung'],
  },
  {
    slug: 'duisburg',
    intro: [
      'Duisburg ist die westlichste größere Stadt in unserem Kerngebiet. Wir fahren alle Bezirke an – von Walsum und Hamborn im Norden bis Huckingen im Süden sowie Rheinhausen und Homberg links des Rheins.',
      'Aufgrund der Entfernung planen wir Einsätze in Duisburg möglichst gebündelt. Für wiederkehrende Leistungen wie DGUV-V3-Prüfungen, Wartungen und Objektbetreuung legen wir feste Tourentage fest.',
    ],
    stadtteile: ['Altstadt', 'Neudorf', 'Duissern', 'Hochfeld', 'Meiderich', 'Ruhrort', 'Hamborn', 'Marxloh', 'Walsum', 'Rheinhausen', 'Homberg', 'Huckingen', 'Buchholz', 'Wedau'],
    schwerpunkte: ['dguv-v3-pruefung', 'gebaeudereinigung', 'hausmeisterservice', 'rueckbau-entkernung'],
  },
  {
    slug: 'bochum',
    intro: [
      'Bochum grenzt östlich an Essen; Wattenscheid liegt direkt an der Stadtgrenze zu Essen-Kray und -Leithe. Die übrigen Bochumer Stadtteile erreichen wir über A40 und A43.',
      'In Bochum bieten wir neben gewerblichen Prüf- und Wartungsleistungen vor allem Sanierungsprojekte in Bestandswohnungen, bei denen Elektro, Trockenbau und Boden ineinandergreifen.',
    ],
    stadtteile: ['Innenstadt', 'Wattenscheid', 'Ehrenfeld', 'Wiemelhausen', 'Weitmar', 'Linden', 'Dahlhausen', 'Langendreer', 'Querenburg', 'Gerthe', 'Riemke', 'Hamme'],
    schwerpunkte: ['dguv-v3-pruefung', 'komplettsanierung', 'trockenbau-innenausbau', 'klimaanlagenwartung'],
  },
  {
    slug: 'gladbeck',
    intro: [
      'Gladbeck liegt nördlich von Essen zwischen Bottrop und Gelsenkirchen. Die Stadt ist kompakt, sodass wir Termine in Zweckel, Rentfort oder Brauck gut mit Einsätzen in den Nachbarstädten verbinden können.',
      'Für Eigentümer und Vermieter in Gladbeck übernehmen wir Haushaltsauflösungen, Entrümpelungen und die anschließende Renovierung bis zur Neuvermietung.',
    ],
    stadtteile: ['Mitte', 'Zweckel', 'Rentfort', 'Brauck', 'Butendorf', 'Ellinghorst', 'Schultendorf', 'Rosenhügel'],
    schwerpunkte: ['haushaltsaufloesung', 'entruempelung', 'renovierung-mieterwechsel', 'elektro-reparatur-stoerung'],
  },
  {
    slug: 'recklinghausen',
    intro: [
      'Recklinghausen ist Kreisstadt des Kreises Recklinghausen und liegt am nordöstlichen Rand unseres Kerngebiets. Wir planen Einsätze hier bevorzugt gebündelt mit Aufträgen in Herten und Herne.',
      'Für Wohnanlagen und Gewerbeobjekte in Recklinghausen bieten wir Objektbetreuung mit festen Intervallen sowie Prüfung und Wartung elektrischer Anlagen an.',
    ],
    stadtteile: ['Altstadt', 'Hillerheide', 'Hochlarmark', 'Hillen', 'Ost', 'Süd', 'Suderwich', 'Speckhorn', 'Essel', 'König-Ludwig'],
    schwerpunkte: ['hausmeisterservice', 'dguv-v3-pruefung', 'waermepumpenwartung', 'gartenpflege'],
  },
  {
    slug: 'herne',
    intro: [
      'Herne liegt nordöstlich von Essen zwischen Gelsenkirchen und Bochum, inklusive des Stadtbezirks Wanne-Eickel. Die Anfahrt erfolgt über die A42 oder A43.',
      'Herne ist eine der am dichtesten besiedelten Städte Deutschlands. Für die vielen Mehrfamilienhäuser bieten wir Treppenhausreinigung, Hausmeisterdienste und Elektroprüfungen bei Mieterwechsel aus einer Hand.',
    ],
    stadtteile: ['Herne-Mitte', 'Wanne', 'Eickel', 'Sodingen', 'Holsterhausen', 'Horsthausen', 'Börnig', 'Baukau', 'Crange', 'Röhlinghausen'],
    schwerpunkte: ['treppenhausreinigung', 'hausmeisterservice', 'e-check', 'elektrosanierung'],
  },
  {
    slug: 'castrop-rauxel',
    intro: [
      'Castrop-Rauxel liegt östlich von Herne an der Grenze zu Dortmund und gehört zur äußeren Anfahrtszone unseres Einsatzgebiets. Einsätze planen wir deshalb mit etwas Vorlauf.',
      'Für Projekte mit planbarem Umfang – etwa Photovoltaik, Wallbox, Bad- oder Bodensanierungen – ist die Entfernung kein Hindernis.',
    ],
    stadtteile: ['Castrop', 'Rauxel', 'Habinghorst', 'Ickern', 'Henrichenburg', 'Frohlinde', 'Merklinde', 'Deininghausen', 'Schwerin', 'Bladenhorst'],
    schwerpunkte: ['photovoltaik-batteriespeicher', 'badsanierung', 'bodenlegearbeiten', 'wallbox-ladeinfrastruktur'],
  },
  {
    slug: 'velbert',
    intro: [
      'Velbert grenzt im Süden an Essen. Neben Velbert-Mitte gehören die Stadtbezirke Langenberg und Neviges mit ihren hügeligen, eher ländlich geprägten Lagen zu unserem Einsatzgebiet.',
      'Hier betreuen wir vor allem Eigentümer von Einfamilienhäusern: Wärmepumpenwartung, Elektrosanierung im Bestand, Smart-Home-Nachrüstung und Gartenpflege.',
    ],
    stadtteile: ['Velbert-Mitte', 'Langenberg', 'Neviges', 'Tönisheide', 'Birth', 'Losenburg'],
    schwerpunkte: ['waermepumpenwartung', 'elektrosanierung', 'smart-home-gebaeudeautomation', 'gartenpflege'],
  },
  {
    slug: 'hattingen',
    intro: [
      'Hattingen liegt südöstlich von Essen an der Ruhr, erreichbar über Essen-Burgaltendorf oder die A43. Die historische Altstadt und die Ortsteile Welper, Blankenstein und Niederwenigern gehören zu unserem Einsatzgebiet.',
      'In älteren Gebäuden ist eine sorgfältige Bestandsaufnahme vor Elektro- und Sanierungsarbeiten besonders wichtig. Wir übernehmen Elektrosanierungen, Bodenarbeiten und Renovierungen mit Rücksicht auf die vorhandene Bausubstanz.',
    ],
    stadtteile: ['Altstadt', 'Welper', 'Blankenstein', 'Holthausen', 'Niederwenigern', 'Bredenscheid', 'Winz-Baak', 'Niederbonsfeld'],
    schwerpunkte: ['elektrosanierung', 'bodenlegearbeiten', 'maler-tapezierarbeiten', 'waermepumpenwartung'],
  },
];
