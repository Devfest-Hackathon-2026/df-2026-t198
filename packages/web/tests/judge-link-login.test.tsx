import { createRequire } from 'node:module';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DemoPage } from '../src/features/demo/page';

const { client, signIn } = vi.hoisted(() => ({
  client: { auth: { currentUser: null, authStateReady: vi.fn(async () => {}) }, logout: vi.fn(async () => {}), db: {} },
  signIn: vi.fn(async () => {}),
}));
vi.mock('../src/shared/firebase', () => ({ firebase: client }));
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: signIn,
  onAuthStateChanged: (_auth: unknown, callback: (user: null) => void) => { callback(null); return () => {}; } }));
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); signIn.mockReset(); });
it.each(['#judge=', '#judge=' + btoa(JSON.stringify({ email: 'judge@example.invalid', password: 'synthetic-secret' }))])(
  'shows the manual login and a fixed failure without credentials (case %#)', async hash => {
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
    window.location = { hash, pathname: '/demo-lms', search: '' };
    window.history = { replaceState: () => { window.location.hash = ''; } };
    vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    signIn.mockRejectedValue(new Error(hash));
    const logs = ['error', 'warn', 'log'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
    const host = document.getElementById('root')!; const root = createRoot(host);
    try {
      await act(async () => root.render(<StrictMode><DemoPage /></StrictMode>));
      expect(host.textContent).toContain('リンクでログインできませんでした。説明資料のアカウントで入ってください。');
      expect(host.querySelector('input[name="email"]')).not.toBeNull();
      expect(host.querySelector('input[name="password"]')).not.toBeNull();
      expect(host.innerHTML).not.toContain(hash.slice(1));
      expect(host.innerHTML).not.toContain('synthetic-secret');
      expect(window.location.hash).toBe('');
      expect(signIn).toHaveBeenCalledTimes(hash === '#judge=' ? 0 : 1);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
