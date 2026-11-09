import { StoryBubble } from './props';
import { storyAssignment, storyCourse } from './screens';
import type { StorySceneId } from './scenes';

export function StoryActionScreen({ scene, elapsed }: { scene: StorySceneId; elapsed: number }) {
  const sent = elapsed >= 1300;
  const read = elapsed >= 1700;
  const recorded = elapsed >= 2300;
  const updated = elapsed >= 2800;
  const prepared = elapsed >= 3000;
  const notified = elapsed >= 3300;
  const arrived = elapsed >= 1000;
  const title = scene === 'office' ? 'LMS · 課題の締切' : scene === 'bedroom' ? 'LMSからスマホへ'
    : scene === 'consultation' ? '面談画面 · 前回からの変化' : scene === 'meeting' ? '2人で見ている時間割' : 'スマホ · メール';
  return <svg className="story-action-screen" viewBox="-24 0 559 400" role="img" aria-label={title} data-screen={scene} data-updated={scene === 'office' ? sent : scene === 'bedroom' ? updated : scene === 'meeting' ? notified : arrived}>
    <StoryBubble title={title} width={535} height={368}>
      {scene !== 'morning' && <><text fontSize="20" fontWeight="700">{storyCourse}</text><text y="33" fontSize="21">{storyAssignment}</text></>}
      {scene === 'office' && <>
        <text y="88" fontSize="20">締切</text>
        <text y="137" fontSize="40" className="story-time" fill="var(--story-teacher)">{sent ? '11/13 17:00' : '11/12 17:00'}</text>
        {sent && <text y="177" fontSize="23">11/12 → 11/13</text>}
        <rect y="205" width="481" height="43" rx="6" fill={sent ? 'var(--story-success-soft)' : 'var(--surface)'} />
        <text x="17" y="234" fontSize="21">{sent ? '締切の変更を送信しました' : '締切を1日延ばす'}</text>
      </>}
      {scene === 'bedroom' && <>
        <text y="83" fontSize="21">{elapsed < 700 ? 'いつもどおりLMSを開く' : !read ? '拡張機能が締切を読む' : !recorded ? '変更をToDokuへ送る' : 'ToDokuに記録しました'}</text>
        <path d="M0 105h481" stroke="var(--line)" />
        <text y="139" fontSize="20">スマホのカレンダー</text>
        <rect y="159" width="481" height="90" rx="7" fill={updated ? 'var(--story-blue-soft)' : 'var(--surface)'} />
        <text x="17" y="200" fontSize="37" fontWeight="700" className="story-time" fill="var(--story-student)">{updated ? '11/13 17:00' : '11/12 17:00'}</text>
        <text x="17" y="232" fontSize="21">{updated ? '同じ締切の予定が移りました' : 'レポートの締切'}</text>
      </>}
      {scene === 'consultation' && <>
        <text y="97" fontSize="28" fontWeight="700" fill="var(--story-supporter)">締切が変わった</text>
        <text y="155" fontSize="39" className="story-time">11/12 → 11/13</text>
        <text y="192" fontSize="22">17:00</text><text x="241" y="192" fontSize="22">17:00</text>
        <text y="247" fontSize="20">学生が共有を許可している課題</text>
      </>}
      {scene === 'meeting' && <>
        <g transform="translate(0 54)" role="img" aria-label={prepared ? '準備を入れた後の時間割' : '準備を入れる前の時間割'}>
          <rect width="481" height="156" fill="var(--paper)" stroke="var(--line)" />
          {['火 11/10', '水 11/11', '木 11/12'].map((day, index) => <text key={day} x={80 + index * 160} y="28" textAnchor="middle" fontSize="20">{day}</text>)}
          <path d="M0 41h481M0 94h481M160 0v156M320 0v156" fill="none" stroke="var(--line)" />
          <text x="80" y="76" textAnchor="middle" fontSize="23">文章表現</text>
          <rect x="165" y="99" width="150" height="52" rx="4" fill={prepared ? 'var(--marker)' : 'var(--story-sheet)'} stroke="var(--story-marker-line)" strokeDasharray={prepared ? undefined : '4 4'} />
          <text x="240" y="135" textAnchor="middle" fontSize="28" fontWeight="700">{prepared ? '準備' : '空き'}</text>
        </g>
        <text y="248" fontSize="22">{notified ? 'スマホにも予定 · 11/11 13:00–14:00' : prepared ? '準備が決まりました · 水曜3限' : '水曜3限 · 空きコマを一緒に相談'}</text>
      </>}
      {scene === 'morning' && <>
        <text y="6" fontSize="21">07:30</text>
        {arrived ? <>
          <text y="58" fontSize="33" fontWeight="700">今日やること</text>
          <text y="100" fontSize="22">ToDokuから</text>
          <rect y="126" width="481" height="121" rx="7" fill="var(--marker-soft)" />
          <text x="17" y="164" fontSize="27" fontWeight="700">13:00–14:00 準備</text>
          <text x="17" y="201" fontSize="22">文章表現 · 第3回レポート</text>
          <text x="17" y="233" fontSize="20">要約する部分と引用する部分を決める</text>
        </> : <><path d="M143 78h190v122H143Zm0 0 95 73 95-73" fill="none" stroke="var(--story-student)" strokeWidth="4" /><text x="238" y="245" textAnchor="middle" fontSize="24">朝のメール</text></>}
      </>}
    </StoryBubble>
  </svg>;
}
