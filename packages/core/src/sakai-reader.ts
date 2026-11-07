import type { Assignment, Course, Submission } from './types.js';
import { isSafeMailText } from './mail-safety.js';

/** JSON field names only; navigation and executable transforms are not configurable. */
export interface SakaiReadingDefinition {
  schemaVersion: number;
  format: string;
  definitionId: string;
  version: number;
  site: { collection: string; id: string; name: string };
  assignment: { collection: string; id: string; courseId: string; title: string;
    deadline: string; deadlineText: string; submissions: string };
  instant: { seconds: string; nanoseconds: string };
}
export const KULMS_ORIGIN = 'https://lms.gakusei.kyoto-u.ac.jp';
export function sakaiRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('parse-error');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || !isSafeMailText(value)) throw new Error('parse-error');
  return value;
}
export function sakaiId(value: unknown): string { return text(value, 200); }
export function sakaiCollection(value: unknown, key: string): unknown[] {
  const list = sakaiRecord(value)[key];
  if (!Array.isArray(list)) throw new Error('parse-error');
  return list;
}
export function sakaiInstant(value: unknown, fields = { seconds: 'epochSecond', nanoseconds: 'nano' }): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = sakaiRecord(value), seconds = record[fields.seconds], nano = record[fields.nanoseconds];
  // A millisecond timestamp must not be silently accepted as seconds.
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253402300799
    || typeof nano !== 'number' || !Number.isInteger(nano) || nano < 0 || nano >= 1e9) return undefined;
  return new Date(seconds * 1000 + Math.floor(nano / 1e6)).toISOString();
}
const courseUrl = (id: string) => `${KULMS_ORIGIN}/portal/site/${encodeURIComponent(id)}`;
export function readSakaiCourse(definition: SakaiReadingDefinition, value: unknown): Course {
  const row = sakaiRecord(value), courseId = sakaiId(row[definition.site.id]);
  return { courseId, name: text(row[definition.site.name]), slots: [], url: courseUrl(courseId) };
}
function ownSubmission(value: unknown, userId: string): { submission: Submission; submittedAt?: string } {
  if (!Array.isArray(value)) return { submission: 'unknown' };
  const own = value.filter(item => {
    if (!item || typeof item !== 'object') return false;
    const submitters = sakaiRecord(item)['submitters'];
    return Array.isArray(submitters) && submitters.some(s => s && typeof s === 'object' && sakaiRecord(s)['id'] === userId);
  });
  if (own.length !== 1) return { submission: 'unknown' };
  const row = sakaiRecord(own[0]);
  if (typeof row['submitted'] !== 'boolean') return { submission: 'unknown' };
  if (row['submitted'] === true) {
    if (row['draft'] === true) return { submission: 'unknown' };
    const submittedAt = sakaiInstant({ epochSecond: row['dateSubmittedEpochSeconds'], nano: 0 });
    return { submission: 'submitted', ...(submittedAt ? { submittedAt } : {}) };
  }
  return { submission: 'not-submitted' };
}
export function readSakaiAssignment(definition: SakaiReadingDefinition, value: unknown, courseId: string, userId: string): Assignment {
  const row = sakaiRecord(value), fields = definition.assignment;
  if (sakaiId(row[fields.courseId]) !== courseId) throw new Error('parse-error');
  const dueAt = sakaiInstant(row[fields.deadline], definition.instant);
  const rawText = row[fields.deadlineText];
  const dueText = rawText == null || rawText === '' ? '' : text(rawText);
  return { sourceId: sakaiId(row[fields.id]), courseId, title: text(row[fields.title]), url: courseUrl(courseId),
    deadline: { ...(dueAt ? { kind: 'datetime', dueAt } as const : { kind: 'unreadable' } as const), dueText, timeZone: 'Asia/Tokyo' },
    ...ownSubmission(row[fields.submissions], userId) };
}
