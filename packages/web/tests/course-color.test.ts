import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { courseColor } from '../src/shared/course-color';

it('keeps the course color stable across calls, names, ordering and visible subsets', () => {
  const courses = Array.from({ length: 80 }, (_, i) => ({ system: 'demo-lms', courseId: `COURSE${i}`, name: `授業${i}` }));
  const original = new Map(courses.map(course => [course.courseId, courseColor(course)]));
  for (const course of [...courses].reverse().filter((_, i) => i % 3 === 0)) {
    const renamed = { ...course, name: '改名後' };
    expect(courseColor(renamed)).toBe(original.get(course.courseId));
    expect(courseColor(course)).toBe(courseColor(course));
  }
  expect(new Set(original.values())).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  expect(courseColor(undefined)).toBeUndefined();
});

it('uses both system and courseId without concatenation ambiguity', () => {
  const ids = Array.from({ length: 32 }, (_, i) => `COURSE${i}`);
  expect(ids.some(courseId => courseColor({ system: 'ynu-lms', courseId }) !== courseColor({ system: 'kulms', courseId }))).toBe(true);
  expect(courseColor({ system: 'ab', courseId: 'c' })).not.toBe(courseColor({ system: 'a', courseId: 'bc' }));
});

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
it('keeps all eight backgrounds AA for body, secondary, link, and deadline-change text', () => {
  const css = readFileSync(new URL('../src/shared/styles/tokens.css', import.meta.url), 'utf8');
  const app = css.match(/\.app \{([^}]+)\}/)![1]!;
  const token = (name: string, scope = app) => scope.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i'))![1]!;
  for (let i = 0; i < 8; i++) {
    const background = token(`course-${i}-soft`);
    for (const color of [token('ink'), token('ink-muted'), token('accent'), token('change-text', css)]) {
      expect(contrast(color, background), `course ${i}: ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token(`course-${i}-band`), background)).toBeGreaterThanOrEqual(3);
    expect(token(`course-${i}-band`)).not.toBe(token('change-text', css));
  }
});
