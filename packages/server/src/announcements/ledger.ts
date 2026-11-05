import type { LedgerAssignment } from '@kadai-hisho/core/ledger';
import { createAnnouncementExtractor } from './extract.js';
import type { Announcement } from './extract.js';

/** Caller supplies the authenticated owner's ledger; this function does not persist or expose an API. */
export async function applyAnnouncementReview(current: readonly LedgerAssignment[],
  system: LedgerAssignment['key']['system'], courseId: string, announcement: Announcement,
  extractor: ReturnType<typeof createAnnouncementExtractor>) {
  const scoped = current.filter((a) => a.key.system === system && a.latest.courseId === courseId && a.presenceState !== 'cancelled');
  const key = (a: LedgerAssignment) => JSON.stringify([a.key.system, a.key.sourceId]);
  const candidates = scoped.map((a) => ({ assignmentKey: key(a), title: a.latest.title,
    officialDueAt: a.officialDeadline?.deadline.kind === 'datetime' ? a.officialDeadline.deadline.dueAt : null }));
  const extraction = await extractor.extract(announcement, candidates);
  if (extraction.status !== 'proposal') return { assignments: [...current], extraction };
  const p = extraction.proposal;
  const detail = `${p.announcementId} (${p.announcementVersion}): ${p.proposedDueAt} / ${p.quote}`;
  const assignments = current.map((a) => candidates.some((c) => c.assignmentKey === key(a)) && key(a) === p.assignmentKey &&
    !a.reviewReasons.some((r) => r.kind === 'conflicting-deadline' && r.detail === detail)
    ? { ...a, reviewReasons: [...a.reviewReasons, { kind: 'conflicting-deadline' as const, detail }] } : a);
  return { assignments, extraction };
}
