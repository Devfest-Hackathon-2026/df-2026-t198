import { onAuthStateChanged, type Auth } from 'firebase/auth';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import type { StudentData } from '../../shared/assignments/types';

export type StudentState = { status: 'loading' | 'signed-out' | 'error' } |
  ({ status: 'ready' } & StudentData);

export function watchAccount(auth: Auth, db: Firestore, next: (state: StudentState) => void) {
  let active = true;
  let stopStudent = () => {};
  const stopAuth = onAuthStateChanged(auth, user => {
    if (!active) return;
    stopStudent();
    next({ status: user ? 'loading' : 'signed-out' });
    if (!user) return;
    let current = true;
    const stops: (() => void)[] = [];
    stopStudent = () => { current = false; stops.forEach(stop => stop()); };
    const values: Partial<StudentData> = {};
    const cached = new Map<string, boolean>();
    for (const name of ['courses', 'assignments', 'fetchStates', 'plans', 'manualAssignments'] as const) {
      stops.push(onSnapshot(collection(db, 'students', user.uid, name), { includeMetadataChanges: true }, snapshot => {
        if (!current) return;
        Object.assign(values, { [name]: snapshot.docs.map(doc => doc.data()) });
        cached.set(name, snapshot.metadata.fromCache);
        if (values.courses && values.assignments && values.fetchStates && values.plans && values.manualAssignments) {
          next({ status: 'ready', courses: values.courses, assignments: values.assignments,
            fetchStates: values.fetchStates, plans: values.plans, manualAssignments: values.manualAssignments, online: [...cached.values()].every(value => !value) });
        }
      }, () => {
        if (!current) return;
        stopStudent();
        next({ status: 'error' });
      }));
    }
  }, () => { stopStudent(); if (active) next({ status: 'error' }); });
  return () => { active = false; stopStudent(); stopAuth(); };
}
