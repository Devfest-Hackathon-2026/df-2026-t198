import { expect, it } from 'vitest';
import { applyObservation } from '../src/ledger.js';
import type { Observation } from '../src/types.js';

const at = '2026-11-10T03:00:00Z';
function observation(id: string, date: string, title = '架空の課題'): Observation {
  return { schemaVersion: 1, observationId: id, system: 'demo-lms', definitionId: 'demo', definitionVersion: 1,
    fetchedAt: at, catalogCourses: [{ courseId: 'fictional-course', name: '架空の授業', slots: [] }],
    courseResults: [{ courseId: 'fictional-course', listComplete: true, seenSourceIds: ['fictional-task'] }],
    assignments: [{ sourceId: 'fictional-task', courseId: 'fictional-course', title,
      url: 'https://example.invalid/task', submission: 'not-submitted',
      deadline: { kind: 'date', date, dueText: date, timeZone: 'Asia/Tokyo' } }], failures: [] };
}

it('現行の応答だけでは新規・締切変更・題名変更を区別できず、課題キーも含まれない', () => {
  const initial = applyObservation([], observation('first', '2026-11-11'), at);
  const deadline = applyObservation(initial.assignments, observation('second', '2026-11-12'), at);
  const title = applyObservation(initial.assignments, observation('third', '2026-11-11', '架空の改題'), at);
  expect(initial.changes.map(change => change.kind)).toEqual(['new']);
  expect(deadline.changes.map(change => change.kind)).toEqual(['deadline-changed']);
  expect(title.changes.map(change => change.kind)).toEqual(['title-changed']);
  expect(deadline.result).toEqual(initial.result);
  expect(title.result).toEqual(initial.result);
  expect(deadline.result).toEqual({ status: 'applied', changed: true, changeCount: 1 });
});

it('同じ内容の次の取得では変更を増やさず、締切変更の履歴には課題と変更前後がある', () => {
  const first = applyObservation([], observation('first', '2026-11-11'), at);
  const second = applyObservation(first.assignments, observation('second', '2026-11-12'), at);
  expect(second.changes[0]).toMatchObject({ assignmentKey: { system: 'demo-lms', sourceId: 'fictional-task' },
    before: { kind: 'date', date: '2026-11-11' }, after: { kind: 'date', date: '2026-11-12' } });
  expect(applyObservation(second.assignments, observation('third', '2026-11-12'), at).result)
    .toEqual({ status: 'applied', changed: false, changeCount: 0 });
});

it.todo('合意後：(a) 締切変更IDと課題キーを応答に含め、旧応答を締切変更と誤表示しない');
it.todo('合意後：(a) 同一観測の再送でバッジを再通知せず、本人変更で通知対象を残さない');
it.todo('合意後：(a) 取得中・失敗バッジを保ち、正常終了後だけ締切変更を表示する');
it.todo('合意後：(a) 通常popupと両立し、複数の締切変更から指定課題へ移動できる');
