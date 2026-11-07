import { createHash, randomUUID } from 'node:crypto';
import type { PreparationPlan, PreparationPlanInput, LedgerAssignment, Course } from '@kadai-hisho/core';
import { preparationAfterDeadline } from '@kadai-hisho/core';
import { preparationDesired, reconcileDesiredCalendarItem, type CalendarItem, type CalendarIntegration } from '@kadai-hisho/core/calendar';
import type { Firestore } from 'firebase-admin/firestore';
import { documentKey } from './observation-store.js';
import { SessionForbidden } from './session-store.js';
import { isDemoStudent } from './demo-store.js';

export class PlanConflict extends Error {}
export class PlanAfterDeadline extends PlanConflict {}
export interface PlanStore {
  save(actor: string, studentUid: string, planId: string, input: PreparationPlanInput | null): Promise<PreparationPlan>;
}
export function createPlanStore(db: Firestore, syncDemo: (uid: string) => Promise<void>): PlanStore {
  return { async save(actor, studentUid, planId, input) {
    const student = db.collection('students').doc(studentUid);
    const ref = student.collection('plans').doc(planId);
    const result = await db.runTransaction(async tx => {
      const grant = (await tx.get(student.collection('supporters').doc(actor))).data();
      if (actor !== studentUid && (grant?.['revokedAt'] !== null || !Array.isArray(grant['scopes']) || !grant['scopes'].includes('all'))) {
        throw new SessionForbidden();
      }
      const profile = (await tx.get(db.collection('demoAccounts').doc(studentUid))).data();
      const actorProfile = (await tx.get(db.collection('demoAccounts').doc(actor))).data();
      if ((profile && !isDemoStudent(profile, studentUid)) ||
        (actorProfile && actorProfile['studentId'] !== studentUid) ||
        (profile && input && input.assignment.system !== 'demo-lms')) throw new SessionForbidden();
      const old = (await tx.get(ref)).data() as PreparationPlan | undefined;
      if (input && old) {
        const same = old.confirmedBy === actor && old.status === 'active' && old.date === input.date && old.period === input.period &&
          old.startsAt === input.startsAt && old.endsAt === input.endsAt && old.assignment.system === input.assignment.system &&
          old.assignment.sourceId === input.assignment.sourceId;
        if (!same) throw new PlanConflict();
        return old;
      }
      if (!input && (!old || (actor !== studentUid && old.confirmedBy !== actor))) throw new SessionForbidden();
      if (!input && old?.status === 'cancelled') return old;
      const itemKey = old?.calendarItemKey ?? createHash('sha256').update(JSON.stringify(['preparation', planId])).digest('hex');
      const itemRef = student.collection('calendarItems').doc(itemKey);
      const previous = (await tx.get(itemRef)).data() as CalendarItem | undefined;
      const integration = (await tx.get(student.collection('integrations').doc('calendar'))).data() as CalendarIntegration | undefined;
      let next: PreparationPlan;
      if (input) {
        const assignment = (await tx.get(student.collection('assignments').doc(documentKey(input.assignment.system, input.assignment.sourceId)))).data() as LedgerAssignment | undefined;
        const courses = await tx.get(student.collection('courses'));
        const weekday = new Date(`${input.date}T00:00:00Z`).getUTCDay() || 7;
        if (assignment && preparationAfterDeadline(input.startsAt, assignment.officialDeadline?.deadline)) throw new PlanAfterDeadline();
        if (!assignment || assignment.presenceState === 'cancelled' || assignment.submission === 'submitted' ||
          Date.parse(input.startsAt) <= Date.now() || courses.docs.some(doc => (doc.data() as Course).slots.some(slot =>
            slot.weekday === weekday && slot.period === input.period))) throw new PlanConflict();
        const now = new Date().toISOString();
        next = { ...input, planId, title: assignment.latest.title, decidedOn: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
          timeZone: 'Asia/Tokyo', confirmedBy: actor, createdByRole: actor === studentUid ? 'student' : 'supporter',
          confirmedAt: now, status: 'active', revision: 1, calendarItemKey: itemKey };
      } else next = { ...old!, status: 'cancelled', revision: old!.revision + 1 };
      const item = reconcileDesiredCalendarItem(previous, { itemKey, kind: 'preparation', sourceKey: next.assignment },
        preparationDesired(next), integration?.calendarId ?? null, () => randomUUID().replaceAll('-', ''));
      tx.set(ref, next);
      if (item && item !== previous) tx.set(itemRef, item);
      return next;
    });
    // Mock destination failures leave the durable queue intact. An identical retry retries synchronization.
    await syncDemo(studentUid);
    return result;
  } };
}
