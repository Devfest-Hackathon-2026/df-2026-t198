import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { resolveFirebaseConfig } from './firebase-config';

const config = resolveFirebaseConfig(import.meta.env, typeof window === 'undefined' ? '' : window.location?.hostname ?? '');
export const firebase = config ? (() => {
  const app = initializeApp(config.options);
  const auth = getAuth(app);
  if (config.emulator) {
    connectAuthEmulator(auth, `http://127.0.0.1:${config.emulator.authPort}`, { disableWarnings: true });
  }
  const db = getFirestore(app);
  if (config.emulator) {
    connectFirestoreEmulator(db, '127.0.0.1', config.emulator.firestorePort);
  }
  return { auth, db, login: () => signInWithPopup(auth, new GoogleAuthProvider()), logout: () => signOut(auth) };
})() : null;
