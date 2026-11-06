import { expect, it } from 'vitest';
import { manualDeadlineDesired, reconcileDesiredCalendarItem } from '../src/calendar.js';
import { manualDeadline } from '../src/manual-assignment.js';
import type { ManualAssignment } from '../src/types.js';

const row: ManualAssignment = { manualAssignmentId: 'fictional', title: '<架空の紙の課題>', date: '2030-12-31', time: null,
  course: null, courseName: null, memo: '架空の短いメモ', createdBy: 'fictional-supporter', createdByRole: 'supporter',
  createdAt: '2030-12-01T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'fictional-item' };
it('keeps a date-only deadline all-day across a year boundary, with no invented time, LMS URL or memo', () => {
  expect(manualDeadline(row)).toMatchObject({ kind: 'date', date: '2030-12-31' });
  const desired = manualDeadlineDesired(row);
  expect(desired).toMatchObject({ state: 'present', event: {
    summary: '<架空の紙の課題>', start: { date: '2030-12-31' }, end: { date: '2031-01-01' }, reminders: { useDefault: true },
  } });
  if (desired.state !== 'present') throw new Error('expected-event');
  expect(desired.event.description).toContain('支援担当が入れました');
  expect(desired.event.description).not.toMatch(/LMS|架空の短いメモ|23:59/);
});
it('uses the selected Japan time with the same five-minute marker as LMS deadlines', () => {
  const desired = manualDeadlineDesired({ ...row, courseName: '架空の授業', time: '13:45' });
  expect(desired).toMatchObject({ state: 'present', event: {
    summary: '架空の授業：<架空の紙の課題>', start: { dateTime: '2030-12-31T13:45:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2030-12-31T04:50:00.000Z', timeZone: 'Asia/Tokyo' },
  } });
});
it('removes the same calendar event and keeps the deletion pending until acknowledged', () => {
  const source = { itemKey: row.calendarItemKey, kind: 'manual-deadline' as const, sourceKey: { system: 'manual' as const, sourceId: row.manualAssignmentId } };
  const created = reconcileDesiredCalendarItem(undefined, source, manualDeadlineDesired(row), null, () => 'abcde')!;
  const cancelled = reconcileDesiredCalendarItem(created, source, manualDeadlineDesired({ ...row, status: 'cancelled' }), null, () => 'other')!;
  expect(cancelled).toMatchObject({ eventId: 'abcde', generation: 1, desiredRevision: 2, appliedRevision: 0, desired: { state: 'deleted' } });
});

it('keeps an overdue manual deadline on the calendar until explicitly cancelled', () => {
  const overdue = { ...row, date: '2000-01-01' };
  expect(manualDeadlineDesired(overdue)).toMatchObject({ state: 'present', event: { start: { date: '2000-01-01' } } });
  expect(manualDeadlineDesired({ ...overdue, status: 'cancelled' })).toEqual({ state: 'deleted' });
});
