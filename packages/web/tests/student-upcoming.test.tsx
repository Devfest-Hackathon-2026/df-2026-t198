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
beforeEach(async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.matchMedia = () => ({ matches: false });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.getElementById('root')!; root = createRoot(host);
  data = studentFixture(); data.assignments = [assignment('架空の課題', dated('2026-11-11'))];
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});
it('今週が0件なら、先の締切を近い順に3件と残りに分ける', async () => {
  data.assignments = ['20', '16', '19', '17'].map(day => assignment(`課題${day}`, dated(`2026-11-${day}`)));
  data.assignments.push(assignment('過去の締切', dated('2026-11-01')));
  await render();
  expect(host.querySelector('#upcoming-title')?.textContent).toBe('これからの締切 3');
  expect(host.querySelector('.empty-week')).toBeNull();
  expect([...host.querySelectorAll('.upcoming > ul > li .td-taskrow-title')].map(row => row.textContent)).toEqual(['課題16', '課題17', '課題19']);
  expect(host.querySelector('.other-deadlines')?.textContent).toContain('課題20');
});
it('今週が1件以上なら今週の一覧とregion名を維持する', async () => {
  data.assignments.push(assignment('先の課題', dated('2026-11-20'))); await render();
  expect(host.querySelector('#upcoming-title')?.textContent).toBe('今週の締切 1');
  expect(host.querySelector('.upcoming')?.getAttribute('aria-labelledby')).toBe('upcoming-title');
  expect(host.querySelector('.upcoming > ul')?.textContent).toContain('架空の課題');
  expect(host.querySelector('.other-deadlines')?.textContent).toContain('先の課題');
});
it('先の締切もない場合は既存の空表示を維持する', async () => {
  data.assignments = [assignment('提出済み', dated('2026-11-11'), { submission: 'submitted' })]; await render();
  expect(host.querySelector('#upcoming-title')?.textContent).toBe('今週の締切 0');
  expect(host.querySelector('.empty-week')?.textContent).toBe('今週の締切はありません');
  expect(host.querySelector('.other-deadlines')).toBeNull();
});
