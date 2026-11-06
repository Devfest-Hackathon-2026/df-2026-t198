import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from 'firebase/auth';
import { applyObservation } from '../../core/src/ledger';
import { observation } from '../../server/tests/observation-fixture';
import { emptySession, type SessionData } from '../src/session-model';
import type { SessionServices } from '../src/session-firebase';
import { SessionPage } from '../src/session-page';

// Reuse the workspace's existing DOM parser for component tests; no browser automation or new dependency.
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
const holder = vi.hoisted(() => ({ services: null as SessionServices | null }));
vi.mock('../src/session-firebase', () => ({ getSessionServices: () => holder.services }));
let root: Root;
let host: HTMLElement;
let userChanged: (user: User | null) => void;
const grants = new Map<string, (allowed: boolean) => void>();
const data: Record<string, SessionData> = {};
const save = vi.fn(async () => {});
beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('FormData', class {
    constructor(private form: HTMLFormElement) {}
    get(name: string) { return this.form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? null; }
  });
  const at = new Date().toISOString();
  for (const uid of ['student-a', 'student-b']) {
    const sample = observation(); sample.assignments[0]!.title = uid === 'student-a' ? '数学のレポート' : '物理の演習';
    sample.assignments[0]!.deadline = { kind: 'date', date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
      dueText: '架空の日付', timeZone: 'Asia/Tokyo' };
    const applied = applyObservation([], sample, at);
    applied.assignments[0]!.reviewReasons = [{ kind: 'unreadable-deadline', detail: 'unreadable' }];
    data[uid] = { ...emptySession(), assignments: applied.assignments, changes: applied.changes,
      courses: [{ ...sample.catalogCourses[0]!, system: 'demo-lms' }],
      context: { lastSessionAt: new Date(Date.now() - 86400_000).toISOString(),
        nextSessionAt: new Date(Date.now() + 7 * 86400_000).toISOString() } };
  }
  grants.clear(); save.mockClear();
  holder.services = {
    local: true, observeUser: next => { userChanged = next; next({ uid: 'supporter' } as User); return () => {}; },
    students: async () => [{ uid: 'student-a' }, { uid: 'student-b' }],
    login: async () => {}, logout: async () => { userChanged(null); }, saveContext: save,
    source: {
      grant: (student, _viewer, next) => { grants.set(student, next); next(true); return () => {}; },
      watch: (student, name, next) => { next((data[student] ?? emptySession())[name]); return () => {}; },
    },
  };
  host = document.getElementById('root')!;
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function open() { await act(async () => { root.render(<SessionPage />); }); }
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === text);
  expect(button, text).toBeDefined();
  await act(async () => { button!.click(); });
}
it('renders deadline, changes, a single decisions section, and clears the previous student on selection', async () => {
  await open();
  expect(host.textContent).not.toContain('数学のレポート');
  await click('学生 student-a');
  expect(host.querySelector('#session-deadlines')?.parentElement?.textContent).toContain('数学のレポート');
  expect(host.querySelector('#session-changes')?.parentElement?.textContent).toContain('課題が出ました');
  expect(host.querySelectorAll('#session-decisions')).toHaveLength(1);
  expect(host.querySelector('#session-decisions')?.parentElement?.textContent).toContain('要確認');
  expect(host.textContent).not.toMatch(/一緒に決めること|一緒に確かめること|前回決めたこと|未提出|準備の候補/);
  await click('学生 student-b');
  expect(host.textContent).toContain('物理の演習'); expect(host.textContent).not.toContain('数学のレポート');
});
it('removes all displayed student data on revocation and on logout', async () => {
  await open(); await click('学生 student-a');
  await act(async () => { grants.get('student-a')!(false); });
  expect(host.textContent).toContain('表示していた内容を消しました');
  expect(host.textContent).not.toContain('数学のレポート');
  expect(host.querySelector('#session-changes')).toBeNull();
  await click('学生 student-b'); await click('ログアウト');
  expect(host.textContent).toContain('面談にログイン');
  expect(host.textContent).not.toContain('物理の演習');
  expect(host.textContent).not.toContain('学生 student-a');
});
it('lets students read their own session without displaying the supporter date editor', async () => {
  await open(); await click('自分の面談を見る');
  expect(host.textContent).toContain('次の面談日時を決めると');
  expect(host.textContent).not.toContain('面談日時を変える');
});

it('saves entered session times with an explicit timezone and allows unset dates', async () => {
  await open(); await click('学生 student-a');
  const form = host.querySelector('.session-editor form')!;
  const last = form.querySelector<HTMLInputElement>('input[name="last"]')!;
  const next = form.querySelector<HTMLInputElement>('input[name="next"]')!;
  last.value = ''; next.value = '2026-11-13T11:00';
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ uid: 'supporter' }), 'student-a', {
    lastSessionAt: null, nextSessionAt: '2026-11-13T11:00:00+09:00',
  });
  expect(host.textContent).toContain('面談日時を保存しました');
});
