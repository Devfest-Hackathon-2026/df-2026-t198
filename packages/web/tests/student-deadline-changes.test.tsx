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
const chips = () => host.querySelectorAll('.td-chip-changed');
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
  await tick(4000);
  data.online = false; await render();
  await tick(3999); expect(chips()).toHaveLength(2);
  await tick(1); expect(chips()).toHaveLength(0);
});
it('再変更から8秒を数え直す', async () => {
  await change('2026-11-12'); await tick(4000);
  await change('2026-11-13'); await tick(4000);
  expect(chips()).toHaveLength(2);
  await tick(3999); expect(chips()).toHaveLength(2);
  await tick(1); expect(chips()).toHaveLength(0);
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
