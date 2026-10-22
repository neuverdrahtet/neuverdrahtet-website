// Automatische Verbuchung von bezahlten Rechnungen und erfassten Ausgaben als
// echte Buchungssätze (doppelte Buchführung, Kern-Kontenplan siehe db.js
// DEFAULT_KONTEN). Bewusst vereinfacht: pro Vorgang werden bis zu zwei
// Buchungssätze erzeugt (Netto-Betrag + Steuer-Betrag als eigene Zeile) statt
// eines mehrzeiligen Buchungssatzes - hält das Datenmodell (ein Soll-/ein
// Haben-Konto pro Buchungssatz) simpel, ergibt im Kontenblatt aber trotzdem
// den korrekten Saldo. Ersetzt keine Steuerberatung.
import { getAll, put, remove } from './db.js';
import { uid } from './utils.js';
import { berechneAbschreibungsplan } from './abschreibung.js';

function findKonto(konten, id, nummer) {
  return konten.find((k) => k.id === id) || (nummer ? konten.find((k) => k.nummer === nummer) : null) || null;
}

function effektiverSteuersatz(netto, steuer) {
  if (!netto) return 19;
  const satz = Math.round((steuer / netto) * 100);
  return satz === 7 ? 7 : 19;
}

function bankOderKasse(konten, settings, zahlungsart) {
  const id = zahlungsart === 'bar' ? settings.kontoKasseId : settings.kontoBankId;
  const fallbackNummer = zahlungsart === 'bar' ? '1000' : '1200';
  return findKonto(konten, id, fallbackNummer);
}

/** Summe der gegen diese Rechnung verrechneten Gutschriften (siehe
 * verrechneteGutschriften, gesetzt in rechnungen.js) - einzige Quelle dieser
 * Summe, analog zu effektivErhaltenerBetrag unten. */
export function summeVerrechneterGutschriften(r) {
  return (r?.verrechneteGutschriften || []).reduce((s, v) => s + (v.betrag || 0), 0);
}

/** Tatsächlich über Bank/Kasse erhaltener Netto-/USt.-/Brutto-Anteil einer
 * bezahlten oder teilbezahlten Rechnung - berücksichtigt einen Skonto-Abzug,
 * eine erfasste Teilzahlung UND einen per Gutschrift bereits anderweitig
 * verrechneten Anteil (der NICHT über Bank/Kasse läuft, siehe
 * erzeugeBuchungenFuerRechnung unten - sonst würde eine per Gutschrift
 * (teil-)ausgeglichene Rechnung fälschlich den vollen Betrag als Bank-/
 * Kasseneingang verbuchen, obwohl tatsächlich weniger oder gar kein Geld
 * geflossen ist - das würde sowohl den Bankkontensaldo als auch den
 * Kontenabgleich (zahlungsabgleich.js) verfälschen). Einzige Quelle dieser
 * Berechnung (wird sowohl von erzeugeBuchungenFuerRechnung unten als auch
 * von cash-basis-Auswertungen wie der Buchhaltung-Übersicht/dem Dashboard
 * verwendet), damit eine Rechnung überall denselben tatsächlich
 * eingegangenen Betrag zeigt wie die daraus erzeugten Buchungssätze. */
