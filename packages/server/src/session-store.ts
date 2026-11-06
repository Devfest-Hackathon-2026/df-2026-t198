import type { SessionContext } from '@kadai-hisho/core/ledger';
import type { Firestore } from 'firebase-admin/firestore';
import { isDemoStudent } from './demo-store.js';
import { demoStudentDisplayName } from './demo-initial.js';

export class SessionForbidden extends Error {
  constructor() { super('forbidden'); }
}
export interface SessionStore {
  listStudents: (supporterUid: string) => Promise<{ uid: string; displayName?: string }[]>;
  saveContext: (supporterUid: string, studentUid: string, context: SessionContext) => Promise<void>;
}
function allowed(data: Record<string, unknown> | undefined) {
  return data?.['revokedAt'] === null && Array.isArray(data['scopes']) && data['scopes'].includes('all');
}
export function createSessionStore(db: Firestore): SessionStore {
  return {
    async listStudents(supporterUid) {
      // Existing grants use the supporter UID as the document ID, not as a field.
      // Collection-group documentId equality requires a full path, so filter grant paths on the server.
      const grants = await db.collectionGroup('supporters').get();
      const students: { uid: string; displayName?: string }[] = [];
      for (const grant of grants.docs) {
        const path = grant.ref.path.split('/');
        if (path.length === 4 && path[0] === 'students' && path[2] === 'supporters' &&
          path[3] === supporterUid && allowed(grant.data())) {
          const uid = path[1]!;
          const profile = (await db.doc(`demoAccounts/${uid}`).get()).data();
          students.push({ uid, ...(isDemoStudent(profile, uid) ? { displayName: demoStudentDisplayName } : {}) });
        }
      }
      return students.sort((a, b) => a.uid.localeCompare(b.uid));
    },
    async saveContext(supporterUid, studentUid, context) {
      const student = db.collection('students').doc(studentUid);
      await db.runTransaction(async tx => {
        const grant = await tx.get(student.collection('supporters').doc(supporterUid));
        if (supporterUid !== studentUid && !allowed(grant.data())) throw new SessionForbidden();
        tx.set(student.collection('sessionContext').doc('current'), context);
      });
    },
  };
}
