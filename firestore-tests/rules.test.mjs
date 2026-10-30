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
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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
await seedUser('techniker-1', { role: 'techniker', mitarbeiterId: 'ma-tech-1' });
await seedUser('techniker-2', { role: 'techniker', mitarbeiterId: 'ma-tech-2' });
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
  await setDoc(doc(ctx.firestore(), 'serviceauftraege', 'sa-1'), {
    externeAuftragsnummer: 'SE-001', kundenname: 'Max Mustermann', kundeId: 'kunde-1',
    technikerIds: ['ma-tech-1'], status: 'zugewiesen', technikerNotizen: '',
  });
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

// =============================================================================
// Phase 0/1 der Service-/Techniker-/Personalverwaltung: neue Rolle
// "techniker" + neue Collection "serviceauftraege" (siehe firestore.rules
// Kommentar dort für die Begründung jeder einzelnen Einschränkung).
// =============================================================================

await pruefe('R21: ein Techniker kann einen ihm zugewiesenen Serviceauftrag lesen', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertSucceeds(getDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1')));
});

await pruefe('R22: ein Techniker kann einen ihm NICHT zugewiesenen Serviceauftrag NICHT lesen', async () => {
  const tech2 = testEnv.authenticatedContext('techniker-2');
  await assertFails(getDoc(doc(tech2.firestore(), 'serviceauftraege', 'sa-1')));
});

await pruefe('R23: ein Techniker kann den Status des eigenen Auftrags auf "in_bearbeitung" setzen (nur status/technikerNotizen/aktualisiertAm geändert)', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung', technikerNotizen: 'Vor Ort, Anlage läuft.', aktualisiertAm: '2026-10-24',
  }));
});

await pruefe('R24: ein Techniker kann einen Serviceauftrag NICHT auf einen willkürlichen/unzulässigen Status setzen (z.B. zurück auf "offen")', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), { status: 'offen' }));
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), { status: 'abgebrochen' }));
});

await pruefe('R25: ein Techniker kann Kundenstammdaten oder die Technikerzuweisung eines eigenen Auftrags NICHT ändern', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung', kundenname: 'Manipuliert',
  }));
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung', technikerIds: ['ma-tech-1', 'ma-tech-2'],
  }));
});

await pruefe('R26: ein Techniker kann KEINEN neuen Serviceauftrag anlegen (kein Hauptauftrag) und keinen löschen', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(setDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-neu'), {
    externeAuftragsnummer: 'SE-002', technikerIds: ['ma-tech-1'], status: 'offen',
  }));
  await assertFails(deleteDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1')));
});

await pruefe('R27: admin/büro haben vollen Zugriff auf serviceauftraege (lesen, anlegen, beliebig ändern, löschen)', async () => {
  // Bewusst NICHT "sa-1" umschreiben - das ist die gemeinsame Fixture für
  // R21/R22/R28-R31 (dort muss techniker-1 weiterhin zugewiesen bleiben);
  // ein eigenes Dokument für den "beliebig ändern"-Nachweis statt die
  // anderen Tests durch eine dauerhafte Mutation zu verfälschen.
  const buero = testEnv.authenticatedContext('buero-1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'serviceauftraege', 'sa-buero-test'), {
      externeAuftragsnummer: 'SE-004', technikerIds: ['ma-tech-1'], status: 'zugewiesen',
    });
  });
  await assertSucceeds(getDoc(doc(buero.firestore(), 'serviceauftraege', 'sa-buero-test')));
  await assertSucceeds(updateDoc(doc(buero.firestore(), 'serviceauftraege', 'sa-buero-test'), { technikerIds: ['ma-tech-2'] }));
  await assertSucceeds(setDoc(doc(buero.firestore(), 'serviceauftraege', 'sa-2'), {
    externeAuftragsnummer: 'SE-003', technikerIds: [], status: 'offen',
  }));
  await assertSucceeds(deleteDoc(doc(buero.firestore(), 'serviceauftraege', 'sa-2')));
});

await pruefe('R28: ein Techniker hat KEINEN pauschalen Zugriff auf gemeinsame Collections (anders als "mitarbeiter" - bewusst nicht Teil von isAnyRole())', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(getDoc(doc(tech1.firestore(), 'aufgaben', 'aufgabe-1')));
  await assertFails(getDoc(doc(tech1.firestore(), 'kunden', 'kunde-1')));
});

