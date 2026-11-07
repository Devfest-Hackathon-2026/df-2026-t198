import type { DemoData } from '@kadai-hisho/core/ledger';

export const demoStudentDisplayName = '田中 太郎';

/** The same fictional scenario as the demo account setup, dated from this run. */
export function initialDemo(now: number) {
  // Shift to the Japanese calendar date before choosing 17:00 JST (08:00 UTC).
  const due = new Date(now + 9 * 3600_000 + 3 * 86400_000);
  due.setUTCHours(8, 0, 0, 0);
  const data: DemoData = { announcements: [], courses: [
    { courseId: 'DEMO101', name: 'レポートの書き方の書き方', teacher: '森 先生', weekday: 1, period: 2, assignments: [
      { sourceId: 'DEMO101_TASK1', title: '書き方を書くレポート', dueAt: due.toISOString(), submission: 'not-submitted' },
      { sourceId: 'DEMO101_TASK2', title: '第3回 ふりかえり', dueAt: due.toISOString(), submission: 'submitted' },
    ] },
    { courseId: 'DEMO202', name: 'キャンパス植物図鑑演習', teacher: '草野 先生', weekday: 4, period: 4, assignments: [] },
    { courseId: 'DEMO303', name: 'Re:線形代数', teacher: '安藤 先生', weekday: 2, period: 1, assignments: [
      { sourceId: 'DEMO303_TASK1', title: '第5回 小テスト', dueAt: new Date(due.getTime() + 7 * 86400_000).toISOString(), submission: 'not-submitted' },
    ] },
    { courseId: 'DEMO404', name: '学食経済学', teacher: '大盛 先生', weekday: 3, period: 3, assignments: [
      { sourceId: 'DEMO404_TASK1', title: '日替わり定食の値段しらべ', dueAt: due.toISOString(), submission: 'submitted' },
    ] },
    { courseId: 'DEMO505', name: '自転車置き場の社会学', teacher: '半田 先生', weekday: 3, period: 1, assignments: [
      { sourceId: 'DEMO505_TASK1', title: '駐輪場のフィールドノート', dueAt: new Date(due.getTime() + 8 * 86400_000).toISOString(), submission: 'not-submitted' },
    ] },
    { courseId: 'DEMO606', name: '90分の数理', teacher: '時田 先生', weekday: 5, period: 2, assignments: [] },
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
