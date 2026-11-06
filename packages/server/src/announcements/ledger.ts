import type { LedgerAssignment } from '@kadai-hisho/core/ledger';
import { createAnnouncementExtractor } from './extract.js';
import type { Announcement, Proposal } from './extract.js';

const key = (a: LedgerAssignment) => JSON.stringify([a.key.system, a.key.sourceId]);
export function announcementCandidates(current: readonly LedgerAssignment[], system: LedgerAssignment['key']['system'], courseId: string) {
  return current.filter(a => a.key.system === system && a.latest.courseId === courseId && a.presenceState !== 'cancelled')
    .map(a => ({ assignmentKey: key(a), title: a.latest.title,
      officialDueAt: a.officialDeadline?.deadline.kind === 'datetime' ? a.officialDeadline.deadline.dueAt : null }));
}
export function announcementReviewReason(p: Proposal) {
  // Quotes can contain the entire announcement. Persist only its reference and proposed instant.
  return { kind: 'conflicting-deadline' as const, detail: `${p.announcementId} (${p.announcementVersion}): ${p.proposedDueAt}` };
}

/** Caller supplies the authenticated owner's ledger; this function does not persist or expose an API. */
export async function applyAnnouncementReview(current: readonly LedgerAssignment[],
  system: LedgerAssignment['key']['system'], courseId: string, announcement: Announcement,
  extractor: ReturnType<typeof createAnnouncementExtractor>) {
  const candidates = announcementCandidates(current, system, courseId);
  const extraction = await extractor.extract(announcement, candidates);
  if (extraction.status !== 'proposal') return { assignments: [...current], extraction };
  const p = extraction.proposal;
  const reason = announcementReviewReason(p);
  const assignments = current.map((a) => candidates.some((c) => c.assignmentKey === key(a)) && key(a) === p.assignmentKey &&
    !a.reviewReasons.some((r) => r.kind === reason.kind && r.detail === reason.detail)
    ? { ...a, reviewReasons: [...a.reviewReasons, reason] } : a);
  return { assignments, extraction };
}
