import { expect, it } from 'vitest';
import { InvalidPlan, parsePlan, validPlanId } from '../src/plans/input.js';
const input = { assignment: { system: 'ynu-lms', sourceId: 'fictional-task' }, date: '2030-11-11', period: 3,
  startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00' };
it('accepts only the explicit slot and Japan-time interval, with no caller-supplied author or calendar destination', () => {
  expect(parsePlan(input)).toEqual(input);
  for (const extra of ['confirmedBy', 'createdByRole', 'calendarId', 'status', 'revision', 'uid']) {
    expect(() => parsePlan({ ...input, [extra]: 'forged' })).toThrow(InvalidPlan);
  }
});
it.each([
  { date: '2030-02-30' }, { date: '2030-11-12' }, { startsAt: '2030-11-11T24:00:00+09:00' },
  { startsAt: '2030-11-11T13:60:00+09:00' }, { startsAt: '2030-11-11T04:00:00Z' },
  { startsAt: input.endsAt }, { endsAt: '2030-11-12T14:30:00+09:00' }, { period: 0 }, { period: 25 },
  { period: 1.5 }, { assignment: { system: 'other', sourceId: 'fictional-task' } },
  { assignment: { system: 'ynu-lms', sourceId: 'fictional-task', uid: 'other' } },
])('rejects invalid date, interval, slot and assignment shapes: %j', patch => {
  expect(() => parsePlan({ ...input, ...patch })).toThrow(InvalidPlan);
});
it('limits plan IDs to UUID v4, excluding path segments and arbitrary field names', () => {
  expect(validPlanId('11111111-1111-4111-8111-111111111111')).toBe(true);
  for (const id of ['..', 'other/plans/id', '__proto__', '11111111-1111-1111-1111-111111111111']) expect(validPlanId(id)).toBe(false);
});
