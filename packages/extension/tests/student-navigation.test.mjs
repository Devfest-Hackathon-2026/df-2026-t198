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
    handlers[event.type](event);
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

it('retries not-idle after two seconds and stops retrying after success', async () => {
  const f = fixture();
  f.collect.mockResolvedValueOnce({ ok: false, code: 'not-idle' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.collect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.collect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.collect).toHaveBeenCalledTimes(2);
});

it('re-arms the remaining idle wait if the wall clock moved backward', async () => {
  const f = fixture();
  vi.setSystemTime(Date.now() - 5);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.collect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4);
  expect(f.collect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(true);
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

it('waits for pageshow before retrying after a slow student navigation', async () => {
  const f = fixture();
  let resolveCollection;
  f.collect.mockImplementationOnce(() => new Promise(resolve => { resolveCollection = resolve; }));
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.click(); await vi.advanceTimersByTimeAsync(0);
  expect(f.clickTarget.dispatchEvent).toHaveBeenCalledTimes(1);
  resolveCollection({ ok: false, code: 'yielded' });
  // The old home remains visible while the server takes more than two seconds.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
  f.windowEvents.pageshow({ persisted: false });
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(2);
  expect(f.guard.claim()).toBe(true);
});

it('can retry after the next student activity when an action stays on home', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.click(); await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
  f.handlers.pointerdown();
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.guard.claim()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(2);
  expect(f.guard.claim()).toBe(true);
});

for (const action of ['submit', 'enter']) it(`does not restart while replaying nested ${action} events`, async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = { cancelable: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  if (action === 'submit') {
    const form = { submit: vi.fn(() => f.handlers.submit({ ...event, target: form })) };
    f.handlers.submit({ ...event, target: form });
    await vi.advanceTimersByTimeAsync(0);
    expect(form.submit).toHaveBeenCalledTimes(1);
  } else {
    const target = { matches: selector => selector.startsWith('a, button'), dispatchEvent: vi.fn(() => true), click: vi.fn(() => f.click()) };
    f.handlers.keydown({ ...event, type: 'keydown', key: 'Enter', target });
    await vi.advanceTimersByTimeAsync(0);
    expect(target.click).toHaveBeenCalledTimes(1);
  }
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
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

for (const name of ['beforeunload', 'pagehide']) it(`aborts page reads and informs the worker on ${name}`, async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  expect(f.windowEvents[name]).toBeTypeOf('function');
  f.windowEvents[name]();
  expect(f.guard.signal.aborted).toBe(true);
  expect(f.guard.canRead(true)).toBe(false);
  expect(f.yieldSession).toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(14_999);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
  f.windowEvents.pageshow({ persisted: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.guard.claim()).toBe(true);
});

for (const name of ['beforeunload', 'pagehide']) {
  for (const reply of ['resolve', 'reject', 'never']) it(`discards held actions on ${name} despite a worker that will ${reply}`, async () => {
    let resolve, reject;
    const f = fixture({ yieldSession: gone => gone ? Promise.resolve({ ok: true }) : new Promise((yes, no) => {
      resolve = yes; reject = no;
    }) });
    await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
    f.click(); f.click();
    f.windowEvents[name]();
    if (reply === 'resolve') resolve({ ok: true });
    if (reply === 'reject') reject(new Error('worker-unavailable'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.clickTarget.dispatchEvent).not.toHaveBeenCalled();
  });
}

it('resumes collection after 15 seconds without pagehide and the normal idle interval', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const oldSignal = f.guard.signal;
  f.windowEvents.beforeunload();
  await vi.advanceTimersByTimeAsync(14_999);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.guard.claim()).toBe(false);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.collect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.collect).toHaveBeenCalledTimes(2);
  expect(f.guard.claim()).toBe(true);
  expect(oldSignal.aborted).toBe(true);
  expect(f.guard.signal.aborted).toBe(false);
  expect(f.guard.canRead(false)).toBe(true);
});

it('cancels the departure recovery on pagehide, even if it arrives near the deadline', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.windowEvents.beforeunload();
  await vi.advanceTimersByTimeAsync(14_999);
  f.windowEvents.pagehide();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.claim()).toBe(false);
});

it('cancels the old recovery timer on pageshow without resetting a new lease', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  f.windowEvents.beforeunload();
  await vi.advanceTimersByTimeAsync(1000);
  f.windowEvents.pageshow({ persisted: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.guard.claim()).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.collect).toHaveBeenCalledTimes(2);
  expect(f.guard.canRead(false)).toBe(true);
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

for (const kind of ['textarea', 'select', 'contentEditable']) it(`preserves Enter in ${kind} without abandoning or blocking`, async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = { key: 'Enter', cancelable: true,
    target: { isContentEditable: kind === 'contentEditable', matches: () => kind !== 'contentEditable' }, preventDefault: vi.fn() };
  f.handlers.keydown(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(f.yieldSession).not.toHaveBeenCalled();
  expect(f.guard.canRead(false)).toBe(true);
  expect(f.guard.signal.aborted).toBe(false);
  f.guard.release(); f.handlers.input();
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.guard.claim()).toBe(true);
});

it('ignores right-button auxclick without abandoning collection', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = f.click(undefined, { type: 'auxclick', button: 2 });
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(f.yieldSession).not.toHaveBeenCalled();
  expect(f.guard.canRead(false)).toBe(true);
});

it('passes middle-button auxclick immediately like a modified click', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = f.click(undefined, { type: 'auxclick', button: 1 });
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(f.yieldSession).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.guard.canRead(false)).toBe(false);
});

for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey', 'altKey']) {
  for (const type of ['keydown', 'keypress', 'keyup']) it(`passes ${modifier}+Enter ${type} without replay`, async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
    const target = { matches: () => false, dispatchEvent: vi.fn(), click: vi.fn() };
    const event = { type, key: 'Enter', target, cancelable: true, [modifier]: true,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    f.handlers[type](event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(f.yieldSession).toHaveBeenCalledExactlyOnceWith(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.dispatchEvent).not.toHaveBeenCalled();
    expect(target.click).not.toHaveBeenCalled();
    expect(f.collect).toHaveBeenCalledTimes(1);
  });
}

it('ignores composing Enter without interrupting collection', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(2000); f.guard.claim();
  const event = { key: 'Enter', isComposing: true, cancelable: true, preventDefault: vi.fn() };
  f.handlers.keydown(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(f.yieldSession).not.toHaveBeenCalled();
  expect(f.guard.canRead(false)).toBe(true);
});

it('does not intercept or restore a stateless LMS', async () => {
  const f = fixture({ statefulSession: false });
  expect(f.handlers).toEqual({}); expect(f.windowEvents).toEqual({});
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.guard.canRead(false)).toBe(true);
});
