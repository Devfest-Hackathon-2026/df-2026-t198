import { expect, it } from 'vitest';
import { parseManualAssignment } from '../src/manual-assignments/input.js';
const input = { title: '架空の紙の課題', date: '2032-02-29', time: null, course: null, memo: '' };
it('accepts an actual leap day and preserves absent time and course', () => {
  expect(parseManualAssignment(input)).toEqual(input);
  expect(parseManualAssignment({ ...input, time: '00:00', course: { system: 'kulms', courseId: 'fictional' } })).toMatchObject({ time: '00:00' });
});
it('rejects forged fields, non-dates and malformed course identities', () => {
  for (const bad of [{ ...input, date: '2031-02-29' }, { ...input, time: '' }, { ...input, status: 'active' },
    { ...input, course: { system: 'manual', courseId: 'fictional' } }, { ...input, memo: null }, { ...input, title: '\u0000' },
    { ...input, course: [] }, { ...input, date: '2030-1-1' }]) expect(() => parseManualAssignment(bad)).toThrow();
});
