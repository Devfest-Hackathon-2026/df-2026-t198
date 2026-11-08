import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterTarget, settleChapters } from './chapter-scroll';

// Chapters at 0, 1000, 2600 (the second is taller than the 1000px viewport), 3600.
const tops = [0, 1000, 2600, 3600];
const at = (y: number, direction: 'down' | 'up', from?: number) => chapterTarget({ y, viewport: 1000, tops, direction, ...(from === undefined ? {} : { from }) });

describe('chapterTarget', () => {
  it('moves to the next chapter after a short scroll down', () => {
    expect(at(130, 'down')).toBe(1000);
  });
  it('returns to the current chapter when the scroll down was tiny', () => {
    expect(at(80, 'down')).toBe(0);
  });
  it('moves to the previous chapter after a short scroll up', () => {
    expect(at(870, 'up')).toBe(0);
  });
  it('leaves a long chapter alone while no boundary is in view', () => {
    expect(at(1300, 'down')).toBeNull();
    expect(at(1500, 'up')).toBeNull();
  });
  it('finishes at a chapter top just above the viewport when scrolling up', () => {
    expect(at(1040, 'up')).toBe(1000);
    expect(at(1040, 'down')).toBeNull();
  });
  it('shows the end of a long chapter instead of its top when going back up', () => {
    expect(at(2400, 'up')).toBe(1600);
  });
  it('moves on from a chapter slightly taller than the viewport in one short scroll', () => {
    // Started at the top of the 1600px chapter; the next boundary just came into view.
    expect(at(1630, 'down', 1000)).toBe(2600);
    expect(at(1630, 'down', 1610)).toBe(1600);
  });
  it('does nothing when already aligned to a chapter', () => {
    expect(at(1000, 'down')).toBeNull();
    expect(at(3600, 'up')).toBeNull();
    // A table-of-contents jump from the top that ends on a chapter stays there.
    expect(at(2600, 'down', 0)).toBeNull();
  });
});

