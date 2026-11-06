import { expect, it } from 'vitest';
import { preparationSlots, preparationPeriodTimes } from '../src/preparation.js';
import type { PreparationPlan } from '../src/types.js';
const assignment = { system: 'ynu-lms' as const, sourceId: 'fictional' };
const now = new Date('2030-11-11T00:00:00Z');
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
  expect(preparationPeriodTimes.panda).toBeUndefined();
});
