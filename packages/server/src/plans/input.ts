import type { PreparationPlanInput } from '@kadai-hisho/core';

export class InvalidPlan extends Error {}
export function validPlanId(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}
export function parsePlan(value: unknown): PreparationPlanInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidPlan();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== 'assignment,date,endsAt,period,startsAt') throw new InvalidPlan();
  const key = body['assignment'];
  if (!key || typeof key !== 'object' || Array.isArray(key) || Object.keys(key).sort().join(',') !== 'sourceId,system') throw new InvalidPlan();
  const assignment = key as Record<string, unknown>;
  if (!['demo-lms', 'ynu-lms', 'kulms', 'kulasis'].includes(String(assignment['system'])) ||
    typeof assignment['sourceId'] !== 'string' || !assignment['sourceId'].length || assignment['sourceId'].length > 256 ||
    [...assignment['sourceId']].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new InvalidPlan();
  const date = body['date'];
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    !Number.isInteger(body['period']) || Number(body['period']) < 1 || Number(body['period']) > 24) throw new InvalidPlan();
  for (const time of [body['startsAt'], body['endsAt']]) {
    if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00\+09:00$/.test(time) || time.slice(0, 10) !== date) throw new InvalidPlan();
  }
  if (Date.parse(String(body['startsAt'])) >= Date.parse(String(body['endsAt']))) throw new InvalidPlan();
  return body as unknown as PreparationPlanInput;
}
