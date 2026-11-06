import type { DemoData } from '@kadai-hisho/core/ledger';

/** The same fictional scenario as the demo account setup, dated from this run. */
export function initialDemo(now: number) {
  // Shift to the Japanese calendar date before choosing 17:00 JST (08:00 UTC).
  const due = new Date(now + 9 * 3600_000 + 3 * 86400_000);
  due.setUTCHours(8, 0, 0, 0);
  const data: DemoData = { announcements: [], courses: [
    { courseId: 'DEMO101', name: '架空の観察入門', teacher: '架空の先生A', weekday: 1, period: 2, assignments: [
      { sourceId: 'DEMO101_TASK1', title: '架空の観察ノート', dueAt: due.toISOString(), submission: 'not-submitted' },
      { sourceId: 'DEMO101_TASK2', title: '架空の振り返り', dueAt: due.toISOString(), submission: 'submitted' },
    ] },
    { courseId: 'DEMO202', name: '架空の表現演習', teacher: '架空の先生B', weekday: 4, period: 4, assignments: [] },
  ] };
  return { data, context: {
    lastSessionAt: new Date(now - 7 * 86400_000).toISOString(),
    nextSessionAt: new Date(now + 7 * 86400_000).toISOString(),
  } };
}
