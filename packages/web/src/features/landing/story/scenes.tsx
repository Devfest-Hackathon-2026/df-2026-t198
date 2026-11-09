import type { ReactNode } from 'react';
import { StoryBrand, storyPaper } from './props';
import { StoryScreen } from './screens';
import { StoryRoomStage } from './room';

export const storyScenes = [
  { id: 'office', place: '研究室', day: '月', hour: 14, minute: 0, title: '先生がLMSの締切を延ばす', caption: '「文章表現」のレポートを、11/12 17:00から11/13 17:00へ。' },
  { id: 'bedroom', place: '学生の部屋', day: '月', hour: 21, minute: 0, title: '学生がいつもどおりLMSを開く', caption: '拡張機能が変更を読み取り、ToDokuに記録。スマホのカレンダーも更新されます。' },
  { id: 'consultation', place: '相談室', day: '火', hour: 10, minute: 0, title: '支援担当が締切の変化を確かめる', caption: '学生が共有を許可した課題を、支援担当が面談の前に確かめます。' },
  { id: 'meeting', place: '面談', day: '火', hour: 10, minute: 30, title: '2人で準備の予定を決める', caption: '空きコマを見ながら相談し、11/11 13:00にレポートの準備を入れます。' },
  { id: 'morning', place: '翌朝の学生の部屋', day: '水', hour: 7, minute: 30, title: '朝のメールで今日の予定を知る', caption: '7:30。「今日やること」のメールで、面談で決めた準備の予定を確かめます。' },
] as const;
export type StorySceneId = typeof storyScenes[number]['id'];

export function StorySheet({ label, title, footer, children }: { label: string; title: string; footer: string; children: ReactNode }) {
  return <svg className="story-sheet" viewBox="0 0 1280 720" role="img" aria-label={title}>
    <rect width="1280" height="720" fill="var(--accent)" />
    <text x="36" y="39" fill={storyPaper} fontSize="15" className="story-time">ToDoku / {label}</text>
    <text x="36" y="83" fill={storyPaper} fontSize="31" fontWeight="700">{title}</text>
    <rect x="28" y="108" width="1224" height="522" rx="12" fill={storyPaper} />
    {children}
    <text x="36" y="678" fill={storyPaper} fontSize="18">{footer}</text>
  </svg>;
}

export function StoryScene({ scene }: { scene: StorySceneId }) {
  const item = storyScenes.find(item => item.id === scene) ?? storyScenes[0];
  return <StorySheet label={`${item.day} ${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')} · ${item.place}`} title={item.title} footer={item.caption}>
    <svg x="42" y="146" width="590" height="425" viewBox="0 0 600 430"><StoryRoomStage scene={scene} /></svg>
    <StoryScreen kind={scene === 'office' ? 'lms' : scene === 'bedroom' ? 'calendar' : scene === 'consultation' ? 'change' : scene === 'meeting' ? 'preparation' : 'mail'} x={650} y={155} width={565} height={410} />
  </StorySheet>;
}

export function StoryEyecatch() {
  return <StorySheet label="ロゴ" title="ToDoku" footer="">
    <StoryBrand x={334} y={294} scale={2} />
  </StorySheet>;
}
