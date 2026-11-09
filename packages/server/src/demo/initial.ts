import type { DemoData } from '@kadai-hisho/core/ledger';

export const demoStudentDisplayName = '田中 太郎';

/** The same fictional scenario as the demo account setup, dated from this run. */
export function initialDemo(now: number) {
  // Shift to the Japanese calendar date before choosing 17:00 JST (08:00 UTC).
  const due = new Date(now + 9 * 3600_000 + 3 * 86400_000);
  due.setUTCHours(8, 0, 0, 0);
  const data: DemoData = { announcements: [], courses: [
    { courseId: 'DEMO101', name: '文章表現', teacher: '森 先生', weekday: 1, period: 2, assignments: [
      { sourceId: 'DEMO101_TASK1', title: '第3回レポート（要約と引用）', dueAt: due.toISOString(), submission: 'not-submitted' },
      { sourceId: 'DEMO101_TASK2', title: '第3回 ふりかえり', dueAt: due.toISOString(), submission: 'submitted' },
    ] },
    { courseId: 'DEMO202', name: '生物学実験', teacher: '草野 先生', weekday: 4, period: 4, assignments: [] },
    { courseId: 'DEMO303', name: '線形代数', teacher: '安藤 先生', weekday: 2, period: 1, assignments: [
      { sourceId: 'DEMO303_TASK1', title: '第5回 小テスト', dueAt: new Date(due.getTime() + 7 * 86400_000).toISOString(), submission: 'not-submitted' },
    ] },
    { courseId: 'DEMO404', name: '経済学入門', teacher: '大盛 先生', weekday: 3, period: 3, assignments: [
      { sourceId: 'DEMO404_TASK1', title: '第2回 確認問題', dueAt: due.toISOString(), submission: 'submitted' },
    ] },
    { courseId: 'DEMO505', name: '社会調査法', teacher: '半田 先生', weekday: 3, period: 1, assignments: [
      { sourceId: 'DEMO505_TASK1', title: '第4回 調査計画書', dueAt: new Date(due.getTime() + 8 * 86400_000).toISOString(), submission: 'not-submitted' },
    ] },
    { courseId: 'DEMO606', name: '統計学入門', teacher: '時田 先生', weekday: 5, period: 2, assignments: [] },
  ] };
  const weekday = new Date(now + 9 * 3600_000);
  // Use the preceding Friday for weekend runs, then one week either side at 15:00 JST.
  const day = weekday.getUTCDay();
  weekday.setUTCDate(weekday.getUTCDate() - (day === 6 ? 1 : day === 0 ? 2 : 0));
  weekday.setUTCHours(6, 0, 0, 0);
  return { data, displayName: demoStudentDisplayName, context: {
    lastSessionAt: new Date(weekday.getTime() - 7 * 86400_000).toISOString(),
    nextSessionAt: new Date(weekday.getTime() + 7 * 86400_000).toISOString(),
  } };
}
