import { createHash, randomUUID } from 'node:crypto';
import type { Course, ManualAssignment, ManualAssignmentInput } from '@kadai-hisho/core';
import { manualDeadlineDesired, reconcileDesiredCalendarItem, type CalendarItem, type CalendarIntegration } from '@kadai-hisho/core/calendar';
import type { Firestore } from 'firebase-admin/firestore';
import { documentKey } from './observation-store.js';
import { SessionForbidden } from './session-store.js';
import { isDemoStudent } from './demo-store.js';

export class ManualAssignmentConflict extends Error {}
export interface ManualAssignmentStore {
  save(actor: string, studentUid: string, id: string, input: ManualAssignmentInput | null): Promise<ManualAssignment>;
}
function sameInput(old: ManualAssignment, input: ManualAssignmentInput) {
  return old.title === input.title && old.date === input.date && old.time === input.time && old.memo === input.memo &&
    old.course?.system === input.course?.system && old.course?.courseId === input.course?.courseId;
}
export function createManualAssignmentStore(db: Firestore, syncDemo: (uid: string) => Promise<void>): ManualAssignmentStore {
  return { async save(actor, studentUid, id, input) {
    const student = db.collection('students').doc(studentUid);
    const ref = student.collection('manualAssignments').doc(id);
    const result = await db.runTransaction(async tx => {
      const grant = (await tx.get(student.collection('supporters').doc(actor))).data();
      if (actor !== studentUid && (grant?.['revokedAt'] !== null || !Array.isArray(grant['scopes']) || !grant['scopes'].includes('all'))) throw new SessionForbidden();
      const profile = (await tx.get(db.collection('demoAccounts').doc(studentUid))).data();
      const actorProfile = (await tx.get(db.collection('demoAccounts').doc(actor))).data();
      if ((profile && !isDemoStudent(profile, studentUid)) || (actorProfile && actorProfile['studentId'] !== studentUid) ||
        (profile && input?.course && input.course.system !== 'demo-lms')) throw new SessionForbidden();
      const old = (await tx.get(ref)).data() as ManualAssignment | undefined;
      if (input && old) {
        if (old.createdBy !== actor || old.status !== 'active' || !sameInput(old, input)) throw new ManualAssignmentConflict();
        return old;
      }
      if (!input && (!old || (actor !== studentUid && old.createdBy !== actor))) throw new SessionForbidden();
      if (!input && old?.status === 'cancelled') return old;
      const itemKey = old?.calendarItemKey ?? createHash('sha256').update(JSON.stringify(['manual-deadline', id])).digest('hex');
      const itemRef = student.collection('calendarItems').doc(itemKey);
      const previous = (await tx.get(itemRef)).data() as CalendarItem | undefined;
      const integration = (await tx.get(student.collection('integrations').doc('calendar'))).data() as CalendarIntegration | undefined;
      let courseName: string | null = null;
      if (input?.course) {
        const course = (await tx.get(student.collection('courses').doc(documentKey(input.course.system, input.course.courseId)))).data() as Course | undefined;
        if (!course) throw new ManualAssignmentConflict();
        courseName = course.name;
      }
      const next: ManualAssignment = input ? { ...input, manualAssignmentId: id, courseName,
        createdBy: actor, createdByRole: actor === studentUid ? 'student' : 'supporter', createdAt: new Date().toISOString(),
        status: 'active', revision: 1, calendarItemKey: itemKey } : { ...old!, status: 'cancelled', revision: old!.revision + 1 };
      const item = reconcileDesiredCalendarItem(previous, { itemKey, kind: 'manual-deadline', sourceKey: { system: 'manual', sourceId: id } },
        manualDeadlineDesired(next), integration?.calendarId ?? null, () => randomUUID().replaceAll('-', ''));
      tx.set(ref, next);
      if (item && item !== previous) tx.set(itemRef, item);
      return next;
    });
    // Retry synchronization even when the identical operation was already saved.
    await syncDemo(studentUid);
    return result;
  } };
}
