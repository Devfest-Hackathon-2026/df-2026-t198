import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DemoPages } from '../src/demo-pages';
import { readDemoObservation } from '../src/demo-reader';
import { parseObservation } from '../../server/src/observation-input';

const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
const data = () => ({ courses: [
  { courseId: 'TEST_A', name: '架空の授業 <&>', teacher: '架空の先生', weekday: 2, period: 3, assignments: [
    { sourceId: 'TASK_A', title: '架空の課題 <script>bad()</script>', dueAt: '2026-11-12T08:00:00.000Z', submission: 'not-submitted' },
  ] },
  { courseId: 'TEST_B', name: '架空の空授業', teacher: '架空の先生B', weekday: 5, period: 1, assignments: [] },
] });
const root = (value = data()) => parseHTML(`<main>${renderToStaticMarkup(createElement(DemoPages, { data: value }))}</main>`).document.querySelector('main');
const read = element => readDemoObservation(element, 'https://example.invalid', '12345678-1234-4234-8234-123456789abc', '2026-11-06T01:00:00.000Z');

it('reads rendered home, lists and details with the existing definition, including an empty course', () => {
  const result = read(root());
  expect(result.definitionId).toBe('demo-lms');
  expect(result.catalogCourses).toEqual([
    { courseId: 'TEST_A', name: '架空の授業 <&>', slots: [{ weekday: 2, period: 3 }], url: 'https://example.invalid/demo-lms' },
    { courseId: 'TEST_B', name: '架空の空授業', slots: [{ weekday: 5, period: 1 }], url: 'https://example.invalid/demo-lms' },
  ]);
  expect(result.courseResults).toEqual([
    { courseId: 'TEST_A', listComplete: true, seenSourceIds: ['TASK_A'] },
    { courseId: 'TEST_B', listComplete: true, seenSourceIds: [] },
  ]);
  expect(result.assignments[0]).toMatchObject({ sourceId: 'TASK_A', title: '架空の課題 <script>bad()</script>',
    submission: 'not-submitted', deadline: { kind: 'datetime', dueAt: '2026-11-12T17:00:00+09:00', timeZone: 'Asia/Tokyo' } });
  expect(result.failures).toEqual([]);
  expect(() => parseObservation(result)).not.toThrow();
  expect(root().querySelector('script')).toBeNull();
});
it('takes changed deadlines from the DOM rather than the data object', () => {
  const element = root();
  element.querySelector('.demo-due').textContent = '2026/11/13 (金) 17:00 まで';
  expect(read(element).assignments[0].deadline.dueAt).toBe('2026-11-13T17:00:00+09:00');
});
it('does not invent complete lists or remove missing details from seen IDs', () => {
  const element = root();
  element.querySelector('.demo-list-end').remove();
  element.querySelector('[data-demo-page="detail"]').remove();
  const result = read(element);
  expect(result.courseResults[0]).toEqual({ courseId: 'TEST_A', listComplete: false, seenSourceIds: ['TASK_A'] });
  expect(result.assignments).toEqual([]);
  expect(result.failures).toEqual([
    { courseId: 'TEST_A', kind: 'parse', detail: 'list-incomplete' },
    { courseId: 'TEST_A', kind: 'parse', detail: 'detail-unavailable' },
  ]);
});
it('fails on a missing materials page and preserves an unreadable deadline as unreadable', () => {
  const element = root();
  element.querySelector('.demo-due').textContent = '確認中';
  expect(read(element).assignments[0].deadline.kind).toBe('unreadable');
  element.querySelector('[data-demo-page="materials"]').remove();
  expect(() => read(element)).toThrow('incomplete-demo-page');
});
