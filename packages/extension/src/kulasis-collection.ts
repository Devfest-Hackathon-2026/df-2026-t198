import definition from '../../../lms-definitions/kulasis/definition.json' with { type: 'json' };
import { checkKulasisLogin, kulasisBase, kulasisTerm, readKulasisCourseCode, readKulasisTimetable } from '../../core/src/kulasis-reader.js';
import type { Observation } from '../../core/src/types.js';

interface Options {
  pageUrl: string; fetcher: typeof fetch; observationId: string; fetchedAt: string; signal: AbortSignal;
  resolveSite: (code: string) => Promise<string | undefined>;
}
export async function collectKulasisObservation(options: Options): Promise<Observation> {
  const observation: Observation = { schemaVersion: 1, system: 'kulasis', observationId: options.observationId,
    definitionId: definition.definitionId, definitionVersion: definition.version, fetchedAt: options.fetchedAt,
    catalogCourses: [], courseResults: [], assignments: [], failures: [] };
  const active = () => { if (options.signal.aborted) throw new Error('yielded'); };
  const read = async (url: string) => {
    active();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15_000);
    try {
      let response: Response;
      try {
        response = await options.fetcher(url, { method: 'GET', credentials: 'same-origin', redirect: 'manual',
          cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      } catch { active(); throw new Error('http-error'); }
      if ([401, 302, 303, 307, 308].includes(response.status) || response.type === 'opaqueredirect') throw new Error('not-logged-in');
      if (!response.ok) throw new Error('http-error');
      const bytes = await response.arrayBuffer(); active();
      if (bytes.byteLength > 5_000_000) throw new Error('parse-error');
      const html = new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
      checkKulasisLogin(html);
      return html;
    } finally { clearTimeout(timeout); options.signal.removeEventListener('abort', abort); }
  };
  try {
    const base = kulasisBase(options.pageUrl, (s, b) => new URL(s, b));
    if (!base) throw new Error(/\/student\/(?:login|logout)/.test(options.pageUrl) ? 'not-logged-in' : 'parse-error');
    const term = kulasisTerm(options.fetchedAt).endsWith('spring') ? definition.terms.spring : definition.terms.autumn;
    const courses = readKulasisTimetable(definition, await read(`${base}/entry/${term}`), base, (s, b) => new URL(s, b));
    // Do not publish a partial timetable as an empty/smaller successful catalog.
    for (const course of courses) {
      try {
        const code = readKulasisCourseCode(await read(course.url!), (s, b) => new URL(s, b));
        if (code) {
          active(); const site = await options.resolveSite(code); active();
          if (site) course.kulmsSiteId = site;
        }
      } catch (error) {
        active();
        if (error instanceof Error && error.message === 'not-logged-in') throw error;
        observation.failures.push({ courseId: course.courseId, kind: 'http', detail: 'detail-unavailable' });
      }
    }
    observation.catalogCourses = courses;
  } catch (error) {
    active(); observation.catalogCourses = []; observation.failures = [];
    const message = error instanceof Error ? error.message : '';
    const kind = message === 'not-logged-in' ? 'not-logged-in' : message === 'http-error' ? 'http' : 'parse';
    observation.failures.push({ courseId: null, kind, detail: kind === 'parse' ? 'parse-error' : message });
  }
  active(); return observation;
}
