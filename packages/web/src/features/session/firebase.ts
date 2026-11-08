import { onAuthStateChanged, signInWithEmailAndPassword, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { firebase } from '../../shared/firebase';
import { emptySession, type SessionData } from './model';
import type { SessionContext } from '../../../../core/src/types';
import type { SessionSource } from './watch';

export function firebaseSessionSource(db: Firestore): SessionSource {
  return {
    grant: (student, supporter, next, fail) => onSnapshot(doc(db, 'students', student, 'supporters', supporter),
      { includeMetadataChanges: true }, snapshot => {
        // A cached permission must never unlock a session after a reload or reconnect.
        if (snapshot.metadata.fromCache) return;
        const grant = snapshot.data();
        next(grant?.['revokedAt'] === null && Array.isArray(grant['scopes']) && grant['scopes'].includes('all'));
      }, fail),
    watch(student, name, next, fail) {
      if (name === 'context') return onSnapshot(doc(db, 'students', student, 'sessionContext', 'current'),
        { includeMetadataChanges: true }, snapshot => {
          if (snapshot.metadata.fromCache) return;
          next((snapshot.data() ?? emptySession().context) as SessionData[typeof name]);
        }, fail);
      return onSnapshot(collection(db, 'students', student, name), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache) return;
        next(snapshot.docs.map(doc => doc.data()) as SessionData[typeof name]);
      }, fail);
    },
  };
}
export interface SessionServices {
  source: SessionSource;
  local: boolean;
  observeUser: (next: (user: User | null) => void) => () => void;
  login: (email: string, password: string) => Promise<unknown>;
  logout: () => Promise<void>;
  students: (user: User) => Promise<{ uid: string; displayName?: string }[]>;
  saveContext: (user: User, student: string, context: SessionContext) => Promise<void>;
}
let services: SessionServices | null | undefined;
export function getSessionServices(): SessionServices | null {
  if (services !== undefined) return services;
  const connection = firebase;
  if (!connection) { services = null; return null; }
  const { auth, db } = connection;
  const local = Boolean(auth.emulatorConfig);
  async function api(user: User, path: string, context?: SessionContext) {
    const response = await fetch(path, { method: context ? 'PUT' : 'GET', cache: 'no-store', headers: {
      Authorization: `Bearer ${await user.getIdToken()}`, ...(context ? { 'Content-Type': 'application/json' } : {}),
    }, ...(context ? { body: JSON.stringify(context) } : {}) });
    if (!response.ok) throw new Error(response.status === 403 ? 'forbidden' : 'request-failed');
    return response.json();
  }
  services = {
    source: firebaseSessionSource(db), local,
    observeUser: next => onAuthStateChanged(auth, next),
    login: async (email, password) => {
      return local ? signInWithEmailAndPassword(auth, email, password) : connection.login();
    },
    logout: connection.logout,
    students: async user => (await api(user, '/api/v1/supporter/students') as { students: { uid: string; displayName?: string }[] }).students,
    saveContext: async (user, student, context) => { await api(user,
      `/api/v1/students/${encodeURIComponent(student)}/session-context`, context); },
  };
  return services;
}
