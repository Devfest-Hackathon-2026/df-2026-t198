import './gallery.css';
import { useState } from 'react';
import { Button, DeadlineText, DetailPanel, FetchState, Field, LongWait, NextAction, Notice,
  Reveal, Skeleton, Staged, StatusChip, Tabs, TaskRow, TaskTable } from './index';
import { serverFetch } from '../network';

const now = '2030-11-11T00:00:00Z';
const due = '2030-11-12T08:00:00Z';
const rows = [
  { id: 'report', course: '情報科学入門', title: '第3回 レポート', due, status: 'changed' as const, remaining: 'あと2日' },
  { id: 'exercise', course: '基礎統計', title: '演習シート', due: '2030-11-13T08:00:00Z', status: 'doing' as const, remaining: 'あと3日' },
];
// Imported only by the DEV branch in app.tsx; never shipped in a production bundle.
export default function UiGallery() {
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState(false);
  const [selected, setSelected] = useState('report'); const [tab, setTab] = useState('week');
  async function request() {
    if (busy) return;
    setBusy(true); setFailure(false);
    try { const response = await serverFetch('/api/health?ui-preview=1'); if (!response.ok) throw new Error(); }
    catch { setFailure(true); } finally { setBusy(false); }
  }
  const selectedTask = rows.find(row => row.id === selected)!;
  return <main className="td-gallery app"><Staged><h1>共通UIの見本</h1><p>架空の授業と課題</p></Staged>
    <section aria-label="テーマ"><h2>テーマ</h2><div className="td-gallery-themes">{[
      ['brand', '紹介ページ'], ['app', '学生・面談'], ['lms-skin', '架空のLMS'],
    ].map(([skin, label]) => <div key={skin} className={`td-theme-sample ${skin}`}><strong>{label}</strong><p>情報科学入門</p><Button>課題を開く</Button></div>)}</div></section>
    <section aria-label="ボタン"><h2>操作</h2><div className="td-row-wrap"><Button variant="primary" busy={busy} busyLabel="確認中…" onClick={() => void request()}>課題を確認する</Button>
      <Button>保存する</Button><Button variant="quiet">閉じる</Button><Button busy busyLabel="保存中…">保存する</Button></div>
      <LongWait busy={busy} afterThree="課題の更新を確かめています…" afterTen="サーバーの応答を待っています。操作が終わるまで、この画面でお待ちください。" />
      {failure && <Notice tone="error" title="課題を確認できませんでした">接続を確かめて、もう一度お試しください。</Notice>}</section>
    <section aria-label="状態と締切"><h2>状態と締切</h2><div className="td-row-wrap">{(['todo', 'doing', 'done', 'overdue', 'changed'] as const).map(status => <StatusChip key={status} status={status} />)}</div>
      <div className="td-row-wrap"><DeadlineText due={due} now={now} /><DeadlineText due="2030-11-10T08:00:00Z" now={now} /><DeadlineText due={null} now={now} /></div></section>
    <section aria-label="課題の行"><h2>課題</h2><div className="td-tasklist">{rows.map(row => <TaskRow key={row.id} {...row} now={now} changed={row.status === 'changed'} href="#details" />)}<TaskRow course="文章表現" title="提出したレポート" status="done" /></div></section>
    <section className="td-gallery-grid" aria-label="予定と詳細"><Reveal><NextAction course="情報科学入門" title="第3回 レポート" step="配布資料の問1を読む（15分）" due={due} now={now}
      onStart={() => void request()} busy={busy} busyLabel="確認中…" /></Reveal>
      <Reveal order={1}><div id="details"><DetailPanel title={selectedTask.title} facts={[
        ['授業', selectedTask.course], ['締切', <DeadlineText due={selectedTask.due} now={now} />], ['更新', '11/11 9:00 時点'],
      ]} agreed="配布資料の問1を読む。" actions={<Button>次の一歩を保存</Button>} /></div></Reveal></section>
    <section aria-label="入力と切り替え"><h2>入力</h2><div className="td-gallery-grid"><Field label="課題名" hint="授業で使っている名前" /><Field label="準備する日" type="date" error="日付を選んでください。" /></div>
      <Tabs label="表示する期間" items={[{ value: 'today', label: '今日' }, { value: 'week', label: '今週' }, { value: 'all', label: 'すべての課題' }]} value={tab} onChange={setTab} /></section>
    <section aria-label="課題の表"><TaskTable rows={rows} now={now} selected={selected} onSelect={setSelected} /></section>
    <section aria-label="読み込みとお知らせ"><h2>更新の状態</h2><div className="td-gallery-grid"><div>{(['idle', 'loading', 'empty', 'error'] as const).map(state => <FetchState key={state} state={state} onRetry={() => void request()} busy={state === 'error' && busy} />)}</div><Skeleton /></div>
      <Notice tone="changed" title="締切が変わった">11/11 17:00 → 11/12 17:00</Notice></section>
  </main>;
}
