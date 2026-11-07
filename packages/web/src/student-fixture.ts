import type { Deadline, LedgerAssignment } from '../../core/src/types';
import type { StudentData } from './student-data';

export function assignment(id: string, deadline: Deadline, patch: Partial<LedgerAssignment> = {}): LedgerAssignment {
  return {
    key: { system: 'demo-lms', sourceId: id },
    latest: { sourceId: id, courseId: 'math', title: id, url: 'https://example.invalid/task', deadline, submission: 'not-submitted' },
    officialDeadline: { deadline, url: 'https://example.invalid/task', fetchedAt: '2026-11-06T09:00:00+09:00', observationId: 'sample' },
    preparationStartsAt: null, submission: 'not-submitted', submittedAt: null, presenceState: 'active',
    consecutiveMissingCount: 0, lastSeenObservationId: 'sample', lastSeenAt: '2026-11-06T09:00:00+09:00', reviewReasons: [], ...patch,
  };
}
export const dated = (date: string): Deadline => ({ kind: 'date', date, dueText: `${date}まで`, timeZone: 'Asia/Tokyo' });
export function studentFixture(): StudentData {
  return {
    online: true,
    plans: [],
    manualAssignments: [],
    courses: [
      { system: 'demo-lms', courseId: 'math', name: '架空の線形代数', url: 'https://example.invalid/course?id=math', slots: [{ weekday: 1, period: 2 }, { weekday: 3, period: 2 }] },
      { system: 'panda', courseId: 'math', name: '架空の別大学の授業', slots: [{ weekday: 7, period: 6 }] },
      { system: 'demo-lms', courseId: 'other', name: '架空の集中講義', slots: [] },
    ],
    assignments: [assignment('レポートB', dated('2026-11-12')), assignment('レポートA', dated('2026-11-10'), {
      reviewReasons: [{ kind: 'unreadable-deadline', detail: '' }],
    }), assignment('提出した課題', dated('2026-11-07'), { submission: 'submitted' }),
    assignment('取り消した課題', dated('2026-11-08'), { presenceState: 'cancelled' })],
    fetchStates: [{ studentId: 'sample', system: 'demo-lms', lastAttemptedAt: '2026-11-06T09:00:00+09:00',
      lastSucceededAt: '2026-11-01T09:00:00+09:00', lastFailureKind: null, lastResult: 'success', lastAppliedObservationId: 'sample' }],
  };
}
