import { reducedMotion } from '../../shared/ui/motion';

/** Share of the viewport the reader must move toward a chapter before the page finishes the move. */
export const CHAPTER_THRESHOLD = 0.12;

export type ChapterScrollInput = {
  y: number;
  viewport: number;
  /** Top of each chapter in page coordinates, in document order. */
  tops: number[];
  direction: 'down' | 'up';
  /** Where this scroll gesture started; a move of the threshold from here also counts. */
  from?: number;
  threshold?: number;
};

/**
 * Where to settle after the reader stops scrolling, or null to leave the page where it is.
 * Only a chapter boundary inside the viewport triggers a move, so a chapter taller than the
 * viewport can still be read freely.
 */
export function chapterTarget({ y, viewport, tops, direction, from = y, threshold = CHAPTER_THRESHOLD }: ChapterScrollInput): number | null {
  // A link or key already landed on a chapter; never push it further.
  if (tops.some(top => Math.abs(top - y) <= 1)) return null;
  const index = tops.findIndex(top => top > y + 1 && top < y + viewport - 1);
  const boundary = tops[index];
  const enough = viewport * threshold;
  if (boundary === undefined) {
    // Scrolling up to just below a chapter's top: finish at that top.
    const above = tops.filter(top => top < y).at(-1);
    return direction === 'up' && above !== undefined && y - above < enough ? above : null;
  }
  const previousTop = tops[index - 1] ?? 0;
  // Show the end of a long previous chapter instead of jumping back to its top.
  const previous = Math.max(previousTop, boundary - viewport);
  const below = y + viewport - boundary;
  const above = boundary - y;
  if (direction === 'down') return below >= enough || y - from >= enough ? boundary : previous;
  return above >= enough || from - y >= enough ? previous : boundary;
}

