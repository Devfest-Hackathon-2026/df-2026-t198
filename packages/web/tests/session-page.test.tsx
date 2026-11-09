import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from 'firebase/auth';
import { applyObservation } from '../../core/src/ledger';
import { observation } from '../../server/tests/observation-fixture';
import { emptySession, type SessionData } from '../src/features/session/model';
import { formatDeadline } from '../src/shared/assignments/deadline-format';
import type { SessionServices } from '../src/features/session/firebase';
import { SessionPage, SessionDetails } from '../src/features/session/page';
import { usePathname } from '../src/shared/use-pathname';

// Reuse the workspace's existing DOM parser for component tests; no browser automation or new dependency.
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
const holder = vi.hoisted(() => ({ services: null as SessionServices | null }));
vi.mock('../src/features/session/firebase', () => ({ getSessionServices: () => holder.services }));
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
it('shows the fictional demo name in both the picker and heading without a visible internal id', async () => {
  holder.services!.students = async () => [{ uid: 'student-a', displayName: '田中 太郎' }];
  await open();
  expect(host.textContent).toContain('田中 太郎');
  expect(host.textContent).not.toContain('student-a');
  await click('田中 太郎');
  expect(host.querySelector('h1')?.textContent).toBe('田中 太郎');
  expect(host.querySelector('.session-heading .session-student-id')).toBeNull();
});
it('does not show an internal demo id while its name is loading on a direct session link', async () => {
  let provideName!: (rows: { uid: string; displayName: string }[]) => void;
  holder.services!.students = () => new Promise(resolve => { provideName = resolve; });
  window.history.pushState(null, '', '/session/student-a');
  await open();
  expect(host.textContent).not.toContain('student-a');
  await act(async () => provideName([{ uid: 'student-a', displayName: '田中 太郎' }]));
  expect(host.querySelector('h1')?.textContent).toBe('田中 太郎');
  expect(host.querySelector('.session-heading .session-student-id')).toBeNull();
});
async function click(text: string) {
  const button = [...host.querySelectorAll('button, a')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === text);
  expect(button, text).toBeDefined();
  await act(async () => { const event = new window.Event('click', { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0 }); button!.dispatchEvent(event); });
}
it('separates checking from planning and opens source details only inside the assignment row', async () => {
  await open();
  expect(host.textContent).toContain('共有を許可した学生の授業と課題を出しています。');
  await click('学生 student-a');
  expect(window.location.pathname).toBe('/session/student-a');
  expect(host.querySelector('#session-deadlines')?.parentElement?.textContent).toContain('数学のレポート');
  expect(host.querySelector('#session-changes')?.parentElement?.textContent).toContain('課題が出ました');
  expect(host.querySelector('#session-decisions')).toBeNull();
  expect(host.querySelector('.td-table')).not.toBeNull();
  expect(host.querySelector('.session-timetable')).toBeNull();
  expect(host.querySelector('.td-detail')).toBeNull();
  await click('数学のレポート');
  expect(host.querySelector('.td-detail .session-task a')?.textContent).toContain('LMSで見る');
  expect(host.querySelector('.session-task summary')?.textContent).toContain('要確認');
  expect(host.textContent).not.toContain('共有を許可した学生の授業と課題を出しています。');
  await click('② 相談する');
  expect(window.location.pathname).toBe('/session/student-a/plan');
  expect(host.querySelector('table')).not.toBeNull();
  expect(host.querySelector('#session-deadlines')).toBeNull();
  expect(host.querySelector('#session-changes')).toBeNull();
  expect(host.querySelectorAll('#session-decisions')).toHaveLength(1);
  expect(host.textContent).not.toContain('学生に確認を頼む');
  expect(host.textContent).not.toContain('確認の依頼は準備中');
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
it.each([false, true])('explains a literal missing LMS date and preserves the previous deadline: %s', async known => {
  const row = data['student-a']!.assignments[0]!;
  const official = row.officialDeadline!;
  row.latest.deadline = { kind: 'unreadable', dueText: ' - ', timeZone: 'Asia/Tokyo' };
  if (!known) row.officialDeadline = null;
  const before = JSON.stringify(row);
  await open(); await click('学生 student-a');
  if (known) await click('数学のレポート');
  const summary = host.querySelector('.session-task summary')?.textContent;
  expect(summary).toContain('LMSに締切日時の記載がありません（表示「-」）');
  expect(summary).toContain('要確認');
  expect(summary).not.toContain('締切を確認できていません');
  expect(summary).not.toContain('締切なし');
  if (known) expect(summary).toContain(formatDeadline(official.deadline));
  expect(JSON.stringify(row)).toBe(before);
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
it('lets students read their own session and edit their session dates', async () => {
  holder.services!.students = async () => [];
  await open(); await click('自分の面談を見る');
  expect(host.textContent).toContain('次の面談日時を決める');
  expect(host.textContent).toContain('面談日時を変える');
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
    date: '2026-11-10', period: 3, decidedOn, planId: 'fictional', title: '数学のレポート', timeZone: 'Asia/Tokyo', startsAt: '2026-11-10T13:00:00+09:00', endsAt: '2026-11-10T14:30:00+09:00', confirmedBy: 'supporter', createdByRole: 'supporter', confirmedAt: '2026-11-01T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'fictional' }];
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
  for (const date of host.querySelectorAll('.session-meta-last > p, .session-meta-next > p')) {
    expect(date.textContent).not.toMatch(/今回|日本時間|Asia\/Tokyo/);
  }
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

it.each([
  ['2026-11-06T15:29:59.999Z', false],
  ['2026-11-06T15:30:00Z', true],
])('shows a stale notice at 72 hours: %s', async (now, stale) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  try {
    data['student-a']!.fetchStates = [{ studentId: 'student-a', system: 'ynu-lms',
      lastAttemptedAt: '2026-11-03T15:30:00Z', lastSucceededAt: '2026-11-03T15:30:00Z',
      lastResult: 'success', lastFailureKind: null, lastAppliedObservationId: 'fictional' }];
    await open(); await click('学生 student-a');
    const notice = host.querySelector('.session-updates .notice');
    if (stale) expect(notice?.textContent).toBe('YNU LMS：11/4から更新がありません。学生がLMSを開くと新しくなります。');
    else {
      expect(notice).toBeNull();
      expect(host.querySelector('.session-updates')?.textContent).toContain('11/4(水) 00:30 時点の情報');
    }
    await click('② 相談する');
    expect(host.querySelector('.session-meta-fetch .session-updates')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

it.each(['partial', 'failed'] as const)('shows incomplete fetching in a notice: %s', async lastResult => {
  data['student-a']!.fetchStates = [{ studentId: 'student-a', system: 'ynu-lms',
    lastAttemptedAt: new Date().toISOString(), lastSucceededAt: null,
    lastResult, lastFailureKind: 'http', lastAppliedObservationId: 'fictional' }];
  await open(); await click('学生 student-a');
  expect(host.querySelector('.session-updates .notice')?.textContent).toBe(
    'YNU LMS：課題をすべて確認できていません。LMSを一緒に開いて確かめてください。');
});

it('prioritizes deadlines and keeps counted navigation and three context cards in both views', async () => {
  await open(); await click('学生 student-a');
  const links = host.querySelectorAll('.session-steps a');
  expect(links[0]?.getAttribute('aria-current')).toBe('page');
  expect(links[0]?.textContent).toContain('締切1件・変化1件');
  expect(links[1]?.textContent).toMatch(/準備の候補 \d+コマ/);
  expect([...host.querySelectorAll('.session-meta > section h2')].map(node => node.textContent))
    .toEqual(['前回の面談', '次の面談', '情報の取得時点']);
  expect(host.querySelector('.session-meta-next .session-editor')).not.toBeNull();
  expect(host.querySelector('.session-check > :first-child #session-deadlines')).not.toBeNull();
  expect(host.querySelector('.session-supplement #session-changes')).not.toBeNull();
  expect(host.querySelector('.td-table .td-r')?.textContent).toBe('あと1日');
  expect(host.querySelector('.td-table .session-status-review')?.textContent).toBe('要確認');
  await click('② 相談する');
  expect(host.querySelector('.session-steps a[aria-current="page"]')?.textContent).toContain('② 相談する');
  expect(host.querySelectorAll('.session-meta > section')).toHaveLength(3);
});

it('shows both deadline-change and review marks while excluding submitted work from deadlines', async () => {
  const session = data['student-a']!;
  const row = session.assignments[0]!;
  session.changes.push({ ...session.changes[0]!, changeId: 'deadline-change', kind: 'deadline-changed', before: null, after: row.officialDeadline!.deadline });
  session.assignments.push({ ...row, key: { ...row.key, sourceId: 'submitted' }, latest: { ...row.latest, title: '提出した課題' }, submission: 'submitted' });
  session.changes.push({ ...session.changes[0]!, changeId: 'submitted-change', kind: 'submitted', before: 'not-submitted', after: 'submitted' });
  await open(); await click('学生 student-a');
  expect(host.querySelectorAll('.td-table tbody tr')).toHaveLength(1);
  expect(host.querySelector('.td-table .td-chip-changed')?.textContent).toContain('締切が変わった');
  expect(host.querySelector('.td-table .session-status-review')?.textContent).toBe('要確認');
  expect(host.querySelector('.session-supplement .session-status-done')?.textContent).toContain('出せました');
  expect(host.querySelector('.session-steps a')?.textContent).toContain('締切1件・変化3件');
});

it('counts the same available periods that the selected task can use, and refills after saving', async () => {
  const now = new Date('2026-11-06T06:00:00Z');
  const original = data['student-a']!.assignments[0]!;
  const deadline = { kind: 'date' as const, date: '2026-11-10', dueText: '架空の日付', timeZone: 'Asia/Tokyo' };
  const assignments = ['課題A', '課題B'].map(sourceId => ({ ...original, key: { ...original.key, system: 'demo-lms' as const, sourceId },
    latest: { ...original.latest, title: sourceId, sourceId, deadline },
    officialDeadline: { ...original.officialDeadline!, deadline } }));
  const session: SessionData = { ...emptySession(), assignments,
    context: { lastSessionAt: null, nextSessionAt: '2026-11-13T11:00:00+09:00' },
    courses: [{ courseId: 'fictional', name: '架空の授業', system: 'demo-lms',
      slots: [3, 4, 5].map(period => ({ weekday: 1 as const, period })) }] };
  const render = () => act(async () => root.render(<SessionDetails data={session} now={now} own={false}
    uid="fictional-student" planning save={save} />));
  await render();
  expect(host.querySelector('#session-plan-count')?.textContent).toBe('準備の候補 2コマ');
  expect(host.querySelectorAll('.session-candidate')).toHaveLength(2);
  session.plans.push({ assignment: assignments[1]!.key, date: '2026-11-09', period: 1,
    startsAt: '2026-11-09T08:50:00+09:00', endsAt: '2026-11-09T10:20:00+09:00',
    planId: 'fictional-a', title: '課題B', decidedOn: '2026-11-06', timeZone: 'Asia/Tokyo', confirmedBy: 'fictional-student',
    createdByRole: 'student', confirmedAt: now.toISOString(), status: 'active', revision: 1, calendarItemKey: 'fictional-item-a' });
  await render();
  expect(host.querySelector('#session-plan-count')?.textContent).toBe('準備の候補 1コマ');
  expect(host.querySelectorAll('.session-candidate')).toHaveLength(1);
  session.plans.push({ ...session.plans[0]!, planId: 'fictional-b', calendarItemKey: 'fictional-item-b', period: 2,
    startsAt: '2026-11-09T10:30:00+09:00', endsAt: '2026-11-09T12:00:00+09:00' });
  await render();
  expect(host.querySelector('#session-plan-count')?.textContent).toBe('準備の候補 0コマ');
  expect(host.querySelectorAll('.session-candidate')).toHaveLength(0);
  expect(host.textContent).toContain('この課題の候補にできるコマがありません。');
});

it('counts the selected task when only another task has preparation candidates', async () => {
  const now = new Date('2026-11-09T08:00:00Z');
  const original = data['student-a']!.assignments[0]!;
  const assignments = ['2026-11-10', '2026-11-12'].map((date, index) => {
    const sourceId = `task-${index}`;
    const deadline = { kind: 'date' as const, date, dueText: '架空の日付', timeZone: 'Asia/Tokyo' };
    return { ...original, key: { system: 'demo-lms' as const, sourceId },
      latest: { ...original.latest, title: `課題${index}`, sourceId, deadline },
      officialDeadline: { ...original.officialDeadline!, deadline } };
  });
  const session: SessionData = { ...emptySession(), assignments,
    context: { lastSessionAt: null, nextSessionAt: '2026-11-13T11:00:00+09:00' } };
  await act(async () => root.render(<SessionDetails data={session} now={now} own={false}
    uid="fictional-student" planning save={save} />));
  expect(host.querySelectorAll('.session-candidate')).toHaveLength(0);
  expect(host.textContent).toContain('この課題の候補にできるコマがありません。');
  expect(host.querySelector('#session-plan-count')?.textContent).toBe('準備の候補 0コマ');
  await click('課題1');
  expect(host.querySelectorAll('.session-candidate')).toHaveLength(2);
  expect(host.querySelector('#session-plan-count')?.textContent).toBe('準備の候補 2コマ');
  await click('課題0');
  expect(host.querySelectorAll('.session-candidate')).toHaveLength(0);
  expect(host.querySelector('#session-plan-count')?.textContent).toBe('準備の候補 0コマ');
});
