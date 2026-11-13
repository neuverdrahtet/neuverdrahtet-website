// Reiner Node-Unit-Test für die Staging-Umschalter-Entscheidungslogik aus
// firebase-config.js (Maßnahme 7, Schritt 6, 13.11.2026) - prüft insbesondere
// die sicherheitskritische Eigenschaft: auf einer echten Produktionsdomain
// darf "?staging=1" NIEMALS die Staging-Konfiguration aktivieren, selbst mit
// bereits gesetztem Flag. Kein Browser nötig, da die Funktion bewusst ohne
// window/localStorage-Zugriff geschrieben ist (reine Eingabe/Ausgabe).
//
// Ausführen: node verwaltung/tests/staging-schalter-logik.test.mjs
import { berechneStagingModus, istProduktionsHostname } from '../js/firebase-config.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('L1: ohne Parameter und ohne gespeichertes Flag ist Staging nicht aktiv', () => {
  const r = berechneStagingModus({ hostname: '127.0.0.1', suchstring: '', gespeichertesFlag: null });
  assert(r.aktiv === false, 'erwartet aktiv=false');
});

pruefe('L2: "?staging=1" auf einer Nicht-Produktionsdomain aktiviert Staging und setzt das Flag', () => {
  const r = berechneStagingModus({ hostname: '127.0.0.1', suchstring: '?staging=1', gespeichertesFlag: null });
  assert(r.aktiv === true, 'erwartet aktiv=true');
  assert(r.neuesFlag === 'aktiv', 'erwartet neuesFlag="aktiv"');
});

pruefe('L3: ein bereits gespeichertes Flag bleibt ohne Parameter aktiv (Persistenz über Reload)', () => {
  const r = berechneStagingModus({ hostname: '127.0.0.1', suchstring: '', gespeichertesFlag: 'aktiv' });
  assert(r.aktiv === true, 'erwartet aktiv=true');
});

pruefe('L4: "?staging=0" deaktiviert ein gespeichertes Flag wieder', () => {
  const r = berechneStagingModus({ hostname: '127.0.0.1', suchstring: '?staging=0', gespeichertesFlag: 'aktiv' });
  assert(r.aktiv === false, 'erwartet aktiv=false');
  assert(r.neuesFlag === null, 'erwartet neuesFlag=null');
});

pruefe('L5 (Sicherheit): auf "neuverdrahtet.com" aktiviert "?staging=1" NICHT die Staging-Konfiguration', () => {
  const r = berechneStagingModus({ hostname: 'neuverdrahtet.com', suchstring: '?staging=1', gespeichertesFlag: null });
  assert(r.aktiv === false, 'erwartet aktiv=false trotz "?staging=1" auf Produktionsdomain');
});

pruefe('L6 (Sicherheit): auf "www.neuverdrahtet.com" bleibt Staging deaktiviert, SELBST mit bereits gesetztem Flag', () => {
  const r = berechneStagingModus({ hostname: 'www.neuverdrahtet.com', suchstring: '?staging=1', gespeichertesFlag: 'aktiv' });
  assert(r.aktiv === false, 'erwartet aktiv=false trotz gesetztem Flag auf Produktionsdomain');
});

pruefe('L7: istProduktionsHostname() erkennt genau die beiden echten Domains, keine andere', () => {
  assert(istProduktionsHostname('neuverdrahtet.com') === true, 'neuverdrahtet.com muss als Produktion erkannt werden');
  assert(istProduktionsHostname('www.neuverdrahtet.com') === true, 'www.neuverdrahtet.com muss als Produktion erkannt werden');
  assert(istProduktionsHostname('neuverdrahtet-staging.web.app') === false, 'die Staging-Domain darf NICHT als Produktion gelten');
  assert(istProduktionsHostname('127.0.0.1') === false, 'localhost/127.0.0.1 darf nicht als Produktion gelten');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