/** Moves to adjacent chapters and handles chapter links. Returns a cleanup function. */
export function settleChapters(sections: HTMLElement[]): () => void {
  let lastY = window.scrollY;
  let from = lastY;
  let reading = false;
  let moved = false;
  let interrupted = false;
  let touching = false;
  const heldKeys = new Set<string>();
  const focusCleanups = new Set<() => void>();
  const scrollKeys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
  let direction: 'down' | 'up' = 'down';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  const dialogOpen = () => !!document.querySelector('dialog[open]');
  const element = (event: Event) => event.target instanceof Element ? event.target : null;
  const inDialog = (event: Event) => dialogOpen() || !!element(event)?.closest('dialog');
  const stopAnimation = () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const cancelByReader = () => {
    if (frame === undefined) return;
    stopAnimation(); reading = false; moved = false; interrupted = true;
  };
  const reset = () => {
    stopAnimation(); clearTimeout(timer);
    reading = false; moved = false; interrupted = false; touching = false; heldKeys.clear();
    lastY = from = window.scrollY;
  };
  const animate = (target: number) => {
    stopAnimation(); clearTimeout(timer); reading = false;
    const startY = window.scrollY;
    const duration = Math.min(1000, Math.max(600, Math.abs(target - startY)));
    const started = window.performance.now();
    const tick = (now: number) => {
      frame = undefined;
      if (reducedMotion() || dialogOpen()) { reset(); return; }
      const progress = Math.min(1, (now - started) / duration);
      const eased = (1 - Math.cos(Math.PI * progress)) / 2;
      // Explicit instant overrides the landing page's CSS smooth behavior on every frame.
      window.scrollTo({ top: startY + (target - startY) * eased, behavior: 'instant' });
      lastY = from = window.scrollY;
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
  };
  const settle = () => {
    if (dialogOpen() || reducedMotion()) { reset(); return; }
    if (touching || heldKeys.size || frame !== undefined) return;
    if (interrupted) { interrupted = false; reading = false; return; }
    if (!reading) return;
    reading = false;
    if (!moved) return;
    const tops = sections.map(section => section.getBoundingClientRect().top + window.scrollY);
    const target = chapterTarget({ y: window.scrollY, viewport: window.innerHeight, tops, direction, from });
    from = window.scrollY;
    if (target !== null && Math.abs(target - window.scrollY) > 1) animate(target);
  };
  // Also used after input ends: scrollend may have fired already while a finger/key was held.
  const schedule = () => { clearTimeout(timer); timer = setTimeout(settle, 150); };
  const intent = (event: Event) => {
    cancelByReader();
    if (inDialog(event)) { reset(); return; }
    if (interrupted) { schedule(); return; }
    // Composited wheel scrolling can update scrollY before the wheel listener runs.
    if (!reading) { from = lastY; moved = false; }
    reading = true; schedule();
  };
  const touchStart = (event: TouchEvent) => { intent(event); touching = !inDialog(event); };
  const touchEnd = (event: TouchEvent) => {
    touching = event.touches.length > 0;
    if (!touching) schedule();
  };
  const keyDown = (event: KeyboardEvent) => {
    cancelByReader();
    if (inDialog(event)) { reset(); return; }
    if (scrollKeys.has(event.key) && !element(event)?.closest('input, textarea, select, button, [contenteditable]')) {
      intent(event); heldKeys.add(event.key);
    } else { reading = false; schedule(); }
  };
  const keyUp = (event: KeyboardEvent) => { heldKeys.delete(event.key); schedule(); };
  const clicked = (event: MouseEvent) => {
    reset();
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || inDialog(event)) return;
    const link = element(event)?.closest('a[href^="#"]');
    const hash = link?.getAttribute('href');
    const section = sections.find(section => hash === `#${section.id}`);
    if (!section || reducedMotion() || link?.hasAttribute('download') || link?.getAttribute('target')) return;
    event.preventDefault();
    if (window.location.hash !== hash) window.history.pushState(window.history.state, '', hash);
    // Match anchor navigation, including keyboard focus, without an extra browser scroll.
    const tabIndex = section.getAttribute('tabindex');
    if (tabIndex === null) {
      section.setAttribute('tabindex', '-1');
      const restore = () => {
        section.removeAttribute('tabindex'); section.removeEventListener('blur', restore);
        focusCleanups.delete(restore);
      };
      focusCleanups.add(restore); section.addEventListener('blur', restore, { once: true });
    }
    section.focus({ preventScroll: true });
    animate(section.getBoundingClientRect().top + window.scrollY);
  };
  const scrolled = () => {
    const y = window.scrollY;
    if (reading && y !== lastY) { direction = y > lastY ? 'down' : 'up'; moved = true; }
    lastY = y;
    if (reading) schedule();
  };
  const pointerDown = () => {
    cancelByReader(); clearTimeout(timer); reading = false; moved = false;
    lastY = from = window.scrollY;
    if (interrupted) schedule();
  };
  window.addEventListener('wheel', intent, { passive: true });
  window.addEventListener('touchstart', touchStart, { passive: true });
  window.addEventListener('touchmove', intent, { passive: true });
  window.addEventListener('touchend', touchEnd, { passive: true });
  window.addEventListener('touchcancel', touchEnd, { passive: true });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('pointerdown', pointerDown, true);
  window.addEventListener('click', clicked, true);
  window.addEventListener('scroll', scrolled, { passive: true });
  window.addEventListener('scrollend', settle);
  window.addEventListener('popstate', reset);
  window.addEventListener('blur', reset);
  // Native dialog close does not bubble; discard gestures before focus restoration scrolls.
  document.addEventListener('close', reset, true);
  return () => {
    reset();
    for (const restore of focusCleanups) restore();
    window.removeEventListener('wheel', intent);
    window.removeEventListener('touchstart', touchStart);
    window.removeEventListener('touchmove', intent);
    window.removeEventListener('touchend', touchEnd);
    window.removeEventListener('touchcancel', touchEnd);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('pointerdown', pointerDown, true);
    window.removeEventListener('click', clicked, true);
    window.removeEventListener('scroll', scrolled);
    window.removeEventListener('scrollend', settle);
    window.removeEventListener('popstate', reset);
    window.removeEventListener('blur', reset);
    document.removeEventListener('close', reset, true);
  };
}