await pruefe('R29: ein Techniker darf einstellungen/mitarbeiterOeffentlich trotzdem lesen (Basis-UI), aber nicht schreiben', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'einstellungen', 'global'), { firma: 'Test' });
  });
  await assertSucceeds(getDoc(doc(tech1.firestore(), 'einstellungen', 'global')));
  await assertFails(setDoc(doc(tech1.firestore(), 'einstellungen', 'global'), { firma: 'manipuliert' }));
});

// =============================================================================
// Phase 4 (mobile Technikeroberfläche): erweiterte Felddokumentation auf
// serviceauftraege (checklistenPunkte/maengel/zusatzarbeitVorschlag/
// berichtsentwurf) - weiterhin niemals Kundenstammdaten/Zuweisung.
// =============================================================================

await pruefe('R30: ein Techniker kann Checkliste, Mängel, Zusatzarbeit-Vorschlag und Berichtsentwurf des eigenen Auftrags zusammen mit dem Status speichern', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung',
    checklistenPunkte: [{ titel: 'Sichtprüfung durchgeführt', erledigt: true, notiz: '' }],
    maengel: 'Dichtung an der Außeneinheit porös.',
    zusatzarbeitVorschlag: 'Austausch der Dichtung empfohlen, ca. 1 Std. Zusatzaufwand.',
    berichtsentwurf: 'Jahreswartung durchgeführt, Anlage funktionstüchtig.',
  }));
});

await pruefe('R31: ein Techniker kann über diese erweiterten Felder TROTZDEM nicht die Technikerzuweisung oder Kundendaten ändern', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung', checklistenPunkte: [], technikerIds: ['ma-tech-1', 'ma-tech-2'],
  }));
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung', maengel: 'x', kundenname: 'Manipuliert',
  }));
});

await pruefe('R31b: ein Techniker kann die Materialliste des eigenen Auftrags abhaken (zusammen mit dem Status)', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    status: 'in_bearbeitung',
    materialliste: [{ titel: 'Kältemittel R32', erledigt: true }],
  }));
});

await pruefe('R31c: Materialliste alleine (ohne die übrigen erlaubten Felder) ist für den eigenen Auftrag ebenfalls erlaubt', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-1'), {
    materialliste: [{ titel: 'Ersatzfilter', erledigt: true }],
  }));
});

// =============================================================================
// Service-/Techniker-/Personalverwaltung Phase 2 (JARVIS SmartDispatch):
// jarvisTechnikerVorschlaege wie alle übrigen jarvis*-Collections admin-only
// lesbar, niemals clientseitig beschreibbar.
// =============================================================================

await pruefe('R32: jarvisTechnikerVorschlaege ist NUR für admin lesbar, nicht für büro/mitarbeiter/techniker', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'jarvisTechnikerVorschlaege', 'sa-1'), { auftragId: 'sa-1', status: 'vorschlag_erstellt' });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'jarvisTechnikerVorschlaege', 'sa-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'jarvisTechnikerVorschlaege', 'sa-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'jarvisTechnikerVorschlaege', 'sa-1')));
});

await pruefe('R33: jarvisTechnikerVorschlaege ist NIEMALS clientseitig beschreibbar, auch nicht für admin', async () => {
  const admin = testEnv.authenticatedContext('admin-1');
  await assertFails(updateDoc(doc(admin.firestore(), 'jarvisTechnikerVorschlaege', 'sa-1'), { freigabeStatus: 'freigegeben' }));
});

// =============================================================================
// Service-/Techniker-/Personalverwaltung Phase 9 (Reisekosten und
// Verpflegungspauschalen): reisekostensaetze (admin-only Schreibzugriff,
// breit lesbar) + reisekostenabrechnungen (eigene Entwürfe, nie Selbst-
// genehmigung).
// =============================================================================

await pruefe('R34: reisekostensaetze ist für alle internen Rollen inkl. Techniker lesbar, aber nur admin darf schreiben', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'reisekostensaetze', 'satz-2020'), { gueltigAb: '2020-01-01', gueltigBis: '', verpflegungGanztag: 28 });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'reisekostensaetze', 'satz-2020')));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'reisekostensaetze', 'satz-2020')));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'reisekostensaetze', 'satz-2020'), { verpflegungGanztag: 99 }));
  await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'reisekostensaetze', 'satz-2020'), { verpflegungGanztag: 29 }));
});

await pruefe('R35: ein Techniker kann eine EIGENE Reisekostenabrechnung als Entwurf anlegen und bearbeiten', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertSucceeds(setDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-1'), {
    mitarbeiterId: 'ma-tech-1', status: 'entwurf', von: '2026-03-10T08:00', bis: '2026-03-10T18:00', anlass: 'Kundentermin',
  }));
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-1'), { anlass: 'Kundentermin (korrigiert)' }));
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-1'), { status: 'eingereicht' }));
});

