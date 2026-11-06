import { readFile } from 'node:fs/promises';
import { URL, URLSearchParams } from 'node:url';
import { expect, it, vi } from 'vitest';
import { collectObservation } from '../src/collection.js';
import { executeLmsRequest } from '../src/lms-request.js';
import { parseObservation } from '../../server/src/observation-input.js';

const sample = async (name) => readFile(new URL(`../../../lms-definitions/coursepower/samples/${name}.html`, import.meta.url), 'utf8');
const homeForm = '<form id="homeHomlForm" name="homeHomlActionForm"><input name="nendo" value="2098"><input name="kougiId"><input name="ignoredSecret" value="synthetic-private"></form>';
const detailForm = '<form id="main_form" name="corsCollActionForm"><input name="jyugyoHiddenId" value="synthetic-folder"><input name="pankuzuHantei" value="0"></form>';
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session?ignored=synthetic-private';

async function fixture({ duplicateFormNames = false } = {}) {
  const home = await sample('home'), list = await sample('assignment-list'), detail = await sample('assignment-detail-open');
  const calls = [];
  const fetcher = vi.fn(async (input, init) => {
    const url = String(input), body = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ url, init });
    const homeDecoys = duplicateFormNames ? ['homehomlInfo', 'ChangeLang'].map(id =>
      `<form id="${id}" name="homeHomlActionForm"><input name="nendo" value="wrong-form"></form>`).join('') : '';
    const detailDecoys = duplicateFormNames ? ['ChangeLang', 'list_form', 'ChangeLang'].map(id =>
      `<form id="${id}" name="corsCollActionForm"><input name="jyugyoHiddenId" value="wrong-form"></form>`).join('') : '';
    const html = url.includes('linkKougi') ? list + detailDecoys + detailForm : url.includes('linkKyozaiTitle')
      ? detail.replaceAll('架空課題04', `架空課題${body.get('kyozaiId')}`) : home + homeDecoys + homeForm;
    return { ok: true, url, text: async () => html };
  });
  const request = (operation) => executeLmsRequest(operation, pageUrl, 'synthetic-session', fetcher, async () => {});
  return { calls, fetcher, request, options: { request, observationId: '00000000-0000-4000-8000-000000000001', fetchedAt: '2098-11-01T00:00:00Z' } };
}

it('reads every catalog course and creates exactly one API-compatible observation without session data', async () => {
  const f = await fixture();
  const observation = await collectObservation(f.options);
  expect(observation.catalogCourses).toHaveLength(22);
  expect(observation.courseResults).toHaveLength(22);
  expect(f.calls.filter(c => c.url.includes('linkKougi'))).toHaveLength(22);
  expect(observation.courseResults.every(c => c.seenSourceIds.length === 9 && c.listComplete && c.endedSourceIds.length === 3)).toBe(true);
  expect(observation.failures).toEqual([]);
  // Three closed materials are recorded as ended; their detail is not requested.
  expect(observation.assignments).toHaveLength(22 * 6);
  expect(new Set(observation.assignments.map(a => a.sourceId)).size).toBe(22 * 6);
  expect(parseObservation(observation)).toEqual(observation);
  expect(JSON.stringify(observation)).not.toMatch(/synthetic-session|synthetic-private|ignoredSecret|Cookie|SID=/i);
  const posts = f.calls.filter(c => c.init.method === 'POST');
  expect(posts.every(c => !String(c.init.body).includes('ignoredSecret'))).toBe(true);
  expect(new URLSearchParams(String(posts[0].init.body)).get('nendo')).toBe('2098');
});

it('selects the unique main form IDs when unrelated forms reuse the same names', async () => {
  const f = await fixture({ duplicateFormNames: true });
  const observation = await collectObservation(f.options);
  expect(observation.catalogCourses).toHaveLength(22);
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.assignments).toHaveLength(22 * 6);
  const courses = f.calls.filter(call => call.url.includes('linkKougi'));
  const details = f.calls.filter(call => call.url.includes('linkKyozaiTitle'));
  expect(courses).toHaveLength(22);
  expect(details).toHaveLength(22 * 6);
  expect(courses.every(call => new URLSearchParams(String(call.init.body)).get('nendo') === '2098')).toBe(true);
  expect(details.every(call => new URLSearchParams(String(call.init.body)).get('jyugyoHiddenId') === 'synthetic-folder')).toBe(true);
  expect(JSON.stringify(observation)).not.toContain('wrong-form');
});

