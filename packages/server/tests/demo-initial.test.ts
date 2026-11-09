import { expect, it } from 'vitest';
import { initialDemo } from '../src/demo/initial.js';

it.each([
  ['2026-11-07T07:41:00+09:00', '2026-10-30T06:00:00.000Z', '2026-11-13T06:00:00.000Z'],
  ['2026-11-08T23:59:00+09:00', '2026-10-30T06:00:00.000Z', '2026-11-13T06:00:00.000Z'],
  ['2026-11-09T00:01:00+09:00', '2026-11-02T06:00:00.000Z', '2026-11-16T06:00:00.000Z'],
])('uses weekday 15:00 Japan appointments and a fictional name from %s', (at, lastSessionAt, nextSessionAt) => {
  expect(initialDemo(Date.parse(at))).toMatchObject({ displayName: '田中 太郎', context: { lastSessionAt, nextSessionAt } });
});

it.each([
  ['2026-11-07T00:00:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T02:34:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T08:59:59.999+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T09:00:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T17:00:00+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-11-07T23:59:59.999+09:00', '2026-11-10T08:00:00.000Z'],
  ['2026-12-30T02:34:00+09:00', '2027-01-02T08:00:00.000Z'],
  ['2028-02-27T02:34:00+09:00', '2028-03-01T08:00:00.000Z'],
])('starts the demo three Japanese dates later at 17:00 from %s', (at, expectedDueAt) => {
  const now = Date.parse(at);
  const { data, context } = initialDemo(now);
  expect(data.courses.find(course => course.courseId === 'DEMO101')!.assignments.map(task => task.dueAt))
    .toEqual([expectedDueAt, expectedDueAt]);
  expect(Date.parse(context.lastSessionAt)).toBeLessThan(now);
  expect(Date.parse(context.nextSessionAt)).toBeGreaterThan(now);
  for (const value of Object.values(context)) {
    const at = new Date(value);
    expect(at.getUTCHours()).toBe(6);
    expect(at.getUTCMinutes()).toBe(0);
    expect(at.getUTCDay()).toBeGreaterThan(0);
    expect(at.getUTCDay()).toBeLessThan(6);
  }
});

it('provides six fictional courses while keeping DEMO101 the first unfinished deadline after a one-day extension', () => {
  const { data, displayName } = initialDemo(Date.parse('2026-11-08T09:00:00+09:00'));
  expect(displayName).toBe('田中 太郎');
  expect(data.courses.map(({ name, teacher, weekday, period }) => ({ name, teacher, weekday, period })))
    .toEqual([
      { name: '文章表現', teacher: '森 先生', weekday: 1, period: 2 },
      { name: '生物学実験', teacher: '草野 先生', weekday: 4, period: 4 },
      { name: '線形代数', teacher: '安藤 先生', weekday: 2, period: 1 },
      { name: '経済学入門', teacher: '大盛 先生', weekday: 3, period: 3 },
      { name: '社会調査法', teacher: '半田 先生', weekday: 3, period: 1 },
      { name: '統計学入門', teacher: '時田 先生', weekday: 5, period: 2 },
    ]);
  const tasks = data.courses.flatMap(course => course.assignments);
  expect(tasks.map(({ title, submission }) => ({ title, submission }))).toEqual([
    { title: '第3回レポート（要約と引用）', submission: 'not-submitted' },
    { title: '第3回 ふりかえり', submission: 'submitted' },
    { title: '第5回 小テスト', submission: 'not-submitted' },
    { title: '第2回 確認問題', submission: 'submitted' },
    { title: '第4回 調査計画書', submission: 'not-submitted' },
  ]);
  expect(data.courses.map(course => course.courseId)).toEqual(['DEMO101', 'DEMO202', 'DEMO303', 'DEMO404', 'DEMO505', 'DEMO606']);
  expect(tasks.map(({ sourceId, dueAt }) => [sourceId, dueAt])).toEqual([
    ['DEMO101_TASK1', '2026-11-11T08:00:00.000Z'],
    ['DEMO101_TASK2', '2026-11-11T08:00:00.000Z'],
    ['DEMO303_TASK1', '2026-11-18T08:00:00.000Z'],
    ['DEMO404_TASK1', '2026-11-11T08:00:00.000Z'],
    ['DEMO505_TASK1', '2026-11-19T08:00:00.000Z'],
  ]);
  expect(new Set(tasks.map(task => task.sourceId)).size).toBe(5);
  const main = tasks.find(task => task.sourceId === 'DEMO101_TASK1')!;
  for (const task of tasks.filter(task => task.submission === 'not-submitted' && task !== main)) {
    expect(Date.parse(task.dueAt)).toBeGreaterThan(Date.parse(main.dueAt) + 86400_000);
  }
  expect(data.courses.filter(course => course.assignments.length === 0).map(course => course.courseId))
    .toEqual(['DEMO202', 'DEMO606']);
});
