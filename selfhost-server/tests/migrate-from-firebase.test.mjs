// Tests für runMigration() aus ../migrate-from-firebase.mjs - mit einem
// Fake-Firestore-Client statt eines echten Projekts (kein Netzwerk, keine
// Zugangsdaten nötig). Deckt die eigentliche Übertragungslogik ab: normale
// Collections, den "einstellungen"-Sonderfall (ein Dokument -> viele Zeilen)
// und die Einladungs-statt-Passwort-Behandlung von "users".
//
// Ausführen: node selfhost-server/tests/migrate-from-firebase.test.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigration } from '../migrate-from-firebase.mjs';
import { openStore } from '../lib/store.js';

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// Minimaler Fake, der nur die Methoden unterstützt, die runMigration() nutzt:
// firestore.collection(name).get() -> { docs: [{ id, data() }] }, plus
// firestore.collection('einstellungen').doc('global').get() -> { exists, data() }.
function fakeFirestore(daten) {
  return {
    collection(name) {
      return {
        async get() {
          const rows = daten[name] || [];
          return { docs: rows.map((r) => ({ id: r.id, data: () => r })) };
        },
        doc(id) {
          return {
            async get() {
              const row = (daten[name] || []).find((r) => r.id === id);
              return { exists: !!row, data: () => row };
            },
          };
        },
      };
    },
  };
}

async function mitTempStore(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'werkora-migrate-test-'));
  const store = openStore(path.join(dir, 'test.db'));
  try {
    await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

await pruefe('normale Collection wird 1:1 übertragen', async () => {
  await mitTempStore(async (store) => {
    const firestore = fakeFirestore({ kunden: [{ id: 'k1', firma: 'Testfirma' }] });
    await runMigration({ firestore, store, log: () => {} });
    const ergebnis = store.get('kunden', 'k1');
    assert(ergebnis?.firma === 'Testfirma', 'Kunde sollte übertragen worden sein');
  });
});

await pruefe('einstellungen-Dokument wird in einzelne Zeilen aufgeteilt', async () => {
  await mitTempStore(async (store) => {
    const firestore = fakeFirestore({});
    firestore.collection = ((orig) => (name) => {
      if (name === 'einstellungen') {
        return {
          doc: () => ({ async get() { return { exists: true, data: () => ({ firmenname: 'neuverdrahtet UG', standardSteuersatz: 19 }) }; } }),
        };
      }
      return orig(name);
    })(firestore.collection.bind(firestore));
    await runMigration({ firestore, store, log: () => {} });
    assert(store.get('einstellungen', 'firmenname')?.value === 'neuverdrahtet UG', 'firmenname sollte übertragen sein');
    assert(store.get('einstellungen', 'standardSteuersatz')?.value === 19, 'standardSteuersatz sollte übertragen sein');
  });
});

await pruefe('users wird NICHT direkt übertragen, aber Einladung erzeugt', async () => {
  await mitTempStore(async (store) => {
    const firestore = fakeFirestore({
      users: [{ id: 'uid1', email: 'mitarbeiter@example.com', role: 'mitarbeiter', mitarbeiterId: 'ma-1', name: 'Max' }],
    });
    const ergebnis = await runMigration({ firestore, store, log: () => {} });
    assert(store.get('users', 'uid1') === undefined, 'users darf NICHT direkt übertragen werden (kein Passwort vorhanden)');
    const einladung = store.get('invites', 'mitarbeiter@example.com');
    assert(einladung?.role === 'mitarbeiter', 'Einladung sollte mit derselben Rolle angelegt werden');
    assert(einladung?.mitarbeiterId === 'ma-1', 'Einladung sollte mitarbeiterId übernehmen');
    assert(ergebnis.einladungenErstellt.includes('mitarbeiter@example.com'), 'E-Mail sollte im Bericht auftauchen');
  });
});

await pruefe('vorhandene Einladung wird nicht überschrieben', async () => {
  await mitTempStore(async (store) => {
    store.put('invites', { id: 'kunde@example.com', role: 'kunde', kundeId: 'alt-id', name: 'Alt' });
    const firestore = fakeFirestore({
      users: [{ id: 'uid2', email: 'kunde@example.com', role: 'kunde', kundeId: 'neu-id', name: 'Neu' }],
    });
    await runMigration({ firestore, store, log: () => {} });
    assert(store.get('invites', 'kunde@example.com')?.kundeId === 'alt-id', 'bestehende Einladung sollte unverändert bleiben');
  });
});

await pruefe('dry-run schreibt nichts', async () => {
  await mitTempStore(async (store) => {
    const firestore = fakeFirestore({ kunden: [{ id: 'k1', firma: 'Testfirma' }] });
    await runMigration({ firestore, store, dryRun: true, log: () => {} });
    assert(store.get('kunden', 'k1') === undefined, 'im dry-run darf nichts geschrieben werden');
  });
});

await pruefe('Timestamp-ähnliche Werte werden in ISO-Strings umgewandelt', async () => {
  await mitTempStore(async (store) => {
    const firestoreTimestamp = { toDate: () => new Date('2026-01-01T00:00:00.000Z') };
    const firestore = fakeFirestore({ termine: [{ id: 't1', beginn: firestoreTimestamp }] });
    await runMigration({ firestore, store, log: () => {} });
    assert(store.get('termine', 't1')?.beginn === '2026-01-01T00:00:00.000Z', 'Timestamp sollte als ISO-String übernommen werden');
  });
});

await pruefe('Lesefehler einer Collection bricht die übrige Migration nicht ab', async () => {
  await mitTempStore(async (store) => {
    const firestore = fakeFirestore({ kunden: [{ id: 'k1', firma: 'Testfirma' }] });
    const original = firestore.collection.bind(firestore);
    firestore.collection = (name) => {
      if (name === 'projekte') return { async get() { throw new Error('keine Berechtigung'); } };
      return original(name);
    };
    const ergebnis = await runMigration({ firestore, store, log: () => {} });
    assert(store.get('kunden', 'k1')?.firma === 'Testfirma', 'andere Collections sollten trotzdem übertragen werden');
    assert(ergebnis.fehler.some((f) => f.includes('projekte')), 'Fehler sollte berichtet werden');
  });
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
