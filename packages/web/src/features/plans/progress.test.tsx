import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { PreparationPlan } from '../../../../core/src/types';
import { PlanList } from './components';
import { actionMessage, planActionErrorMessage, planProgress, NextSubmission } from './progress';
import { performPlanAction } from './api';
import { assignment, dated } from '../../shared/testing/student-fixture';
afterEach(() => vi.unstubAllGlobals());
const plan: PreparationPlan = { planId: 'fictional', assignment: { system: 'demo-lms', sourceId: 'task' }, title: '架空のレポート',
  date: '2030-11-11', period: 3, startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00',
  timeZone: 'Asia/Tokyo', decidedOn: '2030-11-11', confirmedBy: 'supporter', createdByRole: 'supporter',
  confirmedAt: '2030-11-10T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'key' };
it('after preparation shows the current deadline, LMS home and route, then hides after submission', () => {
  const task = assignment('架空のレポート', dated('2030-11-12'));
  task.key = { system: 'ynu-lms', sourceId: 'task' };
  const finished = { ...plan, assignment: task.key, status: 'done' as const };
  const render = () => renderToStaticMarkup(<NextSubmission plan={finished} assignments={[task]}
    courses={[{ system: 'ynu-lms', courseId: task.latest.courseId, name: '架空の授業', slots: [] }]} />);
  expect(render()).toContain('次は提出'); expect(render()).toContain('11/12（日付のみ）');
  expect(render()).toContain('ホーム › 架空の授業 › 架空のレポート');
  expect(render()).toContain('href="https://example.invalid/lms/homeHoml/doIndex"');
  task.submission = 'submitted'; expect(render()).toBe('');
});
describe('preparation progress belongs to the plan, not LMS submission', () => {
  it('does not describe a replay without a current plan as a missing slot', () => {
    expect(actionMessage('unchanged')).toBe('予定が変わりました。学生の画面で確かめてください。');
  });
  it('uses the server destination even when a regular account has a demo-lms assignment', () => {
    expect(actionMessage('moved', plan, false)).toContain('拡張機能がGoogleにつながる');
    expect(actionMessage('moved', plan, false)).not.toContain('体験用の予定を更新しました');
  });
  it('reports current state on replay and describes only the calendar destination that was updated', () => {
    const done = { ...plan, status: 'done' as const };
    expect(actionMessage('unchanged', done)).toBe('この準備はもう「終わった」と記録されています。変更していません。');
    expect(actionMessage('unchanged', { ...plan, laterResult: 'moved' })).toContain('2030/11/11 13:00〜14:30');
    expect(actionMessage('unchanged', { ...plan, status: 'cancelled' })).toContain('外されています。変更していません。');
    expect(actionMessage('moved', plan, true)).toContain('体験用の予定を更新しました');
    expect(actionMessage('moved', plan, true)).not.toContain('拡張機能');
    expect(actionMessage('moved', { ...plan, assignment: { ...plan.assignment, system: 'ynu-lms' } })).toContain('拡張機能がGoogleにつながる');
  });
  it('keeps an existing plan visible and warns after the task deadline moves before it', () => {
    const task = assignment('架空のレポート', dated('2030-11-10'));
    task.key = plan.assignment;
    const html = renderToStaticMarkup(<PlanList plans={[plan]} assignments={[task]} own={false} />);
    expect(html).toContain('架空のレポート');
    expect(html).toContain('締切より後の予定です');
    task.officialDeadline!.deadline = dated('2030-11-11');
    expect(renderToStaticMarkup(<PlanList plans={[plan]} assignments={[task]} own={false} />)).not.toContain('締切より後の予定です');
  });
  it('old plans remain readable as not done yet; both later and done have distinct labels', () => {
    expect(planProgress(plan)).toBe(''); expect(planProgress({ ...plan, laterResult: 'moved' })).toBe('後回しにした');
    expect(planProgress({ ...plan, status: 'done', laterResult: 'moved' })).toBe('終わった（LMSへの提出は別）');
    expect(planProgress({ ...plan, laterResult: 'no-slot' })).toBe('');
  });
  it('keeps finished plans visible to supporters while cancelled plans remain hidden', () => {
    const html = renderToStaticMarkup(<PlanList plans={[{ ...plan, status: 'done' }, { ...plan, planId: 'removed', title: '取消した予定', status: 'cancelled' }]} own={false} />);
    expect(html).toContain('架空のレポート'); expect(html).toContain('終わった（LMSへの提出は別）');
    expect(html).not.toContain('取消した予定'); expect(html).not.toContain('<button');
  });
});
it('distinguishes a stale action conflict from a connection failure and tells the student where to check', async () => {
  const user = { getIdToken: async () => 'synthetic-test-token' } as User;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })));
  const error = await performPlanAction(user, 'fictional', 'done', 1).catch((error: unknown) => error);
  expect(error).toEqual(new Error('plan-conflict'));
  expect(planActionErrorMessage(error, '接続を確かめてください。')).toBe('予定が変わりました。学生の画面で確かめてください。');
  expect(planActionErrorMessage(new Error('plan-action-failed'), '接続を確かめてください。')).toBe('接続を確かめてください。');
});

it('shows no initial progress label, and keeps preparation separate from submission', () => {
  const html = renderToStaticMarkup(<PlanList plans={[plan]} own />);
  expect(html).not.toContain('まだ');
  expect(html).not.toContain('未提出');
  expect(actionMessage('done')).toBe('準備が終わりました。LMSへの提出は別に行ってください。');
  expect(actionMessage('moved')).toContain('カレンダーの予定は、拡張機能がGoogleにつながると動きます。');
  expect(actionMessage('no-slot')).toContain('準備の予定を動かしませんでした。');
});
it('uses the server current plan when a conflicting link cannot be applied', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'plan-conflict', plan: { ...plan, status: 'done' } }), { status: 409 })));
  const error = await performPlanAction({ getIdToken: async () => 'synthetic' } as User, 'fictional', 'later', 1).catch((error: unknown) => error);
  expect(planActionErrorMessage(error, '接続を確かめてください。')).toBe('この準備はもう「終わった」と記録されています。変更していません。');
});
