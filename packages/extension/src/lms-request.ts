import navigation from '../../../lms-definitions/coursepower/navigation.json' with { type: 'json' };
import { LmsReadError, isStateError, loggedOut, pageDiagnostic, safeDiagnostic, stopsCollection } from './collection-diagnostics.js';
import { sessionFromUrl } from './session.js';
import { readPage } from '../../core/src/html-reader.js';
import definition from '../../../lms-definitions/coursepower/definition.json' with { type: 'json' };

export type LmsOperation = { kind: 'home' } | { kind: 'course' | 'detail'; fields: Record<string, string> };
export interface LmsPage { html: string; url: string; status?: number }
export { navigation };

export function validOperation(input: unknown): input is LmsOperation {
  if (!input || typeof input !== 'object') return false;
  const op = input as LmsOperation;
  if (op.kind === 'home') return Object.keys(op).length === 1;
  if ((op.kind !== 'course' && op.kind !== 'detail') || Object.keys(op).length !== 2
    || !op.fields || typeof op.fields !== 'object' || Array.isArray(op.fields)) return false;
  return Object.entries(op.fields).every(([key, value]) => navigation[op.kind as 'course' | 'detail'].fields.includes(key)
    && typeof value === 'string' && value.length <= 2048)
    && (op.kind === 'course' ? /^[A-Z]{3}\d{13}$/.test(op.fields['kougiId'] ?? '')
      : /^[A-Z]{3}\d{13}$/.test(op.fields['kyozaiId'] ?? '') && /^\d{2}$/.test(op.fields['kyozaiSyCdHidden'] ?? '')
        && Object.hasOwn(op.fields, 'jyugyoHiddenId') && typeof op.fields['jyugyoHiddenId'] === 'string');
}

/** No arbitrary URL, method, headers, or submission operations cross the tab boundary. */
export async function executeLmsRequest(input: unknown, pageUrl: string, sid: string,
  fetcher: typeof fetch = fetch, pause = () => new Promise<void>(resolve => setTimeout(resolve, 250)),
  signal?: AbortSignal, canStart = () => true): Promise<LmsPage> {
  if (!validOperation(input) || sessionFromUrl(pageUrl) !== sid || !/^[A-Za-z0-9._~%+-]{1,512}$/.test(sid)) {
    throw new Error('invalid-request');
  }
  const path = input.kind === 'home' ? navigation.home : navigation[input.kind].path;
  const url = new URL(`${path};SID=${sid}`, new URL(pageUrl).origin);
  if (signal?.aborted || !canStart()) throw new Error('yielded');
  await pause();
  if (signal?.aborted || !canStart()) throw new Error('yielded');
  let diagnostic = safeDiagnostic({ path });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetcher(url.href, {
      method: input.kind === 'home' ? 'GET' : 'POST',
      ...(input.kind === 'home' ? {} : { body: new URLSearchParams(input.fields) }),
      credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'follow',
      signal: controller.signal,
    });
    diagnostic = safeDiagnostic({ httpStatus: response.status, path: response.url });
    const final = new URL(response.url);
    if (final.origin !== url.origin || !final.pathname.startsWith('/lms/')) throw new Error();
    const html = await response.text();
    if (html.length > 5_000_000) throw new Error();
    if (signal?.aborted) throw new Error('yielded');
    if (isStateError({ html, url: response.url })) {
      throw new LmsReadError('lms-state', pageDiagnostic({ html, url: response.url, status: response.status }));
    }
    if (!response.ok) {
      diagnostic = pageDiagnostic({ html, url: response.url, status: response.status });
      try { readPage(definition, html, { utcOffset: '+09:00' }); }
      catch (error) { if (error instanceof Error && error.message === 'not-logged-in') throw error; }
      throw new Error('http-error');
    }
    // Do not retain any query, fragment, or matrix parameter in reference URLs.
    final.pathname = final.pathname.replace(/;[^/]*/g, ''); final.search = ''; final.hash = '';
    return { html, url: final.href, status: response.status };
  } catch (error) {
    if (stopsCollection(error)) throw error;
    if (signal?.aborted) throw new Error('yielded', { cause: error });
    throw new LmsReadError(loggedOut(error) ? 'not-logged-in' : 'http-error', diagnostic);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
