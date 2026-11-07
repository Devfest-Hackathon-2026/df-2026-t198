import type { ManualAssignmentInput } from '@kadai-hisho/core';
export class InvalidManualAssignment extends Error {}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max &&
    (min === 0 || value.trim().length > 0) && ![...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
export function parseManualAssignment(value: unknown): ManualAssignmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidManualAssignment();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== 'course,date,memo,time,title' ||
    !text(body['title'], 1, 160) || !text(body['memo'], 0, 300)) throw new InvalidManualAssignment();
  const date = body['date'];
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new InvalidManualAssignment();
  if (body['time'] !== null && (typeof body['time'] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body['time']))) throw new InvalidManualAssignment();
  const course = body['course'];
  if (course !== null) {
    if (!course || typeof course !== 'object' || Array.isArray(course) || Object.keys(course).sort().join(',') !== 'courseId,system') throw new InvalidManualAssignment();
    const key = course as Record<string, unknown>;
    if (!['demo-lms', 'ynu-lms', 'kulms', 'kulasis'].includes(String(key['system'])) || !text(key['courseId'], 1, 256)) throw new InvalidManualAssignment();
  }
  return { title: body['title'], date, time: body['time'] as string | null,
    course: course as ManualAssignmentInput['course'], memo: body['memo'] };
}
