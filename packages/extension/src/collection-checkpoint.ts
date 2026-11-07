import type { Observation } from '../../core/src/types.js';

export interface CompletedCourse {
  result: Observation['courseResults'][number];
  assignments: Observation['assignments'];
  failures: Observation['failures'];
  fetchedAt: string;
}
export interface CollectionCheckpoint {
  sessionHash: string;
  uid: string;
  courses: CompletedCourse[];
}

export async function sessionHash(sid: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sid));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Session storage is extension-only. Reject stale, sent, or incomplete progress. */
export function reusableCheckpoint(checkpoint: CollectionCheckpoint, hash: string, completedAt: unknown): boolean {
  return checkpoint.sessionHash === hash && Array.isArray(checkpoint.courses) && checkpoint.courses.length > 0
    && checkpoint.courses.every(course => {
      const at = Date.parse(course.fetchedAt), age = Date.now() - at;
      return course.result.listComplete && Number.isFinite(at) && age >= 0 && age <= 30 * 60_000
        && !(typeof completedAt === 'number' && completedAt >= at);
    });
}
