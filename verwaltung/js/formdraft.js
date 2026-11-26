// Automatische Zwischenspeicherung für die großen Dokumentenformulare (Angebot/
// Rechnung/Auftragsbestätigung): rein lokal im Browser (localStorage), KEIN
// Firestore-Schreibvorgang - sonst würde z.B. bei Rechnungen durch einen nie
// abgeschickten Entwurf eine echte Rechnungsnummer "verbraucht", was die
// GoBD-pflichtige lückenlose Nummerierung verletzen würde. Dient nur als
// Überbrückung für "aus Versehen das Formular geschlossen" (Backdrop-Klick,
// Escape, Wegnavigieren) - bei einem expliziten "Abbrechen"-Klick oder nach
// erfolgreichem Speichern wird der Entwurf von der aufrufenden view wieder
// gelöscht (siehe loescheEntwurf).
//
// Bewusst nur für das BLANKO-"Neu"-Formular gedacht (kein Prefill/keine
// Umwandlung aus einem Angebot o.ä.) - ein Entwurf-Slot pro Dokumenttyp reicht
// für den Alltag eines Einzelunternehmers, und so landet nie versehentlich der
// Inhalt einer abgebrochenen Umwandlung in einem später geöffneten, eigentlich
// unabhängigen neuen Dokument.

const PREFIX = 'nv-entwurf-';

export function ladeEntwurf(typ) {
  try {
    const raw = localStorage.getItem(PREFIX + typ);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.formData ? parsed : null;
  } catch {
    return null;
  }
}

export function loescheEntwurf(typ) {
  try { localStorage.removeItem(PREFIX + typ); } catch { /* localStorage evtl. nicht verfügbar */ }
}

// formEl: das <form>-Element des Dokuments. getPositionen: Funktion, die die
// aktuellen Positionen liefert (z.B. editor.getPositionen) - die Positionen
// hängen am Positions-Editor, nicht an normalen Formularfeldern, und müssen
// deshalb separat eingesammelt werden. Speichert alle paar Sekunden und
// zusätzlich kurz nach der letzten Eingabe (debounced), damit auch ein
// Schließen direkt nach dem letzten Tastendruck nichts verliert.
export function autosaveEntwurf(formEl, typ, getPositionen, { intervalMs = 8000, debounceMs = 1500 } = {}) {
  function speichern() {
    try {
      const formData = Object.fromEntries(new FormData(formEl));
      localStorage.setItem(PREFIX + typ, JSON.stringify({ savedAt: new Date().toISOString(), formData, positionen: getPositionen() }));
    } catch { /* localStorage voll/deaktiviert - Entwurf ist dann halt nicht gesichert, kein Blocker fürs Weiterarbeiten */ }
  }
  let debounceTimer = null;
  const onInput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(speichern, debounceMs);
  };
  formEl.addEventListener('input', onInput);
  formEl.addEventListener('change', onInput);
  const intervalId = setInterval(speichern, intervalMs);
  return {
    stop: () => {
      clearInterval(intervalId);
      clearTimeout(debounceTimer);
      formEl.removeEventListener('input', onInput);
      formEl.removeEventListener('change', onInput);
    },
  };
}
