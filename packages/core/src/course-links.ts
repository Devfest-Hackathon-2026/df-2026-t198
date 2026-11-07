import type { Course, LmsSystem } from './types.js';

type SourceCourse = Course & { system: LmsSystem };
/** Sources stay separate in storage; only confirmed current timetable links supply slots. */
export function linkedCourses(courses: SourceCourse[]): SourceCourse[] {
  const sites = new Set(courses.filter(c => c.system === 'kulms').map(c => c.courseId));
  const linked = courses.filter(c => c.system === 'kulasis' && c.currentTerm === true && c.kulmsSiteId && sites.has(c.kulmsSiteId));
  return courses.filter(c => !linked.includes(c)).map(course => {
    const meetings = course.system === 'kulms' ? linked.filter(c => c.kulmsSiteId === course.courseId) : [];
    if (!meetings.length) return course;
    const slots = [...new Map(meetings.flatMap(c => c.slots).map(slot => [JSON.stringify(slot), slot])).values()];
    return { ...course, slots, currentTerm: true };
  });
}
