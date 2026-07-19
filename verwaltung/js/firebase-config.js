// Firebase-Projekt-Konfiguration. Dies ist KEIN Geheimnis (Firebase-Sicherheit
// läuft über Security Rules + Login, nicht über das Verstecken dieser Werte) –
// diese Datei darf normal im Code/Git stehen.
//
// Woher bekomme ich diese Werte?
// 1. https://console.firebase.google.com öffnen, Projekt anlegen (oder auswählen).
// 2. Projekteinstellungen (Zahnrad oben links) -> "Meine Apps" -> Web-App (</>) hinzufügen.
// 3. Den angezeigten "firebaseConfig"-Block hier unten eintragen.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// Auf "true" setzen, um lokal gegen die Firebase Local Emulator Suite zu testen
// (firebase emulators:start --only firestore,auth,storage), statt gegen das
// echte Projekt. Für den produktiven Einsatz muss dies "false" sein.
export const USE_EMULATOR = false;
