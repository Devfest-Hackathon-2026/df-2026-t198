import type { ReactNode } from 'react';
import { StoryPerson, type StoryPalette } from './people';
import { StoryBrand, StoryClock, StoryDesk, StoryLaptop, StoryRoom, storyPaper } from './props';
import { StoryPhone, StoryScreen } from './screens';

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

export function StoryScene({ scene, palette }: { scene: StorySceneId; palette: StoryPalette }) {
  const item = storyScenes.find(item => item.id === scene) ?? storyScenes[0];
  const colors = palette.colors;
  const room = scene === 'office' ? 'office' : scene === 'bedroom' || scene === 'morning' ? 'bedroom' : 'consultation';
  return <StorySheet label={`${item.day} ${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')} · ${item.place}`}
    title={item.title} footer={item.caption}>
    <StoryRoom kind={room} daylight={scene === 'morning'} x={42} y={146} width={590} height={425} />
    {scene === 'office' && <>
      <StoryClock kind="wall" hour={14} minute={0} x={273} y={154} size={92} />
      <StoryPerson role="teacher" color={colors.teacher} x={180} y={265} width={266} height={293} />
      <StoryDesk x={130} y={491} width={438} /><StoryLaptop x={259} y={362} width={204} />
      <StoryScreen kind="lms" x={667} y={155} width={540} height={400} />
    </>}
    {scene === 'bedroom' && <>
      <StoryClock kind="phone" hour={21} minute={0} x={522} y={390} size={89} />
      <StoryPerson role="student" color={colors.student} x={175} y={263} width={265} height={290} />
      <StoryDesk x={144} y={491} width={360} /><StoryLaptop x={244} y={369} width={195} />
      <StoryScreen kind="calendar" x={667} y={155} width={540} height={400} />
      <text x="665" y="586" fontSize="17">LMSを開く → 拡張が読む → ToDokuに記録</text>
    </>}
    {scene === 'consultation' && <>
      <StoryPerson role="supporter" color={colors.supporter} x={182} y={240} width={276} height={310} />
      <StoryDesk x={118} y={491} width={455} /><StoryLaptop x={195} y={363} width={207} />
      <StoryClock kind="table" hour={10} minute={0} x={462} y={375} size={96} />
      <StoryScreen kind="change" x={667} y={155} width={540} height={400} />
    </>}
    {scene === 'meeting' && <>
      <StoryPerson role="student" pose="seated" color={colors.student} x={77} y={267} width={255} height={280} />
      <StoryPerson role="supporter" pose="seated" color={colors.supporter} x={313} y={262} width={252} height={281} />
      <StoryDesk x={67} y={491} width={534} /><StoryLaptop x={243} y={378} width={181} />
      <StoryClock kind="table" hour={10} minute={30} x={490} y={387} size={85} />
      <StoryPhone screen="calendar" prepared x={83} y={391} width={58} />
      <text x="128" y="582" textAnchor="middle" fontSize="17" fill={colors.student}>学生</text>
      <text x="461" y="582" textAnchor="middle" fontSize="17" fill={colors.supporter}>支援担当</text>
      <StoryScreen kind="preparation" x={648} y={155} width={585} height={422} />
    </>}
    {scene === 'morning' && <>
      <StoryPerson role="student" pose="phone" color={colors.student} x={161} y={244} width={285} height={316} />
      <StoryDesk x={154} y={501} width={333} />
      <StoryPhone screen="mail" x={500} y={370} width={107} />
      <StoryClock kind="phone" hour={7} minute={30} x={79} y={171} size={79} />
      <StoryScreen kind="mail" x={667} y={155} width={540} height={400} />
    </>}
  </StorySheet>;
}

export function StoryEyecatch() {
  return <StorySheet label="ロゴ" title="ToDoku" footer="">
    <StoryBrand x={334} y={294} scale={2} />
  </StorySheet>;
}
