import { URL } from 'node:url';
import { expect, it } from 'vitest';
import { assignmentLmsLink as selectLink } from '../src/lms-link.js';

const assignmentLmsLink = (url, course, title, navigation) =>
  selectLink(url, course, title, navigation, (value, base) => new URL(value, base));
const detail = 'https://lms.example.invalid/tasks/fictional';
it('uses the definition to choose home and a route, including for another LMS', () => {
  expect(assignmentLmsLink(detail, '架空の授業', '架空の課題', { statefulSession: true, home: '/home' }))
    .toEqual({ url: 'https://lms.example.invalid/home', route: 'ホーム › 架空の授業 › 架空の課題' });
  expect(assignmentLmsLink(detail, '授業', '課題', { statefulSession: false, home: '/home' }))
    .toEqual({ url: detail, route: null });
  expect(assignmentLmsLink(detail, '授業', '課題')).toEqual({ url: detail, route: null });
});
it.each(['javascript:alert(1)', 'https://u:p@lms.example.invalid/task',
  'https://lms.example.invalid/task?SID=fictional', 'https://lms.example.invalid/task;SID=fictional',
  'https://lms.example.invalid/task?token=fictional', 'https://lms.example.invalid/task#private'])('rejects unsafe detail URLs before selecting a home: %s', url => {
  expect(assignmentLmsLink(url, '授業', '課題', { statefulSession: true, home: '/home' })).toBeNull();
});
it('rejects unsafe home definitions and unsafe labels', () => {
  expect(assignmentLmsLink(detail, '授業', '課題', { statefulSession: true, home: '/home?token=fictional' })).toBeNull();
  expect(assignmentLmsLink(detail, '授業', '課題', { statefulSession: true, home: 'https://other.example.invalid/' })).toBeNull();
  expect(assignmentLmsLink(detail, 'Cookie: fictional', '課題')).toBeNull();
});
