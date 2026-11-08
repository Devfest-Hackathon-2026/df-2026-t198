import { readPage, validateDefinition, type DemoAnnouncement, type CourseSlot, type Observation, type ReadingDefinition } from '@kadai-hisho/core';
import rawDefinition from '../../../../../lms-definitions/demo-lms/definition.json';

export const demoDefinition = validateDefinition(rawDefinition);
function required(element: Element | null): Element {
  if (!element) throw new Error('incomplete-demo-page');
  return element;
}
function matches(root: Element, selector: string, attribute: string, id: string) {
  return required([...root.querySelectorAll(selector)].find(node => node.getAttribute(attribute) === id) ?? null);
}
/** Read rendered pages, never the Firestore data used to draw them. */
export function readDemoObservation(root: Element, origin: string, observationId: string, fetchedAt: string,
  definition: ReadingDefinition = demoDefinition): Observation {
  const context = { utcOffset: '+09:00' };
  const home = readPage(definition, required(root.querySelector('[data-demo-page="home"]')).outerHTML, context);
  if (home.pageType !== 'home') throw new Error('incomplete-demo-page');
  const observation: Observation = { schemaVersion: 1, observationId, fetchedAt, system: 'demo-lms',
    definitionId: definition.definitionId, definitionVersion: definition.version,
    catalogCourses: home.courses.map(course => ({ courseId: course.courseId, name: course.name,
      slots: course.slots.map(slot => ({ weekday: slot.dayOfWeek as CourseSlot['weekday'], period: slot.period })),
      url: new URL('/demo-lms', origin).href })), courseResults: [], assignments: [], failures: [] };
  for (const course of home.courses) {
    const materials = matches(root, '[data-demo-page="materials"]', 'data-course-id', course.courseId);
    const list = readPage(definition, materials.outerHTML, { ...context, courseId: course.courseId });
    if (list.pageType !== 'materials') throw new Error('incomplete-demo-page');
    const end = definition.materials.listEnd;
    const listComplete = !!end && [...materials.querySelectorAll(end.selector)].some(node =>
      end.text === undefined || node.textContent?.replace(/\s+/gu, ' ').trim() === end.text);
    observation.courseResults.push({ courseId: course.courseId, listComplete,
      seenSourceIds: list.assignments.map(task => task.sourceId) });
    if (!listComplete) observation.failures.push({ courseId: course.courseId, kind: 'parse', detail: 'list-incomplete' });
    for (const task of list.assignments) {
      try {
        const detail = matches(root, '[data-demo-page="detail"]', 'data-source-id', task.sourceId);
        const result = readPage(definition, detail.outerHTML, { ...context, courseId: course.courseId, sourceId: task.sourceId });
        const assignment = result.assignments[0];
        if (result.pageType !== 'assignment-detail' || !assignment) throw new Error('incomplete-demo-page');
        observation.assignments.push({ sourceId: task.sourceId, courseId: course.courseId, title: assignment.title,
          submission: assignment.submission, url: new URL(`/demo-lms?assignment=${encodeURIComponent(task.sourceId)}`, origin).href,
          deadline: { ...(assignment.dueAt ? { kind: 'datetime', dueAt: assignment.dueAt } as const : { kind: 'unreadable' } as const),
            dueText: assignment.dueText ?? '', timeZone: 'Asia/Tokyo' } });
      } catch {
        observation.failures.push({ courseId: course.courseId, kind: 'parse', detail: 'detail-unavailable' });
      }
    }
  }
  return observation;
}

/** Announcements travel separately from observations and are read from the visible LMS DOM. */
export function readDemoAnnouncements(root: Element): (DemoAnnouncement & { system: 'demo-lms' })[] {
  return [...root.querySelectorAll('[data-demo-announcement]')].map(node => {
    const attribute = (name: string) => {
      const value = node.getAttribute(name);
      if (!value) throw new Error('incomplete-demo-announcement');
      return value;
    };
    return { system: 'demo-lms', courseId: attribute('data-course-id'), announcement: {
      announcementId: attribute('data-announcement-id'), version: attribute('data-version'),
      publishedAt: attribute('data-published-at'),
      body: required(node.querySelector('.demo-announcement-body')).textContent ?? '',
    } };
  });
}
