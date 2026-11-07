import { applyObservation } from '@kadai-hisho/core';
import type { NotificationSnapshot } from '../src/notification-targets.js';
import { observation } from './observation-fixture.js';

export const origin = 'https://study.example.invalid';
export const recipient = ['fictional-student', 'example.invalid'].join('@');
export function notificationFixture(): NotificationSnapshot {
  const input = observation();
  input.system = 'ynu-lms';
  input.fetchedAt = '2030-11-11T07:00:00+09:00';
  input.assignments[0]!.deadline = { kind: 'datetime', dueAt: '2030-11-12T17:00:00+09:00', timeZone: 'Asia/Tokyo', dueText: '架空の締切' };
  return { uid: 'notification-student', demo: false,
    settings: { enabled: true, deliveryOwner: 'cloud', version: 1, timeZone: 'Asia/Tokyo', morningTime: '07:30',
      recipientUid: 'notification-student', migrationState: 'ready', updatedAt: input.fetchedAt },
    assignments: applyObservation([], input, input.fetchedAt).assignments,
    courses: input.catalogCourses.map(c => ({ ...c, system: 'ynu-lms' })),
    fetchStates: [{ studentId: 'notification-student', system: 'ynu-lms', lastSucceededAt: input.fetchedAt,
      lastAttemptedAt: input.fetchedAt, lastResult: 'success', lastFailureKind: null, lastAppliedObservationId: input.observationId }],
    plans: [{ planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assignment: { system: 'ynu-lms', sourceId: 'fictional/task' },
      title: '架空のレポート', date: '2030-11-11', period: 3, startsAt: '2030-11-11T13:00:00+09:00',
      endsAt: '2030-11-11T14:30:00+09:00', timeZone: 'Asia/Tokyo', decidedOn: '2030-11-10',
      confirmedBy: 'notification-student', confirmedAt: input.fetchedAt, createdByRole: 'student',
      status: 'active', revision: 1, calendarItemKey: 'fictional-calendar-key' }],
  };
}
