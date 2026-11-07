import definition from '../../../lms-definitions/coursepower/definition.json' with { type: 'json' };
import navigation from '../../../lms-definitions/coursepower/navigation.json' with { type: 'json' };
import { readPage } from '../../core/src/html-reader.js';
import { parseHtmlTree } from '../../core/src/html-tree.js';

export interface PageDiagnostic { httpStatus: number | null; pageType: string; path: string | null }
const paths = new Set([navigation.home, navigation.course.path, navigation.detail.path,
  '/lms/corsColl/doIndex', '/lms/homeHoml/doLinkKougi', '/lms/corsColl/doLinkKyozaiTitle', ...navigation.errorPage.paths]);

export function isHomePage(url: string): boolean {
  try { return navigation.homePaths.includes(new URL(url).pathname.replace(/;[^/]*/g, '')); }
  catch { return false; }
}

export function isStateError(page: { html: string; url: string }): boolean {
  const path = new URL(page.url).pathname.replace(/;[^/]*/g, '');
  if (navigation.errorPage.paths.includes(path)) return true;
  const { document } = parseHtmlTree(page.html);
  return navigation.errorPage.markers.some(marker => Array.from(document.querySelectorAll(marker.selector))
    .some(node => node.textContent?.includes(marker.text)));
}

/** Only known action paths survive: arbitrary paths can themselves contain IDs. */
export function safeDiagnostic(input?: Partial<PageDiagnostic>): PageDiagnostic {
  let path: string | null = null;
  try {
    const url = new URL(input?.path ?? '', 'https://lms.ynu.ac.jp');
    const candidate = url.pathname.replace(/;[^/]*/g, '');
    if (url.origin === 'https://lms.ynu.ac.jp' && paths.has(candidate)) path = candidate;
  } catch { /* Unknown paths are omitted. */ }
  const status = input?.httpStatus, pageType = input?.pageType ?? 'unknown';
  return { httpStatus: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    pageType: ['home', 'materials', 'assignment-detail', 'lms-state'].includes(pageType) ? pageType : 'unknown', path };
}

export function pageDiagnostic(page: { html: string; url: string; status?: number }): PageDiagnostic {
  let pageType = 'unknown';
  try { pageType = isStateError(page) ? 'lms-state' : readPage(definition, page.html, { utcOffset: '+09:00', courseId: 'probe', sourceId: 'probe' }).pageType; } catch { /* Unreadable/login page. */ }
  return safeDiagnostic({ httpStatus: page.status ?? null, pageType, path: page.url });
}

export class LmsReadError extends Error {
  constructor(code: string, readonly diagnostic: PageDiagnostic) { super(code); }
}
export const loggedOut = (error: unknown): boolean => error instanceof Error && error.message === 'not-logged-in';
export const stopsCollection = (error: unknown): boolean => error instanceof Error && ['yielded', 'lms-state'].includes(error.message);
