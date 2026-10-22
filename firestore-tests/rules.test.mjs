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
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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
await seedUser('admin-2', { role: 'admin' });
await seedUser('kunde-1', { role: 'kunde', kundeId: 'kunde-1' });
await seedUser('kunde-2', { role: 'kunde', kundeId: 'kunde-2' });
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'siriGeraeteTokens', 'tok-1'), { label: 'Test' });
  await setDoc(doc(ctx.firestore(), 'jarvisAktionen', 'akt-1'), { status: 'pending' });
  await setDoc(doc(ctx.firestore(), 'kunden', 'kunde-1'), { firma: 'Test' });
  await setDoc(doc(ctx.firestore(), 'angebote', 'angebot-1'), { kundeId: 'kunde-1', titel: 'Test-Angebot' });
  await setDoc(doc(ctx.firestore(), 'belegVorschlaege', 'vorschlag-1'), {
    ausgabeId: 'a1', status: 'offen',
    alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 100 }, erwarteteVersion: 'v1',
  });
  await setDoc(doc(ctx.firestore(), 'aufgaben', 'aufgabe-1'), { titel: 'Test-Aufgabe' });
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

// =============================================================================
// Phase 11 Punkt 3: erweiterte Rollenprüfung - Kundenportal (strikt auf
// eigene kundeId beschränkt), gemeinsam genutzte Collections (alle drei
// internen Rollen), und die neue belegVorschlaege-Collection (Phase 11
// Punkt 1, bulkFixReceipts-Vorschlagsmodus - admin/büro wie "ausgaben").
// =============================================================================

await pruefe('R9: Rolle "kunde" kann NUR das eigene Kunden-Dokument lesen, nicht das eines anderen Kunden', async () => {
  const kunde1 = testEnv.authenticatedContext('kunde-1');
  await assertSucceeds(getDoc(doc(kunde1.firestore(), 'kunden', 'kunde-1')));
  await assertFails(getDoc(doc(kunde1.firestore(), 'kunden', 'kunde-2')));
});

await pruefe('R10: Rolle "kunde" kann ein Angebot lesen, das zur eigenen kundeId gehört, aber keine interne Collection wie "aufgaben"', async () => {
  const kunde1 = testEnv.authenticatedContext('kunde-1');
  await assertSucceeds(getDoc(doc(kunde1.firestore(), 'angebote', 'angebot-1')));
  await assertFails(getDoc(doc(kunde1.firestore(), 'aufgaben', 'aufgabe-1')));
});

await pruefe('R11: "kunde" hat KEINEN Zugriff über die generelle isSensitiveCollection/isSharedCollection-Regel (nicht Teil von isAnyRole())', async () => {
  const kunde1 = testEnv.authenticatedContext('kunde-1');
  await assertFails(getDoc(doc(kunde1.firestore(), 'kunden', 'kunde-1-nicht-vorhanden')));
  await assertFails(setDoc(doc(kunde1.firestore(), 'angebote', 'angebot-1'), { titel: 'manipuliert' }));
});

await pruefe('R12: alle drei internen Rollen (admin/büro/mitarbeiter) dürfen die geteilte Collection "aufgaben" lesen', async () => {
  for (const uid of ['admin-1', 'buero-1', 'mitarbeiter-1']) {
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(uid).firestore(), 'aufgaben', 'aufgabe-1')));
  }
});

await pruefe('R13: Rolle "admin" KANN einen offenen Beleg-Vorschlag per Teil-Update korrekt ablehnen (eigene uid als abgelehntVonUid, keine inhaltlichen Felder geändert)', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertSucceeds(getDoc(doc(admin.firestore(), 'belegVorschlaege', 'vorschlag-1')));
  await assertSucceeds(updateDoc(doc(admin.firestore(), 'belegVorschlaege', 'vorschlag-1'), { status: 'abgelehnt', abgelehntVonUid: 'admin-1' }));
});

await pruefe('R14: Rolle "mitarbeiter" kann belegVorschlaege NICHT lesen UND NICHT schreiben (bewusst admin-only, siehe unten)', async () => {
  const mitarbeiter = testEnv.authenticatedContext('mitarbeiter-1');
  await assertFails(getDoc(doc(mitarbeiter.firestore(), 'belegVorschlaege', 'vorschlag-1')));
  await assertFails(updateDoc(doc(mitarbeiter.firestore(), 'belegVorschlaege', 'vorschlag-1'), { status: 'abgelehnt', abgelehntVonUid: 'mitarbeiter-1' }));
});

