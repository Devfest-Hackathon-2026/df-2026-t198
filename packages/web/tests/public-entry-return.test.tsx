import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicDemoEntry } from '../src/shared/auth/public-demo-entry';

vi.mock('../src/shared/firebase', () => ({ firebase: { auth: {} } }));
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: vi.fn(async () => {}) }));
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('restores the shared entrance after returning from a preserved page (S07)', async () => {
  for (const role of ['STUDENT', 'SUPPORTER']) for (const field of ['EMAIL', 'PASSWORD']) {
    vi.stubEnv(`VITE_PUBLIC_DEMO_${role}_${field}`, 'synthetic-only');
  }
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.location = { assign: vi.fn() };
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.getElementById('root')!; const root = createRoot(host);
  try {
    await act(async () => root.render(<PublicDemoEntry />));
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelectorAll('button:disabled')).toHaveLength(2);
    const event = new window.Event('pageshow'); Object.defineProperty(event, 'persisted', { value: true });
    await act(async () => window.dispatchEvent(event));
    expect(host.querySelectorAll('button:disabled')).toHaveLength(0);
    expect(host.textContent).toContain('学生として試す');
  } finally { await act(async () => root.unmount()); }
});
