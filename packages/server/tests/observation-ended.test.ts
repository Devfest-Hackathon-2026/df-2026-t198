import { expect, it } from 'vitest';
import { parseObservation } from '../src/observations/input.js';
import { observation } from './observation-fixture.js';

function ended() {
  const body = observation();
  return { ...body, assignments: [], courseResults: [{ ...body.courseResults[0]!, endedSourceIds: ['fictional/task'] }] };
}
it('accepts ended task IDs and an explicitly skipped course while retaining the legacy contract', () => {
  expect(parseObservation(ended())).toEqual(ended());
  const past = { ...observation(), assignments: [], courseResults: [],
    catalogCourses: [{ ...observation().catalogCourses[0]!, currentTerm: false }] };
  expect(parseObservation(past)).toEqual(past);
  expect(parseObservation(observation())).toEqual(observation());
});
it('rejects unknown, duplicate, overlapping or credential-bearing ended IDs', () => {
  for (const ids of [['unknown'], ['fictional/task', 'fictional/task'], ['SID=synthetic-marker']]) {
    const body = ended(); body.courseResults[0]!.endedSourceIds = ids;
    expect(() => parseObservation(body)).toThrow('invalid-observation');
  }
  expect(() => parseObservation({ ...ended(), assignments: observation().assignments })).toThrow('invalid-observation');
  expect(() => parseObservation({ ...ended(), courseResults: [{ ...ended().courseResults[0], endedSourceIds: 'fictional/task' }] }))
    .toThrow('invalid-observation');
});
it('rejects results for an out-of-term course and non-boolean term markers', () => {
  for (const currentTerm of [false, 'false', null, 0]) {
    expect(() => parseObservation({ ...observation(), catalogCourses: [{ ...observation().catalogCourses[0], currentTerm }] }))
      .toThrow('invalid-observation');
  }
});
