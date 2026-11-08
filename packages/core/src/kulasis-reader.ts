import { parseHtmlTree } from './html-tree.js';
import type { Course, CourseSlot } from './types.js';
import { isSafeMailText } from './mail-safety.js';
import { KULMS_ORIGIN } from './sakai-reader.js';

export type KulasisUrlParser = (value: string, base?: string) => {
  origin: string; username: string; password: string; pathname: string; search: string; hash: string;
  searchParams: { get(key: string): string | null };
};
export const KULASIS_ORIGIN = 'https://www.k.kyoto-u.ac.jp';
export function isKulasisOrigin(origin: string): boolean {
  return origin === KULASIS_ORIGIN || origin === 'https://k.kyoto-u.ac.jp';
}
export interface KulasisDefinition {
  definitionId: string; version: number; tables: string; rows: string; links: string;
  terms: { spring: string; autumn: string };
}
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, '').trim();
const weekday = (text: string) => /^([月火水木金土日])(?:曜(?:日)?)?$/.test(normalize(text))
  ? '月火水木金土日'.indexOf(normalize(text)[0]!) + 1 : undefined;
const period = (text: string) => {
  const match = /^(?:第)?([1-9]|1\d|2[0-4])(?:時限|限)?$/.exec(normalize(text));
  return match ? Number(match[1]) : undefined;
};
export function kulasisBase(value: string, parseUrl: KulasisUrlParser): string | undefined {
  try {
    const url = parseUrl(value);
    if (!isKulasisOrigin(url.origin) || url.username || url.password) return;
    const path = /^\/student\/((?:[a-z]+\/)*[a-z]+)\/(?:top|(?:entry|support|global_notice|syllabus|oh)\/[^/]+|information_detail|information_attachment|course_mail_list)$/.exec(url.pathname);
    return path ? `${url.origin}/student/${path[1]}` : undefined;
  } catch { return; }
}
export function kulasisTerm(date: string): string {
  const day = new Date(date).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
  return `${month < 4 ? year - 1 : year}-${month >= 4 && month <= 9 ? 'spring' : 'autumn'}`;
}
/** A delayed logout is a timer, never a navigation instruction for the collector. */
export function checkKulasisLogin(html: string): void {
  const { document } = parseHtmlTree(html);
  if (document.querySelector('input[type="password"]')) throw new Error('not-logged-in');
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.toLowerCase() !== 'refresh') continue;
    const content = meta.getAttribute('content') ?? '';
    if (/^\s*0(?:\.0+)?\s*;/.test(content)) throw new Error('not-logged-in');
  }
}
/** Reads header labels rather than assuming the user's timetable orientation. */
export function readKulasisTimetable(definition: KulasisDefinition, html: string, base: string, parseUrl: KulasisUrlParser): Course[] {
  checkKulasisLogin(html);
  const { document } = parseHtmlTree(html);
  const courses = new Map<string, Course>();
  let recognized = false;
  for (const table of document.querySelectorAll(definition.tables)) {
    const rows = Array.from(table.querySelectorAll(definition.rows)).filter(row => row.closest('table') === table);
    while (rows[0]) {
      const cells = Array.from(rows[0].querySelectorAll('th, td')).filter(cell => cell.closest('tr') === rows[0]);
      if (cells.length !== 1) break;
      const width = Number(cells[0]!.getAttribute('colspan') ?? 1);
      if (!Number.isInteger(width) || width <= 1 || width > 50 || Number(cells[0]!.getAttribute('rowspan') ?? 1) !== 1) break;
      rows.shift();
    }
    const grid: (typeof rows[number])[][] = [];
    rows.forEach((row, y) => {
      grid[y] ??= [];
      let x = 0;
      for (const cell of Array.from(row.querySelectorAll('th, td')).filter(c => c.closest('tr') === row)) {
        while (grid[y]![x]) x++;
        const height = Number(cell.getAttribute('rowspan') ?? 1), width = Number(cell.getAttribute('colspan') ?? 1);
        if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1 || height > 50 || width > 50) throw new Error('parse-error');
        for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
          grid[y + dy] ??= []; grid[y + dy]![x + dx] = cell;
        }
        x += width;
      }
    });
    if (grid.length > 100 || grid.some(row => row.length > 100)) throw new Error('parse-error');
    const dayColumns = new Map<number, number>(), periodColumns = new Map<number, number>();
    const dayRows = new Map<number, number>(), periodRows = new Map<number, number>();
    for (let y = 0; y < grid.length; y++) for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      const cell = grid[y]![x]!;
      if (!cell || cell.querySelector(definition.links)) continue;
      const day = weekday(cell.textContent ?? ''), p = period(cell.textContent ?? '');
      if (day) { if (y <= 1 && x > 0) dayColumns.set(x, day); if (x <= 1 && y > 0) dayRows.set(y, day); }
      if (p) { if (y <= 1 && x > 0) periodColumns.set(x, p); if (x <= 1 && y > 0) periodRows.set(y, p); }
    }
    if (!(dayColumns.size && periodRows.size) && !(dayRows.size && periodColumns.size)) continue;
    const horizontal = dayColumns.size * periodRows.size >= dayRows.size * periodColumns.size;
    recognized = true;
    for (let y = 0; y < grid.length; y++) for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      const cell = grid[y]![x];
      if (!cell) continue;
      const day = horizontal ? dayColumns.get(x) : dayRows.get(y), p = horizontal ? periodRows.get(y) : periodColumns.get(x);
      if (!day || !p) continue;
      let foundCourse = false;
      for (const link of cell.querySelectorAll(definition.links)) {
        let url: ReturnType<KulasisUrlParser>;
        try { url = parseUrl(link.getAttribute('href') ?? '', base + '/'); } catch { throw new Error('parse-error'); }
        if (!isKulasisOrigin(url.origin) || !url.pathname.endsWith('/support/top')) continue;
        if (!/^\/student\/(?:[a-z]+\/)*[a-z]+\/support\/top$/.test(url.pathname) || url.username || url.password) throw new Error('parse-error');
        const id = url.searchParams.get('no'), name = (link.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!id || id.length > 200 || !/^[\w-]+$/.test(id) || !name || name.length > 1000 || !isSafeMailText(name)) throw new Error('parse-error');
        const courseUrl = `${parseUrl(base).origin}${url.pathname}?no=${encodeURIComponent(id)}`;
        const course: Course = courses.get(id) ?? { courseId: id, name, slots: [], url: courseUrl, currentTerm: true };
        if (course.name !== name || course.url !== courseUrl) throw new Error('parse-error');
        if (!course.slots.some(s => s.weekday === day && s.period === p)) course.slots.push({ weekday: day, period: p } as CourseSlot);
        courses.set(id, course);
        foundCourse = true;
      }
      if (!foundCourse && !['', '-', '―', '—'].includes(normalize(cell.textContent ?? ''))) throw new Error('parse-error');
    }
  }
  if (!recognized || courses.size > 100) throw new Error('parse-error');
  return [...courses.values()];
}
export function readKulasisCourseCode(html: string, parseUrl: KulasisUrlParser): string | undefined {
  checkKulasisLogin(html);
  const { document } = parseHtmlTree(html);
  const codes = new Set<string>();
  for (const link of document.querySelectorAll('a[href]')) {
    try {
      const url = parseUrl(link.getAttribute('href') ?? '', KULASIS_ORIGIN);
      if (url.origin !== KULMS_ORIGIN || url.username || url.password || url.search || url.hash) continue;
      const match = /^\/direct\/courselink\/_kcd=([A-Za-z0-9_-]{1,100})$/.exec(url.pathname);
      if (match) codes.add(match[1]!);
    } catch { /* Unrelated links are not mappings. */ }
  }
  return codes.size === 1 ? [...codes][0] : undefined;
}
export function kulmsSiteFromUrl(value: string, parseUrl: KulasisUrlParser): string | undefined {
  try {
    const url = parseUrl(value);
    if (url.origin !== KULMS_ORIGIN || url.username || url.password || url.search || url.hash) return;
    const match = /^\/portal\/site\/([^/]+)\/?$/.exec(url.pathname);
    const id = match ? decodeURIComponent(match[1]!) : '';
    return id && id.length <= 200 && /^[\w-]+$/.test(id) ? id : undefined;
  } catch { return; }
}
