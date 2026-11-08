import { beforeEach, expect, it, vi } from 'vitest';
import input from '../../../lms-definitions/kulms/samples/input.json' with { type: 'json' };
import expected from '../../../lms-definitions/kulms/samples/observation.expected.json' with { type: 'json' };
import { collectKulmsObservation } from '../src/kulms-collection.js';
import { parseObservation } from '../../server/src/observations/input.js';

const origin = 'https://lms.gakusei.kyoto-u.ac.jp';
let requests: { url: string; init: RequestInit | undefined }[];
let replies: Record<string, unknown>;
const fetcher = vi.fn<typeof fetch>();
const options = () => ({ fetcher, observationId: expected.observationId, fetchedAt: expected.fetchedAt,
  signal: new AbortController().signal });
beforeEach(() => {
  requests = [];
  replies = { '/direct/user/current.json': input.user,
    '/direct/site.json?_limit=200&_start=0': input.sites,
    '/direct/site.json?_limit=200&_start=1': { site_collection: [] },
    '/direct/assignment/site/fictional-course.json': input.assignments };
  fetcher.mockReset().mockImplementation(async (url, init) => {
    const path = String(url).replace(origin, ''); requests.push({ url: String(url), init });
    if (!(path in replies)) throw new Error('unexpected-request');
    return new Response(JSON.stringify(replies[path]), { headers: { 'Content-Type': 'application/json' } });
  });
});
it('matches the frozen observation, sends only allowed fields, and measures M2', async () => {
  const result = await collectKulmsObservation(options());
  expect(result).toEqual(expected);
  expect(parseObservation(result)).toEqual(expected);
  expect(requests.every(r => r.url.startsWith(origin + '/direct/') && r.init?.credentials === 'same-origin'
    && r.init.redirect === 'manual' && r.init.method === 'GET')).toBe(true);
  const matches = expected.assignments.flatMap((a, i) => ['title', 'deadline', 'submission'].map(key =>
    JSON.stringify(result.assignments[i]?.[key as 'title']) === JSON.stringify(a[key as 'title'])));
  expect(matches.filter(Boolean)).toHaveLength(15);
  console.info(`M2: ${matches.filter(Boolean).length}/${matches.length} (100%); initial synthetic measurement`);
});
it('accepts a browser fetch function that rejects an unrelated receiver', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(function (this: unknown, url, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return original(url, init);
  });
  expect(await collectKulmsObservation(options())).toEqual(expected);
});
it.each([401, 302])('sends a logout failure instead of an empty success: %s', async status => {
  fetcher.mockResolvedValue(new Response(null, { status }));
  const result = await collectKulmsObservation(options());
  expect(result.failures).toEqual([{ courseId: null, kind: 'not-logged-in', detail: 'not-logged-in' }]);
  expect(result.courseResults).toEqual([]);
});
it.each([null, {}, { id: null }, { id: '' }])('does not treat an anonymous user as logged in: %s', async user => {
  replies['/direct/user/current.json'] = user;
  expect((await collectKulmsObservation(options())).failures[0]?.kind).toBe('not-logged-in');
  expect(requests).toHaveLength(1);
});
it('recognizes a login page returned with status 200', async () => {
  fetcher.mockResolvedValue(new Response('<html>Log in</html>', { headers: { 'Content-Type': 'text/html' } }));
  expect((await collectKulmsObservation(options())).failures[0]?.kind).toBe('not-logged-in');
});
it.each([403, 500])('does not mistake permission or server errors for logout: %s', async status => {
  fetcher.mockResolvedValue(new Response(null, { status }));
  expect((await collectKulmsObservation(options())).failures[0]?.kind).toBe('http');
});
it('requires an explicit collection and does not certify a broken assignment list', async () => {
  replies['/direct/assignment/site/fictional-course.json'] = {};
  const result = await collectKulmsObservation(options());
  expect(result.courseResults[0]?.listComplete).toBe(false);
  expect(result.failures[0]?.kind).toBe('parse');
});
it('does not infer semester from a title or creation date, or a deadline from calendar/closeTime', async () => {
  const result = await collectKulmsObservation(options());
  expect(result.catalogCourses[0]).not.toHaveProperty('currentTerm');
  expect(result.catalogCourses[0]?.slots).toEqual([]);
  expect(result.assignments[3]?.deadline.kind).toBe('unreadable');
});
it('requires the empty terminal site page, detecting repeated pages', async () => {
  replies['/direct/site.json?_limit=200&_start=1'] = input.sites;
  const result = await collectKulmsObservation(options());
  expect(result.failures[0]?.kind).toBe('parse');
  expect(result.courseResults).toEqual([]);
});
it('aborts on student departure without returning a partial observation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(collectKulmsObservation({ ...options(), signal: controller.signal })).rejects.toThrow('yielded');
  expect(fetcher).not.toHaveBeenCalled();
});
it('preserves partial courses on a bad row, without certifying their completeness', async () => {
  replies['/direct/assignment/site/fictional-course.json'] = { assignment_collection: [
    input.assignments.assignment_collection[0], { id: 'fictional-broken', context: 'fictional-course' }] };
  const result = await collectKulmsObservation(options());
  expect(result.courseResults[0]?.listComplete).toBe(false);
  expect(result.assignments).toHaveLength(1); expect(result.failures[0]?.kind).toBe('parse');
  expect(parseObservation(result)).toEqual(result);
});
it('accepts explicit empty lists only while authenticated', async () => {
  replies['/direct/assignment/site/fictional-course.json'] = { assignment_collection: [] };
  const result = await collectKulmsObservation(options());
  expect(result.failures).toEqual([]); expect(result.courseResults[0]?.listComplete).toBe(true);
});
it('collects subsequent site pages even when the server returns fewer than the limit', async () => {
  replies['/direct/site.json?_limit=200&_start=1'] = { site_collection: [{ id: 'fictional-second', title: '架空の次の授業' }] };
  replies['/direct/site.json?_limit=200&_start=2'] = { site_collection: [] };
  replies['/direct/assignment/site/fictional-second.json'] = { assignment_collection: [] };
  expect((await collectKulmsObservation(options())).courseResults.map(r => r.listComplete)).toEqual([true, true]);
});
it('does not mix students if another tab changes the LMS login during collection', async () => {
  const original = fetcher.getMockImplementation()!;
  let probes = 0;
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/user/current.json') && ++probes === 2) return new Response(JSON.stringify({ id: 'fictional-other' }));
    return original(url, init);
  });
  await expect(collectKulmsObservation(options())).rejects.toThrow('account-changed');
});
it('keeps the deadline equality boundary active instead of ending it', async () => {
  const equal = { ...options(), fetchedAt: '2030-11-10T15:00:00.000Z' };
  expect((await collectKulmsObservation(equal)).assignments.map(a => a.sourceId)).toContain('fictional-a');
});
