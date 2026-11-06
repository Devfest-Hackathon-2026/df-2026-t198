import type { DemoAccount, DemoData } from '@kadai-hisho/core/ledger';
import type { Firestore } from 'firebase-admin/firestore';

export class DemoForbidden extends Error {
  constructor() { super('forbidden'); }
}
export class DemoConflict extends Error {
  constructor() { super('deadline-changed'); }
}
export interface DemoStore {
  extend: (uid: string, sourceId: string, expectedDueAt: string) => Promise<{ sourceId: string; dueAt: string }>;
}
export function isDemoStudent(data: Partial<DemoAccount> | undefined, uid: string) {
  return data?.role === 'student' && data.studentId === uid;
}
export function createDemoStore(db: Firestore): DemoStore {
  return {
    async extend(uid, sourceId, expectedDueAt) {
      return db.runTransaction(async tx => {
        const profile = await tx.get(db.doc(`demoAccounts/${uid}`));
        if (!isDemoStudent(profile.data(), uid)) throw new DemoForbidden();
        const ref = db.doc(`students/${uid}/demo/current`);
        const data = (await tx.get(ref)).data() as DemoData | undefined;
        const matches = data?.courses.flatMap(course => course.assignments).filter(item => item.sourceId === sourceId) ?? [];
        if (matches.length !== 1) throw new DemoForbidden();
        const task = matches[0]!;
        if (task.dueAt !== expectedDueAt) throw new DemoConflict();
        const dueAt = new Date(Date.parse(task.dueAt) + 86400_000).toISOString();
        task.dueAt = dueAt;
        tx.set(ref, data!);
        return { sourceId, dueAt };
      });
    },
  };
}
