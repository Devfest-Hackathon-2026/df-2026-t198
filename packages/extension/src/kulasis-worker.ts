import { KULASIS_ORIGIN, kulmsSiteFromUrl } from '../../core/src/kulasis-reader.js';
import { KULMS_ORIGIN } from '../../core/src/sakai-reader.js';
import { handleKulmsMessage } from './kulms-worker.js';

/** The page can request a course code, never an arbitrary cross-origin URL or response body. */
export async function resolveKulmsSite(code: unknown, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(code)) return;
  try {
    const response = await fetcher(`${KULMS_ORIGIN}/direct/courselink/_kcd=${code}`, {
      method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15_000),
    });
    const site = response.ok ? kulmsSiteFromUrl(response.url, (s, b) => new URL(s, b)) : undefined;
    await response.body?.cancel();
    return site;
  } catch { return; }
}
export function handleKulasisMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): boolean | undefined {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'kulasis-resolve-site') {
    let trusted = false;
    try { trusted = new URL(sender.url ?? '').origin === KULASIS_ORIGIN; } catch { /* Reject invalid senders. */ }
    if (!trusted || sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined) {
      respond({ ok: false }); return false;
    }
    void resolveKulmsSite('code' in message ? message.code : undefined).then(siteId => respond({ ok: true, siteId }));
    return true;
  }
  return handleKulmsMessage(message, sender, respond, 'kulasis');
}
