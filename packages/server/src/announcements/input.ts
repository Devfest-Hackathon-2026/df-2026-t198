import type { Observation } from '@kadai-hisho/core/ledger';
import { validInstant, type Announcement } from './extract.js';

export interface AnnouncementInput {
  system: Observation['system'];
  courseId: string;
  announcement: Announcement;
}
export class InvalidAnnouncement extends Error {
  constructor() { super('invalid-announcement'); }
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new InvalidAnnouncement();
}
function record(value: unknown, fields: string[]) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  const object = value as Record<string, unknown>;
  check(Object.keys(object).length === fields.length && fields.every(k => Object.hasOwn(object, k)));
  return object;
}
function text(value: unknown, max: number) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max);
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    check(!/\b(?:sid|jsessionid|session[_-]?id|cookie|authorization|(?:access|refresh|id)[_-]?token)\s*[:=]|\bbearer\s+\S+/i.test(decoded));
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return;
      decoded = next;
    } catch { return; }
  }
  throw new InvalidAnnouncement();
}
export function parseAnnouncement(value: unknown): AnnouncementInput {
  const input = record(value, ['system', 'courseId', 'announcement']);
  check(typeof input['system'] === 'string' && ['ynu-lms', 'kulms', 'kulasis', 'demo-lms'].includes(input['system']));
  text(input['courseId'], 200);
  const a = record(input['announcement'], ['announcementId', 'version', 'publishedAt', 'body']);
  text(a['announcementId'], 200); text(a['version'], 100); text(a['body'], 12000);
  check(validInstant(a['publishedAt']));
  return input as unknown as AnnouncementInput;
}
