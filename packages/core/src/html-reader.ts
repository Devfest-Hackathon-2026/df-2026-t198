import type { TreeElement } from 'linkedom/worker';
import { htmlAttribute, parseHtmlTree } from './html-tree.js';
import { validateDefinition, type Marker, type Pattern, type ReadingDefinition, type ValueRule } from './definition.js';
import type { PageReading, ReadAssignment, ReadCourse, ReadingContext } from './reading-types.js';

const tidy = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const fail = (): never => { throw new Error('unreadable-page'); };

/** Parameters are literal strings, never regular expressions or executable handlers. */
function extract(text: string, pattern: Pattern): string | null {
  switch (pattern.type) {
    case 'prefixed-id':
      return text.startsWith(pattern.prefix) && /^[0-9]+$/.test(text.slice(pattern.prefix.length)) ? text : null;
    case 'after-label': {
      if (!text.startsWith(pattern.label)) return null;
      const suffix = text.slice(pattern.label.length);
      return /^\s+\S/u.test(suffix) ? suffix.trim() : null;
    }
    case 'number-between': {
      const normalized = text.normalize('NFKC');
      const before = pattern.before.normalize('NFKC'), after = pattern.after.normalize('NFKC');
      const start = normalized.indexOf(before);
      if (start < 0) return null;
      const suffix = normalized.slice(start + before.length);
      const digits = /^[0-9]+/.exec(suffix)?.[0];
      return digits && suffix.slice(digits.length).startsWith(after) ? digits : null;
    }
    case 'call-argument': {
      const match = /^([A-Za-z_$][A-Za-z0-9_$]*)\(\s*(['"])([A-Za-z0-9_-]{1,128})\2\s*\)\s*;?$/.exec(text);
      return match?.[1] === pattern.name ? match[3]! : null;
    }
  }
}

function value(root: TreeElement, rule: ValueRule): string | null {
  const scope = rule.ancestor ? root.closest(rule.ancestor) : root;
  if (!scope) return null;
  const nodes = scope.querySelectorAll(rule.selector);
  if (nodes.length !== 1) return null;
  const node = nodes[0]!;
  const raw = rule.attribute ? htmlAttribute(node, rule.attribute) : node.textContent;
  if (raw === null) return null;
  let text: string | null = tidy(raw);
  const steps = rule.pattern === undefined ? [] : Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern];
  for (const step of steps) {
    text = extract(text, step);
    if (text === null) break;
  }
  return text;
}
function required(root: TreeElement, rule: ValueRule): string {
  return value(root, rule) || fail();
}
function has(root: TreeElement, marker: Marker | null): boolean {
  return marker !== null && Array.from(root.querySelectorAll(marker.selector)).some((node) =>
    marker.text === undefined || tidy(node.textContent ?? '') === marker.text);
}
function contextId(context: ReadingContext, key: 'courseId' | 'sourceId'): string {
  const id = context[key];
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('missing-reading-context');
  return id;
}

/** No locale/date-string guessing: one allowed format, calendar validation, caller's offset. */
export function parseDeadline(text: string, utcOffset: string): string | null {
  if (!/^[+-](?:0[0-9]|1[0-3]):[0-5][0-9]$|^[+-]14:00$/.test(utcOffset)) {
    throw new Error('invalid-utc-offset');
  }
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) \([月火水木金土日]\) (\d{2}):(\d{2}) まで$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]!
    || Number(hour) > 24 || Number(minute) > 59 || (hour === '24' && minute !== '00')) return null;
  if (hour === '24') {
    const next = new Date(`${year}-${month}-${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (next.getUTCFullYear() > 9999) return null;
    return `${next.toISOString().slice(0, 10)}T00:00:00${utcOffset}`;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:00${utcOffset}`;
}
function readCourses(root: TreeElement, d: ReadingDefinition): PageReading {
  const courses = new Map<string, ReadCourse>();
  const rows = Array.from(root.querySelectorAll(d.courses.rows));
  if (!rows.length && !has(root, d.pageChecks.home.empty)) fail();
  for (const row of rows) {
    const courseId = required(row, d.courses.courseId);
    const name = required(row, d.courses.name), teacher = required(row, d.courses.teacher);
    const day = required(row, d.courses.day);
    if (!Object.hasOwn(d.transforms.weekdays, day)) fail();
    const dayOfWeek = d.transforms.weekdays[day];
    const periodText = value(row, d.courses.period);
    const period = Number(periodText);
    if (dayOfWeek !== null && (!Number.isSafeInteger(period) || period < 1)) fail();
    if (dayOfWeek === null && periodText !== null) fail();
    const course = courses.get(courseId) ?? { courseId, name, teacher, slots: [] };
    if (course.name !== name || course.teacher !== teacher) fail();
    if (dayOfWeek !== null && dayOfWeek !== undefined
      && !course.slots.some((s) => s.dayOfWeek === dayOfWeek && s.period === period)) {
      course.slots.push({ dayOfWeek, period });
    }
    courses.set(courseId, course);
  }
  return { pageType: 'home', courses: [...courses.values()], assignments: [] };
}
function submission(status: string, d: ReadingDefinition): ReadAssignment['submission'] {
  return Object.hasOwn(d.transforms.submission, status) ? d.transforms.submission[status]! : 'unknown';
}
function readMaterials(root: TreeElement, d: ReadingDefinition, context: ReadingContext): PageReading {
  const courseId = contextId(context, 'courseId');
  const rows = Array.from(root.querySelectorAll(d.materials.rows));
  if (!rows.length && !has(root, d.pageChecks.materials.empty)) fail();
  const ids = new Set<string>();
  const assignments = rows.map((row): ReadAssignment => {
    const sourceId = required(row, d.materials.sourceId);
    if (ids.has(sourceId)) fail();
    ids.add(sourceId);
    const statusText = required(row, d.materials.status);
    return { sourceId, courseId, title: required(row, d.materials.title),
      dueText: null, dueAt: null, submission: submission(statusText, d), statusText,
      availabilityText: required(row, d.materials.availability) };
  });
  return { pageType: 'materials', courseId, assignments };
}
function readDetail(root: TreeElement, d: ReadingDefinition, context: ReadingContext): PageReading {
  const dueText = value(root, d.assignmentDetail.due);
  const statusText = required(root, d.assignmentDetail.status);
  return { pageType: 'assignment-detail', assignments: [{
    sourceId: contextId(context, 'sourceId'), courseId: contextId(context, 'courseId'),
    title: required(root, d.assignmentDetail.title), dueText,
    dueAt: dueText ? parseDeadline(dueText, context.utcOffset) : null,
    statusText, submission: submission(statusText, d),
  }] };
}

/** Pure reading only: does not evaluate handlers, follow links, or infer list completion. */
export function readPage(definition: unknown, html: string, context: ReadingContext): PageReading {
  const d = validateDefinition(definition);
  // Bound parser input; exceptions never include the supplied HTML/selector/context.
  if (typeof html !== 'string' || html.length > 5_000_000) throw new Error('invalid-html');
  try {
    const { document } = parseHtmlTree(html);
    if (has(document, d.pageChecks.loggedOut)) throw new Error('not-logged-in');
    if (d.pageChecks.loggedIn && !has(document, d.pageChecks.loggedIn)) fail();
    const kinds = (['home', 'materials', 'assignmentDetail'] as const).filter((kind) =>
      d.pageChecks[kind].present.every((marker) => has(document, marker)));
    if (kinds.length !== 1) fail();
    switch (kinds[0]) {
      case 'home': return readCourses(document, d);
      case 'materials': return readMaterials(document, d, context);
      case 'assignmentDetail': return readDetail(document, d, context);
      default: return fail();
    }
  } catch (error) {
    const allowed = ['unreadable-page', 'not-logged-in', 'missing-reading-context', 'invalid-utc-offset'];
    if (error instanceof Error && allowed.includes(error.message)) throw error;
    // The parser cause can contain private HTML or selectors; retain only a fixed code.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('unreadable-page');
  }
}
