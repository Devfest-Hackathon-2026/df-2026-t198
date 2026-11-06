import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionPlanning } from '../src/session-planning';
import { emptySession } from '../src/session-model';
import { assignment, dated } from '../src/student-fixture';

it.each(['2030-11-15', '2030-11-16', '2030-11-17'])('shows the selected task deadline in its day column, including weekends: %s', date => {
  const task = assignment('架空のレポート', dated(date));
  const data = { ...emptySession(), assignments: [task],
    context: { lastSessionAt: null, nextSessionAt: '2030-11-20T15:00:00+09:00' } };
  const html = renderToStaticMarkup(<SessionPlanning data={data} now={new Date('2030-11-14T09:00:00+09:00')} />);
  expect(html).toContain(`締切 ${date.replaceAll('-', '/')}（日付のみ）`);
  expect(html).not.toContain('23:59');
  expect(html).toContain('session-deadline');
});
