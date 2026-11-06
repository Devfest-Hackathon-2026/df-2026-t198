import { expect, it } from 'vitest';
import { initialDemo } from '../src/demo-initial.js';

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
  expect(context).toEqual({
    lastSessionAt: new Date(now - 7 * 86400_000).toISOString(),
    nextSessionAt: new Date(now + 7 * 86400_000).toISOString(),
  });
});
