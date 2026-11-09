import { StoryPerson, roleNames, storyPalettes, type StoryPalette, type StoryPose, type StoryRole } from './people';
import { StoryBrand, StoryClock, StoryDesk, StoryLaptop, StoryRoom, storyPaper } from './props';
import { StorySheet } from './scenes';
import { StoryPhone, StoryScreen, type StoryScreenKind } from './screens';

export function StoryCatalog({ palette }: { palette: StoryPalette }) {
  const poses: { role: StoryRole; pose: StoryPose; label: string }[] = [
    { role: 'teacher', pose: 'desk', label: '先生 / 机' },
    { role: 'student', pose: 'desk', label: '学生 / 机' },
    { role: 'supporter', pose: 'desk', label: '支援担当 / 机' },
    { role: 'student', pose: 'phone', label: '学生 / スマホ' },
    { role: 'student', pose: 'walking', label: '学生 / 歩く' },
    { role: 'student', pose: 'seated', label: '学生 / 面談' },
    { role: 'supporter', pose: 'seated', label: '支援担当 / 面談' },
  ];
  return <StorySheet label="素材一覧" title="人物・道具・背景の見本" footer={`${palette.name} ｜ 画面の中身は「画面の見本」で拡大できます。`}>
    {poses.map((item, index) => <g key={item.label}>
      <StoryPerson {...item} color={palette.colors[item.role]} x={46 + index * 137} y={135} width={120} height={190} />
      {item.pose === 'desk' && <><StoryDesk x={53 + index * 137} y={284} width={107} /><StoryLaptop x={79 + index * 137} y={246} width={56} /></>}
      <text x={106 + index * 137} y="354" textAnchor="middle" fontSize="14">{item.label}</text>
    </g>)}
    <StoryLaptop x={1056} y={162} width={130} /><StoryDesk x={1031} y={247} width={183} />
    <text x="1123" y="354" textAnchor="middle" fontSize="14">机とノートPC</text>
    <path d="M48 382H1230" stroke="var(--line)" />
    {(['office', 'bedroom', 'consultation'] as const).map((kind, index) => <g key={kind}>
      <StoryRoom kind={kind} x={45 + index * 220} y={407} width={202} height={150} />
      <text x={146 + index * 220} y="588" textAnchor="middle" fontSize="16">{['研究室', '学生の部屋', '相談室'][index]}</text>
    </g>)}
    <StoryClock kind="wall" hour={14} minute={0} x={730} y={424} size={80} />
    <StoryClock kind="phone" hour={21} minute={0} x={827} y={416} size={74} />
    <StoryClock kind="table" hour={10} minute={30} x={919} y={431} size={80} />
    <text x="865" y="588" textAnchor="middle" fontSize="15">時刻を指定できる時計</text>
    <StoryBrand x={1030} y={448} scale={.6} />
    <text x="1124" y="588" textAnchor="middle" fontSize="15">アイキャッチ</text>
  </StorySheet>;
}

export function StoryScreensCatalog() {
  return <StorySheet label="画面の見本" title="画面の中身を、吹き出しで拡大する" footer="架空の授業「文章表現」と、第3回レポート（要約と引用）の見本です。">
    {(['lms', 'change', 'preparation', 'calendar', 'mail'] as StoryScreenKind[]).map((kind, index) => <StoryScreen key={kind} kind={kind}
      x={43 + (index % 3) * 402} y={115 + Math.floor(index / 3) * 251} width={386} height={248} />)}
    <StoryPhone screen="calendar" x={908} y={387} width={116} />
    <StoryPhone screen="mail" x={1082} y={387} width={116} />
  </StorySheet>;
}

export function StoryColorsCatalog() {
  return <StorySheet label="配色の比較" title="3人を見分ける配色を選ぶ" footer="上段は生成り、下段は朱色。同じ人物・大きさで比較しています。">
    {storyPalettes.map((palette, index) => <g key={palette.id} transform={`translate(${48 + index * 403} 133)`}>
      <text x="0" y="17" fontSize="20" fontWeight="700">{palette.name}</text>
      <rect y="50" width="377" height="170" rx="6" fill={storyPaper} stroke="var(--line)" />
      <rect y="250" width="377" height="170" rx="6" fill="var(--accent)" />
      {(['teacher', 'student', 'supporter'] as StoryRole[]).map((role, roleIndex) => <g key={role}>
        {[57, 257].map(y => <StoryPerson key={y} role={role} color={palette.colors[role]} x={11 + roleIndex * 125} y={y} width={110} height={152} />)}
        <text x={66 + roleIndex * 125} y="239" textAnchor="middle" fontSize="14">{roleNames[role]}</text>
        <text x={66 + roleIndex * 125} y="446" textAnchor="middle" fontSize="13" className="story-time">{roleNames[role]}</text>
      </g>)}
    </g>)}
  </StorySheet>;
}
