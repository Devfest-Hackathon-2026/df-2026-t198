import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { CalendarIntegration, CalendarItem, ManualAssignment } from '@kadai-hisho/core';
import { studentFixture } from '../../shared/testing/student-fixture';
import { assignCourseColors, courseIdentityKey } from '../../shared/course-color';
import { CourseColorProvider } from '../../shared/course-color-context';
import { calendarCourses } from './course-colors';
import { DemoCalendarView } from './calendar';

it('resolves same-name courses by saved source identities and leaves preparation/unassigned items uncolored', () => {
  const data = studentFixture();
  const first = data.assignments[0]!;
  const second = { ...first, key: { system: 'kulms' as const, sourceId: first.key.sourceId } };
  data.courses[1]!.name = data.courses[0]!.name;
  const item = (itemKey: string, kind: CalendarItem['kind'], sourceKey: CalendarItem['sourceKey']): CalendarItem => ({
    itemKey, kind, sourceKey, calendarId: null, eventId: itemKey, generation: 1, desiredRevision: 1,
    desired: { state: 'deleted' }, appliedRevision: 0, appliedAt: null, lastAttemptedAt: null, lastErrorCode: null,
  });
  const items = [item('first', 'deadline', first.key), item('second', 'deadline', second.key),
    item('prep', 'preparation', first.key), item('unknown', 'deadline', { system: 'demo-lms', sourceId: 'missing' }),
    item('manual', 'manual-deadline', { system: 'manual', sourceId: 'manual' }),
    item('unassigned', 'manual-deadline', { system: 'manual', sourceId: 'unassigned' })];
  const manual = [{ manualAssignmentId: 'manual', course: { system: 'demo-lms', courseId: 'math' } },
    { manualAssignmentId: 'unassigned', course: null }] as ManualAssignment[];
  const before = JSON.stringify({ data, items, manual });
  const map = calendarCourses(items, [...data.assignments, second], data.courses, manual);
  expect([...map.keys()]).toEqual(['first', 'second', 'manual']);
  expect(map.get('first')).toBe(data.courses[0]);
  expect(map.get('second')).toBe(data.courses[1]);
  expect(map.get('manual')).toBe(data.courses[0]);
  expect(JSON.stringify({ data, items, manual })).toBe(before);

  const integration: CalendarIntegration = { mode: 'mock', executor: 'demo', calendarId: 'demo', connectionState: 'connected',
    mockEvents: Object.fromEntries(items.map(row => [row.itemKey, { itemKey: row.itemKey, generation: 1, revision: 1, event: {
      summary: `${data.courses[0]!.name}：${row.itemKey}`, description: '', start: { date: '2026-11-12' }, end: { date: '2026-11-13' },
      transparency: 'transparent', reminders: { useDefault: true },
    } }])) };
  const colors = assignCourseColors(data.courses);
  const html = renderToStaticMarkup(<CourseColorProvider courses={data.courses}>
    <DemoCalendarView integration={integration} pending={false} now={Date.parse('2026-11-09')}
      courses={data.courses} courseByItem={map} /></CourseColorProvider>);
  expect(html.match(/data-course-color=/g)).toHaveLength(3);
  expect(html).toContain(`data-course-color="${colors.get(courseIdentityKey(data.courses[0]!))}"`);
  expect(html).toContain(`data-course-color="${colors.get(courseIdentityKey(data.courses[1]!))}"`);
  expect(html).toContain(data.courses[0]!.name);
});