await pruefe('R36: ein Techniker kann KEINE fremde Reisekostenabrechnung anlegen/lesen/bearbeiten', async () => {
  const tech2 = testEnv.authenticatedContext('techniker-2');
  await assertFails(getDoc(doc(tech2.firestore(), 'reisekostenabrechnungen', 'rk-1')));
  await assertFails(setDoc(doc(tech2.firestore(), 'reisekostenabrechnungen', 'rk-fremd'), { mitarbeiterId: 'ma-tech-1', status: 'entwurf' }));
  await assertFails(updateDoc(doc(tech2.firestore(), 'reisekostenabrechnungen', 'rk-1'), { anlass: 'Manipuliert' }));
});

await pruefe('R37: ein Techniker kann die EIGENE Reisekostenabrechnung NICHT selbst genehmigen/ablehnen/prüfen', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-1'), { status: 'genehmigt' }));
  await assertFails(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-1'), { status: 'abgelehnt' }));
});

await pruefe('R38: admin/büro können jede Reisekostenabrechnung lesen und genehmigen/ablehnen', async () => {
  const buero = testEnv.authenticatedContext('buero-1');
  await assertSucceeds(getDoc(doc(buero.firestore(), 'reisekostenabrechnungen', 'rk-1')));
  await assertSucceeds(updateDoc(doc(buero.firestore(), 'reisekostenabrechnungen', 'rk-1'), { status: 'genehmigt', geprueftVonUid: 'buero-1' }));
});

await pruefe('R39: ein Mitarbeiter kann nach erfolgter Genehmigung seine eigene Abrechnung NICHT mehr nachträglich ändern', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await assertFails(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-1'), { anlass: 'nachträglich verändert' }));
});

// =============================================================================
// Service-/Techniker-/Personalverwaltung Phase 8 (Performance- und
// Bonus-Simulation): bonusreferenzwerte - admin/büro lesbar (die Ansicht ist
// ohnehin admin/büro-only), nur admin darf schreiben, mitarbeiter/techniker
// haben KEINEN Zugriff (keine Geschäftsentscheidung für Nicht-Büro-Rollen).
// =============================================================================

await pruefe('R40: bonusreferenzwerte ist nur für admin/büro lesbar, mitarbeiter/techniker haben keinen Zugriff', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'bonusreferenzwerte', 'r-1'), {
      kennzahl: 'abgeschlosseneAuftraege', schwellenwert: 10, bonusBetrag: 100, gueltigAb: '2026-01-01', gueltigBis: '',
    });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'bonusreferenzwerte', 'r-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'bonusreferenzwerte', 'r-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'bonusreferenzwerte', 'r-1')));
});

await pruefe('R41: nur admin darf einen Bonus-Referenzwert anlegen/ändern, büro NICHT (globale Planungsregel)', async () => {
  await assertFails(setDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'bonusreferenzwerte', 'r-2'), {
    kennzahl: 'istStunden', schwellenwert: 150, bonusBetrag: 50, gueltigAb: '2026-01-01', gueltigBis: '',
  }));
  await assertSucceeds(setDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'bonusreferenzwerte', 'r-2'), {
    kennzahl: 'istStunden', schwellenwert: 150, bonusBetrag: 50, gueltigAb: '2026-01-01', gueltigBis: '',
  }));
});

// =============================================================================
// Service-/Techniker-/Personalverwaltung Phase 10-13 (Mitarbeiter-Benefits,
// Steuerregeln, Gesamtkosten): mitarbeiterBenefits ist admin/büro-Vollzugriff
// wie "mitarbeiter" selbst, benefitSteuerregeln admin-only Schreibzugriff.
// =============================================================================

await pruefe('R42: mitarbeiterBenefits ist admin/büro-Vollzugriff, aber NICHT für mitarbeiter/techniker lesbar (genauso schützenswert wie mitarbeiter selbst)', async () => {
  await assertSucceeds(setDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'mitarbeiterBenefits', 'b-1'), {
    mitarbeiterId: 'ma-tech-1', benefitTyp: 'jobrad', arbeitgeberKostenMonatlich: 30, beginnDatum: '2026-01-01', endeDatum: '',
  }));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'mitarbeiterBenefits', 'b-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'mitarbeiterBenefits', 'b-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'mitarbeiterBenefits', 'b-1')));
});

