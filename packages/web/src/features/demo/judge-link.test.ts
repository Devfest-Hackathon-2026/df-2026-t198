import { afterEach, expect, it, vi } from 'vitest';
import { consumeJudgeLink, loginWithJudgeLink } from './judge-link';

const credentials = { email: 'judge-student@example.invalid', password: 'synthetic-パスワード' };
const fragment = (value: unknown = credentials) => '#judge=' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function browser(hash: string) {
  const location = { hash, pathname: '/demo-lms', search: '?test=1' };
  return { location, history: { replaceState: vi.fn(() => { location.hash = ''; }) } };
}
afterEach(() => vi.restoreAllMocks());

it('reads UTF-8 base64url credentials and replaces history before returning them', () => {
  const page = browser(fragment());
  expect(consumeJudgeLink(page)).toEqual({ kind: 'credentials', ...credentials });
  expect(page.location.hash).toBe('');
  expect(page.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/demo-lms?test=1');
});
it.each(['', '#courses', '#detail-DEMO101_TASK1'])('preserves ordinary navigation: %s', hash => {
  const page = browser(hash);
  expect(consumeJudgeLink(page)).toEqual({ kind: 'absent' });
  expect(page.history.replaceState).not.toHaveBeenCalled();
});
it.each(['#judge', '#judge=', '#judge=' + 'x'.repeat(8193), '#judge=bad!', '#judge=YQ', '#judge=_w', fragment(null), fragment({ email: 1 }),
  fragment({ ...credentials, password: '' }), fragment({ ...credentials, email: 'invalid' }),
  fragment({ ...credentials, extra: 'unexpected' })])('rejects and removes malformed credentials (case %#)', hash => {
  const page = browser(hash);
  expect(consumeJudgeLink(page)).toEqual({ kind: 'invalid' });
  expect(page.location.hash).toBe('');
});
it('waits for restored auth and logs out before signing into the link account', async () => {
  const page = browser(fragment()); const order: string[] = [];
  const client = { auth: { currentUser: null as object | null, authStateReady: async () => {
    expect(page.location.hash).toBe(''); client.auth.currentUser = {}; order.push('ready');
  } }, logout: vi.fn(async () => { order.push('logout'); }) };
  const signIn = vi.fn(async (_auth: unknown, email: string, password: string) => {
    expect([email, password]).toEqual([credentials.email, credentials.password]); order.push('login');
  });
  expect(await loginWithJudgeLink(page, client, signIn)).toBe('success');
  expect(order).toEqual(['ready', 'logout', 'login']);
});
it('does not authenticate an absent or invalid link', async () => {
  const signIn = vi.fn();
  expect(await loginWithJudgeLink(browser(''), null, signIn)).toBe('absent');
  expect(await loginWithJudgeLink(browser('#judge='), null, signIn)).toBe('failed');
  expect(signIn).not.toHaveBeenCalled();
});
it.each(['history', 'ready', 'logout', 'login'])('contains sensitive exceptions at %s without logging', async point => {
  const page = browser(fragment()); const sensitive = new Error(JSON.stringify(credentials) + fragment());
  if (point === 'history') page.history.replaceState.mockImplementation(() => { throw sensitive; });
  const client = { auth: { currentUser: {}, authStateReady: async () => { if (point === 'ready') throw sensitive; } },
    logout: async () => { if (point === 'logout') throw sensitive; } };
  const signIn = vi.fn(async () => { throw sensitive; });
  const logs = ['log', 'warn', 'error', 'info', 'debug'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
  expect(await loginWithJudgeLink(page, client, signIn)).toBe('failed');
  for (const log of logs) expect(log).not.toHaveBeenCalled();
  if (point !== 'login') expect(signIn).not.toHaveBeenCalled();
});
