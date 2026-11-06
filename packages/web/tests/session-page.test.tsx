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
import { usePathname } from '../src/session-route';

// Reuse the workspace's existing DOM parser for component tests; no browser automation or new dependency.
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
const holder = vi.hoisted(() => ({ services: null as SessionServices | null }));
vi.mock('../src/session-firebase', () => ({ getSessionServices: () => holder.services }));
let root: Root;
let host: HTMLElement;
let userChanged: (user: User | null) => void;
let publishChanges: (value: SessionData['changes']) => void;
const grants = new Map<string, (allowed: boolean) => void>();
const data: Record<string, SessionData> = {};
const save = vi.fn(async () => {});
beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.location = { pathname: '/session' };
  window.history = { pushState: (_state: unknown, _title: string, path: string) => { window.location.pathname = path; } };
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
      watch: (student, name, next) => {
        if (name === 'changes') publishChanges = next as typeof publishChanges;
        next((data[student] ?? emptySession())[name]); return () => {};
      },
    },
  };
  host = document.getElementById('root')!;
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function RoutedSession() { const path = usePathname(); return <SessionPage path={path} />; }
async function open() { await act(async () => { root.render(<RoutedSession />); }); }
async function click(text: string) {
  const button = [...host.querySelectorAll('button, a')].find(button => button.textContent?.trim() === text);
  expect(button, text).toBeDefined();
  await act(async () => { const event = new window.Event('click', { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0 }); button!.dispatchEvent(event); });
}
it('separates checking from planning and opens source details only inside the assignment row', async () => {
  await open();
  expect(host.textContent).toContain('学生が見せることにした');
  await click('学生 student-a');
  expect(window.location.pathname).toBe('/session/student-a');
  expect(host.querySelector('#session-deadlines')?.parentElement?.textContent).toContain('数学のレポート');
  expect(host.querySelector('#session-changes')?.parentElement?.textContent).toContain('課題が出ました');
  expect(host.querySelector('#session-decisions')).toBeNull();
  expect(host.querySelector('table')).toBeNull();
  expect(host.querySelector('.session-task:not([open]) a')?.textContent).toContain('LMSで見る');
  expect(host.querySelector('.session-task summary')?.textContent).toContain('要確認');
  expect(host.textContent).not.toContain('学生が見せることにした');
  await click('② 相談する');
  expect(window.location.pathname).toBe('/session/student-a/plan');
  expect(host.querySelector('table')).not.toBeNull();
  expect(host.querySelector('#session-deadlines')).toBeNull();
  expect(host.querySelector('#session-changes')).toBeNull();
  expect(host.querySelectorAll('#session-decisions')).toHaveLength(1);
  expect(host.querySelector('button[aria-describedby="session-confirm-help"]')?.hasAttribute('disabled')).toBe(true);
  expect(host.textContent).toContain('確認の依頼は準備中');
  expect(save).not.toHaveBeenCalled();
  await click('① 確かめる');
  await click('学生を選び直す'); await click('学生 student-b');
  expect(host.textContent).toContain('物理の演習'); expect(host.textContent).not.toContain('数学のレポート');
});
it('shows a newly received change without waiting for the minute timer', async () => {
  const started = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(started);
  try {
    await open(); await click('学生 student-a');
    const later = new Date(started + 5000);
    vi.useFakeTimers(); vi.setSystemTime(later);
    const change = { ...data['student-a']!.changes[0]!, changeId: 'newly-arrived', kind: 'title-changed' as const,
      before: '前の題名', after: '新しい題名', recordedAt: later.toISOString() };
    await act(async () => { publishChanges([...data['student-a']!.changes, change]); });
    expect(host.querySelector('#session-changes')?.parentElement?.textContent).toContain('題名が変わりました：前の題名 → 新しい題名');
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});
it('removes all displayed student data on revocation and on logout', async () => {
  await open(); await click('学生 student-a'); await click('② 相談する');
  await act(async () => { grants.get('student-a')!(false); });
  expect(host.textContent).toContain('表示していた内容を消しました');
  expect(host.textContent).not.toContain('数学のレポート');
  expect(host.querySelector('#session-changes')).toBeNull();
  expect(host.querySelector('table')).toBeNull();
  await click('学生を選び直す'); await click('学生 student-b'); await click('ログアウト');
  expect(host.textContent).toContain('面談にログイン');
  expect(host.textContent).not.toContain('物理の演習');
  expect(host.textContent).not.toContain('学生 student-a');
});
it('lets students read their own session without displaying the supporter date editor', async () => {
  holder.services!.students = async () => [];
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

it.each([
  ['2026-11-05T03:00:00Z', '2026-11-05'],
  ['2026-11-05T17:00:00Z', '2026-11-06'],
])('loads the planning URL and shows saved promises for the Tokyo session date: %s', async (lastSessionAt, decidedOn) => {
  window.location.pathname = '/session/student-a/plan';
  data['student-a']!.context.lastSessionAt = lastSessionAt;
  data['student-a']!.plans = [{ assignment: data['student-a']!.assignments[0]!.key,
    date: '2026-11-10', period: 3, decidedOn, calendarEventId: 'fictional' }];
  await open();
  expect(host.querySelector('table')).not.toBeNull();
  await click('① 確かめる');
  expect(host.querySelector('#session-promises')?.parentElement?.textContent).toContain('3限に準備');
  expect(save).not.toHaveBeenCalled();
});

it('keeps student IDs secondary and removes redundant selector actions', async () => {
  await open();
  expect(host.querySelector('.session-students button')).toBeNull();
  expect(host.textContent).not.toContain('自分の面談を見る');
  const card = host.querySelector('.session-students nav a')!;
  expect(card.querySelector('strong')?.textContent).toBe('学生');
  expect(card.querySelector('.session-student-id')?.textContent).toBe('student-a');
  await click('学生 student-a');
  expect(host.querySelector('h1')?.textContent).toBe('学生');
  expect(host.querySelector('.session-heading .session-student-id')?.textContent).toBe('student-a');
  expect(host.querySelector('.session-dates')?.textContent).not.toMatch(/今回|日本時間|Asia\/Tokyo/);
  expect(host.querySelector('.session-account button')?.classList.contains('logout')).toBe(true);
});

it('calls the demo source the trial LMS and hides timezone identifiers', async () => {
  const at = new Date().toISOString();
  data['student-a']!.fetchStates = [{ studentId: 'student-a', system: 'demo-lms', lastAttemptedAt: at,
    lastSucceededAt: at, lastFailureKind: null, lastResult: 'success', lastAppliedObservationId: 'fictional' }];
  const deadline = { kind: 'datetime' as const, dueAt: new Date(Date.now() + 86400_000).toISOString(),
    dueText: '架空の日時', timeZone: 'Asia/Tokyo' };
  data['student-a']!.assignments[0]!.officialDeadline!.deadline = deadline;
  await open(); await click('学生 student-a');
  expect(host.querySelector('.session-updates')?.textContent).toContain('体験用LMS');
  expect(host.textContent).not.toMatch(/模擬LMS|Asia\/Tokyo|面談日時は日本時間/);
});

it('does not treat a pending or failed student list as an empty list', async () => {
  let failList!: (reason: Error) => void;
  holder.services!.students = () => new Promise((_resolve, reject) => { failList = reject; });
  await open();
  expect(host.textContent).not.toContain('自分の面談を見る');
  await act(async () => { failList(new Error('fictional-offline')); });
  expect(host.textContent).toContain('担当する学生を開けませんでした');
  expect(host.textContent).not.toContain('自分の面談を見る');
});
