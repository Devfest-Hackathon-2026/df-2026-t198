import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { protectStudentNavigation } from '../src/student-navigation.js';

const home = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  for (const name of ['MouseEvent', 'KeyboardEvent']) vi.stubGlobal(name, class {
    constructor(type, init) { this.type = type; Object.assign(this, init); }
  });
  vi.stubGlobal('HTMLFormElement', class { requestSubmit(submitter) { this.submit(submitter); } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture({ href = home, yieldSession = vi.fn(async () => ({ ok: true })), statefulSession = true } = {}) {
  const handlers = {}, windowEvents = {};
  const doc = { addEventListener: (name, fn) => { handlers[name] = fn; } };
  const view = { location: { href }, addEventListener: (name, fn) => { windowEvents[name] = fn; } };
  const collect = vi.fn(async () => ({ ok: true }));
  const guard = protectStudentNavigation(doc, view, yieldSession, collect,
    { statefulSession, homePaths: ['/lms/homeHoml/doIndex'] });
  const clickTarget = { closest() { return this; }, matches: () => false, dispatchEvent: vi.fn(() => true) };
  const click = (target = clickTarget, extra = {}) => {
    const event = { type: 'click', target, button: 0, cancelable: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra };
    handlers.click(event);
    return event;
  };
  return { handlers, windowEvents, collect, guard, click, clickTarget, yieldSession };
}

it('claims only a home page after two seconds without student activity', async () => {
  const f = fixture();
  expect(f.guard.claim()).toBe(false);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.collect).not.toHaveBeenCalled();
  f.handlers.pointerdown();
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.guard.claim()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(true);
  expect(f.guard.claim()).toBe(false);
});

it('does not start or claim on a course page, regardless of idle time', async () => {
  const f = fixture({ href: home.replace('homeHoml/doIndex', 'corsColl/doIndex') });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).not.toHaveBeenCalled(); expect(f.guard.claim()).toBe(false);
});

for (const reply of ['resolve', 'reject', 'throw', 'never']) it(`replays every held click once when the worker will ${reply}`, async () => {
  let respond;
  const yieldSession = vi.fn(() => {
    if (reply === 'throw') throw new Error('extension-invalidated');
    if (reply === 'reject') return Promise.reject(new Error('no-worker'));
    return new Promise(resolve => { respond = resolve; });
  });
  const f = fixture({ yieldSession });
  await vi.advanceTimersByTimeAsync(2000); expect(f.guard.claim()).toBe(true);
  const first = f.click(), second = f.click();
  expect(first.preventDefault).toHaveBeenCalledTimes(1);
  expect(second.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  expect(f.clickTarget.dispatchEvent).not.toHaveBeenCalled();
  expect(yieldSession).toHaveBeenCalledTimes(1);
  if (reply === 'resolve') respond({ ok: true });
  await vi.advanceTimersByTimeAsync(reply === 'never' ? 14_999 : 0);
  expect(f.clickTarget.dispatchEvent).toHaveBeenCalledTimes(reply === 'never' ? 0 : 2);
  if (reply === 'never') await vi.advanceTimersByTimeAsync(1);
  expect(f.clickTarget.dispatchEvent).toHaveBeenCalledTimes(2);
  respond?.({ ok: true });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.clickTarget.dispatchEvent).toHaveBeenCalledTimes(2);
  const third = f.click();
  expect(third.preventDefault).not.toHaveBeenCalled();
});

it('does not recapture its own replay even if a new collection is requested', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.clickTarget.dispatchEvent.mockImplementation(event => {
    f.handlers.click({ ...event, target: f.clickTarget, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    return true;
  });
  f.click(); await vi.advanceTimersByTimeAsync(0);
  expect(f.clickTarget.dispatchEvent).toHaveBeenCalledTimes(1);
  expect(f.yieldSession).toHaveBeenCalledTimes(1);
});

it('releases the next held action even when a replay throws', async () => {
  const f = fixture({ yieldSession: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.clickTarget.dispatchEvent.mockImplementationOnce(() => { throw new Error('page-handler-failed'); });
  f.click(); f.click();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(f.clickTarget.dispatchEvent).toHaveBeenCalledTimes(2);
});

it('retries from home after yielding and another two idle seconds', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.click(); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.collect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(2);
});

it('preserves a form submitter and invokes the student submission once', async () => {
  const f = fixture({ yieldSession: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const form = { submit: vi.fn() }, submitter = { name: 'pressed', value: 'original' };
  f.handlers.submit({ type: 'submit', target: form, submitter, cancelable: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(form.submit).toHaveBeenCalledExactlyOnceWith(submitter);
});

for (const kind of ['button', 'input']) it(`replays Enter once with a missing worker (${kind})`, async () => {
  const f = fixture({ yieldSession: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const button = { click: vi.fn() };
  const target = { dispatchEvent: vi.fn(() => true), click: button.click,
    matches: selector => kind === 'button' && selector.startsWith('a, button'),
    form: { querySelector: () => button } };
  for (const type of ['keydown', 'keyup']) f.handlers[type]({ type, target, key: 'Enter', code: 'Enter', cancelable: true,
    preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(target.dispatchEvent).toHaveBeenCalledTimes(2);
  expect(button.click).toHaveBeenCalledTimes(1);
});

it('aborts page reads and informs the worker on pagehide', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.windowEvents.pagehide();
  expect(f.guard.signal.aborted).toBe(true);
  expect(f.guard.canRead(true)).toBe(false);
  expect(f.yieldSession).toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).toHaveBeenCalledTimes(1);
});

it('aborts an unanswered page read when the worker releases its lease', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const signal = f.guard.signal;
  f.guard.release();
  expect(signal.aborted).toBe(true);
  expect(f.guard.canRead(true)).toBe(false);
  expect(f.click().preventDefault).not.toHaveBeenCalled();
});

it('passes modified clicks immediately while abandoning acquisition', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = f.click(undefined, { ctrlKey: true });
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(f.yieldSession).toHaveBeenCalledWith(true);
  expect(f.guard.canRead(false)).toBe(false);
});

it('preserves native Enter in an editor or select and abandons collection', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = { key: 'Enter', cancelable: true, target: { isContentEditable: true }, preventDefault: vi.fn() };
  f.handlers.keydown(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(f.yieldSession).toHaveBeenCalledWith(true);
  expect(f.guard.canRead(false)).toBe(false);
});

it('does not intercept or restore a stateless LMS', async () => {
  const f = fixture({ statefulSession: false });
  expect(f.handlers).toEqual({}); expect(f.windowEvents).toEqual({});
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.canRead(false)).toBe(true);
});
