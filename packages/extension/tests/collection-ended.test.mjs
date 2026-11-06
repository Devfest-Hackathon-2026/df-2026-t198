import { expect, it } from 'vitest';
import { collectObservation } from '../src/collection.js';
import { parseObservation } from '../../server/src/observation-input.js';

const courseId = 'KOG0000000000001';
const sourceId = 'REP0000000000001';
const key = `${courseId}_${sourceId}`;
const home = term => `<div class="weeklyCourseArea"><div class="dayBox"><div class="cpLabel">月曜日</div>
  <div class="courseCard"><div class="courseCardInfo">第1限${term === null ? '' : `<span class="term">${term}</span>`}</div>
  <div class="courseCardName"><a onclick="formSubmit('${courseId}')">架空の授業</a></div>
  <div class="courseCardUser">架空の教員</div></div></div></div><form id="homeHomlForm"></form>`;
const list = (closed, linked) => `<div class="kyozai_table"><table><tr><td></td>
  <td class="kyozaititleCell" id="${sourceId}">レポート ${linked ? `<a onclick="kyozaiTitleLink('${sourceId}','02')">架空の課題</a>` : '架空の課題'}</td>
  <td>${closed ? '公開終了' : '公開中'}</td><td><span class="materialLabe">未提出</span></td></tr></table></div><form id="main_form"></form>`;
const detail = due => `<ul class="breadCrumb"><li class="current"><span class="textoverflow">架空の課題</span></li></ul>
  <div id="cs_centerinVox"><table class="cs_table3a"><tr><th>提出期間</th><td>${due}</td></tr>
  <tr><th>状況</th><td><span class="green1">未提出</span></td></tr></table></div>`;
async function collect({ term = '秋学期', closed = false, linked = true,
  due = '<span class="red3">2098/11/13 (木) 11:53 まで</span>', at = '2098-11-07T00:00:00Z' } = {}) {
  const calls = [];
  const result = await collectObservation({ observationId: '00000000-0000-4000-8000-000000000105', fetchedAt: at,
    request: async operation => {
      calls.push(operation.kind);
      return { html: operation.kind === 'home' ? home(term) : operation.kind === 'course' ? list(closed, linked) : detail(due),
        url: 'https://lms.ynu.ac.jp/lms/example' };
    } });
  return { result, calls };
}

it('completes a course containing only closed tasks without requesting detail or creating new ledger input', async () => {
  const { result, calls } = await collect({ closed: true, linked: false });
  expect(calls).toEqual(['home', 'course']);
  expect(result.courseResults).toEqual([{ courseId, listComplete: true, seenSourceIds: [key], endedSourceIds: [key] }]);
  expect(result.assignments).toEqual([]);
  expect(result.failures).toEqual([]);
  expect(parseObservation(result)).toEqual(result);
});
it('continues to fail when an open task has no detail link', async () => {
  const { result } = await collect({ linked: false });
  expect(result.courseResults[0]).toMatchObject({ listComplete: false, seenSourceIds: [key] });
  expect(result.failures).toEqual([{ courseId, kind: 'parse', detail: 'detail-unavailable' }]);
});
it.each([
  ['<span class="red3">2098/11/06 (木) 11:53 まで</span>', true],
  ['<span class="red3">2098/11/07 (木) 09:00 まで</span>', false],
  ['<span class="red3">2098/11/08 (木) 11:53 まで</span>', false],
  ['-', true], ['<span class="red3"> - </span>', true],
  ['', false], ['日付を確認中', false],
])('distinguishes ended deadlines and a literal dash from unreadable dates: %s', async (due, ended) => {
  const { result } = await collect({ due });
  expect(result.courseResults[0].endedSourceIds).toEqual(ended ? [key] : []);
  expect(result.assignments).toHaveLength(ended ? 0 : 1);
  expect(result.failures).toEqual([]);
  expect(parseObservation(result)).toEqual(result);
});
it.each([
  ['春学期', '2098-11-07T00:00:00Z', false], ['秋学期', '2098-11-07T00:00:00Z', true],
  ['春学期', '2098-03-31T14:59:59Z', false], ['春学期', '2098-03-31T15:00:00Z', true],
  ['秋学期', '2098-09-30T14:59:59Z', false], ['秋学期', '2098-09-30T15:00:00Z', true],
  ['通年', '2098-11-07T00:00:00Z', true], ['秋学期前半', '2098-06-07T00:00:00Z', true],
  [null, '2098-11-07T00:00:00Z', true],
])('requests only current courses, preserving unknown terms: %s at %s', async (term, at, currentTerm) => {
  const { result, calls } = await collect({ term, at, closed: true });
  expect(result.catalogCourses[0].currentTerm).toBe(currentTerm);
  expect(calls).toEqual(currentTerm ? ['home', 'course'] : ['home']);
  expect(result.courseResults).toHaveLength(currentTerm ? 1 : 0);
  expect(result.failures).toEqual([]);
  expect(parseObservation(result)).toEqual(result);
});
