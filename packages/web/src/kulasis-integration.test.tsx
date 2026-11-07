import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudentView } from './student';
import { SessionPlanning } from './session-planning';
import { assignment, dated } from './student-fixture';
import { emptySession } from './session-model';
import type { StudentData } from './student-data';
import expected from '../../../lms-definitions/kulasis/samples/observation.expected.json';
import type { Course } from '../../core/src/types';

it('places a linked KULMS task in the timetable while leaving a same-name unlinked site outside', () => {
  const row = assignment('架空の対応済み課題', dated('2030-11-12'));
  row.key = { system: 'kulms', sourceId: 'fictional-task' }; row.latest.courseId = 'fictional-site';
  const data: StudentData = { courses: [
    ...expected.catalogCourses.map(c => ({ ...c, slots: c.slots as Course['slots'], system: 'kulasis' as const })),
    { system: 'kulms', courseId: 'fictional-site', name: '架空のKULMS名', slots: [] },
    { system: 'kulms', courseId: 'fictional-unlinked', name: '架空の授業', slots: [] },
  ], assignments: [row], fetchStates: [], online: true, plans: [], manualAssignments: [] };
  const before = JSON.stringify(data);
  const student = renderToStaticMarkup(<StudentView data={data} now={Date.parse('2030-11-08')} />);
  expect(student.match(/class="course-cell[^"]*"[^>]*>.*?架空のKULMS名.*?架空の対応済み課題/g)).toHaveLength(2);
  expect(student).toContain('曜日・時限のない授業');
  const session = renderToStaticMarkup(<SessionPlanning data={{ ...emptySession(), ...data }} now={new Date('2030-11-08')} />);
  expect(session).toContain('架空のKULMS名<small>架空の対応済み課題</small>');
  expect(session).toContain('aria-label="曜日・時限がまだ分からない授業"');
  expect(JSON.stringify(data)).toBe(before);
});
