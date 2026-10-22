// Phase 11 Sicherheitskorrektur: bulkFixReceipts (KI-Bürokraft-Worker) legt
// seit Phase 11 nur noch VORSCHLÄGE in der Firestore-Collection
// "belegVorschlaege" an (alte+neue Belegwerte), statt Ausgaben direkt zu
// ändern - siehe cloudflare-worker-ki-buerokraft/worker.js,
// bulk-fix-receipts. Dieses Modul setzt die dazugehörige, serverseitig
// (durch Firestore selbst) versionsgebundene Freigabe/Ablehnung um: eine
// Firestore-Transaktion liest Vorschlag UND Ausgabe neu ein und vergleicht
// die relevanten Felder der Ausgabe gegen die im Vorschlag gespeicherten
// "alten Werte" - hat sich die Ausgabe seitdem verändert (z.B. weil jemand
// sie zwischenzeitlich manuell bearbeitet hat), wird NICHT blind
// übernommen, sondern der Vorschlag als "veraltet" markiert und die
// Freigabe abgelehnt. Das ist dieselbe Grundidee wie die
// "currentDocument.updateTime"-Versionssicherung der JARVIS-Freigabe-Engine
// im Haupt-Worker, hier aber über eine normale Firestore-Client-Transaktion
// (serverseitig atomar von Firestore selbst durchgesetzt, nicht nur im
// Browser geprüft).
import { firebaseConfig } from './firebase-config.js';

const FIREBASE_ENABLED = !!firebaseConfig.projectId;
let firestore = null;
if (FIREBASE_ENABLED) {
  ({ firestore } = await import('./firebase.js'));
}
const { doc, getDoc, runTransaction } = await import('./vendor/firebase/firebase-firestore.js');

export class BelegVorschlagVeraltetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BelegVorschlagVeraltetError';
  }
}

/** Vergleicht nur die Felder, die der Vorschlag selbst betrifft (nicht das ganze Dokument) - andere, zwischenzeitlich geänderte Felder (z.B. eine neue Notiz) dürfen die Freigabe nicht blockieren. */
function werteStimmenUeberein(ausgabe, alteWerte) {
  for (const feld of Object.keys(alteWerte)) {
    const istWert = ausgabe?.[feld] ?? null;
    const sollWert = alteWerte[feld] ?? null;
    if (istWert !== sollWert) return false;
  }
  return true;
}

/**
 * Enthält die eigentliche Transaktionslogik, nimmt die Firestore-Instanz als
 * Parameter entgegen (statt sie fest zu verdrahten) - macht die Funktion
 * unabhängig von firebase.js/dem persistenten Browser-Cache testbar (siehe
 * firestore-tests/belegvorschlaege.test.mjs, Phase 11 Punkt 3
 * "Versionierung und konkurrierende Freigaben": echter Test gegen den
 * Firestore-Emulator, inkl. simulierter Nebenläufigkeit). Die öffentliche
 * Funktion unten ruft diese nur mit der echten App-Firestore-Instanz auf.
 */
export async function freigebenBelegVorschlagMit(firestoreInstanz, vorschlagId, { freigegebenVonUid } = {}) {
  // WICHTIG: wirft eine Transaktions-Callback-Funktion eine Exception, bricht
  // Firestore die GESAMTE Transaktion ab - KEINE der darin per tx.update()
  // vorgenommenen Änderungen wird committet, auch nicht die "veraltet"-
  // Markierung. Ein "markiere als veraltet UND wirf einen Fehler" innerhalb
  // derselben Transaktion ist deshalb nicht möglich (durch einen echten
  // Emulator-Test aufgedeckt, siehe firestore-tests/belegvorschlaege.test.mjs
  // V2/V6 - mit einem reinen Mock wäre dieser Fehler nicht aufgefallen, weil
  // ein Mock das Alles-oder-Nichts-Verhalten einer echten Transaktion nicht
  // nachbildet). Die Transaktion gibt deshalb nur ein Ergebnis-Objekt zurück
  // (inkl. "veraltet"-Fall, der Status wird dabei ganz normal MIT committet)
  // - erst NACH dem erfolgreichen Commit entscheidet der Aufrufer unten, ob
  // ein BelegVorschlagVeraltetError geworfen wird.
  const ergebnis = await runTransaction(firestoreInstanz, async (tx) => {
    const vorschlagRef = doc(firestoreInstanz, 'belegVorschlaege', vorschlagId);
    const vorschlagSnap = await tx.get(vorschlagRef);
    if (!vorschlagSnap.exists()) return { veraltet: false, nichtGefunden: true };
    const vorschlag = vorschlagSnap.data();
    if (vorschlag.status !== 'offen') return { veraltet: false, nichtOffen: true, status: vorschlag.status };

    const ausgabeRef = doc(firestoreInstanz, 'ausgaben', vorschlag.ausgabeId);
    const ausgabeSnap = await tx.get(ausgabeRef);
    if (!ausgabeSnap.exists()) {
      tx.update(vorschlagRef, { status: 'veraltet', veraltetGrund: 'Ausgabe existiert nicht mehr.', entschiedenAm: new Date().toISOString() });
      return { veraltet: true, grund: 'Die zugehörige Ausgabe existiert nicht mehr - Vorschlag wurde als veraltet markiert.' };
    }
    const ausgabe = ausgabeSnap.data();
    if (!werteStimmenUeberein(ausgabe, vorschlag.alteWerte)) {
      tx.update(vorschlagRef, { status: 'veraltet', veraltetGrund: 'Ausgabe wurde zwischenzeitlich anders geändert.', entschiedenAm: new Date().toISOString() });
      return { veraltet: true, grund: 'Die Ausgabe wurde seit dem Vorschlag bereits anders geändert - Freigabe abgelehnt, Vorschlag als veraltet markiert. Bitte neu prüfen.' };
    }
    tx.update(ausgabeRef, vorschlag.neueWerte);
    tx.update(vorschlagRef, { status: 'freigegeben', freigegebenAm: new Date().toISOString(), freigegebenVonUid: freigegebenVonUid || null });
    return { veraltet: false, ausgabeId: vorschlag.ausgabeId, angewendeteWerte: vorschlag.neueWerte };
  });
  if (ergebnis.nichtGefunden) throw new Error('Beleg-Vorschlag wurde nicht gefunden.');
  if (ergebnis.nichtOffen) throw new Error(`Beleg-Vorschlag ist nicht mehr offen (Status: ${ergebnis.status}).`);
  if (ergebnis.veraltet) throw new BelegVorschlagVeraltetError(ergebnis.grund);
  return { ausgabeId: ergebnis.ausgabeId, angewendeteWerte: ergebnis.angewendeteWerte };
}

