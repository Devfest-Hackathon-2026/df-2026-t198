import { afterEach, expect, it, vi } from 'vitest';
import { handleKulasisMessage, resolveKulmsSite } from '../src/kulasis-worker.js';

afterEach(() => vi.unstubAllGlobals());
it('resolves only a fixed course-code GET and returns only a validated portal site identifier', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const response = new Response('not returned');
    Object.defineProperty(response, 'url', { value: 'https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site' });
    return response;
  });
  expect(await resolveKulmsSite('fictional-code', fetcher)).toBe('fictional-site');
  expect(fetcher).toHaveBeenCalledWith('https://lms.gakusei.kyoto-u.ac.jp/direct/courselink/_kcd=fictional-code', expect.objectContaining({ method: 'GET', credentials: 'include', redirect: 'follow' }));
  expect(await resolveKulmsSite('https://example.test/', fetcher)).toBeUndefined();
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['https://example.test/portal/site/fictional-site', 'https://lms.gakusei.kyoto-u.ac.jp/portal', 'https://lms.gakusei.kyoto-u.ac.jp/direct/courselink/_kcd=fictional'])('does not invent a mapping for %s', async url => {
  const response = new Response(''); Object.defineProperty(response, 'url', { value: url });
  expect(await resolveKulmsSite('fictional-code', async () => response)).toBeUndefined();
});
it.each(['tool', 'tool-reset'])('resolves an authenticated site %s redirect', async kind => {
  const response = new Response('not returned');
  Object.defineProperty(response, 'url', { value: `https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site/${kind}/fictional-tool` });
  expect(await resolveKulmsSite('fictional-code', async () => response)).toBe('fictional-site');
});
it('rejects foreign senders, subframes and KULMS pages before making a cross-origin request', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('chrome', { runtime: { id: 'fictional-extension' } });
  const sender = { id: 'fictional-extension', frameId: 0, tab: { id: 1 }, url: 'https://www.k.kyoto-u.ac.jp/student/la/top' };
  for (const bad of [{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, url: 'https://lms.gakusei.kyoto-u.ac.jp/' }, {}]) {
    const respond = vi.fn();
    expect(handleKulasisMessage({ type: 'kulasis-resolve-site', code: 'fictional' }, bad as chrome.runtime.MessageSender, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith({ ok: false });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['https://www.k.kyoto-u.ac.jp', 'https://k.kyoto-u.ac.jp'])('accepts a trusted top frame on %s', async origin => {
  const response = new Response('');
  Object.defineProperty(response, 'url', { value: 'https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site' });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('chrome', { runtime: { id: 'fictional-extension' } });
  const sender = { id: 'fictional-extension', frameId: 0, tab: { id: 1 }, url: origin + '/student/la/top' };
  let respond!: (value: unknown) => void;
  const reply = new Promise(resolve => { respond = resolve; });
  expect(handleKulasisMessage({ type: 'kulasis-resolve-site', code: 'fictional' }, sender as chrome.runtime.MessageSender, respond)).toBe(true);
  expect(await reply).toEqual({ ok: true, siteId: 'fictional-site' });
  expect(fetcher).toHaveBeenCalledOnce();
});
