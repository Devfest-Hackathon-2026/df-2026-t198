import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { PreparationPlan } from '../../core/src/types';
import { PlanList } from './preparation-plans';
import { actionMessage, performPlanAction, planActionErrorMessage, planProgress } from './plan-progress';
afterEach(() => vi.unstubAllGlobals());
const plan: PreparationPlan = { planId: 'fictional', assignment: { system: 'demo-lms', sourceId: 'task' }, title: '架空のレポート',
  date: '2030-11-11', period: 3, startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00',
  timeZone: 'Asia/Tokyo', decidedOn: '2030-11-11', confirmedBy: 'supporter', createdByRole: 'supporter',
  confirmedAt: '2030-11-10T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'key' };
describe('preparation progress belongs to the plan, not LMS submission', () => {
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
