import { expect, it } from 'vitest';
import type { AssignmentChange, LedgerAssignment } from '../../core/src/types';
import { buildSessionView } from '../src/session-model';

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
