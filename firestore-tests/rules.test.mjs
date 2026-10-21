// Echter Firestore-Security-Rules-Test gegen einen LAUFENDEN Firestore-
// Emulator (nicht nur gegen die Cloudflare-Worker-Mocks in
// cloudflare-worker/jarvis-tests/) - deckt firestore.rules direkt ab: wer
// darf welche Collection lesen/schreiben, abhängig von der Rolle in
// users/{uid}.role.
//
// Phase 10.1 Hintergrund: der Phase-9-Commit (3adaac6) behauptete
// "38/38 Firestore-Regel-Tests ... grün", obwohl zu keinem Zeitpunkt eine
// solche Testdatei, eine firebase.json mit "emulators"-Block oder
// firebase-tools/@firebase/rules-unit-testing im Repo vorhanden waren -
// diese Behauptung war nicht verifizierbar/reproduzierbar. Diese Datei
// ersetzt das NICHT 1:1 (die ursprünglichen 38 Einzeltests sind nirgends
// dokumentiert und lassen sich nicht rekonstruieren), deckt aber die
// sicherheitskritischsten Regeln ab, die in Phase 9/10 tatsächlich bearbeitet
// wurden (siriGeraeteTokens, jarvisAktionen, sensible Collections, users).
//
// Ausführen (braucht einmalig "npm install" im Repo-Root):
//   npm run test:rules
// (nutzt "firebase emulators:exec", startet/stoppt den Firestore-Emulator
// automatisch; erfordert eine lokale Java-Installation, die der Emulator
// selbst benötigt)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const hierDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(hierDir, '..', 'firestore.rules'), 'utf8');

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [host, portStr] = emulatorHost.split(':');

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-test',
  firestore: { host, port: Number(portStr), rules },
});

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}

async function seedUser(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}

await testEnv.clearFirestore();
await seedUser('admin-1', { role: 'admin' });
await seedUser('buero-1', { role: 'buero' });
await seedUser('mitarbeiter-1', { role: 'mitarbeiter' });
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'siriGeraeteTokens', 'tok-1'), { label: 'Test' });
  await setDoc(doc(ctx.firestore(), 'jarvisAktionen', 'akt-1'), { status: 'pending' });
  await setDoc(doc(ctx.firestore(), 'kunden', 'kunde-1'), { firma: 'Test' });
});

await pruefe('R1: nicht angemeldeter Nutzer kann siriGeraeteTokens NICHT lesen', async () => {
  const unauth = testEnv.unauthenticatedContext();
  await assertFails(getDoc(doc(unauth.firestore(), 'siriGeraeteTokens', 'tok-1')));
});

await pruefe('R2: Rolle "buero" kann siriGeraeteTokens NICHT lesen (nur admin)', async () => {
  const buero = testEnv.authenticatedContext('buero-1');
  await assertFails(getDoc(doc(buero.firestore(), 'siriGeraeteTokens', 'tok-1')));
});

await pruefe('R3: Rolle "admin" KANN siriGeraeteTokens lesen', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertSucceeds(getDoc(doc(admin.firestore(), 'siriGeraeteTokens', 'tok-1')));
});

await pruefe('R4: Rolle "admin" kann jarvisAktionen NICHT schreiben (write:false - rein serverseitig per Service-Account, nie direkt aus dem Browser)', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertFails(setDoc(doc(admin.firestore(), 'jarvisAktionen', 'akt-1'), { status: 'freigegeben' }));
});

await pruefe('R5: Rolle "admin" KANN jarvisAktionen lesen', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertSucceeds(getDoc(doc(admin.firestore(), 'jarvisAktionen', 'akt-1')));
});

await pruefe('R6: Rolle "mitarbeiter" kann die sensible Collection "kunden" NICHT lesen (nur admin/büro)', async () => {
  const mitarbeiter = testEnv.authenticatedContext('mitarbeiter-1');
  await assertFails(getDoc(doc(mitarbeiter.firestore(), 'kunden', 'kunde-1')));
});

await pruefe('R7: Rolle "buero" KANN die sensible Collection "kunden" lesen', async () => {
  const buero = testEnv.authenticatedContext('buero-1');
  await assertSucceeds(getDoc(doc(buero.firestore(), 'kunden', 'kunde-1')));
});

await pruefe('R8: ein Nutzer kann sein EIGENES users-Dokument lesen, aber nicht das eines anderen (außer admin)', async () => {
  const buero = testEnv.authenticatedContext('buero-1');
  await assertSucceeds(getDoc(doc(buero.firestore(), 'users', 'buero-1')));
  await assertFails(getDoc(doc(buero.firestore(), 'users', 'mitarbeiter-1')));
  const admin = testEnv.authenticatedContext('admin-1');
  await assertSucceeds(getDoc(doc(admin.firestore(), 'users', 'mitarbeiter-1')));
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await testEnv.cleanup();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
