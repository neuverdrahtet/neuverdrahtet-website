// Schaltet db.js (und auth.js/employeeAuth.js/blobstore.js) auf den eigenen
// Werkora-Selfhost-Server um (siehe selfhost-server/README.md) statt
// Firebase/Firestore. Bewusst standardmäßig AUS, damit die bisherige
// Firebase/GitHub-Pages-Variante unverändert weiterläuft, bis hier bewusst
// umgeschaltet wird - z.B. erst, nachdem die bestehenden Firebase-Daten
// einmalig auf den Selfhost-Server übertragen wurden.
//
// Die App wird im Selfhost-Betrieb VOM selben Server ausgeliefert, der auch
// die API bereitstellt (siehe selfhost-server/server.js) - es braucht daher
// keine Basis-URL-Konfiguration, nur dieses eine An/Aus.
export const selfhostConfig = {
  enabled: false,
};
