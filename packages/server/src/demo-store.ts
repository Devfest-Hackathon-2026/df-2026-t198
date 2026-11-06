import type { DemoAccount, DemoData } from '@kadai-hisho/core/ledger';
import { initialDemo } from './demo-initial.js';
import type { Firestore } from 'firebase-admin/firestore';

export class DemoForbidden extends Error {
  constructor() { super('forbidden'); }
}
export class DemoConflict extends Error {
  constructor() { super('deadline-changed'); }
}
export interface DemoStore {
  reset: (uid: string, onlyIfStale: boolean) => Promise<{ reset: boolean; data: DemoData }>;
  extend: (uid: string, sourceId: string, expectedDueAt: string) => Promise<{ sourceId: string; dueAt: string }>;
}
export function isDemoStudent(data: Partial<DemoAccount> | undefined, uid: string) {
  return data?.role === 'student' && data.studentId === uid;
}
export function createDemoStore(db: Firestore): DemoStore {
  return {
    async reset(uid, onlyIfStale) {
      return db.runTransaction(async tx => {
        const profile = await tx.get(db.doc(`demoAccounts/${uid}`));
        if (!isDemoStudent(profile.data(), uid)) throw new DemoForbidden();
        const student = db.doc(`students/${uid}`);
        const source = student.collection('demo').doc('current');
        const current = (await tx.get(source)).data() as DemoData | undefined;
        if (!current) throw new DemoForbidden();
        const contextRef = student.collection('sessionContext').doc('current');
        const context = (await tx.get(contextRef)).data();
        const now = Date.now();
        const dates = [context?.['nextSessionAt'], ...current.courses.flatMap(course => course.assignments.map(task => task.dueAt))];
        if (onlyIfStale && dates.every(date => typeof date === 'string' && Date.parse(date) > now)) return { reset: false, data: current };
        const calendar = student.collection('integrations').doc('calendar');
        const integration = (await tx.get(calendar)).data();
        if (integration && (integration['mode'] !== 'mock' || integration['executor'] !== 'demo')) throw new DemoForbidden();
        const collections = ['assignments', 'courses', 'changes', 'fetchStates', 'observationReceipts', 'calendarItems'];
        const rows = [];
        for (const name of collections) rows.push(await tx.get(student.collection(name)));
        const initial = initialDemo(now);
        for (const row of rows) for (const document of row.docs) tx.delete(document.ref);
        tx.delete(calendar);
        tx.set(source, initial.data);
        tx.set(contextRef, initial.context);
        return { reset: true, data: initial.data };
      });
    },
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
