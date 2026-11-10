import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PreparationPlan } from '@kadai-hisho/core';
import { nextPreparation, remainingDays } from './nearest';
import { StudentView } from './page';
import { assignment, dated, studentFixture } from '../../shared/testing/student-fixture';

const now = Date.parse('2026-11-10T03:00:00Z');
const item = assignment('架空の最優先課題', dated('2026-11-14'));
export function samplePlan(patch: Partial<PreparationPlan> = {}): PreparationPlan {
  return { planId: 'fictional-plan', assignment: item.key, title: item.latest.title, date: '2026-11-10', period: 2,
    startsAt: '2026-11-10T10:30:00+09:00', endsAt: '2026-11-10T12:00:00+09:00', decidedOn: '2026-11-09',
    timeZone: 'Asia/Tokyo', confirmedBy: 'fictional-student', createdByRole: 'supporter', confirmedAt: '2026-11-09T09:00:00+09:00',
    status: 'active', revision: 3, calendarItemKey: 'fictional-calendar', ...patch };
}
const actions = { add: async () => {}, remove: async () => {}, act: async () => ({ outcome: 'done' as const, plan: samplePlan({ status: 'done' }), demo: true }) };
function hero(plans: PreparationPlan[], assignments = [item]) {
  const html = renderToStaticMarkup(<StudentView data={{ ...studentFixture(), assignments, plans }} actions={actions} now={now} calendar />);
  return html.match(/<section class="rd-next"[\s\S]*?<\/section>/)![0];
}
describe('学生の次の行動', () => {
  it('今日の未完了の準備を最優先し、完了と後回しに既存の操作を使う', () => {
    const plan = samplePlan();
    const html = hero([plan]);
    expect(html).toContain('今日 10:30〜12:00 に、準備をする');
    expect(html).toContain('>終わった</button>');
    expect(html).toContain('>後回しにする</button>');
    expect(html).toContain('LMSで見る');
    expect(html).not.toContain('準備の予定を入れる');
    expect(nextPreparation({ kind: 'lms', row: item }, [plan], now).today).toBe(plan);
  });
  it('今日の準備が無く最も近い未提出課題に予定がなければ登録を促す', () => {
    const html = hero([samplePlan({ status: 'done' })]);
    expect(html).toContain('架空の最優先課題の、準備の時間を決める');
    expect(html).toContain('>準備の予定を入れる</button>');
    expect(html).toContain('あと4日');
    expect(html).not.toContain('>終わった</button>');
  });
  it('別大学の同じIDの予定を取り違えず、取り消された予定を数えない', () => {
    const next = nextPreparation({ kind: 'lms', row: item }, [samplePlan({ assignment: { ...item.key, system: 'kulms' }, date: '2026-11-11' }), samplePlan({ status: 'cancelled' })], now);
    expect(next).toEqual({ today: undefined, future: undefined, hasPlans: false });
  });
  it('これからの予定があれば次の日時を知らせ、ボタンは出さない', () => {
    const html = hero([samplePlan({ date: '2026-11-11', startsAt: '2026-11-11T10:30:00+09:00' })]);
    expect(html).toContain('次の準備は 11/11（水）10:30');
    expect(html).not.toContain('<button');
  });
  it('未提出の課題がなければ急ぎの課題が無いことを示す', () => {
    expect(hero([], [assignment('提出済み', dated('2026-11-14'), { submission: 'submitted' })])).toContain('いま急ぎの課題はありません');
    expect(hero([], [])).not.toContain('<button');
  });
  it('日付のみは現地の日付で数え、当日は今日、前日以前は残り日数なし', () => {
    expect(remainingDays(dated('2026-11-14'), now)).toBe('あと4日');
    expect(remainingDays(dated('2026-11-10'), now)).toBe('今日');
    expect(remainingDays(dated('2026-11-09'), now)).toBeUndefined();
    expect(remainingDays({ kind: 'none', dueText: '', timeZone: 'Asia/Tokyo' }, now)).toBeUndefined();
  });
  it('締切のカレンダーと設定を閉じて配置し、体験の注意を設定内に置く', () => {
    const html = renderToStaticMarkup(<StudentView data={studentFixture()} calendar now={now} />);
    expect(html).toContain('<details class="student-calendar rd-fold"><summary>締切のカレンダー');
    expect(html).toContain('<details class="rd-settings rd-fold"><summary>連携と設定');
    expect(html.indexOf('体験版では')).toBeGreaterThan(html.indexOf('連携と設定'));
    expect(html).not.toContain('class="rd-fold" open');
  });
});
