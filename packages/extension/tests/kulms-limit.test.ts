import { expect, it, vi } from 'vitest';
import { collectKulmsObservation } from '../src/kulms-collection.js';
import { parseObservation } from '../../server/src/observations/input.js';
import { applyObservation } from '../../core/src/ledger.js';
import type { Observation } from '../../core/src/types.js';
import input from '../../../lms-definitions/kulms/samples/input.json' with { type: 'json' };
import siteKinds from '../../../lms-definitions/kulms/samples/site-kinds.input.json' with { type: 'json' };

const at = '2030-11-08T00:00:00Z';
function setup(count: number) {
  const sites: Record<string, unknown>[] = Array.from({ length: count }, (_, i) => ({ id: `fictional-site-${i}`, title: `架空の授業${i}`, type: 'course', published: true }));
  const fetcher = vi.fn<typeof fetch>(async value => {
    const url = new URL(String(value));
    let body: unknown;
    if (url.pathname.endsWith('/user/current.json')) body = input.user;
    else if (url.pathname.endsWith('/site.json')) body = { site_collection: url.searchParams.get('_start') === '0' ? sites : [] };
    else {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!.replace('.json', ''));
      body = { assignment_collection: [{ ...input.assignments.assignment_collection[0], id: `fictional-task-${id}`, context: id }] };
    }
    return new Response(JSON.stringify(body));
  });
  return { sites, fetcher, options: { fetcher, observationId: '18000000-0000-4000-8000-000000000002', fetchedAt: at, signal: new AbortController().signal } };
}
it('collects 101 sites without losing the whole observation, prioritizing an explicit timetable link', async () => {
  const { options, fetcher } = setup(101);
  const result = await collectKulmsObservation({ ...options, prioritySiteIds: ['fictional-site-100'] });
  expect(result.catalogCourses).toHaveLength(100);
  expect(result.catalogCourses[0]).toMatchObject({ courseId: 'fictional-site-100', currentTerm: true });
  expect(result.failures).toEqual([{ courseId: 'fictional-site-99', kind: 'parse', detail: 'course-limit' }]);
  expect(result.courseResults).toHaveLength(100); expect(parseObservation(result)).toEqual(result);
  expect(String(fetcher.mock.calls.find(([url]) => String(url).includes('/assignment/site/'))?.[0])).toContain('/assignment/site/fictional-site-100.json');
});
it('does not cancel omitted assignments on repeated capped observations', async () => {
  const { options } = setup(101);
  const incoming = await collectKulmsObservation(options);
  const row = { ...input.assignments.assignment_collection[0], id: 'fictional-stored' };
  const first: Observation = { ...incoming, catalogCourses: [{ courseId: 'fictional-site-100', name: '架空の授業', slots: [] }],
    courseResults: [{ courseId: 'fictional-site-100', listComplete: true, seenSourceIds: [row.id] }],
    assignments: [{ ...incoming.assignments[0]!, sourceId: row.id, courseId: 'fictional-site-100' }], failures: [] };
  const before = applyObservation([], first, at).assignments;
  const once = applyObservation(before, { ...incoming, observationId: 'fictional-second' }, at);
  const twice = applyObservation(once.assignments, { ...incoming, observationId: 'fictional-third' }, at);
  expect(twice.assignments.find(a => a.key.sourceId === row.id)).toEqual(before[0]);
  expect(twice.changes.some(c => c.assignmentKey.sourceId === row.id)).toBe(false);
});
it('excludes only known non-course and unpublished values, retaining missing or unknown metadata', async () => {
  const { options, sites, fetcher } = setup(7);
  sites.splice(0, sites.length, ...structuredClone(siteKinds));
  const result = await collectKulmsObservation(options);
  expect(result.catalogCourses.map(c => c.courseId)).toEqual(['fictional-site-3', 'fictional-site-4', 'fictional-site-5', 'fictional-site-6']);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/assignment/site/fictional-site-0.'))).toBe(false);
});
it('for a large catalog keeps mapped empty sites and unmatched sites with future deadlines', async () => {
  const { options, fetcher } = setup(103);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => String(url).includes('/assignment/site/') && !String(url).endsWith('fictional-site-102.json')
    ? new Response('{"assignment_collection":[]}') : original(url, init));
  const result = await collectKulmsObservation({ ...options, prioritySiteIds: ['fictional-site-101'] });
  expect(result.catalogCourses.map(c => c.courseId)).toEqual(['fictional-site-101', 'fictional-site-102']);
  expect(result.failures).toEqual([]); expect(parseObservation(result)).toEqual(result);
});
it('bounds both failure and assignment arrays while leaving incomplete lists uncertified', async () => {
  const { options } = setup(302);
  const result = await collectKulmsObservation(options);
  expect(result.failures).toHaveLength(200);
  expect(result.failures.at(-1)).toEqual({ courseId: null, kind: 'parse', detail: 'course-limit' });
  expect(parseObservation(result)).toEqual(result);
});
