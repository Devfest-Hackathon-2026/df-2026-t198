import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const emulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const projectId = emulator ? 'demo-kadai-hisho' : import.meta.env.VITE_FIREBASE_PROJECT_ID;
const apiKey = emulator ? 'demo-key' : import.meta.env.VITE_FIREBASE_API_KEY;
const authDomain = emulator ? 'localhost' : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
export const firebase = projectId && apiKey && authDomain ? (() => {
  const app = initializeApp({ projectId, apiKey, authDomain });
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
  }
  return { auth, db, login: () => signInWithPopup(auth, new GoogleAuthProvider()), logout: () => signOut(auth) };
})() : null;
