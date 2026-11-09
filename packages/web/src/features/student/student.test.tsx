import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deadlineText, pending, StudentView } from './page';
import { assignment, dated, studentFixture } from '../../shared/testing/student-fixture';
import { studentFitFixture } from '../../shared/testing/student-fit-fixture';
describe('学生が締切を確かめる画面', () => {
  it('終了した課題は次の締切に数えず、過去の学期の授業は時間割にも出さない', () => {
    const data = studentFixture();
    const ended = assignment('終了したレポート', dated('2026-11-12'));
    ended.presenceState = 'ended';
    data.assignments = [ended];
    expect(pending(data.assignments)).toEqual([]);
    data.courses[0]!.currentTerm = false;
    const html = renderToStaticMarkup(<StudentView data={data} />);
    expect(html).not.toContain('架空の線形代数');
    expect(html).not.toContain('終了したレポート');
    expect(html).toContain('今週の締切はありません');
  });
  it('時間割のマスの締切は日付だけにし、読み上げには時刻を残す', () => {
    const data = studentFixture();
    data.assignments = [assignment('レポートA', { kind: 'datetime', dueAt: '2026-11-12T08:30:00Z', dueText: '', timeZone: 'Asia/Tokyo' })];
    const html = renderToStaticMarkup(<StudentView data={data} now={Date.parse('2026-11-10T03:00:00Z')} />);
    const cell = html.match(/<button class="course-cell[^>]*>.*?<\/button>/)![0];
    expect(cell.match(/class="course-deadline">(.*?)<\/span>/)![1]!.replace(/<[^>]+>/g, '')).toBe('11/12 · 1件');
    expect(cell).toContain('aria-description="11/12 17:30');
  });
  it('前の学期でも残っている締切は一覧に出し、時間割には出さない', () => {
    const data = studentFixture();
    data.courses[0]!.currentTerm = false;
    const html = renderToStaticMarkup(<StudentView data={data} />);
    expect(html).toContain('今週の締切');
    expect(html).toContain('レポートA');
    expect(html).toContain('レポートB');
    expect(html.match(/架空の線形代数/g)).toHaveLength(2); // 締切の一覧だけ
    expect(html).not.toContain('提出した課題');
    expect(html).not.toContain('取り消した課題');
  });
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
    expect(html.match(/<strong>架空の線形代数<\/strong>/g)).toHaveLength(2);
    expect(html).toContain('架空の別大学の授業</strong></button>');
    expect(html).toContain('日</th>');
    expect(html).toContain('6限');
    expect(html).toContain('架空の集中講義');
  });
  it.each([false, true])('LMS原文が「-」なら日時の記載がないと示し、既知締切を保持する: %s', known => {
    const item = assignment('架空のレポート', dated('2026-11-10'), {
      reviewReasons: [{ kind: 'unreadable-deadline', detail: 'unreadable' }],
    });
    item.latest.deadline = { kind: 'unreadable', dueText: ' - ', timeZone: 'Asia/Tokyo' };
    if (!known) item.officialDeadline = null;
    const before = JSON.stringify(item);
    const html = renderToStaticMarkup(<StudentView data={{ ...studentFixture(), assignments: [item] }} />);
    expect(html).toContain('LMSに締切日時の記載がありません（表示「-」）');
    expect(html).toContain('要確認');
    expect(html).not.toContain('締切を確認できていません');
    expect(html).not.toContain('締切なし');
    if (known) expect(html).toContain('11/10（日付のみ）');
    expect(JSON.stringify(item)).toBe(before);
  });
  it('初回の案内と、締切なし・不明・タイムゾーン付き日時を区別する', () => {
    const html = renderToStaticMarkup(<StudentView data={{ manualAssignments: [], plans: [], courses: [], assignments: [], fetchStates: [], online: true }} />);
    expect(html).toContain('まだ課題がありません');
    expect(html).not.toContain('要確認');
    expect(deadlineText({ kind: 'none', dueText: 'なし', timeZone: 'Asia/Tokyo' })).toBe('締切なし');
    expect(deadlineText(undefined)).toBe('締切を確認できていません');
    expect(deadlineText({ kind: 'datetime', dueAt: '2026-11-10T08:30:00Z', dueText: '', timeZone: 'Asia/Tokyo' })).toBe('11/10 17:30');
    expect(pending([assignment('不明', { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' }),
      assignment('日付あり', dated('2026-11-12'))]).map(a => a.latest.title)).toEqual(['日付あり', '不明']);
  });
  it('最終成功から72時間の境界で案内を出し、新しい情報には出さない', () => {
    const data = studentFixture();
    data.fetchStates = [{ ...data.fetchStates[0]!, lastSucceededAt: '2026-11-03T15:30:00Z', lastResult: 'success' }];
    const render = (now: string) => renderToStaticMarkup(<StudentView data={data} now={Date.parse(now)} />);
    expect(render('2026-11-06T15:29:59Z')).not.toContain('から更新がありません');
    expect(render('2026-11-06T15:30:00Z')).toContain('11/4から更新がありません。LMSを開くと新しくなります。');
    expect(render('2026-11-07T15:30:00Z')).not.toContain('changed');
  });

});

it('架空の長い英語付き授業名と同一コマの2授業を保持し、締切を1行にまとめる', () => {
  const data = studentFitFixture(studentFixture(), true);
  const html = renderToStaticMarkup(<StudentView data={data} now={Date.parse('2026-11-09')} />);
  for (const course of data.courses) {
    expect(html).toContain(`title="${course.name}" aria-label="${course.name}"`);
  }
  expect(html.match(/<div class="timetable-slot">(.*?)<\/div>/)![1]!.match(/<button/g)).toHaveLength(2);
  expect(html).toContain('11/10 · 2件');
  expect(html.match(/scope="row"/g)).toHaveLength(7);
  expect(html.match(/scope="col"/g)).toHaveLength(8);
});

it.each(['partial', 'failed'] as const)('学生の失敗の案内を維持する: %s', lastResult => {
  const data = studentFixture();
  data.fetchStates = [{ ...data.fetchStates[0]!, system: 'ynu-lms', lastSucceededAt: null, lastResult }];
  const html = renderToStaticMarkup(<StudentView data={data} now={Date.parse('2026-11-06T15:30:00Z')} />);
  expect(html).toContain('class="notice"');
  expect(html).toContain('YNU LMS：課題をすべて確認できていません。LMSを開いて確かめてください。');
});