await pruefe('R43: benefitSteuerregeln ist admin/büro lesbar, aber nur admin darf schreiben, mitarbeiter/techniker haben keinen Zugriff', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'benefitSteuerregeln', 's-1'), {
      benefitTyp: 'sachbezug', regelBeschreibung: 'Sachbezugsfreigrenze 50 EUR/Monat', gueltigAb: '2022-01-01', gueltigBis: '', quelle: '§8 Abs. 2 Satz 11 EStG',
    });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'benefitSteuerregeln', 's-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'benefitSteuerregeln', 's-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'benefitSteuerregeln', 's-1')));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'benefitSteuerregeln', 's-1'), { regelBeschreibung: 'manipuliert' }));
  await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'benefitSteuerregeln', 's-1'), { regelBeschreibung: 'Sachbezugsfreigrenze 50 EUR/Monat (korrigiert)' }));
});

// =============================================================================
// Phase 15 (Sicherheits-Härtungspass) - zwei bei der Prüfung gefundene Lücken:
// serviceauftraege erlaubte bisher jeden ZIELstatus-Wechsel unabhängig vom
// AUSGANGSstatus (ein Techniker konnte einen bereits "abgebrochen"en Auftrag
// auf "abgeschlossen" setzen und damit eine Büro-Entscheidung umgehen);
// reisekostenabrechnungen erlaubte inhaltliche Änderungen auch noch NACH dem
// Einreichen, solange der Status in ['entwurf','eingereicht'] blieb.
// =============================================================================

await pruefe('R44: ein Techniker kann einen bereits ABGEBROCHENEN Serviceauftrag NICHT per Status-Update "abschließen" (Büro-Entscheidung darf nicht umgangen werden)', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'serviceauftraege', 'sa-abgebrochen'), {
      externeAuftragsnummer: 'SE-005', technikerIds: ['ma-tech-1'], status: 'abgebrochen',
    });
  });
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-abgebrochen'), { status: 'abgeschlossen' }));
  await assertFails(updateDoc(doc(tech1.firestore(), 'serviceauftraege', 'sa-abgebrochen'), { status: 'in_bearbeitung' }));
});

await pruefe('R45: ein Mitarbeiter kann eine bereits EINGEREICHTE Reisekostenabrechnung nicht mehr inhaltlich ändern (nur noch den Status selbst, z.B. zurückziehen)', async () => {
  const tech1 = testEnv.authenticatedContext('techniker-1');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'reisekostenabrechnungen', 'rk-eingereicht'), {
      mitarbeiterId: 'ma-tech-1', status: 'eingereicht', von: '2026-03-10T08:00', bis: '2026-03-10T18:00', anlass: 'Kundentermin', kilometer: 10,
    });
  });
  await assertFails(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-eingereicht'), { kilometer: 500 }));
  await assertFails(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-eingereicht'), { anlass: 'nachträglich erhöht' }));
  // Zurückziehen auf "entwurf" bleibt erlaubt (nur der Status ändert sich) -
  // und erst DANACH darf wieder inhaltlich bearbeitet werden.
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-eingereicht'), { status: 'entwurf' }));
  await assertSucceeds(updateDoc(doc(tech1.firestore(), 'reisekostenabrechnungen', 'rk-eingereicht'), { kilometer: 500 }));
});

// =============================================================================
// KI-Wartungsdisposition MVP Phase 1 (Screenshot-Import Partner-
// Wartungsaufträge): jarvisPartnerImportEntwuerfe ist admin-only lesbar und
// NIEMALS clientseitig beschreibbar, wie alle anderen jarvis*-Collections.
// =============================================================================

await pruefe('R46: jarvisPartnerImportEntwuerfe ist NUR für admin lesbar, nicht für büro/mitarbeiter/techniker', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'jarvisPartnerImportEntwuerfe', 'batch-1'), { partnerId: 'wr-gruppe', zeilen: [] });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'jarvisPartnerImportEntwuerfe', 'batch-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'jarvisPartnerImportEntwuerfe', 'batch-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'jarvisPartnerImportEntwuerfe', 'batch-1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'jarvisPartnerImportEntwuerfe', 'batch-1')));
});

await pruefe('R47: jarvisPartnerImportEntwuerfe ist NIEMALS clientseitig beschreibbar, auch nicht für admin', async () => {
  await assertFails(updateDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'jarvisPartnerImportEntwuerfe', 'batch-1'), { partnerId: 'manipuliert' }));
});

