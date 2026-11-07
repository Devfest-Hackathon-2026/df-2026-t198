import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const collect = vi.hoisted(() => vi.fn());
vi.mock('../src/kulms-collection.js', () => ({ collectKulmsObservation: collect }));
vi.mock('../src/change-notice.js', () => ({ showChangeNotice: () => {} }));
let listener: (message: unknown, sender: chrome.runtime.MessageSender, respond: (x: unknown) => void) => boolean;
let doc: EventTarget & { visibilityState: string };
let view: EventTarget & { location: { origin: string } };
const ready = vi.fn();
const request = { type: 'kulms-collect', observationId: 'fictional', fetchedAt: '2030-11-08T00:00:00Z' };
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); collect.mockReset().mockResolvedValue({ system: 'kulms' });
  ready.mockReset().mockResolvedValue({ ok: true });
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  view = Object.assign(new EventTarget(), { location: { origin: 'https://lms.gakusei.kyoto-u.ac.jp' } });
  vi.stubGlobal('chrome', { runtime: { id: 'fictional-extension', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, sendMessage: ready } });
  const { startKulmsContent } = await import('../src/kulms-content.js');
  startKulmsContent(doc as unknown as Document, view as unknown as Window);
  await vi.advanceTimersByTimeAsync(2000);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('waits for idle, requests worker authorization and accepts only extension commands', async () => {
  expect(ready).toHaveBeenCalledWith({ type: 'kulms-page-ready' });
  const respond = vi.fn();
  expect(listener(request, { id: 'other' }, respond)).toBe(false); expect(collect).not.toHaveBeenCalled();
  expect(listener(request, { id: 'fictional-extension' }, respond)).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(respond).toHaveBeenLastCalledWith({ ok: true, observation: { system: 'kulms' } });
});
it.each(['pointerdown', 'keydown', 'input', 'scroll'])('lets %s proceed and aborts the read before it can deliver', async eventName => {
  let finish!: (value: unknown) => void;
  collect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const respond = vi.fn(); listener(request, { id: 'fictional-extension' }, respond);
  const event = new Event(eventName, { cancelable: true }); doc.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(collect.mock.calls[0]?.[0].signal.aborted).toBe(true);
  finish({ system: 'kulms' }); await vi.advanceTimersByTimeAsync(0);
  expect(respond).toHaveBeenLastCalledWith({ ok: false, code: 'yielded' });
  const next = vi.fn(); listener(request, { id: 'fictional-extension' }, next);
  expect(next).toHaveBeenCalledWith({ ok: false, code: 'yielded' });
  await vi.advanceTimersByTimeAsync(2000); expect(ready).toHaveBeenCalledTimes(2);
});
it('stops on pagehide and resumes on pageshow without YNU messages', async () => {
  view.dispatchEvent(new Event('pagehide'));
  const respond = vi.fn(); listener(request, { id: 'fictional-extension' }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: false, code: 'yielded' });
  view.dispatchEvent(new Event('pageshow')); await vi.advanceTimersByTimeAsync(2000);
  expect(ready).toHaveBeenCalledTimes(2);
  expect(listener({ type: 'ynu-read-page' }, { id: 'fictional-extension' }, vi.fn())).toBe(false);
});
