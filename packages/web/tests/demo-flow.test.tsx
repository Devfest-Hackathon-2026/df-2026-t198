import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DemoFlowPreview } from '../src/features/demo/triptych';
import { usePathname } from '../src/shared/use-pathname';

const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('autoplays source-only extension before either observed view changes, without requests', async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const host = document.getElementById('root')!; const root = createRoot(host);
  await act(async () => root.render(<DemoFlowPreview />));
  const pane = (name: string) => host.querySelector(`[data-demo-pane="${name}"]`)!;
  try {
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(pane('student').textContent).toContain('11/12');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(pane('lms').textContent).toContain('11/13');
    for (const role of ['student', 'supporter']) {
      expect(pane(role).textContent).toContain('11/12');
      expect(pane(role).textContent).not.toContain('11/13');
      expect(pane(role).textContent).toContain('まだLMSを開いていない');
    }
    await act(async () => { vi.advanceTimersByTime(3000); });
    for (const role of ['lms', 'student', 'supporter']) expect(pane(role).textContent).toContain('11/13');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(pane('lms').querySelector('s')).toBeNull();
    expect(pane('lms').textContent).not.toContain('11/13');
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it('keeps autoplay stopped under reduced motion and offers manual steps', async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.getElementById('root')!; const root = createRoot(host);
  await act(async () => root.render(<DemoFlowPreview />));
  try {
    const before = host.textContent;
    await act(async () => { vi.advanceTimersByTime(12000); });
    expect(host.textContent).toBe(before);
    const next = host.querySelector<HTMLButtonElement>('button[data-demo-next]')!;
    await act(async () => next.click());
    expect(host.querySelector('[data-demo-pane="student"]')!.textContent).toContain('11/12');
  } finally { await act(async () => root.unmount()); }
});

it('leaves LMS hash history to the page and transitions only when the path changes', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.location = { pathname: '/demo-lms' };
  window.matchMedia = () => ({ matches: false });
  const transition = vi.fn((update: () => void) => { update(); return { finished: Promise.resolve() }; });
  document.startViewTransition = transition;
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  function Path() { return <p>{usePathname()}</p>; }
  const host = document.getElementById('root')!; const root = createRoot(host);
  await act(async () => root.render(<Path />));
  try {
    await act(async () => window.dispatchEvent(new window.Event('popstate')));
    expect(transition).not.toHaveBeenCalled();
    window.location.pathname = '/student';
    await act(async () => window.dispatchEvent(new window.Event('popstate')));
    expect(transition).toHaveBeenCalledOnce();
    expect(host.textContent).toBe('/student');
  } finally { await act(async () => root.unmount()); }
});
