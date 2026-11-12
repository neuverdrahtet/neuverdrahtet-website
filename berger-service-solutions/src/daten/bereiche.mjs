// Die vier Geschäftsbereiche und die Prozessmodelle (Abschnitt 2 und 8 der Projektanweisung).

export const BEREICHE = [
  {
    id: 'elektro',
    slug: 'elektrotechnik',
    name: 'Elektrotechnik, Prüfung & Wartung',
    kurzname: 'Elektrotechnik',
    icon: 'blitz',
    title: 'Elektriker in Essen: Installation, Prüfung & Wartung',
    description: 'Elektroinstallation, Elektrosanierung, DGUV-V3-Prüfung, E-Check, Wärmepumpen- und Klimawartung, PV, Wallbox und Smart Home in Essen und 50 km Umkreis.',
    h1: 'Elektrotechnik, Prüfung und Wartung in Essen und im Ruhrgebiet',
    kurz: 'Installation, Sanierung, Reparatur, Prüfungen nach DGUV V3 und DIN VDE, Wartung von Wärmepumpen und Klimaanlagen, PV, Wallbox, Smart Home.',
    intro: [
      'Elektrische Anlagen müssen sicher funktionieren – im Einfamilienhaus genauso wie im Mehrfamilienhaus, im Büro oder im Gewerbebetrieb. Wir planen und installieren neue Anlagen, modernisieren bestehende Installationen und prüfen elektrische Anlagen und Betriebsmittel nach den einschlägigen Vorschriften.',
      'Prüf- und Wartungsleistungen wie DGUV-V3-Prüfung, E-Check, Wärmepumpen- oder Klimaanlagenwartung können Sie direkt online buchen. Für Installations- und Sanierungsprojekte vereinbaren wir zunächst eine Besichtigung und erstellen ein schriftliches Angebot.',
    ],
    zielgruppen: ['Eigentümer und Vermieter', 'Hausverwaltungen und WEG', 'Gewerbe, Büros und Praxen', 'Mieter (nach Absprache mit dem Vermieter)'],
  },
  {
    id: 'handwerk',
    slug: 'handwerk-sanierung',
    name: 'Handwerk, Renovierung & Sanierung',
    kurzname: 'Handwerk & Sanierung',
    icon: 'kelle',
    title: 'Renovierung & Sanierung in Essen: Bad, Boden, Innenausbau',
    description: 'Komplett- und Wohnungssanierung, Bad, Fliesen, Maler- und Trockenbauarbeiten sowie Bodenlegearbeiten in Essen und Umgebung – koordiniert aus einer Hand.',
    h1: 'Handwerk, Renovierung und Sanierung aus einer Hand',
    kurz: 'Komplett- und Wohnungssanierung, Bad, Fliesen, Maler- und Trockenbauarbeiten, Innenausbau, Renovierung bei Mieterwechsel und Bodenlegearbeiten.',
    intro: [
      'Eine Sanierung berührt fast immer mehrere Gewerke: Elektro, Trockenbau, Fliesen, Boden, Malerarbeiten. Wir koordinieren diese Arbeiten in einer sinnvollen Reihenfolge, damit Termine ineinandergreifen und Sie einen festen Ansprechpartner haben.',
      'Jedes Projekt beginnt mit einer Besichtigung und einem Aufmaß. Danach erhalten Sie eine nachvollziehbare Kalkulation und ein schriftliches Angebot. Gewerke, die eine besondere handwerksrechtliche Berechtigung erfordern, führen wir nur im Rahmen unserer Eintragungen oder mit qualifizierten Partnerbetrieben aus – das legen wir im Angebot offen.',
    ],
    zielgruppen: ['Eigentümer von Wohnungen und Häusern', 'Vermieter und Hausverwaltungen', 'Gewerbliche Mieter und Eigentümer'],
  },
  {
    id: 'objekt',
    slug: 'hausmeisterservice-objektservice',
    name: 'Hausmeister- & Objektservice',
    kurzname: 'Hausmeister & Objektservice',
    icon: 'haus',
    title: 'Hausmeisterservice & Objektbetreuung in Essen und Umgebung',
    description: 'Hausmeisterservice, Objektbetreuung, Treppenhaus- und Gebäudereinigung, Gartenpflege und Winterdienst für Wohn- und Gewerbeimmobilien in Essen.',
    h1: 'Hausmeister- und Objektservice für Wohn- und Gewerbeimmobilien',
    kurz: 'Hausmeisterservice, technische Objektbetreuung, Reinigung, Gartenpflege, Winterdienst, Wohnungsübergaben und regelmäßige Betreuungsverträge.',
    intro: [
      'Ein Objekt bleibt nur dann in gutem Zustand, wenn regelmäßig jemand hinschaut. Wir übernehmen Objektkontrollen, Reinigung, Grünpflege, Winterdienst und Kleinreparaturen – als Einzelauftrag oder als fester Betreuungsvertrag mit wiederkehrenden Einsätzen.',
      'Jeder Einsatz wird mit Checkliste und digitalem Leistungsnachweis dokumentiert. Hausverwaltungen und Eigentümer sehen so jederzeit, was wann erledigt wurde. Technische Mängel, die wir bei Kontrollen feststellen, melden wir mit Foto – und können sie als Elektro- und Handwerksbetrieb häufig direkt beheben.',
    ],
    zielgruppen: ['Hausverwaltungen und WEG-Verwalter', 'Private Vermieter von Mehrfamilienhäusern', 'Eigentümer von Gewerbeimmobilien', 'Büros, Praxen und Gewerbebetriebe'],
  },
  {
    id: 'rueckbau',
    slug: 'entruempelung-rueckbau',
    name: 'Rückbau, Entrümpelung & Haushaltsauflösung',
    kurzname: 'Entrümpelung & Rückbau',
    icon: 'kiste',
    title: 'Entrümpelung, Haushaltsauflösung & Rückbau in Essen',
    description: 'Wohnungs-, Keller- und Gewerbeentrümpelung, Haushaltsauflösung, Rückbau, Demontage und Entkernung mit fachgerechter Entsorgung und besenreiner Übergabe.',
    h1: 'Entrümpelung, Haushaltsauflösung und Rückbau',
    kurz: 'Entrümpelungen, Haushalts- und Wohnungsauflösungen, Rückbau, Demontage und Entkernung – mit fachgerechter Entsorgung und dokumentierter Übergabe.',
    intro: [
      'Ob Kellerraum, komplette Wohnung oder Gewerbefläche: Wir räumen, demontieren und entsorgen fachgerecht und übergeben die Räume besenrein. Auf Wunsch bereiten wir die Wohnung anschließend direkt für die Renovierung und Neuvermietung vor.',
      'Am Anfang stehen Fotos oder eine Besichtigung. Daraus ermitteln wir Mengen und Entsorgungswege und erstellen ein schriftliches Angebot. Entsorgungsnachweise und ein Übergabeprotokoll erhalten Sie nach Abschluss der Arbeiten.',
    ],
    zielgruppen: ['Privatpersonen und Erbengemeinschaften', 'Vermieter und Hausverwaltungen', 'Betreuer und Nachlassverwalter', 'Gewerbebetriebe'],
  },
];

