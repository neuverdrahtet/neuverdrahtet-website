// Echter Test gegen einen LAUFENDEN Firebase-Storage-Emulator für die
// P0-Sicherheitskorrektur vom 29.10.2026 (Master-Audit Bericht 03, Finding
// #8: "storage.rules: Zugriff nach Pfad-Präfix einschränken, wo möglich").
//
// Bewusst OHNE jede firestore.get()-Cross-Service-Prüfung (siehe
// ausführlicher Kommentar in storage.rules, warum das hier nicht verwendet
// wird - das Firebase Local Emulator Suite unterstützt Storage->Firestore-
// Cross-Service-Regeln nicht zuverlässig, empirisch nachgewiesen am
// 29.10.2026). Dieser Test deckt deshalb genau das ab, was storage.rules
// tatsächlich prüft: Login-Pflicht, erlaubte Pfad-Präfixe, Dateityp und
// Größe - keine Rollenprüfung.
//
// Ausführen: npm run test:storage-rules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const hierDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(hierDir, '..', 'storage.rules'), 'utf8');

const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
const [host, portStr] = storageEmulatorHost.split(':');

const testEnv = await initializeTestEnvironment({
  projectId: 'storage-rules-test',
  storage: { host, port: Number(portStr), rules },
});

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}

const nutzerCtx = testEnv.authenticatedContext('irgendein-uid');
const gastStorage = testEnv.unauthenticatedContext().storage();
const nutzerStorage = nutzerCtx.storage();

const bild = new Uint8Array([0xff, 0xd8, 0xff]); // reicht als Testinhalt, Rules prüfen nur contentType/size, nie den Byte-Inhalt
const grossesBild = new Uint8Array(16 * 1024 * 1024); // 16 MB > die 15-MB-Grenze für ausgaben/aufmasse/fotos/socialPosts

await pruefe('S1: nicht eingeloggt -> Lesen auf bekanntem Pfad wird abgelehnt', async () => {
  await assertFails(getBytes(ref(gastStorage, 'ausgaben/beleg1')));
});
await pruefe('S2: nicht eingeloggt -> Schreiben wird abgelehnt', async () => {
  await assertFails(uploadBytes(ref(gastStorage, 'ausgaben/beleg1'), bild, { contentType: 'application/pdf' }));
});

await pruefe('S3: eingeloggt -> PDF-Beleg unter ausgaben/ erlaubt', async () => {
  await assertSucceeds(uploadBytes(ref(nutzerStorage, 'ausgaben/beleg1'), bild, { contentType: 'application/pdf' }));
});
await pruefe('S4: eingeloggt -> Bild-Beleg unter ausgaben/ erlaubt', async () => {
  await assertSucceeds(uploadBytes(ref(nutzerStorage, 'ausgaben/beleg2'), bild, { contentType: 'image/jpeg' }));
});
await pruefe('S5: eingeloggt -> Text-Datei unter ausgaben/ ABGELEHNT (nur Bild/PDF erlaubt)', async () => {
  await assertFails(uploadBytes(ref(nutzerStorage, 'ausgaben/beleg3'), bild, { contentType: 'text/plain' }));
});
await pruefe('S6: eingeloggt -> überdimensionierte Datei (>15MB) unter ausgaben/ ABGELEHNT', async () => {
  await assertFails(uploadBytes(ref(nutzerStorage, 'ausgaben/beleg4'), grossesBild, { contentType: 'image/jpeg' }));
});

await pruefe('S7: eingeloggt -> Bild unter zeiterfassung/{id}/medien/{id} erlaubt', async () => {
  await assertSucceeds(uploadBytes(ref(nutzerStorage, 'zeiterfassung/e1/medien/m1'), bild, { contentType: 'image/png' }));
});
await pruefe('S8: eingeloggt -> PDF unter zeiterfassung/ ABGELEHNT (dort nur Bilder erlaubt)', async () => {
  await assertFails(uploadBytes(ref(nutzerStorage, 'zeiterfassung/e1/unterschrift'), bild, { contentType: 'application/pdf' }));
});

await pruefe('S9: eingeloggt -> PDF unter dokumente/{typ}/{id}/{docId} erlaubt (Arbeitsberichte etc.)', async () => {
  await assertSucceeds(uploadBytes(ref(nutzerStorage, 'dokumente/projekt/p1/d1'), bild, { contentType: 'application/pdf' }));
});

await pruefe('S10: eingeloggt -> unbekannter Pfad (kein Präfix passt) wird abgelehnt, weder Lesen noch Schreiben', async () => {
  await assertFails(uploadBytes(ref(nutzerStorage, 'irgendein-unbekannter-pfad/x'), bild, { contentType: 'image/jpeg' }));
  await assertFails(getBytes(ref(nutzerStorage, 'irgendein-unbekannter-pfad/x')));
});

await pruefe('S11: eingeloggt -> Lesen eines bekannten, bereits hochgeladenen Pfads erlaubt', async () => {
  await assertSucceeds(getBytes(ref(nutzerStorage, 'ausgaben/beleg1')));
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await testEnv.cleanup();
if (fehlgeschlagen > 0) process.exit(1);
