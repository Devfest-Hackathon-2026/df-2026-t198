import { parseUrl } from './calendar-url.mjs';
import { expect, it } from 'vitest';
import { acknowledgeCalendarItem, deadlineDesired, reconcileCalendarItem } from '../src/calendar.js';
import { applyObservation } from '../src/ledger.js';
import type { CalendarItem, LedgerAssignment, Observation } from '../src/types.js';

const linkOptions = { parseUrl };
const ynuLinkOptions = { ...linkOptions, navigation: { statefulSession: true, home: '/lms/homeHoml/doIndex' } };

it('does not acknowledge a newer desired revision with a delayed success', () => {
  const item = { itemKey: 'a', generation: 1, eventId: 'abcde', desiredRevision: 2,
    appliedRevision: 0, appliedAt: null, lastAttemptedAt: null, lastErrorCode: null } as CalendarItem;
  expect(acknowledgeCalendarItem(item, { itemKey: 'a', generation: 1, eventId: 'abcde',
    revision: 1, errorCode: null }, '2026-11-06T01:00:00Z')).toEqual(item);
});

function assignment(): LedgerAssignment {
  const input: Observation = { schemaVersion: 1, observationId: 'synthetic-observation', system: 'demo-lms',
    definitionId: 'demo', definitionVersion: 1, fetchedAt: '2026-11-06T00:00:00Z',
    catalogCourses: [{ courseId: 'course', name: '架空の授業', slots: [] }],
    courseResults: [{ courseId: 'course', listComplete: true, seenSourceIds: ['task'] }], failures: [],
    assignments: [{ sourceId: 'task', courseId: 'course', title: '架空の課題', url: 'https://example.invalid/task',
      submission: 'not-submitted', deadline: { kind: 'date', date: '2026-12-31', dueText: '12月31日まで', timeZone: 'Asia/Tokyo' } }] };
  return applyObservation([], input, input.fetchedAt).assignments[0]!;
}
it('deletes an ended task event without inventing an event for a task first seen ended', () => {
  const row = assignment();
  const first = reconcileCalendarItem(undefined, 'key', row, '授業', 'calendar', () => 'abcde', linkOptions)!;
  row.presenceState = 'ended';
  expect(deadlineDesired(row, '授業', linkOptions)).toEqual({ state: 'deleted' });
  expect(reconcileCalendarItem(first, 'key', row, '授業', 'calendar', () => 'unused', linkOptions))
    .toMatchObject({ eventId: 'abcde', generation: 1, desiredRevision: 2, desired: { state: 'deleted' } });
  expect(reconcileCalendarItem(undefined, 'key', row, '授業', 'calendar', () => 'unused', linkOptions)).toBeUndefined();
});
it('uses an all-day event with the exclusive next-day end and compact context', () => {
  expect(deadlineDesired(assignment(), '架空の授業', linkOptions)).toEqual({ state: 'present', event: {
    summary: '架空の授業：架空の課題', description: '締切：12月31日まで\nLMSで開く：https://example.invalid/task',
    start: { date: '2026-12-31' }, end: { date: '2027-01-01' }, transparency: 'transparent', reminders: { useDefault: true },
  } });
});
it('opens the LMS home with a route for YNU instead of the POST-only assignment URL', () => {
  const row = assignment();
  row.key.system = 'ynu-lms';
  row.latest.url = 'https://example.invalid/lms/corsColl/linkKyozaiTitle';
  const desired = deadlineDesired(row, '架空の授業', ynuLinkOptions);
  expect(desired).toMatchObject({ state: 'present', event: {
    description: '締切：12月31日まで\nLMSで開く：https://example.invalid/lms/homeHoml/doIndex\n道順：ホーム › 架空の授業 › 架空の課題',
  } });
});
it('uses the supplied navigation for another LMS and escapes route labels', () => {
  const row = assignment();
  row.key.system = 'kulms';
  row.latest.title = '<架空の課題>';
  const desired = deadlineDesired(row, '架空の授業', { ...linkOptions, navigation: { statefulSession: true, home: '/another-home' } });
  expect(desired).toMatchObject({ state: 'present', event: {
    description: '締切：12月31日まで\nLMSで開く：https://example.invalid/another-home\n道順：ホーム › 架空の授業 › &lt;架空の課題&gt;',
  } });
});
it.each([undefined, linkOptions, ynuLinkOptions])('omits a link that cannot be validated without losing the deadline (%#)', options => {
  const row = assignment();
  row.latest.url = 'javascript:alert(1)';
  expect(deadlineDesired(row, '架空の授業', options)).toMatchObject({ state: 'present', event: {
    description: '締切：12月31日まで', start: { date: '2026-12-31' },
  } });
});
it('omits an unsafe home instead of falling back to the POST-only URL', () => {
  const row = assignment();
  row.latest.url = 'https://example.invalid/lms/corsColl/linkKyozaiTitle';
  expect(deadlineDesired(row, '架空の授業', { ...linkOptions, navigation: { statefulSession: true, home: 'https://other.invalid/' } }))
    .toMatchObject({ state: 'present', event: { description: '締切：12月31日まで' } });
});
it('explains an unreadable deadline without copying the review detail or changing the known date', () => {
  const row = assignment();
  row.latest.deadline = { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' };
  row.reviewReasons = [{ kind: 'unreadable-deadline', detail: 'private review detail' }];
  expect(deadlineDesired(row, '架空の授業', linkOptions)).toMatchObject({ state: 'present', event: {
    summary: '【要確認】架空の授業：架空の課題',
    description: '締切：12月31日まで\nLMSで開く：https://example.invalid/task\n要確認：今回、締切を読めませんでした。前に確認できた締切があれば、そのまま出しています。',
    start: { date: '2026-12-31' }, end: { date: '2027-01-01' },
  } });
});
it('updates an already synced event description once without allocating another event', () => {
  const row = assignment();
  row.latest.deadline = { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' };
  row.reviewReasons = [{ kind: 'unreadable-deadline', detail: '' }];
  const previous: CalendarItem = {
    itemKey: 'key', kind: 'deadline', sourceKey: row.key, calendarId: 'calendar', eventId: 'abcde', generation: 1,
    desiredRevision: 4, appliedRevision: 4, appliedAt: '2026-11-06T00:00:00Z',
    lastAttemptedAt: '2026-11-06T00:00:00Z', lastErrorCode: null,
    desired: { state: 'present', event: { summary: '【要確認】架空の授業：架空の課題',
      description: '締切：12月31日まで\nLMSで開く：https://example.invalid/task',
      start: { date: '2026-12-31' }, end: { date: '2027-01-01' },
      transparency: 'transparent', reminders: { useDefault: true } } },
  };
  const newEventId = () => { throw new Error('must update the existing event'); };
  const updated = reconcileCalendarItem(previous, 'key', row, '架空の授業', 'calendar', newEventId, linkOptions)!;
  expect(updated).toMatchObject({ itemKey: 'key', eventId: 'abcde', generation: 1,
    desiredRevision: 5, appliedRevision: 4, desired: { state: 'present', event: {
      description: expect.stringContaining('要確認：今回、締切を読めませんでした。'),
    } } });
  expect(reconcileCalendarItem(updated, 'key', row, '架空の授業', 'calendar', newEventId, linkOptions)).toBe(updated);
  const applied = acknowledgeCalendarItem(updated, { itemKey: 'key', generation: 1, eventId: 'abcde', revision: 5, errorCode: null }, '2026-11-09T00:00:00Z');
  expect(reconcileCalendarItem(applied, 'key', row, '架空の授業', 'calendar', newEventId, linkOptions)).toBe(applied);
});
it('keeps the official time, shows conflicting dates without copying the announcement, and disables submitted reminders', () => {
  const row = assignment();
  row.officialDeadline!.deadline = { kind: 'datetime', dueAt: '2026-11-12T12:00:00+09:00', dueText: '11月12日 正午', timeZone: 'Asia/Tokyo' };
  row.submission = 'submitted';
  row.reviewReasons = [{ kind: 'conflicting-deadline', detail: 'notice (v1): 2026-11-14T12:00:00+09:00 / private announcement body' }];
  const desired = deadlineDesired(row, '架空の授業', linkOptions);
  expect(desired).toMatchObject({ state: 'present', event: { summary: '【要確認】架空の授業：架空の課題',
    start: { dateTime: '2026-11-12T12:00:00+09:00' }, end: { dateTime: '2026-11-12T03:05:00.000Z' }, reminders: { useDefault: false } } });
  if (desired.state !== 'present') throw new Error();
  expect(desired.event.description.split('\n')[2]).toBe('要確認：課題の欄 2026-11-12T12:00:00+09:00 ／ お知らせ 2026-11-14T12:00:00+09:00');
  expect(desired.event.description).not.toContain('private announcement body');
});
it('preserves an unreadable deadline and does not invent one without official evidence', () => {
  const row = assignment();
  row.latest.deadline = { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' };
  row.reviewReasons = [{ kind: 'unreadable-deadline', detail: '' }];
  expect(deadlineDesired(row, '授業', linkOptions)).toMatchObject({ state: 'present', event: { start: { date: '2026-12-31' }, summary: '【要確認】授業：架空の課題' } });
  row.officialDeadline = null;
  expect(deadlineDesired(row, '授業', linkOptions)).toEqual({ state: 'deleted' });
});
it('keeps an ID across edits and retries, finishes deletion before restoration, then changes generation', () => {
  const row = assignment();
  const first = reconcileCalendarItem(undefined, 'key', row, '授業', 'calendar', () => 'abcde', linkOptions)!;
  expect(reconcileCalendarItem(first, 'key', row, '授業', 'calendar', () => 'unused', linkOptions)).toBe(first);
  row.latest.title = '変更';
  const changed = reconcileCalendarItem(first, 'key', row, '授業', 'calendar', () => 'unused', linkOptions)!;
  expect(changed).toMatchObject({ eventId: 'abcde', generation: 1, desiredRevision: 2 });
  row.presenceState = 'cancelled';
  const deleted = reconcileCalendarItem(changed, 'key', row, '授業', 'calendar', () => 'unused', linkOptions)!;
  row.presenceState = 'active';
  expect(reconcileCalendarItem(deleted, 'key', row, '授業', 'calendar', () => 'unused', linkOptions)).toBe(deleted);
  const ack = acknowledgeCalendarItem(deleted, { itemKey: 'key', generation: 1, eventId: 'abcde', revision: 3, errorCode: null }, 'now');
  const restored = reconcileCalendarItem(ack, 'key', row, '授業', 'calendar', () => '12345', linkOptions)!;
  expect(restored).toMatchObject({ generation: 2, eventId: '12345', desiredRevision: 4, appliedRevision: 3 });
  expect(acknowledgeCalendarItem(restored, { itemKey: 'key', generation: 1, eventId: 'abcde', revision: 4, errorCode: null }, 'now')).toBe(restored);
});
it('does not create a new revision when stored map fields arrive in a different order', () => {
  const row = assignment();
  const first = reconcileCalendarItem(undefined, 'key', row, '授業', 'calendar', () => 'abcde', linkOptions)!;
  if (first.desired.state !== 'present') throw new Error();
  const event = first.desired.event;
  const restored: CalendarItem = { ...first, desired: { event: {
    reminders: event.reminders, end: event.end, start: event.start, description: event.description,
    transparency: event.transparency, summary: event.summary,
  }, state: 'present' } };
  expect(reconcileCalendarItem(restored, 'key', row, '授業', 'calendar', () => 'unused', linkOptions)).toBe(restored);
});
