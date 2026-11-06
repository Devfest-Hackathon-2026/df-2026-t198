import { expect, it } from 'vitest';
import { initialDemo } from '../src/demo-initial.js';
it('starts the fictional deadlines three Japan calendar days ahead, including before 09:00 JST', () => {
  for (const hour of ['00:00', '03:30', '08:59', '09:00', '23:59']) {
    const demo = initialDemo(Date.parse(`2026-11-07T${hour}:00+09:00`));
    expect(demo.data.courses[0]!.assignments[0]!.dueAt).toBe('2026-11-10T08:00:00.000Z');
  }
});
