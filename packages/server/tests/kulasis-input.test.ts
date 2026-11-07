import { expect, it } from 'vitest';
import { parseObservation } from '../src/observation-input.js';
import type { Observation } from '@kadai-hisho/core';

export const timetable: Observation = {
  schemaVersion: 1, observationId: '18000000-0000-4000-8000-000000000001', system: 'kulasis',
  definitionId: 'kulasis-timetable', definitionVersion: 1, fetchedAt: '2030-11-08T00:00:00Z',
  catalogCourses: [{ courseId: 'fictional-no', name: '架空の授業', slots: [{ weekday: 2, period: 3 }],
    currentTerm: true, kulmsSiteId: 'fictional-site' }], courseResults: [], assignments: [], failures: [],
};
it('accepts an explicit mapping only on a timetable source', () => {
  expect(parseObservation(timetable)).toEqual(timetable);
  expect(() => parseObservation({ ...timetable, system: 'kulms' })).toThrow('invalid-observation');
});
it('rejects a timetable claiming to have read an assignment list, even an empty complete list', () => {
  expect(() => parseObservation({ ...timetable,
    courseResults: [{ courseId: 'fictional-no', listComplete: true, seenSourceIds: [] }] })).toThrow('invalid-observation');
});
it('allows a fixed overflow failure for an omitted KULMS course, without certifying its list', () => {
  const observation = { ...timetable, system: 'kulms', catalogCourses: [],
    failures: [{ courseId: 'fictional-omitted', kind: 'parse', detail: 'course-limit' }] };
  expect(parseObservation(observation)).toEqual(observation);
  expect(() => parseObservation({ ...observation, system: 'ynu-lms' })).toThrow('invalid-observation');
  expect(() => parseObservation({ ...observation, failures: [{ courseId: 'fictional-omitted', kind: 'parse', detail: 'parse-error' }] })).toThrow('invalid-observation');
});