export const PROZESSE = {
  wartung: {
    name: 'Wartung und Prüfung',
    schritte: [
      ['Online-Buchung', 'Sie wählen Leistung, Einsatzadresse und einen Wunschtermin. Das Einsatzgebiet wird sofort geprüft.'],
      ['Terminbestätigung', 'Nach dem Abgleich mit unserem Kalender bestätigen wir den Termin per E-Mail und auf Wunsch per WhatsApp.'],
      ['Durchführung', 'Prüfung oder Wartung vor Ort nach Checkliste, mit kalibrierten Messgeräten bzw. nach Herstellervorgaben.'],
      ['Dokumentation und Prüfbericht', 'Messwerte, Mängel und Fotos werden digital erfasst. Sie erhalten einen Prüf- bzw. Wartungsbericht.'],
      ['Rechnung', 'Die Rechnung wird auf Basis der dokumentierten Leistung erstellt.'],
      ['Wiederholungstermin', 'Wir erinnern Sie rechtzeitig an die nächste fällige Prüfung oder Wartung.'],
    ],
  },
  service: {
    name: 'Reparatur und Störungsbeseitigung',
    schritte: [
      ['Termin buchen', 'Sie beschreiben die Störung, laden auf Wunsch Fotos hoch und wählen einen Wunschtermin.'],
      ['Bestätigung', 'Wir bestätigen den Termin und melden uns bei Rückfragen telefonisch.'],
      ['Fehlersuche vor Ort', 'Systematische Fehlersuche mit Messtechnik.'],
      ['Reparatur oder Angebot', 'Kleinere Reparaturen erledigen wir direkt. Größere Arbeiten bieten wir separat an.'],
      ['Dokumentation und Rechnung', 'Arbeitszeit, Material und Messergebnisse werden dokumentiert und abgerechnet.'],
    ],
  },
  handwerk: {
    name: 'Handwerk und Sanierung',
    schritte: [
      ['Anfrage', 'Sie beschreiben Ihr Vorhaben und senden gern Fotos oder Pläne mit.'],
      ['Besichtigung und Aufmaß', 'Wir sehen uns die Situation vor Ort an und nehmen Maße und Bestand auf.'],
      ['Kalkulation und Angebot', 'Sie erhalten ein schriftliches, nachvollziehbares Angebot mit Leistungspositionen.'],
      ['Auftragsfreigabe', 'Nach Ihrer Freigabe planen wir Termine und Gewerkefolge.'],
      ['Materialplanung', 'Material wird bestellt und auf den Bauablauf abgestimmt.'],
      ['Durchführung und Dokumentation', 'Ausführung mit fotografischer Baustellendokumentation.'],
      ['Abnahme', 'Gemeinsame Abnahme mit Protokoll.'],
      ['Rechnung', 'Abschlags- und Schlussrechnung entsprechend Angebot und Baufortschritt.'],
    ],
  },
  objekt: {
    name: 'Hausmeister- und Objektservice',
    schritte: [
      ['Anfrage oder Objektbegehung', 'Wir lernen das Objekt kennen und nehmen die gewünschten Leistungen auf.'],
      ['Leistungsverzeichnis und Angebot', 'Leistungen, Intervalle und Zuständigkeiten werden schriftlich festgelegt.'],
      ['Einzelauftrag oder Vertrag', 'Einmaliger Einsatz oder Betreuungsvertrag mit festen Intervallen.'],
      ['Wiederkehrende Einsatzplanung', 'Termine werden automatisch geplant und Mitarbeitern zugewiesen.'],
      ['Durchführung nach Checkliste', 'Jeder Einsatz folgt einer objektbezogenen Checkliste.'],
      ['Digitaler Leistungsnachweis', 'Datum, Uhrzeit, erledigte Punkte und Fotos werden dokumentiert.'],
      ['Regelmäßige Abrechnung', 'Abrechnung monatlich, quartalsweise oder je Einsatz – wie vereinbart.'],
    ],
  },
  rueckbau: {
    name: 'Rückbau und Entrümpelung',
    schritte: [
      ['Anfrage mit Fotos', 'Fotos der Räume helfen uns, den Umfang realistisch einzuschätzen.'],
      ['Besichtigung', 'Bei größeren Objekten sehen wir uns alles vor Ort an.'],
      ['Mengenermittlung', 'Volumen, Materialarten und Zugangssituation werden erfasst.'],
      ['Entsorgungskalkulation und Angebot', 'Sie erhalten ein schriftliches Angebot inklusive Entsorgungswegen.'],
      ['Durchführung', 'Räumung, Demontage und Abtransport zum vereinbarten Termin.'],
      ['Entsorgungsnachweise', 'Wiege- bzw. Entsorgungsbelege werden der Auftragsakte zugeordnet.'],
      ['Dokumentierte Übergabe', 'Besenreine Übergabe mit Fotoprotokoll.'],
    ],
  },
};
