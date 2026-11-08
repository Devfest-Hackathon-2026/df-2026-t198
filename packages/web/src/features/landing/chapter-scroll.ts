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

/** Moves to the adjacent chapter after a short scroll. Returns a cleanup function. */
export function settleChapters(sections: HTMLElement[]): () => void {
  if (reducedMotion()) return () => undefined;
  let lastY = window.scrollY;
  let from = window.scrollY;
  // Only the reader's own wheel, touch or key scrolling is finished; links and scripts are left alone.
  let reading = false;
  const intent = () => { reading = true; };
  const scrollKeys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
  const key = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (scrollKeys.has(event.key) && !target?.closest('dialog, input, textarea, select, button')) reading = true;
  };
  // A click (such as a table-of-contents link) starts its own scroll.
  const clicked = () => { reading = false; };
  let direction: 'down' | 'up' = 'down';
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Older Safari has no scrollend; settle after scrolling has been quiet for a moment instead.
  const hasScrollEnd = 'onscrollend' in window;
  const settle = () => {
    if (!reading || document.querySelector('dialog[open]')) { from = window.scrollY; return; }
    reading = false;
    const tops = sections.map(section => section.getBoundingClientRect().top + window.scrollY);
    const target = chapterTarget({ y: window.scrollY, viewport: window.innerHeight, tops, direction, from });
    from = target ?? window.scrollY;
    if (target !== null && Math.abs(target - window.scrollY) > 1) window.scrollTo({ top: target, behavior: 'smooth' });
  };
  const scrolled = () => {
    const y = window.scrollY;
    if (y !== lastY) direction = y > lastY ? 'down' : 'up';
    lastY = y;
    if (!hasScrollEnd) { clearTimeout(timer); timer = setTimeout(settle, 150); }
  };
  window.addEventListener('wheel', intent, { passive: true });
  window.addEventListener('touchmove', intent, { passive: true });
  window.addEventListener('keydown', key);
  window.addEventListener('click', clicked, true);
  window.addEventListener('scroll', scrolled, { passive: true });
  window.addEventListener('scrollend', settle);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('wheel', intent);
    window.removeEventListener('touchmove', intent);
    window.removeEventListener('keydown', key);
    window.removeEventListener('click', clicked, true);
    window.removeEventListener('scroll', scrolled);
    window.removeEventListener('scrollend', settle);
  };
}
