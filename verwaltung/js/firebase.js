import { initializeApp } from './vendor/firebase/firebase-app.js';
import { initializeFirestore, persistentLocalCache, connectFirestoreEmulator } from './vendor/firebase/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from './vendor/firebase/firebase-auth.js';
import { getStorage, connectStorageEmulator } from './vendor/firebase/firebase-storage.js';
import { firebaseConfig, USE_EMULATOR } from './firebase-config.js';

const app = initializeApp(firebaseConfig);

export const firestore = initializeFirestore(app, { localCache: persistentLocalCache() });
export const auth = getAuth(app);
export const storage = getStorage(app);

if (USE_EMULATOR) {
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
