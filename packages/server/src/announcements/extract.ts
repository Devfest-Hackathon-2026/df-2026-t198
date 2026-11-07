export interface Announcement {
  announcementId: string;
  version: string;
  publishedAt: string;
  body: string;
}
export interface AssignmentCandidate {
  assignmentKey: string;
  title: string;
  officialDueAt: string | null;
}
export interface Usage { inputTokens: number; outputTokens: number; totalTokens: number }
export interface Proposal {
  announcementId: string;
  assignmentKey: string;
  proposedDueAt: string;
  quote: string;
  reason: string | null;
  announcementVersion: string;
}
export interface AnnouncementModel {
  generate(announcement: Announcement, candidates: readonly AssignmentCandidate[]): Promise<{ output: unknown; usage: Usage }>;
}
export class PublicDemoLimit extends Error {
  constructor() { super('public-demo-limit'); }
}
export type ExtractionResult =
  | { status: 'proposal'; proposal: Proposal; usage: Usage }
  | { status: 'abstained' | 'invalid-output'; usage: Usage }
  | { status: 'invalid-input' | 'model-error' | 'duplicate' | 'budget-limit' };

// Return false for calendar rollovers that Date.parse silently normalizes.
export function validInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, minute, s, , oh, om] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= days &&
    Number(h) < 24 && Number(minute) < 60 && Number(s) < 60 &&
    (oh === undefined || (Number(oh) <= 14 && Number(om) < 60 && (Number(oh) < 14 || Number(om) === 0))) &&
    Number.isFinite(Date.parse(value));
}
const bounded = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
function validInput(a: Announcement, candidates: readonly AssignmentCandidate[]) {
  return bounded(a.announcementId, 200) && bounded(a.version, 100) && bounded(a.body, 12000) &&
    validInstant(a.publishedAt) && candidates.length > 0 && candidates.length <= 50 &&
    new Set(candidates.map((c) => c.assignmentKey)).size === candidates.length &&
    candidates.every((c) => bounded(c.assignmentKey, 200) && bounded(c.title, 300) &&
      (c.officialDueAt === null || validInstant(c.officialDueAt)));
}
function validate(output: unknown, a: Announcement, candidates: readonly AssignmentCandidate[]): Omit<Proposal, 'announcementVersion'> | 'abstained' | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const v = output as Record<string, unknown>;
  const fields = ['announcementId', 'assignmentKey', 'proposedDueAt', 'quote', 'reason'];
  if (Object.keys(v).length !== fields.length || !fields.every((k) => Object.hasOwn(v, k)) ||
      v['announcementId'] !== a.announcementId || typeof v['quote'] !== 'string' || v['quote'].length > 300 ||
      (v['reason'] !== null && !bounded(v['reason'], 300))) return null;
  if (v['assignmentKey'] === null && v['proposedDueAt'] === null && bounded(v['reason'], 300)) {
    return v['quote'] === '' || a.body.includes(v['quote']) ? 'abstained' : null;
  }
  if (!candidates.some((c) => c.assignmentKey === v['assignmentKey']) || !validInstant(v['proposedDueAt']) ||
      !v['quote'].trim() || !a.body.includes(v['quote'])) return null;
  return v as unknown as Omit<Proposal, 'announcementVersion'>;
}

// One instance per trusted owner/course scope. A durable atomic claim is required when connecting the ledger.
// No HTTP route or official-deadline writer is exposed here.
export function createAnnouncementExtractor(model: AnnouncementModel, claim?: (id: string, version: string) => Promise<boolean>) {
  const seen = new Set<string>();
  return {
    async extract(a: Announcement, candidates: readonly AssignmentCandidate[]): Promise<ExtractionResult> {
      if (!validInput(a, candidates)) return { status: 'invalid-input' };
      const key = JSON.stringify([a.announcementId, a.version]);
      if (seen.has(key)) return { status: 'duplicate' };
      seen.add(key);
      try {
        if (claim && !await claim(a.announcementId, a.version)) return { status: 'duplicate' };
        const { output, usage } = await model.generate(a, candidates);
        const result = validate(output, a, candidates);
        if (result === null) return { status: 'invalid-output', usage };
        if (result === 'abstained') return { status: 'abstained', usage };
        return { status: 'proposal', proposal: { ...result, announcementVersion: a.version }, usage };
      } catch (error) {
        if (error instanceof PublicDemoLimit) throw error;
        if (error instanceof Error && error.message === 'budget-limit') return { status: 'budget-limit' };
        // Upstream exceptions can contain the entire request, credentials or response; do not expose them.
        return { status: 'model-error' };
      }
    },
  };
}
