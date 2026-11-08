import type { SessionContext } from '@kadai-hisho/core/ledger';

export class InvalidSessionContext extends Error {
  constructor() { super('invalid-session-context'); }
}
function validTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10) &&
    Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60 &&
    (value.endsWith('Z') || (Number(value.slice(-5, -3)) < 24 && Number(value.slice(-2)) < 60));
}
export function parseSessionContext(value: unknown): SessionContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidSessionContext();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'lastSessionAt') ||
    !Object.hasOwn(input, 'nextSessionAt') || !validTimestamp(input['lastSessionAt']) ||
    !validTimestamp(input['nextSessionAt'])) throw new InvalidSessionContext();
  return { lastSessionAt: input['lastSessionAt'], nextSessionAt: input['nextSessionAt'] };
}
