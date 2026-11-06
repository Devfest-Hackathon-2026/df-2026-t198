import { URL, URLSearchParams } from 'node:url';
import { readFile } from 'node:fs/promises';
import { vi } from 'vitest';
import { collectObservation } from '../../src/collection.js';
import { executeLmsRequest } from '../../src/lms-request.js';

const sample = name => readFile(new URL(`../../../../lms-definitions/coursepower/samples/${name}.html`, import.meta.url), 'utf8');
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';

// A stateful server, not a request stub accepting the new retry sequence: student
// navigation invalidates issued form fields. Only reopening the parent renews them.
export async function fakeLms({ stage = 'course', wrongPage = false, permanent = false, logout = false, logoutStatus = 403,
  unreadableCourses = 0, emptyCourses = 0, unreadableDetail = false, moveStudent = true, redirectCourse = false,
  stateError = false, errorStatus = 500, errorRedirect = true, strictState = false } = {}) {
  const home = await sample('home'), list = await sample('assignment-list');
  const detail = await sample('assignment-detail-open'), expired = await sample('session-expired');
  let epoch = 0, moved = false, homeReads = 0, listReads = 0, courseId = '', stageRequests = 0, screen = 'home';
  const attempts = new Map(), courseOrder = new Map();
  const fetcher = vi.fn(async (url, init) => {
    const fields = new URLSearchParams(init.body);
    const kind = url.includes('linkKyozaiTitle') ? 'detail' : url.includes('linkKougi') ? 'course' : 'home';
    const key = `${kind}:${kind === 'detail' ? courseId + ':' : ''}${fields.get(kind === 'course' ? 'kougiId' : 'kyozaiId')}`;
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    if (moveStudent && kind === stage && (permanent || (!moved && ++stageRequests === 3))) { epoch++; moved = true; }
    const stale = kind === 'course' ? fields.get('nendo') !== String(epoch)
      : kind === 'detail' && fields.get('jyugyoHiddenId') !== String(epoch);
    let status = 200, html;
    if ((stateError && kind === stage) || (strictState && kind === 'detail' && screen !== 'course')) {
      status = errorStatus;
      html = '<html><body>システムエラーが発生しました。</body></html>';
      if (errorRedirect) url = new URL('/lms/error/', url).href;
    }
    else if (kind === stage && logout) { status = logoutStatus; html = expired; }
    else if (stale) { status = wrongPage ? 200 : 409; html = home; }
    else if (kind === 'home') {
      homeReads++; screen = 'home';
      html = home + `<form id="homeHomlForm"><input name="nendo" value="${epoch}"></form>`;
    } else if (kind === 'course') {
      listReads++; screen = 'course'; courseId = fields.get('kougiId');
      if (!courseOrder.has(courseId)) courseOrder.set(courseId, courseOrder.size);
      html = list + `<form id="main_form"><input name="jyugyoHiddenId" value="${epoch}"></form>`;
      const ordinal = courseOrder.get(courseId);
      if (ordinal < unreadableCourses) html = '<div class="logoutButton"></div><div>unrecognized</div>';
      else if (ordinal < unreadableCourses + emptyCourses) html = '<!doctype html><html><body><div class="logoutButton"></div>'
        + '<form id="main_form" name="corsCollActionForm"></form><div id="cs_centerinVox">'
        + '<p class="box07"><input class="cancelButton"><input class="continueButton"></p></div></body></html>';
    } else html = unreadableDetail ? '<div class="logoutButton"></div><div>unrecognized</div>' : detail;
    if (redirectCourse && kind === 'course') url = new URL('/lms/homeHoml/doLinkKougi', url).href;
    return { ok: status === 200, status, url, text: async () => html };
  });
  const request = operation => executeLmsRequest(operation, pageUrl, 'synthetic-session', fetcher, async () => {});
  const recovered = vi.fn(), failed = vi.fn();
  const collect = () => collectObservation({ request, observationId: 'synthetic-observation', fetchedAt: '2098-11-01T00:00:00Z',
    onRecovered: recovered, onFailure: failed });
  const studentNavigate = () => {
    if (screen !== 'home') return false;
    screen = 'student-course';
    return true;
  };
  return { collect, fetcher, attempts, recovered, failed, studentNavigate, counts: () => ({ homeReads, listReads }) };
}
