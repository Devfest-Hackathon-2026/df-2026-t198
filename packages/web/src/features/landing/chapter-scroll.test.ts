import { describe, expect, it } from 'vitest';
import { chapterTarget } from './chapter-scroll';

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
