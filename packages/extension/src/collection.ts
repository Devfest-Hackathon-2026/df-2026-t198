import definition from '../../../lms-definitions/coursepower/definition.json' with { type: 'json' };
import { readCourseTerms, readPage } from '../../core/src/html-reader.js';
import { readFormFields, readHtmlAttribute } from '../../core/src/html-navigation.js';
import type { Observation, FetchFailure, CourseSlot } from '../../core/src/types.js';
import { LmsReadError, isStateError, loggedOut, pageDiagnostic, stopsCollection } from './collection-diagnostics.js';
import { navigation, type LmsOperation, type LmsPage } from './lms-request.js';

export interface CollectionOptions {
  request: (operation: LmsOperation) => Promise<LmsPage>;
  observationId: string;
  fetchedAt: string;
  onFailure?: (stage: LmsOperation['kind'], error: unknown) => void;
  onRecovered?: () => void;
  onCourseResult?: (complete: boolean, failureKind?: FetchFailure['kind']) => void;
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
  const read = async (operation: LmsOperation, readingContext = context as Parameters<typeof readPage>[2]) => {
    try {
      const page = await options.request(operation);
      if (isStateError(page)) throw new LmsReadError('lms-state', pageDiagnostic(page));
      try {
        const reading = readPage(definition, page.html, readingContext);
        const expected = operation.kind === 'home' ? 'home' : operation.kind === 'course' ? 'materials' : 'assignment-detail';
        if (reading.pageType !== expected) throw new Error('parse-error');
        return { page, reading };
      } catch (error) { throw new LmsReadError(loggedOut(error) ? 'not-logged-in' : 'parse-error', pageDiagnostic(page)); }
    } catch (error) { options.onFailure?.(operation.kind, error); throw error; }
  };
  try {
    const { page: home, reading: catalog } = await read({ kind: 'home' });
    if (catalog.pageType !== 'home') throw new Error('parse-error');
    const terms = readCourseTerms(definition, home.html);
    observation.catalogCourses = catalog.courses.map(c => ({ courseId: c.courseId, name: c.name,
      currentTerm: currentTerm(terms.get(c.courseId), options.fetchedAt),
      slots: c.slots.map(s => ({ weekday: s.dayOfWeek as CourseSlot['weekday'], period: s.period })) }));
    let homeFields = readFormFields(home.html, navigation.course.form, navigation.course.fields);
    for (const course of observation.catalogCourses) {
      if (course.currentTerm === false) continue;
      const courseId = course.courseId;
      const result = { courseId, listComplete: false, seenSourceIds: [] as string[], endedSourceIds: [] as string[] };
      observation.courseResults.push(result);
      let courseRetried = false;
      let courseFailure: FetchFailure | undefined;
      const openCourse = async () => {
        const open = () => read({ kind: 'course', fields: { ...homeFields, kougiId: courseId } }, { ...context, courseId });
        try { return await open(); }
        catch (error) {
          if (stopsCollection(error) || loggedOut(error) || courseRetried) throw error;
          courseRetried = true;
          const { page } = await read({ kind: 'home' });
          homeFields = readFormFields(page.html, navigation.course.form, navigation.course.fields);
          const reopened = await open();
          options.onRecovered?.();
          return reopened;
        }
      };
      try {
        const initial = await openCourse();
        let list = initial.page;
        const materials = initial.reading;
        result.seenSourceIds = materials.assignments.map(a => sourceKey(courseId, a.sourceId));
        let fields = readFormFields(list.html, navigation.detail.form, navigation.detail.fields);
        result.listComplete = true;
        let detailFailure: FetchFailure | undefined;
        for (const material of materials.assignments) {
          if (material.availabilityText === '公開終了') {
            result.endedSourceIds.push(sourceKey(courseId, material.sourceId));
            continue;
          }
          try {
            const openDetail = async () => {
              const handler = readHtmlAttribute(list.html, `td[id="${material.sourceId}"] a[onclick]`, 'onclick') ?? '';
              const args = /^kyozaiTitleLink\(\s*(['"])([A-Z]{3}\d{13})\1\s*,\s*(['"])(\d{2})\3\s*\)\s*;?$/.exec(handler);
              if (!args || args[2] !== material.sourceId) throw new Error('detail-unavailable');
              return read({ kind: 'detail', fields: { ...fields,
                kyozaiId: material.sourceId, kyozaiSyCdHidden: args[4]! } }, { ...context, courseId, sourceId: material.sourceId });
            };
            let opened;
            try { opened = await openDetail(); }
            catch (error) {
              if (stopsCollection(error) || loggedOut(error)) throw error;
              ({ page: list } = await openCourse());
              fields = readFormFields(list.html, navigation.detail.form, navigation.detail.fields);
              opened = await openDetail();
              options.onRecovered?.();
            }
            const { page: detail, reading } = opened;
            const a = reading.assignments[0]!;
            if (a.dueText === '-' || (a.dueAt && Date.parse(a.dueAt) < Date.parse(options.fetchedAt))) {
              result.endedSourceIds.push(sourceKey(courseId, a.sourceId));
              continue;
            }
            observation.assignments.push({ sourceId: sourceKey(courseId, a.sourceId), courseId, title: a.title,
              url: detail.url, deadline: { ...(a.dueAt ? { kind: 'datetime' as const, dueAt: a.dueAt } : { kind: 'unreadable' as const }),
                dueText: a.dueText ?? '', timeZone: 'Asia/Tokyo' }, submission: a.submission });
          } catch (error) {
            if (stopsCollection(error)) throw error;
            result.listComplete = false;
            if (!detailFailure || (error instanceof Error && error.message === 'not-logged-in')) {
              detailFailure = failure(error, courseId);
              if (detailFailure.kind === 'parse') detailFailure.detail = 'detail-unavailable';
            }
            if (loggedOut(error)) break;
          }
        }
        courseFailure = detailFailure;
      } catch (error) { if (stopsCollection(error)) throw error; courseFailure = failure(error, courseId); }
      finally {
        if (courseFailure) observation.failures.push(courseFailure);
        options.onCourseResult?.(result.listComplete, courseFailure?.kind);
      }
      if (observation.failures.at(-1)?.kind === 'not-logged-in') break;
    }
  } catch (error) { if (stopsCollection(error)) throw error; observation.failures.push(failure(error, null)); }
  return observation;
}
