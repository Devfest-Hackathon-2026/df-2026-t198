import { expect, it } from 'vitest';
import { fakeLms } from './helpers/stateful-lms.mjs';

for (const stage of ['course', 'detail']) for (const wrongPage of [false, true]) {
  it(`renews ${stage} form state after student navigation (${wrongPage ? 'unexpected page' : 'HTTP failure'})`, async () => {
    const f = await fakeLms({ stage, wrongPage });
    const observation = await f.collect();
    expect(observation.catalogCourses).toHaveLength(22);
    expect(observation.courseResults).toHaveLength(22);
    expect(observation.courseResults.every(c => c.listComplete && c.seenSourceIds.length === 9)).toBe(true);
    expect(observation.assignments).toHaveLength(132);
    expect(observation.failures).toEqual([]);
    // Detail navigation also invalidates the home form: both the course reopen
    // and the detail retry must recover, with one refreshed home in either case.
    expect(f.recovered).toHaveBeenCalledTimes(stage === 'course' ? 1 : 2);
    expect([...f.attempts].filter(([key]) => key.startsWith(`${stage}:`)).filter(([, n]) => n === 2)).toHaveLength(1);
    expect(f.counts().homeReads).toBe(2);
    expect(f.counts().listReads).toBe(stage === 'course' ? 22 : 23);
  });
}

it('tries a permanently stale course only twice and continues with the remaining courses', async () => {
  const f = await fakeLms({ permanent: true });
  const observation = await f.collect();
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.failures).toHaveLength(22);
  expect([...f.attempts].filter(([key]) => key.startsWith('course:')).every(([, n]) => n === 2)).toBe(true);
  expect(f.counts().homeReads).toBe(23);
  expect(f.recovered).not.toHaveBeenCalled();
});

for (const stage of ['course', 'detail']) it(`does not refresh or retry ${stage} after logout`, async () => {
  const f = await fakeLms({ stage, logout: true });
  const observation = await f.collect();
  expect(observation.failures.every(failure => failure.kind === 'not-logged-in')).toBe(true);
  expect([...f.attempts].filter(([key]) => key.startsWith(`${stage}:`)).every(([, n]) => n === 1)).toBe(true);
  expect(f.counts().homeReads).toBe(1);
  expect(f.recovered).not.toHaveBeenCalled();
});
