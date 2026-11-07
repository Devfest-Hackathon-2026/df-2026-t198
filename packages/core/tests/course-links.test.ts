import { expect, it } from 'vitest';
import { linkedCourses } from '../src/course-links.js';
import type { Course, LmsSystem } from '../src/types.js';

const courses: (Course & { system: LmsSystem })[] = [
  { system: 'kulasis', courseId: 'fictional-no', name: '架空の教務名', slots: [{ weekday: 2, period: 3 }],
    url: 'https://www.k.kyoto-u.ac.jp/student/la/support/top?no=fictional-no', currentTerm: true, kulmsSiteId: 'fictional-site' },
  { system: 'kulms', courseId: 'fictional-site', name: '架空の授業', slots: [],
    url: 'https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site', currentTerm: false },
  { system: 'kulms', courseId: 'fictional-unlinked', name: '架空の教務名', slots: [] },
];
it('joins only explicit links, preserving the LMS identity and URL and the timetable slots', () => {
  const before = JSON.parse(JSON.stringify(courses));
  expect(linkedCourses(courses)).toEqual([
    { ...courses[1], slots: [{ weekday: 2, period: 3 }], currentTerm: true }, courses[2],
  ]);
  expect(courses).toEqual(before);
});
it('keeps unresolved or past links separate and does not join by name', () => {
  expect(linkedCourses([courses[0]!, courses[2]!])).toEqual([courses[0], courses[2]]);
  const past = { ...courses[0]!, currentTerm: false };
  expect(linkedCourses([past, courses[1]!])).toEqual([past, courses[1]]);
});
it('combines multiple timetable meetings without duplicate slots or erasing optional LMS attributes', () => {
  const next = { ...courses[0]!, courseId: 'fictional-no-2', slots: [{ weekday: 4 as const, period: 2 }] };
  const rows = linkedCourses([...courses, next]);
  expect(rows.find(c => c.system === 'kulms' && c.courseId === 'fictional-site')?.slots)
    .toEqual([{ weekday: 2, period: 3 }, { weekday: 4, period: 2 }]);
});