await pruefe('R14b: Rolle "büro" kann belegVorschlaege NICHT lesen/schreiben - bewusst ADMIN-ONLY, anders als "ausgaben" selbst (JARVIS/KI-Bürokraft-Automation ist im gesamten Rollout auf admin beschränkt)', async () => {
  const buero = testEnv.authenticatedContext('buero-1');
  await assertFails(getDoc(doc(buero.firestore(), 'belegVorschlaege', 'vorschlag-1')));
  await assertFails(updateDoc(doc(buero.firestore(), 'belegVorschlaege', 'vorschlag-1'), { status: 'abgelehnt', abgelehntVonUid: 'buero-1' }));
});

// =============================================================================
// Phase 11.1 Punkt 1: Belegfreigaben dürfen NICHT allein durch Client-Code
// (belegvorschlaege.js) abgesichert sein - die folgenden Angriffe müssen
// SERVERSEITIG (durch firestore.rules selbst) abgelehnt werden, unabhängig
// davon, ob sie über die echte App, eine manipulierte Browseranfrage oder
// eine veränderte JavaScript-Datei kommen. Jeder dieser Tests simuliert
// genau das: ein direkter Firestore-Schreibzugriff, der belegvorschlaege.js
// komplett umgeht.
// =============================================================================

await pruefe('R16: ein admin/büro-Nutzer kann über einen direkten Schreibzugriff NICHT die inhaltlichen Felder eines Vorschlags verändern (z.B. neueWerte nachträglich erhöhen) und ihn dabei "freigeben"', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertFails(updateDoc(doc(admin.firestore(), 'belegVorschlaege', 'vorschlag-1'), {
    status: 'freigegeben', freigegebenVonUid: 'admin-1', neueWerte: { betragBrutto: 999999 },
  }));
});

await pruefe('R17: ein bereits entschiedener Vorschlag (nicht mehr "offen") kann NICHT erneut freigegeben/abgelehnt werden - verhindert eine doppelte Anwendung über einen direkten Schreibzugriff', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'belegVorschlaege', 'vorschlag-entschieden'), {
      ausgabeId: 'a1', status: 'freigegeben', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 100 }, erwarteteVersion: 'v1',
    });
  });
  await assertFails(updateDoc(doc(admin.firestore(), 'belegVorschlaege', 'vorschlag-entschieden'), { status: 'abgelehnt', abgelehntVonUid: 'admin-1' }));
});

await pruefe('R18: ein zweiter, ebenfalls berechtigter admin kann eine Freigabe NICHT im Namen eines ANDEREN Nutzers eintragen (freigegebenVonUid muss der eigenen uid entsprechen, auch wenn die Rolle an sich passt)', async () => {
  const admin2 = testEnv.authenticatedContext('admin-2');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'belegVorschlaege', 'vorschlag-fremd'), {
      ausgabeId: 'a1', status: 'offen', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 100 }, erwarteteVersion: 'v1',
    });
  });
  await assertFails(updateDoc(doc(admin2.firestore(), 'belegVorschlaege', 'vorschlag-fremd'), { status: 'freigegeben', freigegebenVonUid: 'admin-1' }));
  await assertSucceeds(updateDoc(doc(admin2.firestore(), 'belegVorschlaege', 'vorschlag-fremd'), { status: 'freigegeben', freigegebenVonUid: 'admin-2' }));
});

await pruefe('R19: aus dem Browser kann NIE ein neuer Beleg-Vorschlag angelegt werden - das darf ausschließlich der KI-Bürokraft-Worker per Service-Account (umgeht Regeln per Definition)', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertFails(setDoc(doc(admin.firestore(), 'belegVorschlaege', 'selbst-erfunden'), {
    ausgabeId: 'a1', status: 'offen', alteWerte: {}, neueWerte: { betragBrutto: 50000 }, erwarteteVersion: 'x',
  }));
});

await pruefe('R20: ein Beleg-Vorschlag kann NICHT auf einen willkürlichen Zielstatus gesetzt werden (z.B. direkt zurück auf "offen" oder einen erfundenen Status)', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'belegVorschlaege', 'vorschlag-status-check'), {
      ausgabeId: 'a1', status: 'offen', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 100 }, erwarteteVersion: 'v1',
    });
  });
  await assertFails(updateDoc(doc(admin.firestore(), 'belegVorschlaege', 'vorschlag-status-check'), { status: 'erfundener-status' }));
});

await pruefe('R15: ein nicht angemeldeter Nutzer kann KEINE einzige der oben genannten Collections lesen', async () => {
  const unauth = testEnv.unauthenticatedContext();
  await assertFails(getDoc(doc(unauth.firestore(), 'belegVorschlaege', 'vorschlag-1')));
  await assertFails(getDoc(doc(unauth.firestore(), 'aufgaben', 'aufgabe-1')));
  await assertFails(getDoc(doc(unauth.firestore(), 'kunden', 'kunde-1')));
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await testEnv.cleanup();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