export function effektivErhaltenerBetrag(r) {
  const gutschriftSumme = summeVerrechneterGutschriften(r);
  if (r.status === 'teilbezahlt') {
    // teilzahlungBetrag soll der tatsächlich über Bank/Kasse eingegangene
    // Betrag sein, unabhängig von einer zusätzlich verrechneten Gutschrift
    // (die eigene, separate Buchungszeilen weiter unten erzeugt) - diese
    // beiden Reduzierungen sind additiv gedacht (siehe offenerRestbetrag in
    // utils.js). Das ist aber NICHT an jeder Eingabestelle erzwungen (z.B.
    // der einfache window.prompt-Schnelleditor in rechnungen.js kennt keine
    // Gutschriften) - deshalb hier als Sicherheitsnetz hart gekappt: die
    // Summe aus Teilzahlung und Gutschrift darf den Bruttobetrag nie
        // übersteigen, sonst würde über 100% des Rechnungsbetrags verbucht.
    const teilbetrag = Math.max(0, Math.min(r.teilzahlungBetrag || 0, (r.brutto || 0) - gutschriftSumme));
    if (!teilbetrag || !r.brutto) return { netto: 0, steuer: 0, brutto: 0, textZusatz: ' (Teilzahlung)' };
    const faktor = Math.min(teilbetrag / r.brutto, 1);
    return {
      netto: Math.round(r.netto * faktor * 100) / 100,
      steuer: Math.round(r.steuer * faktor * 100) / 100,
      brutto: Math.round(teilbetrag * 100) / 100,
      textZusatz: ' (Teilzahlung)',
    };
  }
  if (r.status === 'bezahlt') {
    const bankBrutto = Math.max(0, (r.brutto || 0) - gutschriftSumme);
    if (bankBrutto <= 0) {
      return { netto: 0, steuer: 0, brutto: 0, textZusatz: gutschriftSumme > 0 ? ' (vollständig per Gutschrift ausgeglichen)' : '' };
    }
    const bankFaktor = r.brutto ? bankBrutto / r.brutto : 1;
    if (r.skontoGenutzt && r.skontoProzent > 0) {
      // Genutztes Skonto mindert nach § 17 UStG die Bemessungsgrundlage
      // anteilig (Netto UND USt.), nicht nur den überwiesenen Bruttobetrag -
      // angewendet auf den bereits um eine Gutschrift bereinigten Anteil.
      const faktor = bankFaktor * (1 - r.skontoProzent / 100);
      const netto = Math.round(r.netto * faktor * 100) / 100;
      const steuer = Math.round(r.steuer * faktor * 100) / 100;
      return { netto, steuer, brutto: Math.round((netto + steuer) * 100) / 100, textZusatz: ` (abzgl. ${r.skontoProzent}% Skonto${gutschriftSumme > 0 ? ', teilw. per Gutschrift' : ''})` };
    }
    const netto = Math.round(r.netto * bankFaktor * 100) / 100;
    const steuer = Math.round(r.steuer * bankFaktor * 100) / 100;
    return { netto, steuer, brutto: Math.round((netto + steuer) * 100) / 100, textZusatz: gutschriftSumme > 0 ? ' (teilw. per Gutschrift ausgeglichen)' : '' };
  }
  return { netto: 0, steuer: 0, brutto: 0, textZusatz: '' };
}

/** Gesamter, tatsächlich in den Buchungssätzen anerkannter Netto-/USt.-/
 * Brutto-Umsatz einer Rechnung - Summe aus dem Bank-/Kasse-Anteil
 * (effektivErhaltenerBetrag) UND einem ggf. per Gutschrift verrechneten
 * Anteil (siehe erzeugeBuchungenFuerRechnung, Abschnitt 1 unten). Für
 * cash-basis-Auswertungen (z.B. die Einnahmen-Übersicht in buchhaltung.js),
 * die sonst einen per Gutschrift (teil-)beglichenen, aber nie als "bezahlt"
 * markierten Umsatz schlicht unterschlagen würden - siehe offenerRestbetrag,
 * das dieselbe Rechnung bereits korrekt als "nichts mehr offen" zeigt.
 * NICHT für die Buchungserzeugung selbst verwenden - erzeugeBuchungenFuer-
 * Rechnung bucht beide Anteile bereits einzeln, das hier würde dort doppelt
 * zählen. */
export function gesamtAnerkannterUmsatz(r) {
  const bank = effektivErhaltenerBetrag(r);
  const gutschriftSumme = summeVerrechneterGutschriften(r);
  if (gutschriftSumme <= 0 || !r.brutto || r.status === 'storniert') return bank;
  const faktor = Math.min(gutschriftSumme / r.brutto, 1);
  return {
    netto: Math.round((bank.netto + r.netto * faktor) * 100) / 100,
    steuer: Math.round((bank.steuer + r.steuer * faktor) * 100) / 100,
    brutto: Math.round((bank.brutto + gutschriftSumme) * 100) / 100,
    textZusatz: bank.textZusatz,
  };
}

