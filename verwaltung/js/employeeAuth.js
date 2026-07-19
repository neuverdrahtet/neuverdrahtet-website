import { firebaseConfig } from './firebase-config.js';

// Nur relevant, wenn Firebase aktiv ist (Phase C: echtes Mitarbeiter-Login).
// Im IndexedDB-Modus bleibt der alte Zugangscode in mitarbeiter.js die einzige
// Zugangssteuerung, dieses Modul wird dann gar nicht importiert/aufgerufen.
export const FIREBASE_ENABLED = !!firebaseConfig.projectId;

async function fs() {
  const { firestore } = await import('./firebase.js');
  const mod = await import('./vendor/firebase/firebase-firestore.js');
  return { firestore, ...mod };
}

export async function inviteEmployee({ email, role, mitarbeiterId, name }) {
  const { firestore, doc, setDoc } = await fs();
  await setDoc(doc(firestore, 'invites', email), {
    role, mitarbeiterId, name, createdAt: new Date().toISOString(),
  });
}

export async function revokeInvite(email) {
  const { firestore, doc, deleteDoc } = await fs();
  await deleteDoc(doc(firestore, 'invites', email));
}

export async function revokeUserAccess(uid) {
  const { firestore, doc, deleteDoc } = await fs();
  await deleteDoc(doc(firestore, 'users', uid));
}

// { status: 'none' } | { status: 'invited', email } | { status: 'registered', email, uid }
export async function getEmployeeAuthStatus(mitarbeiterId) {
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
