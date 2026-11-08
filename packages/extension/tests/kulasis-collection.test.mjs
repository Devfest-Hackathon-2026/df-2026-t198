import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import expected from '../../../lms-definitions/kulasis/samples/observation.expected.json' with { type: 'json' };
import { collectKulasisObservation } from '../src/kulasis-collection.js';
import { parseObservation } from '../../server/src/observations/input.js';
const { AbortController, Response } = globalThis;

const sample = readFileSync(new URL('../../../lms-definitions/kulasis/samples/timetable.cp932.html', import.meta.url));
const support = readFileSync(new URL('../../../lms-definitions/kulasis/samples/support.html', import.meta.url), 'utf8');
const base = 'https://www.k.kyoto-u.ac.jp/student/la';
const options = () => ({ pageUrl: base + '/top', fetchedAt: expected.fetchedAt, observationId: expected.observationId,
  signal: new AbortController().signal, resolveSite: vi.fn(async () => 'fictional-site'),
  fetcher: vi.fn(async url => new Response(String(url).includes('/entry/') ? sample : support.replace('fictional-code', 'fictional-other'))) });
it('decodes CP932, ignores the delayed logout, and sends a timetable with an explicit mapping', async () => {
  const opts = options();
  opts.fetcher.mockImplementation(async url => new Response(String(url).includes('/entry/') ? sample : String(url).endsWith('1') ? support : '<html><body></body></html>'));
  const result = await collectKulasisObservation(opts);
  expect(result).toEqual(expected); expect(parseObservation(result)).toEqual(expected);
  expect(opts.resolveSite).toHaveBeenCalledExactlyOnceWith('fictional-code');
  expect(opts.fetcher.mock.calls.every(([url, init]) => String(url).startsWith(base) && init?.method === 'GET' && init.credentials === 'same-origin' && init.redirect === 'manual')).toBe(true);
  expect(opts.fetcher.mock.calls[0]?.[0]).toBe(base + '/entry/kouki');
});
it('accepts a browser fetch function that rejects an unrelated receiver', async () => {
  const opts = options();
  opts.fetcher.mockImplementation(async url => new Response(String(url).includes('/entry/') ? sample : String(url).endsWith('1') ? support : '<html><body></body></html>'));
  const original = opts.fetcher.getMockImplementation();
  opts.fetcher.mockImplementation(function (url, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return original(url, init);
  });
  expect(await collectKulasisObservation(opts)).toEqual(expected);
});
it('sends current-host cross-department course URLs accepted by the server', async () => {
  const opts = { ...options(), pageUrl: 'https://k.kyoto-u.ac.jp/student/la/top' };
  const otherDepartment = Buffer.from(sample.toString('latin1').replaceAll('/student/la/support/top', '/student/other/support/top'), 'latin1');
  opts.fetcher.mockImplementation(async url => new Response(String(url).includes('/entry/') ? otherDepartment : '<html></html>'));
  const result = await collectKulasisObservation(opts);
  expect(result.catalogCourses).toHaveLength(2);
  expect(result.catalogCourses.every(course => course.url.startsWith('https://k.kyoto-u.ac.jp/student/other/support/top?no='))).toBe(true);
  expect(parseObservation(result)).toEqual(result);
});
it('uses the current academic half in Japan, including January and the April boundary', async () => {
  for (const [at, path] of [['2031-01-01T00:00:00Z', 'kouki'], ['2031-03-31T15:00:00Z', 'zenki']]) {
    const opts = { ...options(), fetchedAt: at };
    await collectKulasisObservation(opts);
    expect(opts.fetcher.mock.calls[0]?.[0]).toBe(base + '/entry/' + path);
  }
});
it.each(['support/top?no=fictional-no-1', 'oh/top', 'syllabus/top'])('fetches the department timetable when starting from %s', async page => {
  const opts = { ...options(), pageUrl: `${base}/${page}` };
  await collectKulasisObservation(opts);
  expect(opts.fetcher.mock.calls[0][0]).toBe(`${base}/entry/kouki`);
});
it.each(['<meta http-equiv="refresh" content="0;url=/student/logout">', '<form><input type="password"></form>'])('does not publish an empty timetable after logout', async html => {
  const opts = options(); opts.fetcher.mockResolvedValue(new Response(html));
  const result = await collectKulasisObservation(opts);
  expect(result.catalogCourses).toEqual([]); expect(result.courseResults).toEqual([]);
  expect(result.failures[0]?.kind).toBe('not-logged-in');
});
it.each([302, 401])('recognizes an HTTP login redirect: %s', async status => {
  const opts = options(); opts.fetcher.mockResolvedValue(new Response(null, { status }));
  expect((await collectKulasisObservation(opts)).failures[0]?.kind).toBe('not-logged-in');
});
it('does not treat an unrecognized page as proof of no classes', async () => {
  const opts = options(); opts.fetcher.mockResolvedValue(new Response('<html><table><tr><td>unknown</td></tr></table></html>'));
  expect((await collectKulasisObservation(opts)).failures).toEqual([{ courseId: null, kind: 'parse', detail: 'parse-error' }]);
});
it('normalizes decoded pages after checking the original login response', async () => {
  const opts = { ...options(), normalizeHtml: vi.fn(html => html) };
  expect((await collectKulasisObservation(opts)).catalogCourses).toHaveLength(2);
  expect(opts.normalizeHtml).toHaveBeenCalledTimes(3);
  expect(opts.normalizeHtml.mock.calls[0][0]).toContain('架空');
  opts.fetcher.mockResolvedValue(new Response('<input type="password">'));
  opts.normalizeHtml.mockClear();
  expect((await collectKulasisObservation(opts)).failures[0].kind).toBe('not-logged-in');
  expect(opts.normalizeHtml).not.toHaveBeenCalled();
});
it('keeps classes separate if the destination cannot be identified', async () => {
  const opts = options(); opts.resolveSite.mockResolvedValue(undefined);
  const result = await collectKulasisObservation(opts);
  expect(result.catalogCourses).toHaveLength(2);
  expect(result.catalogCourses.every(course => !course.kulmsSiteId)).toBe(true);
});
it('withholds a timetable after a failed mapping lookup so stored mappings are not overwritten', async () => {
  const opts = options();
  opts.fetcher.mockImplementation(async url => new Response(String(url).includes('/entry/') ? sample : String(url).endsWith('1') ? support : '<html></html>'));
  opts.resolveSite.mockRejectedValue(new Error('detail-unavailable'));
  const result = await collectKulasisObservation(opts);
  expect(result.failures).toEqual([{ courseId: null, kind: 'http', detail: 'http-error' }]);
  expect(result.catalogCourses).toEqual([]);
  expect(parseObservation(result)).toEqual(result);
});
it('discards the catalog if the login expires while reading support pages', async () => {
  const opts = options(); opts.fetcher.mockImplementation(async url => new Response(String(url).includes('/entry/') ? sample : '<input type="password">'));
  expect(await collectKulasisObservation(opts)).toMatchObject({ catalogCourses: [], failures: [{ kind: 'not-logged-in' }] });
});
it('aborts without publishing when student activity wins', async () => {
  const controller = new AbortController(); const opts = { ...options(), signal: controller.signal };
  opts.resolveSite.mockImplementation(async () => { controller.abort(); return 'fictional-site'; });
  await expect(collectKulasisObservation(opts)).rejects.toThrow('yielded');
});
