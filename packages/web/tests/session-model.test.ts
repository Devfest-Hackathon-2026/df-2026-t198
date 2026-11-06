import { expect, it } from 'vitest';
import type { AssignmentChange, LedgerAssignment } from '../../core/src/types';
import { buildSessionView, changeDescription, formatDeadline } from '../src/session-model';

const now = new Date('2026-11-06T06:00:00Z');
const context = { lastSessionAt: '2026-11-01T10:00:00+09:00', nextSessionAt: '2026-11-13T11:00:00+09:00' };
function row(id: string, deadline: LedgerAssignment['latest']['deadline'], extra: Partial<LedgerAssignment> = {}): LedgerAssignment {
  return { key: { system: 'demo-lms', sourceId: id }, latest: { sourceId: id, courseId: 'math', title: id,
    url: 'https://example.org/task', deadline, submission: 'not-submitted' },
    officialDeadline: { deadline, url: 'https://example.org/task', fetchedAt: now.toISOString(), observationId: 'fictional' },
    presenceState: 'active', submission: 'not-submitted', submittedAt: null, consecutiveMissingCount: 0,
    lastSeenAt: now.toISOString(), lastSeenObservationId: 'fictional', reviewReasons: [], preparationStartsAt: null, ...extra };
}
const date = (value: string) => ({ kind: 'date' as const, date: value, dueText: value, timeZone: 'Asia/Tokyo' });
const instant = (value: string) => ({ kind: 'datetime' as const, dueAt: value, dueText: value, timeZone: 'Asia/Tokyo' });
it('shows remaining deadlines through the next session, preserving date-only precision', () => {
  const assignments = [row('yesterday', date('2026-11-05')), row('today', date('2026-11-06')),
    row('session-date', date('2026-11-13')), row('at-session', instant('2026-11-13T11:00:00+09:00')),
    row('after-session', instant('2026-11-13T11:00:01+09:00')), row('later', date('2026-11-14')),
    row('done', date('2026-11-07'), { submission: 'submitted' }),
    row('cancelled', date('2026-11-07'), { presenceState: 'cancelled' }),
    row('none', { kind: 'none', dueText: 'なし', timeZone: 'Asia/Tokyo' })];
  expect(buildSessionView({ assignments, changes: [], context }, now).deadlines.map(r => r.latest.title))
    .toEqual(['today', 'session-date', 'at-session']);
});
it('uses deadline timezone at the current-day and next-session date boundary', () => {
  const zoneDate = { ...date('2026-11-05'), timeZone: 'America/Los_Angeles' };
  const view = buildSessionView({ assignments: [row('west-coast', zoneDate)], changes: [], context },
    new Date('2026-11-06T02:00:00Z'));
  expect(view.deadlines).toHaveLength(1);
});
it('selects changes after the previous session and before now across courses, newest first', () => {
  const change = (id: string, at: string): AssignmentChange => ({ changeId: id, recordedAt: at,
    assignmentKey: { system: 'demo-lms', sourceId: id }, kind: 'deadline-changed', before: date('2026-11-07'),
    after: date('2026-11-08'), observationId: 'fictional' });
  const changes = [change('old', '2026-11-01T00:00:00Z'), change('boundary', context.lastSessionAt),
    change('recent', '2026-11-06T05:00:00Z'), change('earlier', '2026-11-02T00:00:00Z'),
    change('future', '2026-11-07T00:00:00Z')];
  expect(buildSessionView({ assignments: [], changes, context }, now).changes.map(r => r.changeId)).toEqual(['recent', 'earlier']);
});
it('keeps review reasons even outside the deadline interval and does not invent missing session dates', () => {
  const assignments = [row('review', date('2026-11-20'), { reviewReasons: [
    { kind: 'unreadable-deadline', detail: 'unreadable' },
  ] })];
  const view = buildSessionView({ assignments, changes: [], context: { lastSessionAt: null, nextSessionAt: null } }, now);
  expect(view.review.map(r => r.latest.title)).toEqual(['review']);
  expect(view.deadlines).toEqual([]);
  expect(view.changes).toEqual([]);
});

it('offers at most two weekday periods per task, before its deadline, without classes or stored plans', async () => {
  const { preparationCandidates, emptySession } = await import('../src/session-model');
  const data = { ...emptySession(), context, assignments: [row('next-week', date('2026-11-11')),
    row('done', date('2026-11-11'), { submission: 'submitted' }),
    row('cancelled', date('2026-11-11'), { presenceState: 'cancelled' }),
    row('after-session', date('2026-11-16')), row('tomorrow', date('2026-11-07'))],
    courses: [{ courseId: 'math', name: '数学', system: 'demo-lms' as const,
      slots: [{ weekday: 1 as const, period: 1 }, { weekday: 1 as const, period: 2 }] }] };
  const original = JSON.stringify(data);
  expect(preparationCandidates(data, now)).toEqual([
    { assignment: { system: 'demo-lms', sourceId: 'next-week' }, date: '2026-11-09', period: 3 },
    { assignment: { system: 'demo-lms', sourceId: 'next-week' }, date: '2026-11-09', period: 4 },
  ]);
  expect(JSON.stringify(data)).toBe(original);
  expect(preparationCandidates({ ...data, context: { ...context, nextSessionAt: null } }, now)).toEqual([]);
});

it('does not suggest a date-only due day or any period in a fully occupied timetable', async () => {
  const { preparationCandidates, emptySession } = await import('../src/session-model');
  const data = { ...emptySession(), context, assignments: [row('monday-due', date('2026-11-09'))], courses: [] };
  expect(preparationCandidates(data, now)).toEqual([]); // Friday now, then weekend, then due day.
  const full = { courseId: 'full', name: '授業', system: 'demo-lms' as const,
    slots: ([1, 2, 3, 4, 5] as const).flatMap(weekday => Array.from({ length: 5 }, (_, p) => ({ weekday, period: p + 1 }))) };
  expect(preparationCandidates({ ...data, courses: [full], assignments: [row('later', date('2026-11-13'))] }, now)).toEqual([]);
});

it('formats deadlines without timezone identifiers and describes extensions in a sentence', () => {
  const before = instant('2026-11-09T17:00:00+09:00');
  const after = instant('2026-11-10T17:00:00+09:00');
  expect(formatDeadline(before)).toBe('11/9 17:00');
  expect(formatDeadline(date('2026-11-12'))).toBe('2026/11/12（日付のみ）');
  expect(formatDeadline({ kind: 'none', dueText: 'なし', timeZone: 'Asia/Tokyo' })).toBe('締切なし');
  expect(formatDeadline({ kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' })).toBe('締切を確認できませんでした');
  expect(formatDeadline({ kind: 'unreadable', dueText: ' - ', timeZone: 'Asia/Tokyo' }))
    .toBe('LMSに締切日時の記載がありません（表示「-」）');
  const change: AssignmentChange = { changeId: 'extension', recordedAt: now.toISOString(),
    assignmentKey: { system: 'demo-lms', sourceId: 'task' }, kind: 'deadline-changed',
    before, after, observationId: 'fictional' };
  expect(changeDescription(change)).toBe('締切が 11/9 17:00 から 11/10 17:00 に変わりました');
  expect(changeDescription({ ...change, before: date('2026-11-09'), after: date('2026-11-10') }))
    .toBe('締切が 2026/11/09（日付のみ） から 2026/11/10（日付のみ） に変わりました');
});
