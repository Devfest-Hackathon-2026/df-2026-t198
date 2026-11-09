import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { firebase } from '../firebase';
import { serverFetch } from '../network';

const hidden = { own: false, visible: false };
export function watchSessionAccess(next: (access: typeof hidden) => void) {
  if (!firebase) return () => {};
  const client = firebase;
  let active = true;
  let stopUser = () => {};
  const stopAuth = onAuthStateChanged(client.auth, user => {
    if (!active) return;
    stopUser(); next(hidden);
    if (!user) return;
    let current = true;
    let shared = false; let demoStudent = false; let demoSupporter = false; let supporter = false;
    const emit = () => { if (current) next({ own: shared || demoStudent, visible: shared || demoStudent || demoSupporter || supporter }); };
    const stops = [
      onSnapshot(doc(client.db, 'demoAccounts', user.uid), { includeMetadataChanges: true }, snapshot => {
        if (!current || snapshot.metadata.fromCache) return;
        const profile = snapshot.data();
        demoStudent = profile?.['role'] === 'student' && profile['studentId'] === user.uid;
        demoSupporter = profile?.['role'] === 'supporter' && typeof profile['studentId'] === 'string'; emit();
      }, () => { demoStudent = false; demoSupporter = false; emit(); }),
      onSnapshot(collection(client.db, 'students', user.uid, 'supporters'), { includeMetadataChanges: true }, snapshot => {
        if (!current || snapshot.metadata.fromCache) return;
        shared = snapshot.docs.some(item => {
          const grant = item.data();
          return grant['revokedAt'] === null && Array.isArray(grant['scopes']) && grant['scopes'].includes('all');
        }); emit();
      }, () => { shared = false; emit(); }),
    ];
    stopUser = () => { current = false; stops.forEach(stop => stop()); };
    // Real supporters have no role document; the existing API returns only their current grants.
    void user.getIdToken().then(token => current ? serverFetch('/api/v1/supporter/students', {
      cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
    }) : null).then(async response => {
      if (!current || !response?.ok) return;
      const data = await response.json() as { students?: unknown };
      if (current) { supporter = Array.isArray(data.students) && data.students.length > 0; emit(); }
    }).catch(() => {});
  }, () => { stopUser(); if (active) next(hidden); });
  return () => { active = false; stopUser(); stopAuth(); };
}
export function useSessionAccess() {
  const [access, setAccess] = useState(hidden);
  useEffect(() => watchSessionAccess(setAccess), []);
  return access;
}
