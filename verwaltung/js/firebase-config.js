// Firebase-Projekt-Konfiguration. Dies ist KEIN Geheimnis (Firebase-Sicherheit
// läuft über Security Rules + Login, nicht über das Verstecken dieser Werte) –
// diese Datei darf normal im Code/Git stehen.
//
// Woher bekomme ich diese Werte?
// 1. https://console.firebase.google.com öffnen, Projekt anlegen (oder auswählen).
// 2. Projekteinstellungen (Zahnrad oben links) -> "Meine Apps" -> Web-App (</>) hinzufügen.
// 3. Den angezeigten "firebaseConfig"-Block hier unten eintragen.
const firebaseConfigProduktion = {
  apiKey: 'AIzaSyDY9NDdfqbnaxIoNi1SxrCbsppbidd0Sto',
  authDomain: 'neuverdrahtet-verwaltung.firebaseapp.com',
  projectId: 'neuverdrahtet-verwaltung',
  storageBucket: 'neuverdrahtet-verwaltung.firebasestorage.app',
  messagingSenderId: '1007747718563',
  appId: '1:1007747718563:web:fbf274c25ae8cf9ccf0e16',
};

// Staging (siehe staging/README.md, Schritt 1.6) - Werte aus der Firebase-
// Konsole des SEPARATEN Staging-Projekts ("neuverdrahtet-staging"), Web-App
// "Verwaltung Staging" (14.11.2026 von Danny angelegt). Die Aktivierungs-
// prüfung unten lässt das ohnehin nur auf der Staging-Vorschau-Domain zu,
// niemals auf der echten Produktionsdomain.
const firebaseConfigStaging = {
  apiKey: 'AIzaSyCyz-FNfxePTj_OASiU6bxBqnYb3VMR7Cg',
  authDomain: 'neuverdrahtet-staging.firebaseapp.com',
  projectId: 'neuverdrahtet-staging',
  storageBucket: 'neuverdrahtet-staging.firebasestorage.app',
  messagingSenderId: '438316593462',
  appId: '1:438316593462:web:6932434bcc78fec46d8397',
};

// Produktionsdomains, auf denen Staging-Modus NIEMALS aktiv werden darf -
// selbst wenn der Query-Parameter/localStorage-Flag unten aus Versehen (z.B.
// ein alter Lesezeichen-Link) gesetzt ist. Bewusst dieselbe Absicherungslogik
// wie die PRODUKTIVE_PROJEKT_IDS-Sperrliste in staging/seed-synthetic-data.mjs
// - ein einzelnes Flag allein darf nie über "ist das wirklich Staging"
// entscheiden.
const PRODUKTIONS_HOSTNAMEN = ['neuverdrahtet.com', 'www.neuverdrahtet.com'];

// Reine Entscheidungsfunktion (ohne window/localStorage-Zugriff) - so lässt
// sich die sicherheitskritische Regel ("nie auf der echten Produktionsdomain")
// mit einem einfachen Node-Unit-Test prüfen, ohne Browser/Netzwerk zu brauchen
// (siehe verwaltung/tests/staging-schalter-logik.test.mjs). Die Parameter
// bilden exakt das ab, was die echte Umgebung liefert: Hostname, Such-String
// der URL und den aktuell gespeicherten Flag-Wert.
export function istProduktionsHostname(hostname) {
  return PRODUKTIONS_HOSTNAMEN.includes(hostname);
}

export function berechneStagingModus({ hostname, suchstring, gespeichertesFlag }) {
  if (istProduktionsHostname(hostname)) {
    return { aktiv: false, neuesFlag: gespeichertesFlag };
  }
  const param = new URLSearchParams(suchstring).get('staging');
  let neuesFlag = gespeichertesFlag;
  if (param === '1') neuesFlag = 'aktiv';
  if (param === '0') neuesFlag = null;
  return { aktiv: neuesFlag === 'aktiv', neuesFlag };
}

function ermittleStagingModus() {
  if (typeof window === 'undefined') return false;
  try {
    const { aktiv, neuesFlag } = berechneStagingModus({
      hostname: window.location.hostname,
      suchstring: window.location.search,
      gespeichertesFlag: localStorage.getItem('nvStagingModus'),
    });
    if (neuesFlag === null) localStorage.removeItem('nvStagingModus');
    else if (neuesFlag) localStorage.setItem('nvStagingModus', neuesFlag);
    return aktiv;
  } catch {
    return false;
  }
}

// Zum Testen gegen die Staging-Umgebung (siehe staging/README.md, Schritt 6)
// einmalig "?staging=1" an die URL der Staging-Vorschau-Domain anhängen -
// bleibt dann (localStorage) bis "?staging=0" oder dem Leeren der
// Browser-Daten aktiv. Auf der echten Produktionsdomain greift das nie
// (siehe PRODUKTIONS_HOSTNAMEN oben).
export const firebaseConfig = ermittleStagingModus()
  ? firebaseConfigStaging
  : firebaseConfigProduktion;

// Auf "true" setzen, um lokal gegen die Firebase Local Emulator Suite zu testen
// (firebase emulators:start --only firestore,auth,storage), statt gegen das
// echte Projekt. Für den produktiven Einsatz muss dies "false" sein.
export const USE_EMULATOR = false;
