import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarIntegration } from '@kadai-hisho/core';
import { DemoCalendarView } from './demo-calendar';

const integration: CalendarIntegration = { mode: 'mock', executor: 'demo', calendarId: 'demo-calendar', connectionState: 'connected',
  mockEvents: { abcde: { itemKey: 'task', generation: 1, revision: 1, event: { summary: '架空のレポート', description: '',
    start: { date: '2026-11-12' }, end: { date: '2026-11-13' }, transparency: 'transparent', reminders: { useDefault: true } } } } };
describe('体験用カレンダーの保存済み予定', () => {
  it('marks the mock destination, preserves date-only precision and shows pending separately', () => {
    const html = renderToStaticMarkup(<DemoCalendarView integration={integration} pending />);
    expect(html).toContain('体験用カレンダー');
    expect(html).toContain('Googleカレンダーには入りません');
    expect(html).toContain('2026-11-12（日付のみ）');
    expect(html).toContain('予定の更新を待っています');
    expect(html).not.toContain('23:59');
  });
  it('does not synthesize events from desired state or display a success claim', () => {
    const html = renderToStaticMarkup(<DemoCalendarView integration={{ ...integration, mockEvents: {} }} pending />);
    expect(html).not.toContain('架空のレポート');
    expect(html).not.toContain('同期済み');
  });
});
