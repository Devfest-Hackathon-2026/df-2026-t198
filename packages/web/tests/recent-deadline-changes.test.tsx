import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssignmentChange } from '../../core/src/types';
import { StudentView } from '../src/features/student/page';
import { SessionDetails } from '../src/features/session/page';
import { emptySession } from '../src/features/session/model';
import { recentDeadlineChanges } from '../src/shared/assignments/recent-deadline-changes';
import { assignment, dated, studentFixture } from '../src/shared/testing/student-fixture';

const now = Date.parse('2026-11-10T03:00:00Z');
const row = assignment('架空の課題', dated('2026-11-12'));
const change = (patch: Partial<AssignmentChange> = {}): AssignmentChange => ({
  changeId: 'deadline-1', assignmentKey: row.key, kind: 'deadline-changed',
  before: dated('2026-11-11'), after: dated('2026-11-12'),
  observationId: 'observation-2', recordedAt: '2026-11-10T02:00:00Z', ...patch,
});

it('7日以内の締切変更だけを選び、同じ課題の最新1件を新しい順に出す', () => {
  const other = assignment('別の課題', dated('2026-11-13'));
  const latest = change({ changeId: 'latest' });
  const second = change({ changeId: 'second', assignmentKey: other.key, recordedAt: '2026-11-09T00:00:00Z' });
  const rows = recentDeadlineChanges([change({ recordedAt: '2026-11-08T00:00:00Z' }), second, latest, latest,
    change({ kind: 'new' }), change({ kind: 'title-changed' }), change({ recordedAt: '2026-11-11T00:00:00Z' })], [row, other], now);
  expect(rows.map(item => item.change.changeId)).toEqual(['latest', 'second']);
  expect(recentDeadlineChanges([change({ recordedAt: new Date(now - 7 * 86400_000).toISOString() })], [row], now)).toHaveLength(1);
  expect(recentDeadlineChanges([change({ recordedAt: new Date(now - 7 * 86400_000 - 1).toISOString() })], [row], now)).toHaveLength(0);
});

it('提出・取消・終了・不明な課題は除き、同じsourceIdの別LMSと混同しない', () => {
  for (const hidden of [{ ...row, submission: 'submitted' as const }, { ...row, presenceState: 'cancelled' as const },
    { ...row, presenceState: 'ended' as const }, { ...row, key: { ...row.key, system: 'kulms' as const } }]) {
    expect(recentDeadlineChanges([change()], [hidden], now)).toEqual([]);
  }
  expect(recentDeadlineChanges([change()], [], now)).toEqual([]);
  expect(recentDeadlineChanges([change()], [{ ...row, officialDeadline: { ...row.officialDeadline!, deadline: dated('2026-11-09') } }], now)).toHaveLength(1);
});

it('学生は初回表示・開き直しでも変更前後とLMSリンクを確認できる', () => {
  const data = { ...studentFixture(), assignments: [row], changes: [change()] };
  for (let repeat = 0; repeat < 2; repeat++) {
    const html = renderToStaticMarkup(<StudentView data={data} now={now} />);
    expect(html).toContain('最近の締切変更');
    expect(html).toContain('変更前'); expect(html).toContain('変更後');
    expect(html).toContain('11/11'); expect(html).toContain('11/12');
    expect(html).not.toContain('23:59');
    expect(html).toContain('LMSで課題を確かめる');
    expect(html.indexOf('最近の締切変更')).toBeLessThan(html.indexOf('次にやること'));
  }
  expect(renderToStaticMarkup(<StudentView data={{ ...data, changes: [change({ kind: 'new' })] }} now={now} />)).not.toContain('最近の締切変更');
});

it('面談日時がなくても最近の変更を示し、時刻のある締切は時刻まで表示する', () => {
  const data = { ...emptySession(), assignments: [row], courses: studentFixture().courses, changes: [change({
    after: { kind: 'datetime', dueAt: '2026-11-12T08:30:00Z', dueText: '', timeZone: 'Asia/Tokyo' },
  })] };
  const html = renderToStaticMarkup(<SessionDetails data={data} now={new Date(now)} own={false} uid="fictional" planning={false} save={async () => {}} />);
  expect(html).toContain('最近の締切変更'); expect(html).toContain('17:30');
  expect(html).toContain('前回の面談日時未設定');
});

it('複数件は最新1件と残りの折りたたみに分け、件数を課題単位にする', () => {
  const assignments = Array.from({ length: 4 }, (_, i) => assignment(`架空の課題${i}`, dated('2026-11-12')));
  const changes = assignments.map((item, i) => change({ changeId: `change-${i}`, assignmentKey: item.key }));
  const html = renderToStaticMarkup(<StudentView data={{ ...studentFixture(), assignments, changes }} now={now} />);
  expect(html).toContain('ほかの締切変更（3件）');
  expect(html).toContain('最近の締切変更（4件）');
});
