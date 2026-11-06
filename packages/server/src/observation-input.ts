import type { Observation } from '@kadai-hisho/core/ledger';

export class InvalidObservation extends Error {
  constructor() { super('invalid-observation'); }
}
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new InvalidObservation();
}
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value));
  const object = value as Record<string, unknown>;
  requireValid(required.every(k => Object.hasOwn(object, k)) &&
    Object.keys(object).every(k => required.includes(k) || optional.includes(k)));
  return object;
}
function text(value: unknown, max = 1000, empty = false): asserts value is string {
  requireValid(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0));
  // Reject credential-bearing text, including escaped URL parameters, before persistence.
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    requireValid(!/\b(?:sid|jsessionid|session[_-]?id|cookie|authorization|(?:access|refresh|id)[_-]?token)\s*[:=]|\bbearer\s+\S+/i.test(decoded));
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return;
      decoded = next;
    } catch { return; }
  }
  // Do not accept deeper escaping that could conceal a credential marker.
  throw new InvalidObservation();
}
function list(value: unknown, max = 200): unknown[] {
  requireValid(Array.isArray(value) && value.length <= max);
  return value;
}
function date(value: unknown): asserts value is string {
  text(value, 10);
  requireValid(/^\d{4}-\d{2}-\d{2}$/.test(value));
  const parsed = new Date(`${value}T00:00:00Z`);
  requireValid(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value);
}
function timestamp(value: unknown) {
  text(value, 40);
  requireValid(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  date(value.slice(0, 10));
  requireValid(Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60);
}
function id(value: unknown): asserts value is string { text(value, 200); }
function unique(values: unknown[]) { requireValid(new Set(values).size === values.length); }
function oneOf(value: unknown, choices: readonly string[]) {
  requireValid(typeof value === 'string' && choices.includes(value));
}

function referenceUrl(value: unknown) {
  text(value, 2048);
  try {
    const url = new URL(value);
    requireValid(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash);
    for (const key of url.searchParams.keys()) {
      requireValid(!/(?:sid|session|cookie|token|auth|password|secret|api[_-]?key)/i.test(key));
    }
  } catch { throw new InvalidObservation(); }
}

function deadline(value: unknown) {
  const base = record(value, ['kind', 'dueText', 'timeZone'], ['dueAt', 'date']);
  text(base['dueText'], 1000, true);
  text(base['timeZone'], 100);
  try { new Intl.DateTimeFormat('en', { timeZone: base['timeZone'] }); }
  catch { throw new InvalidObservation(); }
  const common = ['kind', 'dueText', 'timeZone'];
  switch (base['kind']) {
    case 'datetime': record(value, [...common, 'dueAt']); timestamp(base['dueAt']); break;
    case 'date': record(value, [...common, 'date']); date(base['date']); break;
    case 'none': case 'unreadable': record(value, common); break;
    default: throw new InvalidObservation();
  }
}

/** Strict wire contract: unknown properties are rejected, never silently stored. */
export function parseObservation(value: unknown): Observation {
  const input = record(value, ['schemaVersion', 'observationId', 'system', 'definitionId',
    'definitionVersion', 'fetchedAt', 'catalogCourses', 'courseResults', 'assignments', 'failures']);
  requireValid(input['schemaVersion'] === 1);
  text(input['observationId'], 36);
  requireValid(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input['observationId']));
  oneOf(input['system'], ['ynu-lms', 'panda', 'demo-lms']);
  id(input['definitionId']);
  requireValid(Number.isSafeInteger(input['definitionVersion']) && Number(input['definitionVersion']) > 0);
  timestamp(input['fetchedAt']);
  const pastCourses = new Set<string>();
  const courseIds = list(input['catalogCourses'], 100).map(value => {
    const course = record(value, ['courseId', 'name', 'slots'], ['url', 'currentTerm']);
    id(course['courseId']); text(course['name']);
    if (Object.hasOwn(course, 'currentTerm')) {
      requireValid(typeof course['currentTerm'] === 'boolean');
      if (course['currentTerm'] === false) pastCourses.add(course['courseId']);
    }
    if (Object.hasOwn(course, 'url')) referenceUrl(course['url']);
    for (const value of list(course['slots'], 50)) {
      const slot = record(value, ['weekday', 'period']);
      requireValid(Number.isInteger(slot['weekday']) && Number(slot['weekday']) >= 1 && Number(slot['weekday']) <= 7);
      requireValid(Number.isSafeInteger(slot['period']) && Number(slot['period']) >= 1 && Number(slot['period']) <= 24);
    }
    return course['courseId'];
  });
  unique(courseIds);
  const seen = new Map<string, string>();
  const ended = new Set<string>();
  const results = list(input['courseResults'], 100).map(value => {
    const result = record(value, ['courseId', 'listComplete', 'seenSourceIds'], ['endedSourceIds']);
    id(result['courseId']);
    requireValid(courseIds.includes(result['courseId']) && !pastCourses.has(result['courseId']) && typeof result['listComplete'] === 'boolean');
    for (const source of list(result['seenSourceIds'], 1000)) {
      id(source); requireValid(!seen.has(source)); seen.set(source, result['courseId']);
    }
    if (Object.hasOwn(result, 'endedSourceIds')) {
      for (const source of list(result['endedSourceIds'], 1000)) {
        id(source);
        requireValid(seen.get(source) === result['courseId'] && !ended.has(source));
        ended.add(source);
      }
    }
    return result['courseId'];
  });
  unique(results);
  const sources = list(input['assignments']).map(value => {
    const assignment = record(value, ['sourceId', 'courseId', 'title', 'url', 'deadline', 'submission'], ['submittedAt']);
    id(assignment['sourceId']); id(assignment['courseId']); text(assignment['title']);
    requireValid(seen.get(assignment['sourceId']) === assignment['courseId'] && !ended.has(assignment['sourceId']));
    referenceUrl(assignment['url']);
    deadline(assignment['deadline']);
    oneOf(assignment['submission'], ['submitted', 'not-submitted', 'unknown']);
    if (Object.hasOwn(assignment, 'submittedAt')) {
      requireValid(assignment['submission'] === 'submitted'); timestamp(assignment['submittedAt']);
    }
    return assignment['sourceId'];
  });
  unique(sources);
  for (const value of list(input['failures'])) {
    const failure = record(value, ['courseId', 'kind', 'detail']);
    requireValid(failure['courseId'] === null ||
      (typeof failure['courseId'] === 'string' && courseIds.includes(failure['courseId'])));
    oneOf(failure['kind'], ['not-logged-in', 'http', 'parse']);
    oneOf(failure['detail'], ['not-logged-in', 'http-error', 'parse-error', 'list-incomplete', 'detail-unavailable']);
  }
  return structuredClone(input) as unknown as Observation;
}