it('keeps seen IDs and an incomplete list after a detail HTTP failure', async () => {
  const f = await fixture();
  const observation = await collectObservation({ ...f.options, request: async (operation) => {
    if (operation.kind === 'detail') throw new Error('http-error');
    return f.request(operation);
  } });
  expect(observation.assignments).toEqual([]);
  expect(observation.courseResults.every(c => !c.listComplete && c.seenSourceIds.length === 9)).toBe(true);
  expect(observation.failures).toHaveLength(22);
  expect(parseObservation(observation)).toEqual(observation);
});

it('sends the literal missing-period display as unreadable, without declaring no deadline', async () => {
  const f = await fixture();
  const html = (await sample('assignment-detail-open')).replace(/<span class="red3">[\s\S]*?<\/span>/, '-');
  const observation = await collectObservation({ ...f.options, request: async operation => operation.kind === 'detail'
    ? { html, url: 'https://lms.ynu.ac.jp/lms/corsColl/doLinkKyozaiTitle' } : f.request(operation) });
  expect(observation.assignments).toHaveLength(22 * 6);
  expect(observation.assignments.every(a => a.deadline.kind === 'unreadable' && a.deadline.dueText === '-')).toBe(true);
  expect(parseObservation(observation)).toEqual(observation);
});

it('does not treat a missing materials table as an empty successful list', async () => {
  const f = await fixture();
  const observation = await collectObservation({ ...f.options, request: async (operation) => operation.kind === 'course'
    ? { html: '<div class="logoutButton"></div>', url: 'https://lms.ynu.ac.jp/lms/corsColl/doIndex' } : f.request(operation) });
  expect(observation.courseResults.every(c => !c.listComplete && !c.seenSourceIds.length)).toBe(true);
  expect(observation.failures).toHaveLength(22);
});

it('records a completed zero-report course without attempting any detail requests', async () => {
  const f = await fixture();
  const html = '<!doctype html><html><body><div class="logoutButton"></div>'
    + '<form id="main_form" name="corsCollActionForm"></form><div id="cs_centerinVox">'
    + '<p class="box07"><input class="cancelButton"><input class="continueButton"></p></div></body></html>';
  const request = vi.fn(async operation => operation.kind === 'course'
    ? { html, url: 'https://lms.ynu.ac.jp/lms/corsColl/doIndex' } : f.request(operation));
  const observation = await collectObservation({ ...f.options, request });
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.courseResults.every(c => c.listComplete && c.seenSourceIds.length === 0)).toBe(true);
  expect(observation.assignments).toEqual([]);
  expect(observation.failures).toEqual([]);
  expect(request.mock.calls.some(([operation]) => operation.kind === 'detail')).toBe(false);
  expect(parseObservation(observation)).toEqual(observation);
});

it('sends a fixed not-logged-in failure with no invented catalog', async () => {
  const observation = await collectObservation({ request: async () => ({ html: await sample('session-expired'), url: pageUrl }),
    observationId: '00000000-0000-4000-8000-000000000001', fetchedAt: '2098-11-01T00:00:00Z' });
  expect(observation.catalogCourses).toEqual([]);
  expect(observation.failures).toEqual([{ courseId: null, kind: 'not-logged-in', detail: 'not-logged-in' }]);
  expect(parseObservation(observation)).toEqual(observation);
});

it('rejects arbitrary endpoints and unapproved form fields before fetch', async () => {
  const fetcher = vi.fn();
  for (const operation of [{ kind: 'unknown', path: 'https://example.test' }, { kind: 'course', fields: { password: 'synthetic-private' } }]) {
    await expect(executeLmsRequest(operation, pageUrl, 'synthetic-session', fetcher)).rejects.toThrow('invalid-request');
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('recognizes the saved expired-login page even when its HTTP status is 403', async () => {
  const html = await sample('session-expired');
  const fetcher = vi.fn(async () => ({ ok: false, status: 403, url: pageUrl, text: async () => html }));
  await expect(executeLmsRequest({ kind: 'home' }, pageUrl, 'synthetic-session', fetcher, async () => {})).rejects.toThrow('not-logged-in');
});

it('retains not-logged-in failures from detail reads without marking lists complete', async () => {
  const f = await fixture();
  const observation = await collectObservation({ ...f.options, request: async operation => {
    if (operation.kind === 'detail') throw new Error('not-logged-in');
    return f.request(operation);
  } });
  expect(observation.courseResults.every(c => !c.listComplete && c.seenSourceIds.length === 9)).toBe(true);
  expect(observation.failures.every(failure => failure.kind === 'not-logged-in')).toBe(true);
});
