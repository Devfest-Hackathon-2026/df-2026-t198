import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deadlineText, pending, StudentView } from './student';
import { assignment, dated, studentFixture } from './student-fixture';

describe('学生が締切を確かめる画面', () => {
  it('常設の操作説明を省き、要確認の詳しい説明は授業を選んだ先に置く', () => {
    const html = renderToStaticMarkup(<StudentView data={studentFixture()} />);
    expect(html).not.toContain('授業を押すと、課題が開きます。');
    expect(html).not.toContain('今回、締切を読めませんでした。前に確認できた締切があれば、そのまま出しています。');
    expect(html).toContain('要確認');
    expect(html).toContain('締切を確認できていません');
  });
  it('締切順に並び、提出と取消は次の締切に数えない', () => {
    expect(pending(studentFixture().assignments).map(a => a.latest.title)).toEqual(['レポートA', 'レポートB']);
  });
  it('読めない回でも、前に確認できた締切を出し、日付だけに時刻を補わない', () => {
    const data = studentFixture();
    data.assignments[1]!.latest.deadline = { kind: 'unreadable', dueText: '不明', timeZone: 'Asia/Tokyo' };
    const html = renderToStaticMarkup(<StudentView data={data} now={Date.parse('2026-11-06')} />);
    expect(html).toContain('11/10（日付のみ）');
    expect(html).not.toContain('23:59');
    expect(html).toContain('要確認');
    expect(html).toContain('要確認：締切を確認できていません。');
    expect(html).toContain('から更新がありません');
    expect(html).not.toContain('未提出');
  });
  it('同じ授業IDの別大学を混ぜず、週末・6限・複数コマ・時限のない授業を出す', () => {
    const html = renderToStaticMarkup(<StudentView data={studentFixture()} />);
    expect(html.match(/架空の線形代数/g)).toHaveLength(4); // 一覧2つと授業の2コマ
    expect(html).toContain('架空の別大学の授業</strong></button>');
    expect(html).toContain('日</th>');
    expect(html).toContain('6限');
    expect(html).toContain('架空の集中講義');
  });
  it('初回の案内と、締切なし・不明・タイムゾーン付き日時を区別する', () => {
    const html = renderToStaticMarkup(<StudentView data={{ plans: [], courses: [], assignments: [], fetchStates: [], online: true }} />);
    expect(html).toContain('まだ課題がありません');
    expect(html).not.toContain('要確認');
    expect(deadlineText({ kind: 'none', dueText: 'なし', timeZone: 'Asia/Tokyo' })).toBe('締切なし');
    expect(deadlineText(undefined)).toBe('締切を確認できていません');
    expect(deadlineText({ kind: 'datetime', dueAt: '2026-11-10T08:30:00Z', dueText: '', timeZone: 'Asia/Tokyo' })).toBe('11/10 17:30');
    expect(pending([assignment('不明', { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' }),
      assignment('日付あり', dated('2026-11-12'))]).map(a => a.latest.title)).toEqual(['日付あり', '不明']);
  });
});
