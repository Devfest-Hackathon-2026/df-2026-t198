import definition from '../../../lms-definitions/kulms/definition.json' with { type: 'json' };
import { KULMS_ORIGIN, readSakaiAssignment, readSakaiCourse, sakaiCollection, sakaiId, sakaiRecord } from '../../core/src/sakai-reader.js';
import type { FetchFailure, Observation } from '../../core/src/types.js';

interface Options { fetcher: typeof fetch; observationId: string; fetchedAt: string; signal: AbortSignal; prioritySiteIds?: string[] }
const failure = (error: unknown, courseId: string | null): FetchFailure => {
  const message = error instanceof Error ? error.message : '';
  const kind = message === 'not-logged-in' ? 'not-logged-in' : message === 'http-error' ? 'http' : 'parse';
  return { courseId, kind, detail: kind === 'parse' ? 'parse-error' : message };
};
/** Runs only inside the KULMS content script; no cookies or raw API data leave it. */
export async function collectKulmsObservation(options: Options): Promise<Observation> {
  const { signal } = options;
  const observation: Observation = { schemaVersion: 1, observationId: options.observationId, system: 'kulms',
    definitionId: definition.definitionId, definitionVersion: definition.version, fetchedAt: options.fetchedAt,
    catalogCourses: [], courseResults: [], assignments: [], failures: [] };
  const active = () => { if (signal.aborted) throw new Error('yielded'); };
  const read = async (path: string): Promise<unknown> => {
    active();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15_000);
    try {
      let response: Response;
      try {
        response = await options.fetcher(`${KULMS_ORIGIN}/direct/${path}`, { method: 'GET', credentials: 'same-origin',
          redirect: 'manual', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
      } catch { active(); throw new Error('http-error'); }
      active();
      if (response.status === 401 || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new Error('not-logged-in');
      if (!response.ok) throw new Error('http-error');
      if (response.headers.get('content-type')?.includes('text/html')) throw new Error('not-logged-in');
      let body: string;
      try { body = await response.text(); } catch { active(); throw new Error('http-error'); }
      active();
      if (body.length > 5_000_000) throw new Error('parse-error');
      try { return JSON.parse(body) as unknown; } catch { throw new Error('parse-error'); }
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  };
  const retry = async (path: string) => {
    try { return await read(path); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'http-error') throw error;
      return read(path);
    }
  };
  try {
    const user = await read('user/current.json');
    if (!user || typeof user !== 'object' || !sakaiRecord(user)['id']) throw new Error('not-logged-in');
    const userId = sakaiId(sakaiRecord(user)['id']);
    const ids = new Set<string>();
    const catalog: Observation['catalogCourses'] = [];
    for (let page = 0, start = 0; ; page++) {
      if (page >= 100) throw new Error('parse-error');
      const sites = sakaiCollection(await retry(`site.json?_limit=200&_start=${start}`), definition.site.collection);
      if (!sites.length) break;
      for (const site of sites) {
        const course = readSakaiCourse(definition, site);
        if (ids.has(course.courseId)) throw new Error('parse-error');
        ids.add(course.courseId);
        const row = sakaiRecord(site);
        // Only upstream Sakai's known values exclude; missing/new values stay eligible.
        if (row[definition.siteFilter.published] === false || definition.siteFilter.excludedTypes.includes(String(row[definition.siteFilter.type]))) continue;
        catalog.push(course);
      }
      start += sites.length;
    }
    const sources = new Set<string>();
    const priority = new Set(options.prioritySiteIds ?? []);
    const selectTerm = catalog.length > 100 || priority.size > 0;
    catalog.sort((a, b) => Number(priority.has(b.courseId)) - Number(priority.has(a.courseId)));
    for (const course of catalog) {
      const assignments: Observation['assignments'] = [];
      let courseFailure: FetchFailure | undefined;
      const result = { courseId: course.courseId, listComplete: false, seenSourceIds: [] as string[], endedSourceIds: [] as string[] };
      try {
        // Sakai's custom site action returns the whole list, ignoring _start/_limit.
        const items = sakaiCollection(await retry(`assignment/site/${encodeURIComponent(course.courseId)}.json`), definition.assignment.collection);
        if (items.length > 1000) throw new Error('parse-error');
        for (const item of items) {
          const assignment = readSakaiAssignment(definition, item, course.courseId, userId);
          if (sources.has(assignment.sourceId)) throw new Error('parse-error');
          sources.add(assignment.sourceId); result.seenSourceIds.push(assignment.sourceId);
          if (assignment.deadline.kind === 'datetime' && Date.parse(assignment.deadline.dueAt) < Date.parse(options.fetchedAt)) {
            result.endedSourceIds.push(assignment.sourceId);
          } else {
            assignments.push(assignment);
          }
        }
        result.listComplete = true;
      } catch (error) {
        active(); courseFailure = failure(error, course.courseId);
      }
      const hasFutureDeadline = assignments.some(a => a.deadline.kind === 'datetime' && Date.parse(a.deadline.dueAt) >= Date.parse(options.fetchedAt));
      if (selectTerm && !priority.has(course.courseId) && !hasFutureDeadline && !courseFailure) continue;
      if (observation.catalogCourses.length >= 100) {
        // No courseResult for omitted sites: their stored tasks must not accrue missing counts.
        observation.failures.push({ courseId: course.courseId, kind: 'parse', detail: 'course-limit' });
      } else {
        if (priority.has(course.courseId)) course.currentTerm = true;
        observation.catalogCourses.push(course); observation.courseResults.push(result);
        const remaining = 200 - observation.assignments.length;
        if (assignments.length > remaining) {
          result.listComplete = false; courseFailure = { courseId: course.courseId, kind: 'parse', detail: 'list-incomplete' };
        }
        observation.assignments.push(...assignments.slice(0, remaining));
        if (courseFailure) observation.failures.push(courseFailure);
      }
      if (courseFailure?.kind === 'not-logged-in') break;
    }
    // A login change in another tab must not mix two students in one observation.
    const finalUser = await read('user/current.json');
    if (!finalUser || !sakaiRecord(finalUser)['id']) throw new Error('not-logged-in');
    if (sakaiId(sakaiRecord(finalUser)['id']) !== userId) throw new Error('account-changed');
  } catch (error) {
    active();
    if (error instanceof Error && error.message === 'account-changed') throw error;
    observation.failures.push(failure(error, null));
  }
  if (observation.failures.length > 200) {
    const last = observation.failures.at(-1)!;
    observation.failures = [...observation.failures.slice(0, 199), last.courseId === null ? last : { courseId: null, kind: 'parse', detail: 'course-limit' }];
  }
  active();
  return observation;
}
