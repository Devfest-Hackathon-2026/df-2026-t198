import { expect, it } from 'vitest';
import expected from '../../../lms-definitions/kulms/samples/observation.expected.json' with { type: 'json' };
import { parseObservation } from '../src/observation-input.js';
import { parseManualAssignment } from '../src/manual-assignment-input.js';
import { parsePlan } from '../src/plan-input.js';
it.each(['kulms', 'kulasis'])('accepts the approved system in observations and manual assignments: %s', system => {
  expect(parseObservation({ ...expected, system }).system).toBe(system);
  expect(parseManualAssignment({ title: '架空の課題', date: '2030-11-10', time: null,
    course: { system, courseId: 'fictional-course' }, memo: '' }).course?.system).toBe(system);
  expect(parsePlan({ assignment: { system, sourceId: 'fictional-a' }, date: '2030-11-10', period: 1,
    startsAt: '2030-11-10T08:00:00+09:00', endsAt: '2030-11-10T09:00:00+09:00' }).assignment.system).toBe(system);
});
it('rejects the obsolete connector name', () => {
  expect(() => parseObservation({ ...expected, system: 'panda' })).toThrow('invalid-observation');
});
