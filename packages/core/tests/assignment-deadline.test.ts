import { expect, it } from 'vitest';
import { assignmentDeadline } from '../src/assignment-deadline.js';
import type { Deadline, LedgerAssignment, ManualAssignmentInput } from '../src/types.js';

const input: ManualAssignmentInput = { title: '架空の課題', date: '2026-11-10', time: null, course: null, memo: '' };
const known: Deadline = { kind: 'datetime', dueAt: '2026-11-10T08:00:00Z', timeZone: 'Asia/Tokyo', dueText: '11月10日17時' };
it('returns the verified LMS deadline even when the latest read failed', () => {
  const row = { officialDeadline: { deadline: known }, latest: { deadline: { kind: 'unreadable' } } } as LedgerAssignment;
  expect(assignmentDeadline(row)).toEqual(known);
  expect(assignmentDeadline({ ...row, officialDeadline: null })).toBeUndefined();
});
it('returns manual dates without inventing a time and preserves Japan time when supplied', () => {
  expect(assignmentDeadline(input)).toMatchObject({ kind: 'date', date: '2026-11-10', timeZone: 'Asia/Tokyo' });
  expect(assignmentDeadline({ ...input, time: '17:00' })).toMatchObject({ kind: 'datetime', dueAt: '2026-11-10T17:00:00+09:00' });
});
