import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PreparationPlan } from '../../core/src/types';
import { PlanList } from './preparation-plans';
import { planProgress } from './plan-progress';
const plan: PreparationPlan = { planId: 'fictional', assignment: { system: 'demo-lms', sourceId: 'task' }, title: '架空のレポート',
  date: '2030-11-11', period: 3, startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00',
  timeZone: 'Asia/Tokyo', decidedOn: '2030-11-11', confirmedBy: 'supporter', createdByRole: 'supporter',
  confirmedAt: '2030-11-10T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'key' };
describe('preparation progress belongs to the plan, not LMS submission', () => {
  it('old plans remain readable as not done yet; both later and done have distinct labels', () => {
    expect(planProgress(plan)).toBe('まだ'); expect(planProgress({ ...plan, laterResult: 'moved' })).toBe('後回しにした');
    expect(planProgress({ ...plan, status: 'done', laterResult: 'moved' })).toBe('終わった（LMSへの提出は別）');
    expect(planProgress({ ...plan, laterResult: 'no-slot' })).toBe('まだ');
  });
  it('keeps finished plans visible to supporters while cancelled plans remain hidden', () => {
    const html = renderToStaticMarkup(<PlanList plans={[{ ...plan, status: 'done' }, { ...plan, planId: 'removed', title: '取消した予定', status: 'cancelled' }]} own={false} />);
    expect(html).toContain('架空のレポート'); expect(html).toContain('終わった（LMSへの提出は別）');
    expect(html).not.toContain('取消した予定'); expect(html).not.toContain('<button');
  });
});
