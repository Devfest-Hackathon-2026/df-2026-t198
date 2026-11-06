import { createHash, randomUUID } from 'node:crypto';
import { preparationSlots, type Course, type LedgerAssignment, type LmsSystem, type PreparationPlan } from '@kadai-hisho/core';
import { preparationDesired, reconcileDesiredCalendarItem, type CalendarIntegration, type CalendarItem } from '@kadai-hisho/core/calendar';
import type { Firestore } from 'firebase-admin/firestore';
import { buildDigest, japanDay, type Digest } from './digest.js';
import { isDemoStudent } from './demo-store.js';
import { documentKey } from './observation-store.js';
import { PlanConflict } from './plan-store.js';
import { SessionForbidden } from './session-store.js';

export interface PlanActionResult { outcome: 'done' | 'moved' | 'no-slot'; plan: PreparationPlan }
export interface DigestStore {
  read(uid: string, email: string): Promise<Digest>;
  prepareDemo(uid: string): Promise<PreparationPlan>;
  act(uid: string, planId: string, action: 'done' | 'later'): Promise<PlanActionResult>;
}
// University configuration, separate from LMS selectors. Demo uses this same timetable.
// Source: YNU's published all-university timetable (linked in docs/decisions.md).
const ynuPeriods = [['08:50', '10:20'], ['10:30', '12:00'], ['13:00', '14:30'], ['14:40', '16:10'],
  ['16:15', '17:45'], ['17:50', '19:20'], ['19:25', '20:55']] as const;
