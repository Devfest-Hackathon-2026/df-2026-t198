import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { CourseIdentity } from '../src/shared/course-color';
import { CourseColorProvider, useCourseColors } from '../src/shared/course-color-context';

function VisibleCourses({ courses }: { courses: CourseIdentity[] }) {
  const color = useCourseColors();
  return <>{courses.map(course => <i key={course.courseId} data-id={course.courseId} data-color={color(course)} />)}
    <i data-id="unassigned" data-color={color(null)} /><i data-id="missing" data-color={color({ system: 'other', courseId: 'missing' })} /></>;
}

it('keeps a full-list allocation when consumers filter courses or change display order', () => {
  const courses = ['DEMO101', 'DEMO202', 'DEMO303', 'DEMO404', 'DEMO505', 'DEMO606'].map(courseId => ({ system: 'demo-lms', courseId }));
  const render = (visible: CourseIdentity[]) => renderToStaticMarkup(<CourseColorProvider courses={courses}><VisibleCourses courses={visible} /></CourseColorProvider>);
  const full = render(courses);
  expect(new Set([...full.matchAll(/data-color="(\d)"/g)].map(match => match[1])).size).toBe(6);
  for (const course of [...courses].reverse()) {
    const single = render([course]);
    const tag = full.match(new RegExp(`<i data-id="${course.courseId}" data-color="\\d"></i>`))![0];
    expect(single).toContain(tag);
  }
  expect(render([...courses].reverse())).toContain('<i data-id="unassigned"></i><i data-id="missing"></i>');
});
