import { expect, it, vi } from 'vitest';
import { applyObservation } from '@kadai-hisho/core/ledger';
import { applyAnnouncementReview } from '../src/announcements/ledger.js';
import type { Announcement, AssignmentCandidate } from '../src/announcements/extract.js';
import { createAnnouncementExtractor } from '../src/announcements/extract.js';
import { observation } from './observation-fixture.js';
it('adds a conflicting-deadline review only to the course candidate, preserving all official facts', async () => {
  const input = observation();
  const rows = applyObservation([], input, input.fetchedAt).assignments;
  const before = structuredClone(rows);
  const notice = { announcementId: 'fictional-notice', version: '1', publishedAt: input.fetchedAt,
    body: '締切は2026年11月30日17:00（日本時間）に延長します。' };
  const generate = vi.fn(async (_a: Announcement, candidates: readonly AssignmentCandidate[]) => ({ output: { announcementId: notice.announcementId,
    assignmentKey: candidates[0]!.assignmentKey, proposedDueAt: '2026-11-30T17:00:00+09:00', quote: notice.body, reason: null },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }));
  const result = await applyAnnouncementReview(rows, input.system, rows[0]!.latest.courseId, notice, createAnnouncementExtractor({ generate }));
  expect(rows).toEqual(before);
  expect(result.assignments[0]).toMatchObject({ officialDeadline: before[0]!.officialDeadline,
    reviewReasons: [{ kind: 'conflicting-deadline', detail: expect.stringContaining('2026-11-30T17:00:00+09:00') }] });
  expect(result.assignments[0]!.latest).toEqual(before[0]!.latest);
  expect((await applyAnnouncementReview(rows, input.system, 'other-course', notice, createAnnouncementExtractor({ generate }))).assignments).toEqual(rows);
  expect(generate).toHaveBeenCalledTimes(1);
});