export function createDigestStore(db: Firestore, syncDemo: (uid: string) => Promise<void>, origin: string,
  clock: () => Date = () => new Date()): DigestStore {
  const trusted = new URL(origin);
  if (trusted.origin !== origin || (trusted.protocol !== 'https:' && !(trusted.protocol === 'http:' && trusted.hostname === '127.0.0.1' && process.env['FIRESTORE_EMULATOR_HOST']))) throw new Error('invalid-web-origin');
  return {
    async prepareDemo(uid) {
      const plan = await db.runTransaction(async tx => {
        if (!isDemoStudent((await tx.get(db.doc(`demoAccounts/${uid}`))).data(), uid)) throw new SessionForbidden();
        const student = db.collection('students').doc(uid);
        const ref = student.collection('plans').doc('11200000-0000-4000-8000-000000000001');
        const old = (await tx.get(ref)).data() as PreparationPlan | undefined;
        if (old) return old;
        const assignments = (await tx.get(student.collection('assignments'))).docs.map(doc => doc.data() as LedgerAssignment);
        const task = assignments.find(row => row.key.system === 'demo-lms' && row.submission !== 'submitted' && row.presenceState !== 'cancelled' && row.presenceState !== 'ended');
        if (!task) throw new PlanConflict();
        const courses = (await tx.get(student.collection('courses'))).docs.map(doc => doc.data() as Course).filter(course => course.currentTerm !== false);
        const now = clock(); const date = japanDay(now); const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
        const period = [1, 2, 3, 4, 5].find(p => !courses.some(course => course.slots.some(slot => slot.weekday === weekday && slot.period === p)));
        if (!period) throw new PlanConflict();
        const itemKey = createHash('sha256').update(JSON.stringify(['preparation', ref.id])).digest('hex');
        const itemRef = student.collection('calendarItems').doc(itemKey);
        const previous = (await tx.get(itemRef)).data() as CalendarItem | undefined;
        const integration = (await tx.get(student.collection('integrations').doc('calendar'))).data() as CalendarIntegration | undefined;
        if (integration && integration.mode !== 'mock') throw new SessionForbidden();
        const [start, end] = ynuPeriods[period - 1]!;
        const next: PreparationPlan = { planId: ref.id, assignment: task.key, title: task.latest.title, date, period,
          startsAt: `${date}T${start}:00+09:00`, endsAt: `${date}T${end}:00+09:00`, timeZone: 'Asia/Tokyo',
          decidedOn: date, confirmedBy: uid, confirmedAt: now.toISOString(), createdByRole: 'student',
          status: 'active', revision: 1, calendarItemKey: itemKey };
        const item = reconcileDesiredCalendarItem(previous, { itemKey, kind: 'preparation', sourceKey: task.key },
          preparationDesired(next), integration?.calendarId ?? null, () => randomUUID().replaceAll('-', ''));
        tx.set(ref, next); if (item) tx.set(itemRef, item);
        return next;
      });
      await syncDemo(uid); return plan;
    },
    async read(uid, email) {
      return db.runTransaction(async tx => {
        const profile = (await tx.get(db.doc(`demoAccounts/${uid}`))).data();
        if (profile && !isDemoStudent(profile, uid)) throw new SessionForbidden();
        const student = db.collection('students').doc(uid);
        const plans = await tx.get(student.collection('plans'));
        const assignments = await tx.get(student.collection('assignments'));
        const courses = await tx.get(student.collection('courses'));
        return buildDigest(email, plans.docs.map(doc => doc.data() as PreparationPlan),
          assignments.docs.map(doc => doc.data() as LedgerAssignment),
          courses.docs.map(doc => doc.data() as Course & { system: LmsSystem }), origin, clock());
      });
    },
    async act(uid, planId, action) {
      const result = await db.runTransaction(async tx => {
        const profile = (await tx.get(db.doc(`demoAccounts/${uid}`))).data();
        if (profile && !isDemoStudent(profile, uid)) throw new SessionForbidden();
        const student = db.collection('students').doc(uid);
        const ref = student.collection('plans').doc(planId);
        const old = (await tx.get(ref)).data() as PreparationPlan | undefined;
        if (!old) throw new SessionForbidden();
        if (action === 'done' && old.status === 'done') return { outcome: 'done' as const, plan: old };
        if (action === 'later' && old.laterResult) return { outcome: old.laterResult, plan: old };
        if (old.status !== 'active') throw new PlanConflict();
        const assignment = (await tx.get(student.collection('assignments').doc(documentKey(old.assignment.system, old.assignment.sourceId)))).data() as LedgerAssignment | undefined;
        if (!assignment || assignment.submission === 'submitted' || assignment.presenceState === 'cancelled' || assignment.presenceState === 'ended') throw new PlanConflict();
        const itemRef = student.collection('calendarItems').doc(old.calendarItemKey);
        const previous = (await tx.get(itemRef)).data() as CalendarItem | undefined;
        const integration = (await tx.get(student.collection('integrations').doc('calendar'))).data() as CalendarIntegration | undefined;
        const now = clock();
        let next: PreparationPlan = { ...old, changedBy: uid, changedAt: now.toISOString(), revision: old.revision + 1 };
        let outcome: PlanActionResult['outcome'] = 'done';
        if (action === 'done') next.status = 'done';
        else {
          const courses = (await tx.get(student.collection('courses'))).docs.map(doc => doc.data() as Course).filter(course => course.currentTerm !== false);
          const plans = (await tx.get(student.collection('plans'))).docs.map(doc => doc.data() as PreparationPlan);
          const deadline = assignment.officialDeadline?.deadline;
          const dueDate = deadline?.kind === 'date' ? deadline.date : deadline?.kind === 'datetime' ? japanDay(new Date(deadline.dueAt)) : '';
          const candidates = preparationSlots(old.assignment, dueDate, courses, now, 366 * 24, plans, old);
          // Do not infer clock times for an unconfigured university.
          const duration = Date.parse(old.endsAt) - Date.parse(old.startsAt);
          const candidate = old.assignment.system === 'panda' ? undefined : candidates.find(slot => {
            const times = ynuPeriods[slot.period - 1];
            return times && duration > 0 && duration <= Date.parse(`${slot.date}T${times[1]}:00+09:00`) - Date.parse(`${slot.date}T${times[0]}:00+09:00`);
          });
          outcome = candidate ? 'moved' : 'no-slot';
          if (candidate) {
            const [start] = ynuPeriods[candidate.period - 1]!;
            const startsAt = `${candidate.date}T${start}:00+09:00`;
            const endsAt = new Date(Date.parse(startsAt) + duration + 9 * 3600_000).toISOString().slice(0, 19) + '+09:00';
            next = { ...next, ...candidate, startsAt, endsAt };
          }
          next.laterResult = outcome;
        }
        const item = reconcileDesiredCalendarItem(previous, { itemKey: old.calendarItemKey, kind: 'preparation', sourceKey: old.assignment },
          preparationDesired(next), integration?.calendarId ?? null, () => randomUUID().replaceAll('-', ''));
        tx.set(ref, next);
        if (item && item !== previous) tx.set(itemRef, item);
        return { outcome, plan: next };
      });
      // Repeat requests also retry durable mock work after response/synchronization loss.
      await syncDemo(uid);
      return result;
    },
  };
}
