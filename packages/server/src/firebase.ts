import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createObservationStore } from './observation-store.js';
import { createSessionStore } from './session-store.js';

export function firebaseDependencies() {
  const app = getApps()[0] ?? initializeApp();
  return {
    verifyToken: async (token: string) => (await getAuth(app).verifyIdToken(token, true)).uid,
    saveObservation: createObservationStore(getFirestore(app)),
    session: createSessionStore(getFirestore(app)),
  };
}
