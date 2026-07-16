/**
 * Näherungsweise Brutto-Netto-Berechnung für die Lohnabrechnung.
 *
 * WICHTIG: Dies ist KEINE zertifizierte Lohnsoftware und bildet NICHT den
 * amtlichen Programmablaufplan für die maschinelle Lohnsteuerberechnung
 * (§ 39b EStG) exakt ab. Steuerzonen-Koeffizienten, Beitragsbemessungsgrenzen
 * und SV-Sätze sind gerundete Näherungswerte und werden vom Gesetzgeber
 * jährlich angepasst. Vor Auszahlung, Lohnsteuer-Anmeldung oder
 * SV-Meldungen unbedingt von einem Steuerberater/Lohnbüro gegenprüfen
 * lassen.
 */

export const STEUERKLASSEN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

// Beitragsbemessungsgrenzen (Näherung, West, pro Monat)
const BBG_RV_AV_MONAT = 8050;
const BBG_KV_PV_MONAT = 5812;

// Näherung der Einkommensteuer-Zonenformel (§ 32a EStG), jährlich zu versteuerndes Einkommen
function estSteuerZonen(zvE) {
  if (zvE <= 11784) return 0;
  if (zvE <= 17005) {
    const y = (zvE - 11784) / 10000;
    return (922.98 * y + 1400) * y;
  }
  if (zvE <= 66760) {
    const y = (zvE - 17005) / 10000;
    return (181.19 * y + 2397) * y + 1025.38;
  }
  if (zvE <= 277825) return 0.42 * zvE - 10602.13;
  return 0.45 * zvE - 18936.88;
}

export function lohnsteuerMonat({ bruttoMonat, steuerklasse = 'I' }) {
  const bruttoJahr = Math.max(0, Number(bruttoMonat) || 0) * 12;
  let steuerJahr;
  switch (steuerklasse) {
    case 'II':
      steuerJahr = estSteuerZonen(Math.max(0, bruttoJahr - 4260));
      break;
    case 'III':
      steuerJahr = estSteuerZonen(bruttoJahr / 2) * 2;
      break;
    case 'V':
    case 'VI':
      // Grobe Näherung: kein Grundfreibetrag, deutlich höherer Effektivsatz als bei Klasse I.
      steuerJahr = estSteuerZonen(bruttoJahr) + bruttoJahr * 0.08;
      break;
    case 'I':
    case 'IV':
    default:
      steuerJahr = estSteuerZonen(bruttoJahr);
  }
  return Math.max(0, steuerJahr / 12);
}

export function soliMonat(lohnsteuerMonatBetrag) {
  const lohnsteuerJahr = lohnsteuerMonatBetrag * 12;
  const freigrenze = 19950; // Näherung, jährlich angepasst
  if (lohnsteuerJahr <= freigrenze) return 0;
  return (lohnsteuerJahr * 0.055) / 12;
}

export function kirchensteuerMonat(lohnsteuerMonatBetrag, satz) {
  return lohnsteuerMonatBetrag * (Number(satz) || 0);
}

export function svBeitraegeMonat({ bruttoMonat, kinderlos = false }) {
  const b = Math.max(0, Number(bruttoMonat) || 0);
  const bmRvAv = Math.min(b, BBG_RV_AV_MONAT);
  const bmKvPv = Math.min(b, BBG_KV_PV_MONAT);
  const rv = bmRvAv * 0.093;
  const av = bmRvAv * 0.013;
  const kv = bmKvPv * 0.082;
  const pv = bmKvPv * (kinderlos ? 0.024 : 0.018);
  return { rv, av, kv, pv, summe: rv + av + kv + pv };
}

export function berechneLohnabrechnung({ bruttoMonat, zulagen = 0, sonstigeAbzuege = 0, steuerklasse = 'I', kirchensteuerSatz = 0, kinderlos = false }) {
  const brutto = (Number(bruttoMonat) || 0) + (Number(zulagen) || 0);
  const lohnsteuer = lohnsteuerMonat({ bruttoMonat: brutto, steuerklasse });
  const soli = soliMonat(lohnsteuer);
  const kirchensteuer = kirchensteuerMonat(lohnsteuer, kirchensteuerSatz);
  const sv = svBeitraegeMonat({ bruttoMonat: brutto, kinderlos });
  const abzuegeGesamt = lohnsteuer + soli + kirchensteuer + sv.summe + (Number(sonstigeAbzuege) || 0);
  const netto = brutto - abzuegeGesamt;
  return { brutto, lohnsteuer, soli, kirchensteuer, sv, sonstigeAbzuege: Number(sonstigeAbzuege) || 0, abzuegeGesamt, netto };
}
