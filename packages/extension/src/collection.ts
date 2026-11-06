import definition from '../../../lms-definitions/coursepower/definition.json' with { type: 'json' };
import { readCourseTerms, readPage } from '../../core/src/html-reader.js';
import { readFormFields, readHtmlAttribute } from '../../core/src/html-navigation.js';
import type { Observation, FetchFailure, CourseSlot } from '../../core/src/types.js';
import { navigation, type LmsOperation, type LmsPage } from './lms-request.js';

export interface CollectionOptions {
  request: (operation: LmsOperation) => Promise<LmsPage>;
  observationId: string;
  fetchedAt: string;
}
const context = { utcOffset: '+09:00' };
const sourceKey = (courseId: string, sourceId: string) => `${courseId}_${sourceId}`;
function currentTerm(terms: string[] | undefined, fetchedAt: string): boolean {
  const month = new Date(Date.parse(fetchedAt) + 9 * 60 * 60_000).getUTCMonth() + 1;
  const past = month >= 4 && month <= 9 ? '秋学期' : '春学期';
  // Missing, unfamiliar or conflicting labels must not hide a current course.
  return !terms?.length || terms.some(term => term !== past);
}
function failure(error: unknown, courseId: string | null): FetchFailure {
  const code = error instanceof Error ? error.message : '';
  return { courseId, kind: code === 'not-logged-in' ? 'not-logged-in' : code === 'http-error' ? 'http' : 'parse',
    detail: code === 'not-logged-in' ? code : code === 'http-error' ? code : 'parse-error' };
}

export async function collectObservation(options: CollectionOptions): Promise<Observation> {
  const observation: Observation = { schemaVersion: 1, observationId: options.observationId, system: 'ynu-lms',
    definitionId: definition.definitionId, definitionVersion: definition.version, fetchedAt: options.fetchedAt,
    catalogCourses: [], courseResults: [], assignments: [], failures: [] };
  try {
    const home = await options.request({ kind: 'home' });
    const catalog = readPage(definition, home.html, context);
    if (catalog.pageType !== 'home') throw new Error('parse-error');
    const terms = readCourseTerms(definition, home.html);
    observation.catalogCourses = catalog.courses.map(c => ({ courseId: c.courseId, name: c.name,
      currentTerm: currentTerm(terms.get(c.courseId), options.fetchedAt),
      slots: c.slots.map(s => ({ weekday: s.dayOfWeek as CourseSlot['weekday'], period: s.period })) }));
    const homeFields = readFormFields(home.html, navigation.course.form, navigation.course.fields);
    for (const course of observation.catalogCourses) {
      if (course.currentTerm === false) continue;
      const courseId = course.courseId;
      const result = { courseId, listComplete: false, seenSourceIds: [] as string[], endedSourceIds: [] as string[] };
      observation.courseResults.push(result);
      try {
        const list = await options.request({ kind: 'course', fields: { ...homeFields, kougiId: courseId } });
        const materials = readPage(definition, list.html, { ...context, courseId });
        if (materials.pageType !== 'materials') throw new Error('parse-error');
        result.seenSourceIds = materials.assignments.map(a => sourceKey(courseId, a.sourceId));
        const fields = readFormFields(list.html, navigation.detail.form, navigation.detail.fields);
        result.listComplete = true;
        let detailFailure: FetchFailure | undefined;
        for (const material of materials.assignments) {
          if (material.availabilityText === '公開終了') {
            result.endedSourceIds.push(sourceKey(courseId, material.sourceId));
            continue;
          }
          try {
            const handler = readHtmlAttribute(list.html, `td[id="${material.sourceId}"] a[onclick]`, 'onclick') ?? '';
            const args = /^kyozaiTitleLink\(\s*(['"])([A-Z]{3}\d{13})\1\s*,\s*(['"])(\d{2})\3\s*\)\s*;?$/.exec(handler);
            if (!args || args[2] !== material.sourceId) throw new Error('detail-unavailable');
            const detail = await options.request({ kind: 'detail', fields: { ...fields,
              kyozaiId: material.sourceId, kyozaiSyCdHidden: args[4]! } });
            const read = readPage(definition, detail.html, { ...context, courseId, sourceId: material.sourceId });
            if (read.pageType !== 'assignment-detail') throw new Error('parse-error');
            const a = read.assignments[0]!;
            if (a.dueText === '-' || (a.dueAt && Date.parse(a.dueAt) < Date.parse(options.fetchedAt))) {
              result.endedSourceIds.push(sourceKey(courseId, a.sourceId));
              continue;
            }
            observation.assignments.push({ sourceId: sourceKey(courseId, a.sourceId), courseId, title: a.title,
              url: detail.url, deadline: { ...(a.dueAt ? { kind: 'datetime' as const, dueAt: a.dueAt } : { kind: 'unreadable' as const }),
                dueText: a.dueText ?? '', timeZone: 'Asia/Tokyo' }, submission: a.submission });
          } catch (error) {
            result.listComplete = false;
            if (!detailFailure || (error instanceof Error && error.message === 'not-logged-in')) {
              detailFailure = failure(error, courseId);
              if (detailFailure.kind === 'parse') detailFailure.detail = 'detail-unavailable';
            }
          }
        }
        if (detailFailure) observation.failures.push(detailFailure);
      } catch (error) { observation.failures.push(failure(error, courseId)); }
    }
  } catch (error) { observation.failures.push(failure(error, null)); }
  return observation;
}
