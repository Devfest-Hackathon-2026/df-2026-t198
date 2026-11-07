import { expect, it } from 'vitest';
import { preparationAfterDeadline, preparationSlots, preparationPeriodTimes } from '../src/preparation.js';
import type { PreparationPlan } from '../src/types.js';
const assignment = { system: 'ynu-lms' as const, sourceId: 'fictional' };
const now = new Date('2030-11-11T00:00:00Z');
it('compares exact instants and includes the entire date-only day in its own time zone', () => {
  const base = { dueText: '架空', timeZone: 'Asia/Tokyo' };
  const datetime = { ...base, kind: 'datetime' as const, dueAt: '2030-11-15T17:00:00+09:00' };
  expect(preparationAfterDeadline('2030-11-15T08:00:00Z', datetime)).toBe(false);
  expect(preparationAfterDeadline('2030-11-15T08:00:01Z', datetime)).toBe(true);
  const date = { ...base, kind: 'date' as const, date: '2030-11-15' };
  expect(preparationAfterDeadline('2030-11-15T23:59:59+09:00', date)).toBe(false);
  expect(preparationAfterDeadline('2030-11-16T00:00:00+09:00', date)).toBe(true);
  expect(preparationAfterDeadline('2030-11-16T09:00:00+09:00', { ...date, timeZone: 'America/Los_Angeles' })).toBe(false);
  for (const deadline of [null, undefined, { ...base, kind: 'none' as const }, { ...base, kind: 'unreadable' as const }]) {
    expect(preparationAfterDeadline('2030-11-18T13:00:00+09:00', deadline)).toBe(false);
  }
});
it('excludes clock overlaps regardless of the saved period or date label, and permits adjacent intervals', () => {
  const occupied = [{ status: 'active', date: '2030-11-11', period: 5,
    startsAt: '2030-11-11T23:00:00+09:00', endsAt: '2030-11-12T11:00:00+09:00' },
  { status: 'active', date: '2030-11-12', period: 1,
    startsAt: '2030-11-12T13:00:00+09:00', endsAt: '2030-11-12T14:30:00+09:00' }] as PreparationPlan[];
  expect(preparationSlots(assignment, '2030-11-13', [], now, 3, occupied).map(p => p.period)).toEqual([4, 5]);
});
it('ignores cancelled/done intervals and previous-term courses', () => {
  const occupied = [{ status: 'done', date: '2030-11-12', period: 1, startsAt: '2030-11-12T08:50:00+09:00', endsAt: '2030-11-12T10:20:00+09:00' }] as PreparationPlan[];
  expect(preparationSlots(assignment, '2030-11-13', [{ courseId: 'old', name: 'old', currentTerm: false, slots: [{ weekday: 2, period: 1 }] }], now, 1, occupied)[0]?.period).toBe(1);
});

it('exposes clock times only for configured systems, using the YNU table for the fictional demo', () => {
  expect(preparationPeriodTimes['ynu-lms']).toEqual([['08:50', '10:20'], ['10:30', '12:00'], ['13:00', '14:30'],
    ['14:40', '16:10'], ['16:15', '17:45'], ['17:50', '19:20'], ['19:25', '20:55']]);
  expect(preparationPeriodTimes['demo-lms']).toEqual(preparationPeriodTimes['ynu-lms']);
  expect(preparationPeriodTimes.kulms).toBeUndefined();
});

it('does not suggest free KULMS periods before the timetable is known', () => {
  const key = { system: 'kulms' as const, sourceId: 'fictional' };
  const now = new Date('2030-11-08T00:00:00Z');
  expect(preparationSlots(key, '2030-11-20', [], now)).toEqual([]);
  expect(preparationSlots(key, '2030-11-20', [{ courseId: 'fictional', name: '架空の授業', slots: [] }], now)).toEqual([]);
  expect(preparationSlots(key, '2030-11-20', [{ courseId: 'fictional', name: '架空の授業', slots: [{ weekday: 1, period: 1 }] }], now)).toHaveLength(2);
});
