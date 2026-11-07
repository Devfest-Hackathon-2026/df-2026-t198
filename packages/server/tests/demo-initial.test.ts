import { expect, it } from 'vitest';
import { initialDemo } from '../src/demo-initial.js';

it.each([
  ['2026-11-07T07:41:00+09:00', '2026-10-30T06:00:00.000Z', '2026-11-13T06:00:00.000Z'],
  ['2026-11-08T23:59:00+09:00', '2026-10-30T06:00:00.000Z', '2026-11-13T06:00:00.000Z'],
  ['2026-11-09T00:01:00+09:00', '2026-11-02T06:00:00.000Z', '2026-11-16T06:00:00.000Z'],
])('uses weekday 15:00 Japan appointments and a fictional name from %s', (at, lastSessionAt, nextSessionAt) => {
  expect(initialDemo(Date.parse(at))).toMatchObject({ displayName: '架空の学生A', context: { lastSessionAt, nextSessionAt } });
});

it.each([
  ['2026-11-07T00:00:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T02:34:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T08:59:59.999+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T09:00:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T17:00:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T23:59:59.999+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-12-30T02:34:00+09:00', '2027-01-02T08:00:00.000Z'],
  ['2028-02-27T02:34:00+09:00', '2028-03-01T08:00:00.000Z'],
])('starts the demo three Japanese dates later at 17:00 from %s', (at, expectedDueAt) => {
  const now = Date.parse(at);
  const { data, context } = initialDemo(now);
  expect(data.courses.flatMap(course => course.assignments.map(task => task.dueAt)))
    .toEqual([expectedDueAt, expectedDueAt]);
  expect(Date.parse(context.lastSessionAt)).toBeLessThan(now);
  expect(Date.parse(context.nextSessionAt)).toBeGreaterThan(now);
  for (const value of Object.values(context)) {
    const at = new Date(value);
    expect(at.getUTCHours()).toBe(6);
    expect(at.getUTCMinutes()).toBe(0);
    expect(at.getUTCDay()).toBeGreaterThan(0);
    expect(at.getUTCDay()).toBeLessThan(6);
  }
});
