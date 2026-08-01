// Berechnung der linearen Abschreibung (AfA) für das Anlagenverzeichnis.
// Reine Rechenfunktionen ohne DOM-/Storage-Zugriff (siehe views/buchhaltung.js
// für die UI und journal.js für die daraus erzeugten Buchungssätze).
//
// Modell: lineare AfA nach § 7 Abs. 1 EStG, zeitanteilig (monatsgenau) im
// Anschaffungsjahr, Rest im letzten (Teil-)Jahr. Geringwertige Wirtschafts-
// güter (GWG) werden stattdessen im Anschaffungsjahr sofort in voller Höhe
// abgeschrieben. Kein Sammelposten-Verfahren, keine degressive AfA - deckt
// den praxisrelevanten Regelfall ab, ersetzt keine Steuerberatung.

function jahrVon(datum) {
  return Number(String(datum).slice(0, 4));
}
function monatVon(datum) {
  return Number(String(datum).slice(5, 7));
}
function runden(n) {
  return Math.round(n * 100) / 100;
}

/** Volle jährliche AfA (ohne Zeitanteil) - für Anzeigezwecke (z.B. Spalte
 * "jährliche AfA" im Anlagenverzeichnis), bevor überhaupt ein Plan berechnet wird. */
export function berechneJahresAfa(anlage) {
  const { anschaffungswertNetto = 0, nutzungsdauerJahre = 1, restwert = 0, gwg = false } = anlage;
  const abzuschreibenderBetrag = Math.max(0, anschaffungswertNetto - restwert);
  if (gwg) return runden(abzuschreibenderBetrag);
  if (!nutzungsdauerJahre || nutzungsdauerJahre <= 0) return 0;
  return runden(abzuschreibenderBetrag / nutzungsdauerJahre);
}

/** Berechnet den vollständigen Abschreibungsplan (ein Eintrag je Kalenderjahr)
 * vom Anschaffungsjahr bis einschließlich dem Jahr von `bisDatum` - oder bis
 * die Nutzungsdauer bzw. `anlage.ausgeschiedenAm` erreicht ist, je nachdem,
 * was zuerst eintritt. Im Jahr des Ausscheidens wird der komplette
 * verbleibende Restbuchwert auf einmal abgeschrieben (vereinfachtes Modell,
 * keine Buchgewinn-/Buchverlust-Ermittlung). */
export function berechneAbschreibungsplan(anlage, bisDatum) {
  const {
    anschaffungsdatum, anschaffungswertNetto = 0, nutzungsdauerJahre = 1,
    restwert = 0, gwg = false, ausgeschiedenAm = '',
  } = anlage;
  if (!anschaffungsdatum || !anschaffungswertNetto) return [];

  const anschaffungsjahr = jahrVon(anschaffungsdatum);
  const anschaffungsmonat = monatVon(anschaffungsdatum);
  const bisJahr = jahrVon(bisDatum || anschaffungsdatum);
  const abzuschreibenderBetrag = Math.max(0, anschaffungswertNetto - restwert);
  const ausscheidenJahr = ausgeschiedenAm ? jahrVon(ausgeschiedenAm) : null;

  if (gwg) {
    if (bisJahr < anschaffungsjahr) return [];
    const betrag = runden(abzuschreibenderBetrag);
    return [{ jahr: anschaffungsjahr, monate: 12, betrag, kumuliert: betrag, restbuchwert: runden(restwert) }];
  }
  if (!nutzungsdauerJahre || nutzungsdauerJahre <= 0) return [];

  const gesamtMonate = Math.round(nutzungsdauerJahre * 12);
  const jahresAfaVoll = abzuschreibenderBetrag / nutzungsdauerJahre;
  const monateErstesJahr = Math.min(13 - anschaffungsmonat, gesamtMonate);

  const plan = [];
  let jahr = anschaffungsjahr;
  let monate = monateErstesJahr;
  let restMonate = gesamtMonate - monateErstesJahr;
  let kumuliert = 0;

  while (monate > 0) {
    if (jahr > bisJahr) break;
    const istAusscheidenJahr = ausscheidenJahr !== null && jahr >= ausscheidenJahr;
    const letztesPlanJahr = restMonate <= 0;

    const betrag = istAusscheidenJahr || letztesPlanJahr
      ? runden(abzuschreibenderBetrag - kumuliert)
      : runden(jahresAfaVoll * (monate / 12));
    kumuliert = runden(kumuliert + betrag);

    plan.push({ jahr, monate, betrag, kumuliert, restbuchwert: runden(anschaffungswertNetto - kumuliert) });

    if (istAusscheidenJahr || letztesPlanJahr) break;
    jahr += 1;
    monate = Math.min(12, restMonate);
    restMonate -= monate;
  }

  return plan;
}

/** Restbuchwert einer Anlage zu einem Stichtag (Bequemlichkeits-Wrapper um
 * berechneAbschreibungsplan - für Listen-/KPI-Anzeigen im Anlagenverzeichnis). */
export function aktuellerRestbuchwert(anlage, datum) {
  const plan = berechneAbschreibungsplan(anlage, datum);
  if (!plan.length) return anlage.anschaffungswertNetto || 0;
  return plan[plan.length - 1].restbuchwert;
}