// =============================================================================
// P0-Sicherheitskorrektur 28.10.2026 (Master-Audit Bericht 03, Risiko #2):
// eine versendete (GoBD-gesperrte) Rechnung darf sich serverseitig nicht
// mehr inhaltlich ändern oder hart löschen lassen - vorher schützte nur
// eine Oberflächen-Variable (rechnungen.js "locked"), ein direkter
// Firestore-Zugriff mit admin/büro-Rolle konnte das umgehen.
// =============================================================================

const RECHNUNG_ENTWURF = {
  nummer: 'R-2026-0001', datum: '2026-01-10', kundeId: 'kunde-1', projektId: '', positionen: [{ menge: 1, einzelpreis: 100 }],
  netto: 100, steuer: 19, brutto: 119, steuerart: 'regel', betreff: 'Test', versendet: false,
};
const RECHNUNG_VERSENDET = { ...RECHNUNG_ENTWURF, nummer: 'R-2026-0002', versendet: true };

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'rechnungen', 'r-entwurf'), RECHNUNG_ENTWURF);
  await setDoc(doc(ctx.firestore(), 'rechnungen', 'r-versendet'), RECHNUNG_VERSENDET);
});

await pruefe('R48: büro kann eine neue Rechnung anlegen, mitarbeiter nicht', async () => {
  await assertSucceeds(setDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'rechnungen', 'r-neu'), RECHNUNG_ENTWURF));
  await assertFails(setDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'rechnungen', 'r-neu-2'), RECHNUNG_ENTWURF));
});

await pruefe('R49: ein NICHT versendeter Rechnungsentwurf lässt sich inhaltlich frei bearbeiten (admin/büro)', async () => {
  await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'rechnungen', 'r-entwurf'), { netto: 200, steuer: 38, brutto: 238 }));
});

await pruefe('R50: eine VERSENDETE Rechnung darf ihren Inhalt (Betrag) NICHT mehr ändern, auch nicht für admin', async () => {
  await assertFails(updateDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-versendet'), { netto: 999, steuer: 190, brutto: 1189 }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'rechnungen', 'r-versendet'), { positionen: [{ menge: 99, einzelpreis: 1 }] }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-versendet'), { kundeId: 'kunde-2' }));
});

await pruefe('R51: eine VERSENDETE Rechnung darf weiterhin Status/Zahlungs-/Verknüpfungsfelder ändern (Storno, Zahlungseingang)', async () => {
  await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext('buero-1').firestore(), 'rechnungen', 'r-versendet'), { status: 'bezahlt', bezahltAm: '2026-02-01', skontoGenutzt: false, zahlungsart: 'ueberweisung' }));
  await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-versendet'), { status: 'storniert', storniertDurchNummer: 'R-2026-0099', verrechneteGutschriften: [], gutschriftVerrechnetAm: '' }));
});

await pruefe('R52: eine VERSENDETE Rechnung lässt sich nie hart löschen, auch nicht als admin oder im Papierkorb', async () => {
  await assertFails(deleteDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-versendet')));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rechnungen', 'r-versendet'), { ...RECHNUNG_VERSENDET, _geloescht: true, _geloeschtAm: '2000-01-01T00:00:00.000Z' });
  });
  await assertFails(deleteDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-versendet')));
});

await pruefe('R53: ein NICHT versendeter, bereits im Papierkorb liegender Rechnungsentwurf lässt sich endgültig löschen', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rechnungen', 'r-entwurf-geloescht'), { ...RECHNUNG_ENTWURF, _geloescht: true, _geloeschtAm: '2000-01-01T00:00:00.000Z' });
  });
  await assertSucceeds(deleteDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-entwurf-geloescht')));
});

await pruefe('R54: ein NICHT versendeter Entwurf, der NOCH NICHT im Papierkorb liegt, lässt sich nicht direkt hart löschen (muss erst weich gelöscht werden)', async () => {
  await assertFails(deleteDoc(doc(testEnv.authenticatedContext('admin-1').firestore(), 'rechnungen', 'r-entwurf')));
});

await pruefe('R55: ein Kunde sieht nur seine eigenen Rechnungen, mitarbeiter/techniker sehen gar keine', async () => {
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('kunde-1').firestore(), 'rechnungen', 'r-entwurf')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('kunde-2').firestore(), 'rechnungen', 'r-entwurf')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('mitarbeiter-1').firestore(), 'rechnungen', 'r-entwurf')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('techniker-1').firestore(), 'rechnungen', 'r-entwurf')));
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await testEnv.cleanup();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
