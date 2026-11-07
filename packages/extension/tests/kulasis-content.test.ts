import { afterEach, expect, it, vi } from 'vitest';
import { startKyotoContent } from '../src/kulms-content.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('uses KULASIS messages and yields to navigation without holding the student action', async () => {
  vi.useFakeTimers();
  let listener!: (message: unknown, sender: { id: string }, respond: (value: unknown) => void) => boolean;
  const ready = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', { runtime: { id: 'fictional-extension', sendMessage: ready, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const view = Object.assign(new EventTarget(), { location: { origin: 'https://www.k.kyoto-u.ac.jp' } });
  let signal!: AbortSignal;
  const collect = vi.fn().mockImplementation(options => { signal = options.signal; return new Promise(() => {}); });
  startKyotoContent(doc as unknown as Document, view as unknown as Window, 'kulasis', view.location.origin, collect);
  await vi.advanceTimersByTimeAsync(2000);
  expect(ready).toHaveBeenCalledWith({ type: 'kulasis-page-ready' });
  const request = { type: 'kulasis-collect', observationId: 'fictional', fetchedAt: '2030-11-08T00:00:00Z' };
  expect(listener({ ...request, type: 'kulms-collect' }, { id: 'fictional-extension' }, vi.fn())).toBe(false);
  expect(listener(request, { id: 'foreign' }, vi.fn())).toBe(false);
  expect(listener(request, { id: 'fictional-extension' }, vi.fn())).toBe(true);
  const event = new Event('pointerdown', { cancelable: true }); doc.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false); expect(signal.aborted).toBe(true);
  view.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(2000);
  expect(ready).toHaveBeenCalledTimes(1);
});