/** Erzeugt (ohne zu speichern) die Buchungssatz-Zeilen für eine bezahlte
 * oder teilbezahlte Rechnung, UND/ODER für einen gegen sie per Gutschrift
 * verrechneten Anteil (siehe summeVerrechneterGutschriften oben - läuft
 * bewusst UNABHÄNGIG vom Zahlungsstatus, da eine Verrechnung ein eigener,
 * sofort wirksamer Vorgang ist, genau wie die Ausstellung der Gutschrift
 * selbst in erzeugeBuchungenFuerGutschrift). */
export function erzeugeBuchungenFuerRechnung(r, { konten, settings }) {
  // Eine stornierte Rechnung darf NIE gebucht werden, auch wenn an ihr noch
  // ein (eigentlich beim Stornieren freizugebender) verrechneteGutschriften-
  // Eintrag hängt - sonst würde eine stornierte Rechnung Phantomumsatz
  // erzeugen. Das Stornieren selbst gibt die Gutschrift(en) separat wieder
  // frei (siehe rechnungen.js openStornoGrundDialog-Handler).
  if (r.status === 'storniert') return [];
  const gutschriftSumme = summeVerrechneterGutschriften(r);
  const istBezahltStatus = r.status === 'bezahlt' || r.status === 'teilbezahlt';
  if (!istBezahltStatus && gutschriftSumme <= 0) return [];
  const belegtext = `Rechnung ${r.nummer}`;
  const quelle = { typ: 'rechnung', id: r.id };
  const buchungen = [];

  const steuerfrei = r.steuerart && r.steuerart !== 'regel';
  const satz = effektiverSteuersatz(r.netto, r.steuer);
  const erloesKonto = steuerfrei
    ? findKonto(konten, 'konto-8125', '8125')
    : findKonto(konten, satz === 7 ? 'konto-8300' : 'konto-8400', satz === 7 ? '8300' : '8400');
  const ustKonto = findKonto(konten, satz === 7 ? 'konto-1771' : 'konto-1776', satz === 7 ? '1771' : '1776');

  // 1) Per Gutschrift verrechneter Anteil: löst die bei Ausstellung der
  //    Gutschrift gebuchte Verbindlichkeit (Konto 1790) anteilig wieder auf
  //    UND erkennt dabei den entsprechenden Umsatz für DIESE (neue) Rechnung
  //    an - die ursprüngliche Gutschrift hat nur ihren EIGENEN, davon
  //    unabhängigen Umsatz gemindert, siehe erzeugeBuchungenFuerGutschrift.
  if (gutschriftSumme > 0 && r.brutto) {
    const kontoGuthaben = findKonto(konten, settings.kontoKundenguthabenId, '1790');
    const faktor = Math.min(gutschriftSumme / r.brutto, 1);
    const gNetto = Math.round(r.netto * faktor * 100) / 100;
    const gSteuer = Math.round(r.steuer * faktor * 100) / 100;
    // Gebucht auf den Tag der tatsächlichen Verrechnung (gutschriftVerrechnetAm,
    // siehe rechnungen.js), NICHT auf das ursprüngliche Rechnungsdatum - sonst
    // könnte eine erst Monate später verrechnete Gutschrift rückwirkend in
    // eine bereits abgeschlossene/gemeldete UStVA-Periode gebucht werden.
    const datum = r.gutschriftVerrechnetAm || r.datum;
    if (kontoGuthaben && erloesKonto && gNetto) {
      buchungen.push({
        id: uid(), datum, text: `${belegtext} (per Gutschrift verrechnet)`,
        sollKontoId: kontoGuthaben.id, habenKontoId: erloesKonto.id,
        betrag: gNetto, quelle, manuell: false, createdAt: new Date().toISOString(),
      });
    }
    if (kontoGuthaben && ustKonto && gSteuer) {
      buchungen.push({
        id: uid(), datum, text: `${belegtext} (per Gutschrift verrechnet, USt.)`,
        sollKontoId: kontoGuthaben.id, habenKontoId: ustKonto.id,
        betrag: gSteuer, quelle, manuell: false, createdAt: new Date().toISOString(),
      });
    }
  }

  // 2) Tatsächlich über Bank/Kasse eingegangener Anteil - wie bisher, aber
  //    effektivErhaltenerBetrag berücksichtigt jetzt bereits oben 1),
  //    sodass hier nur noch der NICHT per Gutschrift gedeckte Teil verbucht
  //    wird (kein doppelt verbuchter Umsatz, kein fiktiver Bankeingang).
  if (istBezahltStatus) {
    const geldKonto = bankOderKasse(konten, settings, r.zahlungsart);
    if (geldKonto) {
      const datum = r.bezahltAm || r.datum;
      const { netto, steuer, textZusatz } = effektivErhaltenerBetrag(r);
      if (erloesKonto && netto) {
        buchungen.push({
          id: uid(), datum, text: `${belegtext}${textZusatz}`,
          sollKontoId: geldKonto.id, habenKontoId: erloesKonto.id,
          betrag: Math.round(netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
        });
      }
      if (ustKonto && steuer) {
        buchungen.push({
          id: uid(), datum, text: `${belegtext} (USt.)`, sollKontoId: geldKonto.id, habenKontoId: ustKonto.id,
          betrag: Math.round(steuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return buchungen;
}

/** Erzeugt (ohne zu speichern) die Buchungssatz-Zeilen für eine erfasste Ausgabe.
 * Drei Fälle je nach `bezahlstatus`:
 * - kein `bezahlstatus` (Standard/Altbestand): sofort bezahlter Beleg, wie bisher
 *   direkt gegen Bank/Kasse gebucht.
 * - `'offen'` (noch nicht bezahlte Lieferantenrechnung): Aufwand + Vorsteuer
 *   gegen Verbindlichkeiten (Konto 1600), kein Bank-/Kasse-Kontakt.
 * - `'bezahlt'` (aus 'offen' heraus beglichen): die Verbindlichkeiten-Buchungen
 *   bleiben (datiert auf `datum`) und eine dritte Buchung gleicht die
 *   Verbindlichkeit gegen Bank/Kasse aus (datiert auf `bezahltAm`).
 * Als Anlagevermögen markierte Ausgaben (`istInvestition`) bekommen hier
 * keine eigene Buchung - die Kapitalisierung übernimmt stattdessen die
 * zugehörige Anlage im Anlagenverzeichnis (siehe erzeugeBuchungenFuerAnlage). */
export function erzeugeBuchungenFuerAusgabe(a, { konten, settings }) {
  if (a.istInvestition) return [];
  const aufwandKonto = findKonto(konten, 'konto-4900', settings.datevAufwandKonto || '4900');
  if (!aufwandKonto) return [];
  const belegtext = `${a.kategorie || 'Ausgabe'}${a.beschreibung ? `: ${a.beschreibung}` : ''}${a.lieferant ? ` (${a.lieferant})` : ''}`;
  const quelle = { typ: 'ausgabe', id: a.id };
  const buchungen = [];
  const netto = a.betragNetto || 0;
  const vorsteuer = (a.betragBrutto || 0) - netto;
  const vorsteuerSatz = netto ? Math.round((vorsteuer / netto) * 100) : Number(a.steuersatz) || 19;
  const vorsteuerKonto = findKonto(konten, vorsteuerSatz === 7 ? 'konto-1571' : 'konto-1576', vorsteuerSatz === 7 ? '1571' : '1576');

  const istOffenOderKreditor = a.bezahlstatus === 'offen' || a.bezahlstatus === 'bezahlt';
  let gegenkonto;
  if (istOffenOderKreditor) {
    gegenkonto = findKonto(konten, 'konto-1600', '1600');
  } else {
    gegenkonto = bankOderKasse(konten, settings, a.bezahltMit);
  }
  if (!gegenkonto) return [];

  if (netto) {
    buchungen.push({
      id: uid(), datum: a.datum, text: belegtext, sollKontoId: aufwandKonto.id, habenKontoId: gegenkonto.id,
      betrag: Math.round(netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  if (vorsteuer && vorsteuerKonto) {
    buchungen.push({
      id: uid(), datum: a.datum, text: `${belegtext} (Vorsteuer)`, sollKontoId: vorsteuerKonto.id, habenKontoId: gegenkonto.id,
      betrag: Math.round(vorsteuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }

  // Kreditorenrechnung inzwischen beglichen: Verbindlichkeit gegen Bank/Kasse ausgleichen.
  if (a.bezahlstatus === 'bezahlt') {
    const geldKonto = bankOderKasse(konten, settings, a.bezahltMit);
    const verbindlichkeitenKonto = gegenkonto;
    if (geldKonto && (a.betragBrutto || 0)) {
      buchungen.push({
        id: uid(), datum: a.bezahltAm || a.datum, text: `${belegtext} (Zahlungsausgleich)`,
        sollKontoId: verbindlichkeitenKonto.id, habenKontoId: geldKonto.id,
        betrag: Math.round((a.betragBrutto || 0) * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
      });
    }
  }

  return buchungen;
}

/** Erzeugt (ohne zu speichern) die Buchungssatz-Zeilen für eine ausgestellte
 * Gutschrift (Kundenguthaben, unabhängig von einer bestehenden Rechnung).
 * Gebucht wird EINMALIG bei Ausstellung, unabhängig davon, ob/wann sie später
 * gegen eine Rechnung verrechnet wird: Soll Erlöskonto (satzspezifisch wie bei
 * einer Rechnung - mindert den Umsatz), Haben "Verbindlichkeiten aus
 * Kundengutschriften" (Konto 1790, siehe DEFAULT_KONTEN) - die Verbindlichkeit
 * bleibt bestehen, bis sie entweder gegen eine künftige Rechnung verrechnet
 * (siehe rechnungen.js verrechneteGutschriften - dort wird bewusst KEINE
 * weitere Buchung erzeugt, da der tatsächlich noch offene Zahlungseingang der
 * Rechnung bereits über deren eigenen teilzahlungBetrag/status korrekt erfasst
 * wird) oder separat ausgezahlt wird (dann als manuelle Buchung in der
 * Buchhaltung zu erfassen, siehe buchhaltung.js). Eine stornierte Gutschrift
 * bekommt keine Buchung (bzw. eine bestehende wird entfernt). */
export function erzeugeBuchungenFuerGutschrift(g, { konten, settings }) {
  // Gebucht wird erst, wenn die Gutschrift tatsächlich ausgestellt (versendet)
  // wurde - ein noch unversendeter Entwurf (z.B. während der Betrag noch
  // korrigiert wird) darf nicht vorzeitig in die Buchhaltung einfließen,
  // analog dazu, dass eine Rechnung erst ab "bezahlt" gebucht wird.
  if (!g || !g.versendet || g.status === 'storniert' || !g.brutto) return [];
  const kontoGuthaben = findKonto(konten, settings.kontoKundenguthabenId, '1790');
  if (!kontoGuthaben) return [];
  const belegtext = `Gutschrift ${g.nummer}`;
  const quelle = { typ: 'gutschrift', id: g.id };
  const buchungen = [];
  const satz = effektiverSteuersatz(g.netto, g.steuer);
  const steuerfrei = g.steuerart && g.steuerart !== 'regel';
  const erloesKonto = steuerfrei
    ? findKonto(konten, 'konto-8125', '8125')
    : findKonto(konten, satz === 7 ? 'konto-8300' : 'konto-8400', satz === 7 ? '8300' : '8400');
  if (erloesKonto && g.netto) {
    buchungen.push({
      id: uid(), datum: g.datum, text: belegtext,
      sollKontoId: erloesKonto.id, habenKontoId: kontoGuthaben.id,
      betrag: Math.round(g.netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  if (g.steuer) {
    const ustKonto = findKonto(konten, satz === 7 ? 'konto-1771' : 'konto-1776', satz === 7 ? '1771' : '1776');
    if (ustKonto) {
      buchungen.push({
        id: uid(), datum: g.datum, text: `${belegtext} (USt.)`,
        sollKontoId: ustKonto.id, habenKontoId: kontoGuthaben.id,
        betrag: Math.round(g.steuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
      });
    }
  }
  return buchungen;
}

/** Erzeugt (ohne zu speichern) die Kapitalisierungsbuchung für eine neu
 * angelegte Anlage (Anlagenverzeichnis): Soll Anlagevermögen-/GWG-Konto
 * (aktiv, je nach `anlage.gwg`), Haben Bank/Kasse, plus eigene Zeile für die
 * Vorsteuer - analog zur Ausgaben-Buchung, nur gegen ein Aktivkonto statt
 * direkt gegen Aufwand. Die jährlichen Abschreibungsbuchungen selbst kommen
 * separat aus `abschreibung.js` + `erzeugeAbschreibungsbuchungenFuerAnlage`. */
export function erzeugeBuchungenFuerAnlage(anlage, { konten, settings }) {
  const kontoId = anlage.gwg ? settings.kontoGwgId : settings.kontoAnlagevermoegenId;
  const fallbackNummer = anlage.gwg ? '0480' : '0400';
  const anlageKonto = findKonto(konten, kontoId, fallbackNummer);
  if (!anlageKonto) return [];
  const geldKonto = bankOderKasse(konten, settings, anlage.bezahltMit);
  if (!geldKonto) return [];

  const belegtext = `Anschaffung: ${anlage.bezeichnung || 'Anlagegut'}${anlage.lieferant ? ` (${anlage.lieferant})` : ''}`;
  const quelle = { typ: 'anlagegut', id: anlage.id };
  const buchungen = [];
  const netto = anlage.anschaffungswertNetto || 0;
  const brutto = anlage.anschaffungswertBrutto || netto;
  const vorsteuer = brutto - netto;
  const vorsteuerSatz = netto ? Math.round((vorsteuer / netto) * 100) : Number(anlage.steuersatz) || 19;
  const vorsteuerKonto = findKonto(konten, vorsteuerSatz === 7 ? 'konto-1571' : 'konto-1576', vorsteuerSatz === 7 ? '1571' : '1576');

  if (netto) {
    buchungen.push({
      id: uid(), datum: anlage.anschaffungsdatum, text: belegtext, sollKontoId: anlageKonto.id, habenKontoId: geldKonto.id,
      betrag: Math.round(netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  if (vorsteuer && vorsteuerKonto) {
    buchungen.push({
      id: uid(), datum: anlage.anschaffungsdatum, text: `${belegtext} (Vorsteuer)`, sollKontoId: vorsteuerKonto.id, habenKontoId: geldKonto.id,
      betrag: Math.round(vorsteuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  return buchungen;
}

/** Erzeugt (ohne zu speichern) die jährlichen Abschreibungsbuchungen einer
 * Anlage bis einschließlich dem Jahr von `bisDatum` (siehe `abschreibung.js`
 * `berechneAbschreibungsplan`) - je ein Buchungssatz pro Kalenderjahr: Soll
 * Abschreibungen (Aufwand), Haben dasselbe Anlagevermögen-/GWG-Konto wie bei
 * der Kapitalisierung (direkte Zuschreibung, kein separates
 * "kumulierte Abschreibungen"-Gegenkonto). Datiert auf den 31.12. des
 * jeweiligen Jahres (übliche Jahresabschluss-Buchung). */
export function erzeugeAbschreibungsbuchungenFuerAnlage(anlage, { konten, settings, bisDatum }) {
  const abschreibungsKonto = findKonto(konten, settings.kontoAbschreibungenId, '6220');
  if (!abschreibungsKonto) return [];
  const kontoId = anlage.gwg ? settings.kontoGwgId : settings.kontoAnlagevermoegenId;
  const fallbackNummer = anlage.gwg ? '0480' : '0400';
  const anlageKonto = findKonto(konten, kontoId, fallbackNummer);
  if (!anlageKonto) return [];

  const belegtext = `Abschreibung: ${anlage.bezeichnung || 'Anlagegut'}`;
  const quelle = { typ: 'anlagegut-afa', id: anlage.id };
  return berechneAbschreibungsplan(anlage, bisDatum)
    .filter((jahr) => jahr.betrag)
    .map((jahr) => ({
      id: uid(), datum: `${jahr.jahr}-12-31`, text: `${belegtext} ${jahr.jahr}`,
      sollKontoId: abschreibungsKonto.id, habenKontoId: anlageKonto.id,
      betrag: jahr.betrag, quelle, manuell: false, createdAt: new Date().toISOString(),
    }));
}

async function ersetzeAutomatischeBuchungen(quelleTyp, quelleId, neueBuchungen) {
  const alle = await getAll('buchungen');
  const bestehende = alle.filter((b) => !b.manuell && b.quelle?.typ === quelleTyp && b.quelle?.id === quelleId);
  for (const b of bestehende) await remove('buchungen', b.id);
  for (const b of neueBuchungen) await put('buchungen', b);
}

/** Hält die automatisch erzeugten Buchungssätze einer Rechnung mit ihrem aktuellen
 * Status synchron: bezahlt → Buchungssätze vorhanden, sonst (offen/storniert/...) → keine. */
export async function syncBuchungFuerRechnung(r, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerRechnung(r, { konten, settings });
  await ersetzeAutomatischeBuchungen('rechnung', r.id, neueBuchungen);
}

/** Hält die automatisch erzeugte Buchung einer Gutschrift mit ihrem aktuellen
 * Status synchron: ausgestellt (nicht storniert) → Buchung vorhanden, storniert → keine. */
export async function syncBuchungFuerGutschrift(g, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerGutschrift(g, { konten, settings });
  await ersetzeAutomatischeBuchungen('gutschrift', g.id, neueBuchungen);
}

/** Hält die automatisch erzeugten Buchungssätze einer Ausgabe mit ihrem aktuellen
 * Inhalt synchron (Betrag/Kategorie/Zahlart geändert → Buchung wird neu erzeugt). */
export async function syncBuchungFuerAusgabe(a, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerAusgabe(a, { konten, settings });
  await ersetzeAutomatischeBuchungen('ausgabe', a.id, neueBuchungen);
}

/** Entfernt alle automatisch erzeugten Buchungssätze einer gelöschten Ausgabe. */
export async function entferneBuchungFuerAusgabe(ausgabeId) {
  await ersetzeAutomatischeBuchungen('ausgabe', ausgabeId, []);
}

/** Hält die Kapitalisierungsbuchung einer Anlage mit ihrem aktuellen Inhalt
 * synchron (Betrag/Kategorie/Zahlart geändert → Buchung wird neu erzeugt). */
export async function syncBuchungFuerAnlage(anlage, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerAnlage(anlage, { konten, settings });
  await ersetzeAutomatischeBuchungen('anlagegut', anlage.id, neueBuchungen);
}

/** Entfernt alle automatisch erzeugten Buchungssätze (Kapitalisierung +
 * Abschreibungen) einer gelöschten Anlage. */
export async function entferneBuchungenFuerAnlage(anlageId) {
  await ersetzeAutomatischeBuchungen('anlagegut', anlageId, []);
  await ersetzeAutomatischeBuchungen('anlagegut-afa', anlageId, []);
}

/** Hält die jährlichen Abschreibungsbuchungen einer Anlage bis einschließlich
 * `bisDatum` synchron - erneuter Aufruf ersetzt den kompletten Plan, ist also
 * gefahrlos wiederholbar (idempotent), z.B. durch erneuten Klick auf
 * "Abschreibungen jetzt buchen". */
export async function syncAbschreibungenFuerAnlage(anlage, settings, bisDatum) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeAbschreibungsbuchungenFuerAnlage(anlage, { konten, settings, bisDatum });
  await ersetzeAutomatischeBuchungen('anlagegut-afa', anlage.id, neueBuchungen);
}
