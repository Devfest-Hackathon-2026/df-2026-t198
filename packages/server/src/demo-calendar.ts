import { acknowledgeCalendarItem, type CalendarIntegration, type CalendarItem,
  type Course, type LedgerAssignment } from '@kadai-hisho/core/calendar';
import type { Firestore } from 'firebase-admin/firestore';
import { CalendarConnectionConflict, readCalendarState, writeCalendarItem } from './calendar-store.js';
import { DemoForbidden, isDemoStudent } from './demo-store.js';

/** The mock destination is durable and owner-readable, independent of desired events. */
export function createDemoCalendarSync(db: Firestore) {
  return async (uid: string) => {
    // A restored task first finishes its old deletion, then gets a new generation.
    for (let pass = 0; pass < 2; pass++) await db.runTransaction(async tx => {
      const profile = await tx.get(db.collection('demoAccounts').doc(uid));
      if (!profile.exists) return;
      if (!isDemoStudent(profile.data(), uid)) throw new DemoForbidden();
      const student = db.collection('students').doc(uid);
      const state = await readCalendarState(tx, student);
      if (state.integration && (state.integration.mode !== 'mock' || state.integration.executor !== 'demo')) {
        throw new CalendarConnectionConflict();
      }
      const assignments = await tx.get(student.collection('assignments'));
      const courses = await tx.get(student.collection('courses'));
      const names = courses.docs.map(doc => doc.data() as Course & { system: string });
      const integration: CalendarIntegration = state.integration ?? {
        mode: 'mock', executor: 'demo', calendarId: 'demo-calendar', connectionState: 'connected',
      };
      const events = { ...integration.mockEvents };
      const now = new Date().toISOString();
      for (const doc of assignments.docs) {
        const assignment = doc.data() as LedgerAssignment;
        if (assignment.key.system !== 'demo-lms') throw new DemoForbidden();
        const name = names.find(course => course.system === 'demo-lms' && course.courseId === assignment.latest.courseId)?.name ?? assignment.latest.courseId;
        const item = writeCalendarItem(tx, student, state.items.get(doc.id), doc.id, assignment, name, integration.calendarId);
        if (item) state.items.set(item.itemKey, item);
      }
      for (const saved of state.items.values()) {
        const item = saved.calendarId === integration.calendarId ? saved : { ...saved, calendarId: integration.calendarId, desiredRevision: saved.desiredRevision + 1 };
        if (item.appliedRevision === item.desiredRevision) continue;
        applyMockEvent(events, item);
        const acknowledged = acknowledgeCalendarItem(item, { itemKey: item.itemKey, generation: item.generation,
          eventId: item.eventId, revision: item.desiredRevision, errorCode: null }, now);
        tx.set(student.collection('calendarItems').doc(item.itemKey), acknowledged);
      }
      const next = { ...integration, mockEvents: events };
      // The destination and its acknowledgement either both persist or neither does.
      if (JSON.stringify(state.integration) !== JSON.stringify(next)) {
        tx.set(student.collection('integrations').doc('calendar'), next);
      }
    });
  };
}
function applyMockEvent(events: NonNullable<CalendarIntegration['mockEvents']>, item: CalendarItem) {
  const previous = events[item.eventId];
  if (previous && (previous.itemKey !== item.itemKey || previous.generation !== item.generation)) {
    throw new CalendarConnectionConflict();
  }
  if (item.desired.state === 'deleted') delete events[item.eventId];
  else events[item.eventId] = { itemKey: item.itemKey, generation: item.generation,
    revision: item.desiredRevision, event: item.desired.event };
}