// A minimal event-capable browser: timers are real controller timers, RAF is stepped explicitly.
class TestElement extends EventTarget {
  id = '';
  tagName = 'SECTION';
  attributes = new Map<string, string>();
  focus = vi.fn();
  closest(selector: string) { return selector.includes('dialog') && this.tagName === 'DIALOG' ? this : null; }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
}
function browser(hasScrollEnd = false, initiallyReduced = false) {
  let now = 0;
  let nextFrame = 0;
  let reduced = initiallyReduced;
  let modal = false;
  const frames = new Map<number, FrameRequestCallback>();
  const win = Object.assign(new EventTarget(), {
    scrollY: 0, innerHeight: 800,
    performance: { now: () => now },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    location: { hash: '' }, history: { state: null, pushState: vi.fn() },
    scrollTo: vi.fn((options: ScrollToOptions) => { win.scrollY = options.top ?? 0; win.dispatchEvent(new Event('scroll')); }),
  });
  if (hasScrollEnd) Object.assign(win, { onscrollend: null });
  const doc = Object.assign(new EventTarget(), { querySelector: () => modal ? new TestElement() : null });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('Element', TestElement);
  const sections = [0, 800, 2400].map((top, index) => Object.assign(new TestElement(), {
    id: `chapter-${index}`, getBoundingClientRect: () => ({ top: top - win.scrollY }),
  })) as unknown as HTMLElement[];
  const stop = settleChapters(sections);
  cleanups.push(stop);
  const input = (type: string, fields: Record<string, unknown> = {}, target: EventTarget = win) => {
    const event = new Event(type, { cancelable: true });
    const { target: delegated, ...properties } = fields;
    Object.assign(event, properties);
    if (delegated) Object.defineProperty(event, 'target', { value: delegated });
    target.dispatchEvent(event); return event;
  };
  const scroll = (y: number) => { win.scrollY = y; input('scroll'); };
  const step = (ms: number) => {
    now += ms; const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
  };
  const gesture = () => { scroll(0); input('wheel'); scroll(150); vi.advanceTimersByTime(150); };
  return { win, doc, sections, input, scroll, step, gesture, frames, stop,
    reduce: (value: boolean) => { reduced = value; }, modal: (value: boolean) => { modal = value; } };
}
const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const stop of cleanups.splice(0)) stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('chapter scroll events and animation', () => {
  it('handles composited wheel movement delivered before the wheel listener', () => {
    const b = browser(); b.win.scrollY = 150; b.input('wheel'); b.input('scroll');
    b.input('scrollend'); b.step(800); expect(b.win.scrollY).toBe(800);
  });
  for (const scrollend of [false, true]) {
    it(`waits for touch release (scrollend=${scrollend})`, () => {
      const b = browser(scrollend);
      b.input('touchstart', { touches: [1] }); b.input('touchmove'); b.scroll(150);
      b.input('scrollend'); vi.advanceTimersByTime(1000);
      expect(b.win.scrollTo).not.toHaveBeenCalled();
      b.input('touchend', { touches: [] }); vi.advanceTimersByTime(150); b.step(800);
      expect(b.win.scrollY).toBe(800);
    });
    it(`waits until all scroll keys are released (scrollend=${scrollend})`, () => {
      const b = browser(scrollend);
      b.input('keydown', { key: 'ArrowDown' }); b.input('keydown', { key: 'PageDown' }); b.scroll(150);
      b.input('scrollend'); vi.advanceTimersByTime(1000);
      expect(b.win.scrollTo).not.toHaveBeenCalled();
      b.input('keyup', { key: 'ArrowDown' }); vi.advanceTimersByTime(200);
      expect(b.win.scrollTo).not.toHaveBeenCalled();
      b.input('keyup', { key: 'PageDown' }); vi.advanceTimersByTime(150); b.step(800);
      expect(b.win.scrollY).toBe(800);
    });
  }
  it('ignores dialog gestures and clears intent when the dialog closes', () => {
    const b = browser(); b.input('wheel'); b.scroll(150);
    b.modal(true); b.input('wheel'); b.input('touchstart', { touches: [1] }); b.input('touchmove');
    b.modal(false); b.input('close', {}, b.doc); b.scroll(180); vi.advanceTimersByTime(200); b.step(1000);
    expect(b.win.scrollTo).not.toHaveBeenCalled();
    b.scroll(0); b.gesture(); b.step(800); expect(b.win.scrollY).toBe(800);
  });
  it('does not resume a pointer-interrupted animation at the end of a touch gesture', () => {
    const b = browser(); b.gesture(); b.step(200);
    b.input('pointerdown'); b.input('touchstart', { touches: [1] });
    b.input('touchmove'); b.scroll(200); vi.advanceTimersByTime(1000);
    b.input('touchcancel', { touches: [] }); vi.advanceTimersByTime(200); b.step(1000);
    expect(b.win.scrollY).toBe(200); expect(b.frames.size).toBe(0);
  });
  it('rechecks reduced motion before settling and can resume when it is disabled', () => {
    const b = browser(); b.input('wheel'); b.scroll(150); b.reduce(true);
    vi.advanceTimersByTime(200); b.step(1000); expect(b.win.scrollTo).not.toHaveBeenCalled();
    b.reduce(false); b.gesture(); b.step(800); expect(b.win.scrollY).toBe(800);
  });
  it('also registers when reduced motion was enabled at mount', () => {
    const b = browser(false, true); b.gesture(); expect(b.frames.size).toBe(0);
    b.reduce(false); b.gesture(); expect(b.frames.size).toBe(1);
  });
  it('uses instant frames with gentle acceleration and deceleration, lasting about 800ms for 800px', () => {
    const b = browser();
    const link = new TestElement(); link.attributes.set('href', '#chapter-1');
    link.closest = selector => selector.includes('a[') ? link : null;
    b.input('click', { button: 0, target: link });
    const positions = [0];
    for (let index = 0; index < 8; index++) { b.step(100); positions.push(b.win.scrollY); }
    const deltas = positions.slice(1).map((y, i) => y - positions[i]!);
    expect(deltas[0]).toBeLessThan(deltas[3]!); expect(deltas[7]).toBeLessThan(deltas[4]!);
    expect(positions[7]).toBeLessThan(800); expect(positions[8]).toBe(800);
    expect(b.win.scrollTo.mock.calls.every(([options]) => options.behavior === 'instant')).toBe(true);
  });
  it('takes at least 600ms for a short return and at most 1000ms for a distant link', () => {
    const b = browser(); b.input('wheel'); b.scroll(40); vi.advanceTimersByTime(150);
    b.step(599); expect(b.win.scrollY).toBeGreaterThan(0);
    b.step(1); expect(b.win.scrollY).toBe(0);
    const link = new TestElement(); link.tagName = 'A'; link.attributes.set('href', '#chapter-2');
    // The window handler receives the actual anchor as the event target.
    link.closest = selector => selector.includes('a[') ? link : null;
    const event = b.input('click', { button: 0, target: link });
    expect(event.defaultPrevented).toBe(true);
    expect(b.win.history.pushState).toHaveBeenCalledWith(null, '', '#chapter-2');
    expect(b.sections[2]!.focus).toHaveBeenCalledWith({ preventScroll: true });
    b.step(999); expect(b.win.scrollY).toBeLessThan(2400);
    b.step(1); expect(b.win.scrollY).toBe(2400);
    expect(b.sections[2]!.getAttribute('tabindex')).toBe('-1');
    b.sections[2]!.dispatchEvent(new Event('blur'));
    expect(b.sections[2]!.hasAttribute('tabindex')).toBe(false);
  });
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown', 'popstate']) {
    it(`stops immediately on ${type}, with no delayed restart`, () => {
      const b = browser(); b.gesture(); b.step(200); const y = b.win.scrollY;
      b.input(type, { key: 'Escape', touches: [1] });
      // The interrupted wheel's own native scroll must not start another chapter animation.
      if (type === 'wheel') b.scroll(y - 60);
      const expected = b.win.scrollY;
      b.step(1000); vi.advanceTimersByTime(1000); b.step(1000);
      expect(b.win.scrollY).toBe(expected); expect(b.frames.size).toBe(0);
    });
  }
  it('stops on reduced motion during animation and on cleanup', () => {
    const b = browser(); b.gesture(); b.step(200); b.reduce(true); const y = b.win.scrollY;
    b.step(1000); expect(b.win.scrollY).toBe(y);
    b.reduce(false); b.gesture(); b.stop(); b.step(1000);
    expect(b.win.scrollY).toBe(150); expect(b.frames.size).toBe(0);
    b.input('wheel'); b.scroll(180); vi.advanceTimersByTime(200); b.step(1000);
    expect(b.win.scrollY).toBe(180);
  });
});
