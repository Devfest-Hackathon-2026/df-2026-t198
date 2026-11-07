import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionPlanning } from '../src/session-planning';
import { emptySession } from '../src/session-model';
import { assignment, dated } from '../src/student-fixture';
import type { PreparationPlan } from '../../core/src/types';

it.each(['2030-11-15', '2030-11-16', '2030-11-17'])('opens the first candidate week despite an active plan this Friday/weekend: %s', date => {
  const task = assignment('架空のレポート', dated('2030-11-20'));
  const plan: PreparationPlan = { planId: 'fictional', assignment: task.key, title: task.latest.title,
    date, period: 3, startsAt: `${date}T13:00:00+09:00`, endsAt: `${date}T14:30:00+09:00`,
    timeZone: 'Asia/Tokyo', decidedOn: date, confirmedBy: 'student', createdByRole: 'student',
    confirmedAt: `${date}T00:00:00Z`, status: 'active', revision: 1, calendarItemKey: 'fictional' };
  const data = { ...emptySession(), assignments: [task], plans: [plan],
    context: { lastSessionAt: null, nextSessionAt: '2030-11-22T15:00:00+09:00' } };
  const html = renderToStaticMarkup(<SessionPlanning data={data} now={new Date(`${date}T09:00:00+09:00`)} />);
  expect(html).toContain('aria-pressed="true">2030/11/18の週');
  expect(html).toContain('session-candidate');
  expect(html.indexOf('2030/11/11の週')).toBeLessThan(html.indexOf('2030/11/18の週'));
});

it.each(['2030-11-15', '2030-11-16', '2030-11-17'])('shows the selected task deadline in its day column, including weekends: %s', date => {
  const task = assignment('架空のレポート', dated(date));
  const data = { ...emptySession(), assignments: [task],
    context: { lastSessionAt: null, nextSessionAt: '2030-11-20T15:00:00+09:00' } };
  const html = renderToStaticMarkup(<SessionPlanning data={data} now={new Date('2030-11-14T09:00:00+09:00')} />);
  expect(html).toContain(`締切 ${date.replaceAll('-', '/')}（日付のみ）`);
  expect(html).not.toContain('23:59');
  expect(html).toContain('session-deadline');
});
