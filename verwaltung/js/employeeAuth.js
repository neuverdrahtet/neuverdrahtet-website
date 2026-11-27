import { firebaseConfig } from './firebase-config.js';
import { selfhostConfig } from './selfhost-config.js';
import { getAllSelfhost, putSelfhost, removeSelfhost } from './selfhostClient.js';

// Nur relevant, wenn Selfhost-Server oder Firebase aktiv sind (Phase C: echtes
// Mitarbeiter-Login, später erweitert um Kundenportal-Zugang - gleicher
// invites/users-Mechanismus, nur mit kundeId statt mitarbeiterId verknüpft).
// Im IndexedDB-Modus bleibt der alte Zugangscode in mitarbeiter.js die
// einzige Zugangssteuerung, dieses Modul wird dann gar nicht importiert/
// aufgerufen.
const SELFHOST_ENABLED = !!selfhostConfig.enabled;
// Name bewusst beibehalten (wird von mehreren views als Gate "ist irgendein
// Remote-Auth-Backend aktiv, das Mitarbeiter-/Kundenportal-Logins
// unterstützt" importiert, z.B. mitarbeiter.js/kunden.js) - der Wert gilt
// jetzt auch im Selfhost-Betrieb als wahr, da dieser dieselbe Einladungs-/
// Portal-Funktion unterstützt, nur über den eigenen Server statt Firestore.
export const FIREBASE_ENABLED = SELFHOST_ENABLED || !!firebaseConfig.projectId;

async function fs() {
  const { firestore } = await import('./firebase.js');
  const mod = await import('./vendor/firebase/firebase-firestore.js');
  return { firestore, ...mod };
}

export async function inviteEmployee({ email, role, mitarbeiterId, name }) {
  if (SELFHOST_ENABLED) {
    await putSelfhost('invites', { id: email, role, mitarbeiterId, name, createdAt: new Date().toISOString() });
    return;
  }
  const { firestore, doc, setDoc } = await fs();
  await setDoc(doc(firestore, 'invites', email), {
    role, mitarbeiterId, name, createdAt: new Date().toISOString(),
  });
}

export async function revokeInvite(email) {
  if (SELFHOST_ENABLED) return removeSelfhost('invites', email);
  const { firestore, doc, deleteDoc } = await fs();
  await deleteDoc(doc(firestore, 'invites', email));
}

export async function revokeUserAccess(uid) {
  if (SELFHOST_ENABLED) return removeSelfhost('users', uid);
  const { firestore, doc, deleteDoc } = await fs();
  await deleteDoc(doc(firestore, 'users', uid));
}

// { status: 'none' } | { status: 'invited', email } | { status: 'registered', email, uid }
export async function getEmployeeAuthStatus(mitarbeiterId) {
  if (SELFHOST_ENABLED) {
    const [invites, users] = await Promise.all([
      getAllSelfhost('invites', { mitarbeiterId }), getAllSelfhost('users', { mitarbeiterId }),
    ]);
    if (users[0]) return { status: 'registered', email: users[0].email, uid: users[0].id };
    if (invites[0]) return { status: 'invited', email: invites[0].id };
    return { status: 'none' };
  }
  const { firestore, collection, query, where, getDocs } = await fs();
  const [inviteSnap, userSnap] = await Promise.all([
    getDocs(query(collection(firestore, 'invites'), where('mitarbeiterId', '==', mitarbeiterId))),
    getDocs(query(collection(firestore, 'users'), where('mitarbeiterId', '==', mitarbeiterId))),
  ]);
  if (!userSnap.empty) {
    const d = userSnap.docs[0];
    return { status: 'registered', email: d.data().email, uid: d.id };
  }
  if (!inviteSnap.empty) {
    const d = inviteSnap.docs[0];
    return { status: 'invited', email: d.id };
  }
  return { status: 'none' };
}

export async function inviteCustomer({ email, kundeId, name }) {
  if (SELFHOST_ENABLED) {
    await putSelfhost('invites', { id: email, role: 'kunde', kundeId, name, createdAt: new Date().toISOString() });
    return;
  }
  const { firestore, doc, setDoc } = await fs();
  await setDoc(doc(firestore, 'invites', email), {
    role: 'kunde', kundeId, name, createdAt: new Date().toISOString(),
  });
}

// { status: 'none' } | { status: 'invited', email } | { status: 'registered', email, uid }
export async function getCustomerAuthStatus(kundeId) {
  if (SELFHOST_ENABLED) {
    const [invites, users] = await Promise.all([
      getAllSelfhost('invites', { kundeId }), getAllSelfhost('users', { kundeId }),
    ]);
    if (users[0]) return { status: 'registered', email: users[0].email, uid: users[0].id };
    if (invites[0]) return { status: 'invited', email: invites[0].id };
    return { status: 'none' };
  }
  const { firestore, collection, query, where, getDocs } = await fs();
  const [inviteSnap, userSnap] = await Promise.all([
    getDocs(query(collection(firestore, 'invites'), where('kundeId', '==', kundeId))),
    getDocs(query(collection(firestore, 'users'), where('kundeId', '==', kundeId))),
  ]);
  if (!userSnap.empty) {
    const d = userSnap.docs[0];
    return { status: 'registered', email: d.data().email, uid: d.id };
  }
  if (!inviteSnap.empty) {
    const d = inviteSnap.docs[0];
    return { status: 'invited', email: d.id };
  }
  return { status: 'none' };
}
