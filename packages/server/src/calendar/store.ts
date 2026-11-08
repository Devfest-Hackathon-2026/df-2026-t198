import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { acknowledgeCalendarItem, reconcileCalendarItem, type CalendarIntegration, type CalendarItem,
  type CalendarReport, type Course, type LedgerAssignment } from '@kadai-hisho/core/calendar';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { DemoForbidden } from '../demo/store.js';

const navigationBySystem: Partial<Record<LedgerAssignment['key']['system'], { statefulSession: boolean; home: string }>> = {
  'ynu-lms': JSON.parse(readFileSync(new URL('../../../../lms-definitions/coursepower/navigation.json', import.meta.url), 'utf8')),
};

export class CalendarConnectionConflict extends Error {}
export interface CalendarStore {
  pending(uid: string): Promise<{ integration: CalendarIntegration | null; items: CalendarItem[] }>;
  connect(uid: string, calendarId: string): Promise<void>;
  report(uid: string, report: CalendarReport): Promise<void>;
}

/** Call before any writes in the enclosing transaction. */
export async function readCalendarState(tx: Transaction, student: DocumentReference) {
  const integration = (await tx.get(student.collection('integrations').doc('calendar'))).data() as CalendarIntegration | undefined;
  const items = await tx.get(student.collection('calendarItems'));
  return { integration, items: new Map(items.docs.map(doc => [doc.id, doc.data() as CalendarItem])) };
}

export function writeCalendarItem(tx: Transaction, student: DocumentReference, previous: CalendarItem | undefined,
  key: string, assignment: LedgerAssignment, courseName: string, calendarId: string | null) {
  const next = reconcileCalendarItem(previous, key, assignment, courseName, calendarId, () => randomUUID().replaceAll('-', ''), {
    navigation: navigationBySystem[assignment.key.system], parseUrl: (value, base) => new URL(value, base),
  });
  if (next && next !== previous) tx.set(student.collection('calendarItems').doc(key), next);
  return next;
}

export function createCalendarStore(db: Firestore): CalendarStore {
  async function requireRealAccount(tx: Transaction, uid: string) {
    if ((await tx.get(db.collection('demoAccounts').doc(uid))).exists) throw new DemoForbidden();
  }
  return {
    async connect(uid, calendarId) {
      const student = db.collection('students').doc(uid);
      await db.runTransaction(async tx => {
        await requireRealAccount(tx, uid);
        const state = await readCalendarState(tx, student);
        if (state.integration && (state.integration.calendarId !== calendarId || state.integration.mode !== 'google')) {
          throw new CalendarConnectionConflict();
        }
        const integration: CalendarIntegration = { mode: 'google', executor: 'extension', calendarId, connectionState: 'connected' };
        tx.set(student.collection('integrations').doc('calendar'), integration);
        for (const [key, item] of state.items) {
          if (!item.calendarId) tx.set(student.collection('calendarItems').doc(key), {
            ...item, calendarId, desiredRevision: item.desiredRevision + 1,
          });
        }
      });
    },
    async pending(uid) {
      const student = db.collection('students').doc(uid);
      return db.runTransaction(async tx => {
        await requireRealAccount(tx, uid);
        const state = await readCalendarState(tx, student);
        const assignments = await tx.get(student.collection('assignments'));
        const courses = await tx.get(student.collection('courses'));
        const names = courses.docs.map(doc => doc.data() as Course & { system: string });
        for (const doc of assignments.docs) {
          const assignment = doc.data() as LedgerAssignment;
          const name = names.find(c => c.system === assignment.key.system && c.courseId === assignment.latest.courseId)?.name ?? assignment.latest.courseId;
          const next = writeCalendarItem(tx, student, state.items.get(doc.id), doc.id, assignment, name, state.integration?.calendarId ?? null);
          if (next) state.items.set(doc.id, next);
        }
        return { integration: state.integration ?? null,
          items: [...state.items.values()].filter(item => item.calendarId && item.appliedRevision !== item.desiredRevision) };
      });
    },
    async report(uid, report) {
      const student = db.collection('students').doc(uid);
      const ref = student.collection('calendarItems').doc(report.itemKey);
      await db.runTransaction(async tx => {
        await requireRealAccount(tx, uid);
        const item = (await tx.get(ref)).data() as CalendarItem | undefined;
        const integrationRef = student.collection('integrations').doc('calendar');
        const integration = (await tx.get(integrationRef)).data() as CalendarIntegration | undefined;
        if (!item) return;
        const updated = acknowledgeCalendarItem(item, report, new Date().toISOString());
        if (updated === item) return;
        tx.set(ref, updated);
        if (integration) tx.set(integrationRef, { ...integration,
          connectionState: report.errorCode === 'authorization-required' ? 'reauthorization-required'
            : report.errorCode === 'event-conflict' ? 'recovery-required' : report.errorCode === null ? 'connected' : integration.connectionState });
      });
    },
  };
}
