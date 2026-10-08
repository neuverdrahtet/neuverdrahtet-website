// Hilft dabei, Werkora als installierte App (PWA) auf einem neuen Gerät
// einzurichten - eigenes Modul statt in main.js, da `beforeinstallprompt`
// schon beim allerersten Seitenaufruf feuern kann, lange bevor irgendeine
// Ansicht (z.B. Einstellungen) gemountet ist. Der Event wird hier zentral
// einmalig eingefangen und für später gemerkt (deferredPrompt), Ansichten
// fragen nur noch den aktuellen Stand ab bzw. abonnieren Änderungen.

let deferredPrompt = null;
let listeners = [];

function notify() {
  listeners.forEach((fn) => { try { fn(); } catch { /* Listener-Fehler dürfen sich nicht gegenseitig stören */ } });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  notify();
});

/** Läuft die App bereits installiert/eigenständig (Home-Bildschirm/Desktop-App), nicht im normalen Browser-Tab? */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true; // iOS Safari
}

/** True, sobald der Browser von sich aus einen nativen Install-Dialog anbietet (Chrome/Edge/Android). */
export function canPromptInstall() {
  return !!deferredPrompt;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

/** fn wird aufgerufen, sobald sich canPromptInstall()/isStandalone() ändern könnten. Gibt eine Abmeldefunktion zurück. */
export function onInstallAvailabilityChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

/** Zeigt den nativen Install-Dialog. Gibt 'accepted'/'dismissed' zurück, oder null falls kein Dialog verfügbar ist. */
export async function promptInstall() {
  if (!deferredPrompt) return null;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  prompt.prompt();
  const choice = await prompt.userChoice;
  notify();
  return choice.outcome;
}
