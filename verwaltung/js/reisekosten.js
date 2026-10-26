// Service-/Techniker-/Personalverwaltung Phase 9: Reisekosten und
// Verpflegungspauschalen - gemeinsames Logikmodul, von der Büro-Ansicht
// (verwaltung/js/views/reisekosten.js) UND der Techniker-Ansicht
// (verwaltung/techniker/techniker.js, eigenes Mini-App) importiert, damit
// beide exakt dieselbe Berechnung verwenden.
//
// WICHTIG - Simulation only (Spezifikationsauflage): Diese Berechnung ist
// eine Orientierungshilfe auf Basis der gesetzlichen Verpflegungspauschalen
// (§9 Abs. 4a EStG) und der üblichen Kilometerpauschale (R 9.5 LStR). Sie
// löst KEINE automatische Auszahlung und KEINE Lohnabrechnung aus - beides
// bleibt vollständig manuell. Vor Verwendung in einer echten Gehalts-
// abrechnung ist eine rechtliche Prüfung durch Lohnbüro/Steuerberater
// erforderlich (siehe Hinweistext in der Oberfläche).
//
// Die Sätze selbst liegen NICHT als feste Konstante im Code (Spezifikations-
// auflage "keine dauerhaft unveränderlichen Konstanten"), sondern in der
// versionierten Collection "reisekostensaetze" (gueltigAb/gueltigBis) - nur
// admin darf dort einen neuen Satz anlegen, siehe firestore.rules.

export const REISEKOSTEN_STATUS = [
  { id: 'entwurf', titel: 'Entwurf' },
  { id: 'eingereicht', titel: 'Eingereicht' },
  { id: 'genehmigt', titel: 'Genehmigt' },
  { id: 'abgelehnt', titel: 'Abgelehnt' },
];

// Findet den am angegebenen Tag gültigen Satz (gueltigAb <= datum <=
// gueltigBis, wobei ein leeres gueltigBis "bis auf Weiteres" bedeutet).
// Bei mehreren passenden Sätzen (sollte nicht vorkommen, da Admin beim
// Anlegen eines neuen Satzes das gueltigBis des vorherigen setzen muss) wird
// der mit dem spätesten gueltigAb gewählt.
export function findeGueltigenSatz(saetze, datum) {
  const passend = (saetze || []).filter((s) => s.gueltigAb && s.gueltigAb <= datum && (!s.gueltigBis || datum <= s.gueltigBis));
  if (passend.length === 0) return null;
  return passend.reduce((a, b) => (b.gueltigAb > a.gueltigAb ? b : a));
}

// Berechnet die Verpflegungspauschale nach §9 Abs. 4a EStG für einen
// Abwesenheitszeitraum [von, bis) (datetime-Strings "YYYY-MM-DDTHH:MM"):
// - eintägige Reise (von und bis am selben Kalendertag): >8 Std. Abwesenheit
//   -> Satz für An-/Abreisetag, sonst 0.
// - mehrtägige Reise: erster und letzter Kalendertag je Satz für An-/
//   Abreisetag (unabhängig von der tatsächlichen Stundenzahl an diesen
//   Tagen - das schreibt das Gesetz so vor), jeder Tag DAZWISCHEN ist per
//   Definition ein voller Abwesenheitstag -> Satz für vollen Kalendertag.
// Der gültige Satz wird PRO TAG nachgeschlagen (selten, aber möglich: eine
// Reise überschneidet einen Satzwechsel).
export function berechneVerpflegungspauschale(von, bis, saetze) {
  if (!von || !bis) return { tage: [], gesamtBetrag: 0, fehlendeSaetze: [] };
  const vonDatum = von.slice(0, 10);
  const bisDatum = bis.slice(0, 10);
  const fehlendeSaetze = new Set();

  function satzFuer(datum) {
    const s = findeGueltigenSatz(saetze, datum);
    if (!s) fehlendeSaetze.add(datum);
    return s;
  }

  if (vonDatum === bisDatum) {
    const stunden = (new Date(bis).getTime() - new Date(von).getTime()) / 3600000;
    const satz = satzFuer(vonDatum);
    const anspruchsberechtigt = stunden > 8;
    const betrag = anspruchsberechtigt && satz ? satz.verpflegungAnUndAbreise : 0;
    return {
      tage: [{ datum: vonDatum, typ: anspruchsberechtigt ? 'eintaegig_ueber_8h' : 'eintaegig_bis_8h', stunden: Math.round(stunden * 10) / 10, betrag }],
      gesamtBetrag: betrag,
      fehlendeSaetze: [...fehlendeSaetze],
    };
  }

  const tage = [];
  let d = new Date(`${vonDatum}T00:00:00Z`);
  const bisD = new Date(`${bisDatum}T00:00:00Z`);
  while (d.getTime() <= bisD.getTime()) {
    const datum = d.toISOString().slice(0, 10);
    const istAnOderAbreise = datum === vonDatum || datum === bisDatum;
    const satz = satzFuer(datum);
    const betrag = satz ? (istAnOderAbreise ? satz.verpflegungAnUndAbreise : satz.verpflegungGanztag) : 0;
    tage.push({ datum, typ: istAnOderAbreise ? 'an_abreisetag' : 'voller_tag', betrag });
    d = new Date(d.getTime() + 86400000);
  }
  return { tage, gesamtBetrag: tage.reduce((sum, t) => sum + t.betrag, 0), fehlendeSaetze: [...fehlendeSaetze] };
}

// Kilometergeld: einfache Multiplikation mit dem zum Reisebeginn gültigen
// Satz - bewusst kein Tagesbezug (ein Kilometerstand wird einmalig für die
// gesamte Reise erfasst, nicht pro Tag).
export function berechneKilometergeld(kilometer, von, saetze) {
  if (!kilometer || !von) return 0;
  const satz = findeGueltigenSatz(saetze, von.slice(0, 10));
  if (!satz) return 0;
  return Math.round(Number(kilometer) * satz.kilometerpauschale * 100) / 100;
}
