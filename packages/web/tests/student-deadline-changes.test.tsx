import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudentView } from '../src/features/student/page';
import { assignment, dated, studentFixture } from '../src/shared/testing/student-fixture';
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
let root: Root; let host: HTMLElement;
let data: ReturnType<typeof studentFixture>;
const now = Date.parse('2026-11-10T03:00:00Z');
const render = async () => { await act(async () => root.render(<StudentView data={structuredClone(data)} now={now} />)); };
const tick = async (ms: number) => { await act(async () => vi.advanceTimersByTime(ms)); };
const chips = () => host.querySelectorAll('.upcoming .td-chip-changed, .course-panel .td-chip-changed');
const change = async (date: string) => {
  const row = data.assignments[0]!;
  row.latest.deadline = dated(date); row.officialDeadline!.deadline = dated(date);
  await render();
};
beforeEach(async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.matchMedia = () => ({ matches: false });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.getElementById('root')!; root = createRoot(host);
  data = studentFixture(); data.assignments = [assignment('架空の課題', dated('2026-11-11'))];
  await render();
  const course = host.querySelector<HTMLButtonElement>('.course-cell')!;
  await act(async () => course.click());
  expect(host.querySelector('.course-panel')).not.toBeNull();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});
it('同じIDの締切変更を一覧と開いた授業詳細に出し、無関係な再描画で延長せず8秒で消す', async () => {
  await change('2026-11-12');
  expect(host.querySelector('.student-deadlines .td-chip-changed')?.textContent).toContain('締切が変わった');
  expect(host.querySelector('.course-panel .td-chip-changed')?.textContent).toContain('締切が変わった');
  expect(host.querySelector('.rd-next .td-chip-changed')?.textContent).toContain('締切が変わった');
  expect(host.querySelector('.rd-next s')?.textContent).toBe('11/11（日付のみ）');
  await tick(4000);
  data.online = false; await render();
  await tick(3999); expect(chips()).toHaveLength(2);
  await tick(1); expect(chips()).toHaveLength(0);
  expect(host.querySelector('.rd-next .td-chip-changed')).toBeNull();
});
it('再変更から8秒を数え直す', async () => {
  await change('2026-11-12'); await tick(4000);
  await change('2026-11-13'); await tick(4000);
  expect(chips()).toHaveLength(2);
  await tick(3999); expect(chips()).toHaveLength(2);
  await tick(1); expect(chips()).toHaveLength(0);
  expect(host.querySelector('.rd-next .td-chip-changed')).toBeNull();
});
it('課題の削除で解除し、同じIDを再追加しても札を戻さない', async () => {
  await change('2026-11-12'); expect(chips()).toHaveLength(2);
  const removed = data.assignments.pop()!; await render();
  expect(chips()).toHaveLength(0);
  data.assignments.push(removed); await render();
  expect(chips()).toHaveLength(0);
  await tick(8000); expect(chips()).toHaveLength(0);
});
it('初回表示・新規追加・題名だけの変更では札を出さない', async () => {
  expect(chips()).toHaveLength(0);
  data.assignments.push(assignment('架空の追加課題', dated('2026-11-12'))); await render();
  expect(chips()).toHaveLength(0);
  data.assignments[0]!.latest.title = '架空の改題'; await render();
  expect(host.textContent).toContain('架空の改題'); expect(chips()).toHaveLength(0);
});
it('保存済みの締切変更は8秒後と開き直しにも残り、対象外になると消える', async () => {
  const row = data.assignments[0]!;
  data.changes = [{ changeId: 'fictional-change', assignmentKey: row.key, kind: 'deadline-changed',
    before: dated('2026-11-10'), after: dated('2026-11-11'), observationId: 'fictional-observation',
    recordedAt: '2026-11-10T02:00:00Z' }];
  await render();
  expect(host.querySelector('.recent-deadline-changes')?.textContent).toContain('変更前');
  await tick(9000);
  data.online = false; await render();
  expect(host.querySelector('.recent-deadline-changes')).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector('.recent-deadline-changes a')?.getAttribute('href')).toBe('https://example.invalid/task');
  row.submission = 'submitted'; await render();
  expect(host.querySelector('.recent-deadline-changes')).toBeNull();
});
it('締切変更で先頭の課題が入れ替わっても、その課題自身の変更前の日付を出す', async () => {
  const other = assignment('架空の別の課題', dated('2026-11-14'));
  data.assignments.push(other); await render();
  other.latest.deadline = dated('2026-11-10'); other.officialDeadline!.deadline = dated('2026-11-10');
  await render();
  expect(host.querySelector('.rd-next')?.textContent).toContain('架空の別の課題');
  expect(host.querySelector('.rd-next .td-chip-changed')?.textContent).toContain('締切が変わった');
  expect(host.querySelector('.rd-next s')?.textContent).toBe('11/14（日付のみ）');
});
