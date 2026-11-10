import { expect, it } from 'vitest';
import type { Deadline, ManualAssignment, PreparationPlan } from '../../core/src/types';
import { applyObservation } from '../../core/src/ledger';
import { observation } from '../../server/tests/observation-fixture';
import { emptySession } from '../src/features/session/model';
import { studentSummary } from '../src/features/session/student-summary';

const now = new Date('2026-11-10T06:00:00Z');
const date = (value: string): Deadline => ({ kind: 'date', date: value, dueText: '架空の日付', timeZone: 'Asia/Tokyo' });
function task(id: string, deadline: Deadline) {
  const sample = observation();
  sample.assignments[0]!.sourceId = id; sample.assignments[0]!.deadline = deadline;
  return applyObservation([], sample, now.toISOString()).assignments[0]!;
}
const manual: ManualAssignment = { manualAssignmentId: 'fictional', title: '架空の手入力課題', date: '2026-11-12', time: null,
  course: null, courseName: null, memo: '', createdBy: 'student', createdByRole: 'student', createdAt: now.toISOString(),
  status: 'active', revision: 1, calendarItemKey: 'fictional' };
const plan: PreparationPlan = { assignment: { system: 'demo-lms', sourceId: 'fictional' }, date: '2026-11-11', period: 1,
  startsAt: '2026-11-11T09:00:00+09:00', endsAt: '2026-11-11T10:00:00+09:00', planId: 'fictional', title: '架空の準備',
  decidedOn: '2026-11-10', timeZone: 'Asia/Tokyo', confirmedBy: 'student', createdByRole: 'student', confirmedAt: now.toISOString(),
  status: 'active', revision: 1, calendarItemKey: 'fictional' };

it('counts remaining deadlines this week, includes manual tasks and excludes submitted, ended, cancelled and past tasks', () => {
  const data = { ...emptySession(), assignments: [task('later', date('2026-11-16')), task('sunday', date('2026-11-15')),
    task('today', date('2026-11-10')), task('past', date('2026-11-09')),
    { ...task('submitted', date('2026-11-11')), submission: 'submitted' as const },
    { ...task('ended', date('2026-11-11')), presenceState: 'ended' as const },
    { ...task('cancelled', date('2026-11-11')), presenceState: 'cancelled' as const },
    task('unknown', { kind: 'unreadable', dueText: '?', timeZone: 'Asia/Tokyo' }),
    task('none', { kind: 'none', dueText: 'なし', timeZone: 'Asia/Tokyo' })],
    manualAssignments: [manual, { ...manual, date: '2026-11-09' }, { ...manual, status: 'cancelled' as const }] };
  const before = JSON.stringify(data);
  expect(studentSummary(data, now)).toMatchObject({ nearest: date('2026-11-10'), thisWeek: 3 });
  expect(JSON.stringify(data)).toBe(before);
});
it('distinguishes an unknown previous session and missing fetch history from zero changes', () => {
  expect(studentSummary(emptySession(), now)).toMatchObject({ nearest: undefined, deadlineOrder: Infinity,
    thisWeek: 0, changes: null, hasPreparation: false, lastSucceededAt: undefined });
  const data = emptySession(); data.context.lastSessionAt = now.toISOString();
  expect(studentSummary(data, now).changes).toBe(0);
});
it('includes only changes strictly after the previous session through now', () => {
  const data = emptySession(); data.context.lastSessionAt = '2026-11-09T06:00:00Z';
  data.changes = ['2026-11-09T05:59:59Z', '2026-11-09T06:00:00Z', '2026-11-09T06:00:01Z', now.toISOString(), '2026-11-10T06:00:01Z']
    .map((recordedAt, i) => ({ changeId: String(i), assignmentKey: { system: 'demo-lms', sourceId: 'fictional' },
      kind: 'new', before: null, after: null, observationId: 'fictional', recordedAt }));
  expect(studentSummary(data, now).changes).toBe(2);
});
it('keeps date-only today until its local day ends and excludes passed instants', () => {
  const instant: Deadline = { kind: 'datetime', dueAt: now.toISOString(), timeZone: 'Asia/Tokyo', dueText: '架空の日時' };
  const data = { ...emptySession(), assignments: [task('now', instant),
    task('passed', { ...instant, dueAt: '2026-11-10T05:59:59Z' })] };
  expect(studentSummary(data, now)).toMatchObject({ nearest: instant, thisWeek: 1 });
  const localDate = { ...date('2026-11-09'), timeZone: 'Pacific/Honolulu' };
  expect(studentSummary({ ...emptySession(), assignments: [task('local-today', localDate)] }, now).nearest).toEqual(localDate);
});
it('rolls the week over on Monday in Japan, including Sunday instants with other display zones', () => {
  const deadline: Deadline = { kind: 'datetime', dueAt: '2026-11-15T14:59:59Z', timeZone: 'Pacific/Kiritimati', dueText: '架空の日時' };
  const data = { ...emptySession(), assignments: [task('sunday', deadline), task('monday', date('2026-11-16'))] };
  expect(studentSummary(data, new Date('2026-11-15T14:59:58Z')).thisWeek).toBe(1);
  expect(studentSummary(data, new Date('2026-11-15T15:00:00Z'))).toMatchObject({ thisWeek: 1, nearest: date('2026-11-16') });
});
it('counts only active preparation plans, excluding done and cancelled ones', () => {
  for (const status of ['active', 'done', 'cancelled'] as const) {
    expect(studentSummary({ ...emptySession(), plans: [{ ...plan, status }] }, now).hasPreparation).toBe(status === 'active');
  }
});
it('uses the latest successful fetch rather than the latest attempt and preserves warnings from older systems', () => {
  const data = emptySession();
  data.fetchStates = [{ studentId: 'fictional', system: 'ynu-lms', lastSucceededAt: '2026-11-01T00:00:00Z',
    lastAttemptedAt: now.toISOString(), lastResult: 'failed', lastFailureKind: 'network', lastAppliedObservationId: 'fictional' },
  { studentId: 'fictional', system: 'kulms', lastSucceededAt: '2026-11-10T05:00:00Z', lastAttemptedAt: '2026-11-10T05:00:00Z',
    lastResult: 'success', lastFailureKind: null, lastAppliedObservationId: 'fictional' }];
  expect(studentSummary(data, now)).toMatchObject({ lastSucceededAt: '2026-11-10T05:00:00Z', incomplete: true });
});