/**
 * Gibt EINEN Beleg-Vorschlag frei: wendet neueWerte auf die Ausgabe an, aber
 * NUR wenn die Ausgabe seit der Vorschlagserstellung unverändert ist. Wirft
 * BelegVorschlagVeraltetError, wenn sich die Ausgabe zwischenzeitlich
 * geändert hat (Vorschlag wird dabei als "veraltet" markiert, damit er nicht
 * in der Liste offener Vorschläge hängen bleibt).
 */
export async function freigebenBelegVorschlag(vorschlagId, opts = {}) {
  if (!FIREBASE_ENABLED) throw new Error('Beleg-Vorschläge erfordern ein eingerichtetes Firebase-Projekt.');
  return freigebenBelegVorschlagMit(firestore, vorschlagId, opts);
}

/** Enthält die Ablehnungs-Transaktionslogik, siehe freigebenBelegVorschlagMit oben (gleicher Testbarkeits-Grund). */
export async function ablehnenBelegVorschlagMit(firestoreInstanz, vorschlagId, { abgelehntVonUid } = {}) {
  return runTransaction(firestoreInstanz, async (tx) => {
    const vorschlagRef = doc(firestoreInstanz, 'belegVorschlaege', vorschlagId);
    const vorschlagSnap = await tx.get(vorschlagRef);
    if (!vorschlagSnap.exists()) throw new Error('Beleg-Vorschlag wurde nicht gefunden.');
    if (vorschlagSnap.data().status !== 'offen') throw new Error(`Beleg-Vorschlag ist nicht mehr offen (Status: ${vorschlagSnap.data().status}).`);
    tx.update(vorschlagRef, { status: 'abgelehnt', abgelehntAm: new Date().toISOString(), abgelehntVonUid: abgelehntVonUid || null });
  });
}

/** Lehnt einen Beleg-Vorschlag ab, ohne die Ausgabe zu verändern. */
export async function ablehnenBelegVorschlag(vorschlagId, opts = {}) {
  if (!FIREBASE_ENABLED) throw new Error('Beleg-Vorschläge erfordern ein eingerichtetes Firebase-Projekt.');
  return ablehnenBelegVorschlagMit(firestore, vorschlagId, opts);
}

/**
 * Sammelfreigabe: gibt mehrere Vorschläge nacheinander frei - JEDER einzeln
 * versionsgebunden wie freigebenBelegVorschlag oben (keine abgeschwächte
 * Prüfung nur weil es eine Sammelaktion ist). Ein veralteter/fehlgeschlagener
 * Einzelfall blockiert die übrigen nicht - alle Ergebnisse werden
 * zurückgegeben, damit die Oberfläche genau zeigen kann, was geklappt hat
 * und was nicht.
 */
export async function freigebenBelegVorschlaegeSammel(vorschlagIds, { freigegebenVonUid } = {}) {
  const ergebnisse = [];
  for (const id of vorschlagIds) {
    try {
      const ergebnis = await freigebenBelegVorschlag(id, { freigegebenVonUid });
      ergebnisse.push({ id, erfolg: true, ...ergebnis });
    } catch (err) {
      ergebnisse.push({ id, erfolg: false, fehler: err.message });
    }
  }
  return ergebnisse;
}

/** Liest eine einzelne Ausgabe frisch (für die "jetzt aktuell"-Anzeige neben den Vorschlagswerten in der Oberfläche). */
export async function leseAusgabeFrisch(ausgabeId) {
  if (!FIREBASE_ENABLED) return null;
  const snap = await getDoc(doc(firestore, 'ausgaben', ausgabeId));
  return snap.exists() ? { id: ausgabeId, ...snap.data() } : null;
}
