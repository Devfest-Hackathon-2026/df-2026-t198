import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assignCourseColors, courseIdentityKey } from '../src/shared/course-color';

it('gives the six demo courses distinct colors independent of list order', () => {
  const courses = ['DEMO101', 'DEMO202', 'DEMO303', 'DEMO404', 'DEMO505', 'DEMO606']
    .map(courseId => ({ system: 'demo-lms', courseId }));
  const colors = assignCourseColors(courses);
  expect(new Set(colors.values()).size).toBe(6);
  expect(assignCourseColors([...courses].reverse())).toEqual(colors);
});

it('keeps colors stable across ordering and renaming without mutating the full list', () => {
  const courses = Array.from({ length: 80 }, (_, i) => ({ system: 'demo-lms', courseId: `COURSE${i}`, name: `授業${i}` }));
  const before = JSON.stringify(courses);
  const original = assignCourseColors(courses);
  expect(assignCourseColors([...courses].reverse().map(course => ({ ...course, name: '改名後' })))).toEqual(original);
  expect(new Set(original.values())).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  expect(original.size).toBe(80);
  expect(JSON.stringify(courses)).toBe(before);
  expect(assignCourseColors([]).size).toBe(0);
});

it('distinguishes systems and ambiguous concatenations, deduplicating identities before using colors', () => {
  const courses = [{ system: 'ynu-lms', courseId: 'math' }, { system: 'kulms', courseId: 'math' },
    { system: 'ab', courseId: 'c' }, { system: 'a', courseId: 'bc' }];
  const colors = assignCourseColors(courses);
  expect(colors.size).toBe(4);
  expect(new Set(colors.values()).size).toBe(4);
  expect(assignCourseColors([...courses, ...courses])).toEqual(colors);
  expect(courseIdentityKey(courses[2]!)).not.toBe(courseIdentityKey(courses[3]!));
});

it('avoids collisions for any eight courses, allowing reuse only beyond eight', () => {
  for (let start = 0; start < 40; start++) {
    const courses = Array.from({ length: 9 }, (_, i) => ({ system: 'demo-lms', courseId: `course-${start + i}` }));
    expect(new Set(assignCourseColors(courses.slice(0, 8)).values()).size).toBe(8);
    expect(assignCourseColors(courses).size).toBe(9);
    expect(new Set(assignCourseColors(courses).values()).size).toBe(8);
  }
});

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
it.each(Array.from({ length: 8 }, (_, i) => i))('keeps course %i text AA and its band distinct from the fill and surrounding surfaces', i => {
  const css = readFileSync(new URL('../src/shared/styles/tokens.css', import.meta.url), 'utf8');
  const app = css.match(/\.app \{([^}]+)\}/)![1]!;
  const token = (name: string, scope = app) => scope.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i'))![1]!;
  const background = token(`course-${i}-soft`);
  // The fixed vermilion needs L* >= 93.7 for AA; use the upper end of the requested light fills.
  const lightness = 116 * Math.cbrt(luminance(background)) - 16;
  expect(lightness).toBeGreaterThanOrEqual(88);
  expect(lightness).toBeLessThanOrEqual(94);
  for (const color of [token('ink'), token('ink-muted'), token('accent'), token('change-text', css)]) {
    expect(contrast(color, background), `course ${i}: ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
  for (const surface of [background, token('paper'), token('sheet')]) {
    expect(contrast(token(`course-${i}-band`), surface)).toBeGreaterThanOrEqual(3);
  }
  expect(token(`course-${i}-band`)).not.toBe(token('change-text', css));
});
