import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarIntegration, DeadlineEvent } from '@kadai-hisho/core';
import { DemoCalendarView } from './calendar';

const integration: CalendarIntegration = { mode: 'mock', executor: 'demo', calendarId: 'demo-calendar', connectionState: 'connected',
  mockEvents: { abcde: { itemKey: 'task', generation: 1, revision: 1, event: { summary: '架空のレポート', description: '',
    start: { date: '2026-11-12' }, end: { date: '2026-11-13' }, transparency: 'transparent', reminders: { useDefault: true } } } } };
const now = Date.parse('2026-11-05T15:00:00Z'); // 日本時間11/6の始まり
const render = (value = integration, pending = false) => renderToStaticMarkup(<DemoCalendarView integration={value} pending={pending} now={now} />);
const cell = (html: string, day: string) => html.match(new RegExp(`<td[^>]*data-date="${day}"[^>]*>(.*?)</td>`))?.[1];
describe('体験用カレンダーの保存済み予定', () => {
  it('distinguishes submitted deadlines by the saved item identity', () => {
    const html = renderToStaticMarkup(<DemoCalendarView integration={integration} pending={false} now={now} submitted={new Set(['task'])} />);
    expect(cell(html, '2026-11-12')).toContain('calendar-event submitted');
    expect(cell(html, '2026-11-12')).toContain('出せました');
    expect(render()).not.toContain('出せました');
  });
  it('日本時間の今日から7列を出し、日付だけの締切に時刻を補わない', () => {
    const html = render(integration, true);
    expect(html).toContain('締切のカレンダー');
    expect(html).toContain('体験用の予定です。Googleカレンダーには入りません。');
    expect(html.match(/<th scope="col"/g)).toHaveLength(7);
    expect(html).toContain('11/6（金）');
    expect(cell(html, '2026-11-06')).toBeDefined();
    expect(cell(html, '2026-11-12')).toContain('架空のレポート');
    expect(cell(html, '2026-11-12')).toContain('日付のみ');
    expect(html).toContain('予定の更新を待っています');
    expect(html).not.toMatch(/23:59|class="[^"]*changed/);
  });
  it('日時を日本時間の日付の列へ置き、授業名と課題名を分ける', () => {
    const event: DeadlineEvent = { ...integration.mockEvents!.abcde!.event, summary: '架空の授業：架空の課題',
      start: { dateTime: '2026-11-09T15:30:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-11-09T15:35:00Z', timeZone: 'UTC' } };
    const html = renderToStaticMarkup(<DemoCalendarView integration={{ ...integration,
      mockEvents: { timed: { itemKey: 'timed', generation: 1, revision: 1, event } } }}
      pending={false} now={now} courses={[{ name: '架空の授業' }]} />);
    expect(cell(html, '2026-11-10')).toContain('<time>00:30</time> <strong>架空の課題</strong>');
    expect(cell(html, '2026-11-10')).toContain('<span class="muted">架空の授業</span>');
    expect(cell(html, '2026-11-09')).not.toContain('架空の課題');
  });
  it('UTCと日本時間の予定を同日の実時刻順に並べ、日付のみを日本時間の先頭に置く', () => {
    const base = integration.mockEvents!.abcde!;
    const event = base.event;
    const html = render({ ...integration, mockEvents: {
      lms: { ...base, event: { ...event, summary: '夕方の課題', start: { dateTime: '2026-11-09T08:00:00Z', timeZone: 'UTC' } } },
      manual: { ...base, event: { ...event, summary: '昼の課題', start: { dateTime: '2026-11-09T13:45:00+09:00', timeZone: 'Asia/Tokyo' } } },
      allDay: { ...base, event: { ...event, summary: '日付だけの課題', start: { date: '2026-11-09' } } },
      early: { ...base, event: { ...event, summary: '早朝の課題', start: { dateTime: '2026-11-08T16:00:00Z', timeZone: 'UTC' } } },
    } });
    const day = cell(html, '2026-11-09')!;
    expect(day.indexOf('日付だけの課題')).toBeLessThan(day.indexOf('早朝の課題'));
    expect(day.indexOf('早朝の課題')).toBeLessThan(day.indexOf('昼の課題'));
    expect(day.indexOf('昼の課題')).toBeLessThan(day.indexOf('夕方の課題'));
  });
  it('授業のない課題名に含まれる全角コロンを分割しない', () => {
    const base = integration.mockEvents!.abcde!;
    const html = render({ ...integration, mockEvents: {
      manual: { ...base, event: { ...base.event, summary: 'レポート：第3回' } },
    } });
    expect(cell(html, '2026-11-12')).toContain('<strong>レポート：第3回</strong>');
    expect(cell(html, '2026-11-12')).not.toContain('<span class="muted">レポート</span>');
  });
  it('準備の予定は準備の表示と課題名を分ける', () => {
    const base = integration.mockEvents!.abcde!;
    const html = render({ ...integration, mockEvents: {
      preparation: { ...base, event: { ...base.event, summary: '準備：書き方を書くレポート' } },
    } });
    expect(cell(html, '2026-11-12')).toContain('<strong>書き方を書くレポート</strong><span class="muted">準備</span>');
  });
  it('7日の外の予定を畳み、予定が無ければ空の案内を出さない', () => {
    const html = renderToStaticMarkup(<DemoCalendarView integration={integration} pending={false} now={Date.parse('2026-11-13T00:00:00Z')} />);
    expect(html).toContain('<details class="calendar-outside">');
    expect(html).toContain('11/12：日付のみ 架空のレポート');
    const empty = render({ ...integration, mockEvents: {} }, true);
    expect(empty).not.toContain('calendar-outside');
    expect(empty).not.toContain('架空のレポート');
    expect(empty).not.toContain('同期済み');
  });
});
