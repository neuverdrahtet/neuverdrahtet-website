// Einfacher Brute-Force-Schutz fürs Login - rein im Arbeitsspeicher (reicht
// für einen Ein-Server-Betrieb; ein Neustart setzt Sperren zurück, was hier
// kein Problem ist, da ein Neustart ohnehin selten und bewusst ist).
export function createLoginLimiter({ maxVersuche = 5, sperrdauerMs = 5 * 60 * 1000, fensterMs = 10 * 60 * 1000 } = {}) {
  const versuche = new Map(); // schluessel -> { anzahl, ersterVersuch, gesperrtBis }

  function schluesselFuer(email) {
    return (email || '').trim().toLowerCase();
  }

  // Gibt die verbleibenden Sekunden zurück, falls gerade gesperrt, sonst null.
  function pruefeSperre(email) {
    const eintrag = versuche.get(schluesselFuer(email));
    if (!eintrag?.gesperrtBis) return null;
    if (eintrag.gesperrtBis <= Date.now()) return null;
    return Math.ceil((eintrag.gesperrtBis - Date.now()) / 1000);
  }

  function vermerkeFehlschlag(email) {
    const schluessel = schluesselFuer(email);
    const jetzt = Date.now();
    const eintrag = versuche.get(schluessel) || { anzahl: 0, ersterVersuch: jetzt };
    if (jetzt - eintrag.ersterVersuch > fensterMs) {
      eintrag.anzahl = 0;
      eintrag.ersterVersuch = jetzt;
    }
    eintrag.anzahl += 1;
    if (eintrag.anzahl >= maxVersuche) eintrag.gesperrtBis = jetzt + sperrdauerMs;
    versuche.set(schluessel, eintrag);
  }

  function vermerkeErfolg(email) {
    versuche.delete(schluesselFuer(email));
  }

  return { pruefeSperre, vermerkeFehlschlag, vermerkeErfolg };
}
