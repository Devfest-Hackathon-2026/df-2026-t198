import type { Observation } from '@kadai-hisho/core/ledger';

/** Invented data only; no saved LMS pages or real accounts. */
export function observation(n = 1): Observation {
  return {
    schemaVersion: 1, observationId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    system: 'demo-lms', definitionId: 'demo', definitionVersion: 1,
    fetchedAt: '2026-11-06T10:00:00+09:00',
    catalogCourses: [{ courseId: 'fictional/course', name: '架空の演習', slots: [{ weekday: 1, period: 2 }] }],
    courseResults: [{ courseId: 'fictional/course', listComplete: true, seenSourceIds: ['fictional/task'] }],
    assignments: [{ courseId: 'fictional/course', sourceId: 'fictional/task', title: '架空のレポート',
      url: 'https://example.invalid/tasks/1', submission: 'not-submitted',
      deadline: { kind: 'date', date: '2026-11-12', dueText: '11月12日', timeZone: 'Asia/Tokyo' } }],
    failures: [],
  };
}
