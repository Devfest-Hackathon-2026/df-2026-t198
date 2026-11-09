import { StoryBubble, storyInk } from './props';

export const storyCourse = '文章表現';
export const storyAssignment = '第3回レポート（要約と引用）';
export type StoryScreenKind = 'lms' | 'change' | 'preparation' | 'calendar' | 'mail';

function AssignmentHeading() {
  return <><text fontSize="18" fontWeight="700">{storyCourse}</text><text y="32" fontSize="19">{storyAssignment}</text></>;
}

export function StoryTimetable({ prepared, x = 0, y = 0 }: { prepared: boolean; x?: number; y?: number }) {
  return <g transform={`translate(${x} ${y})`} role="img" aria-label={prepared ? '準備を入れた後の時間割' : '準備を入れる前の時間割'}>
    <text y="0" fontSize="17" fontWeight="700">{prepared ? '決めたあと' : '決める前'}</text>
    <rect y="20" width="218" height="142" fill="var(--paper)" stroke="var(--line)" />
    {['火 11/10', '水 11/11', '木 11/12'].map((day, index) => <text key={day} x={44 + index * 69} y="42" textAnchor="middle" fontSize="12">{day}</text>)}
    <path d="M9 52H209M9 105H209M78 24V158M147 24V158" fill="none" stroke="var(--line)" />
    <text x="14" y="78" fontSize="13">文章表現</text><text x="20" y="94" fontSize="11">2限</text>
    <rect x="82" y="109" width="61" height="48" fill={prepared ? 'var(--marker)' : 'var(--story-sheet)'} stroke={prepared ? 'var(--story-marker-line)' : 'var(--line-strong)'} strokeDasharray={prepared ? undefined : '3 3'} />
    <text x="113" y="131" textAnchor="middle" fontSize="15" fontWeight="700">{prepared ? '準備' : '空き'}</text>
    <text x="113" y="149" textAnchor="middle" fontSize="11">3限</text>
  </g>;
}

export function StoryPhone({ screen, x = 0, y = 0, width = 170, prepared = false }: {
  screen: 'calendar' | 'mail'; x?: number; y?: number; width?: number; prepared?: boolean;
}) {
  return <svg x={x} y={y} width={width} height={width * 1.65} viewBox="0 0 180 297" role="img" aria-label={screen === 'calendar' ? 'スマホのカレンダー' : '今日やることのメール通知'}>
    <rect x="2" y="2" width="176" height="293" rx="23" fill={storyInk} />
    <rect x="9" y="9" width="162" height="279" rx="17" fill="var(--story-sheet)" />
    <path d="M67 16h46" stroke={storyInk} strokeWidth="5" strokeLinecap="round" />
    <text x="23" y="44" fontSize="12" className="story-time">{screen === 'mail' ? '07:30' : '10:30'}</text>
    <text x="22" y="74" fontSize="17" fontWeight="700">{screen === 'calendar' ? 'カレンダー' : 'メール'}</text>
    <path d="M19 87H161" stroke="var(--line)" />
    {screen === 'calendar' ? <>
      <text x="22" y="111" fontSize="13">{prepared ? '11/11 水' : '11/13 金'}</text>
      <rect x="18" y="123" width="144" height="109" rx="7" fill={prepared ? 'var(--marker-soft)' : 'var(--story-blue-soft)'} />
      <text x="28" y="147" fontSize="16" fontWeight="700">{prepared ? '13:00 準備' : '17:00 締切'}</text>
      <text x="28" y="173" fontSize="13">文章表現</text><text x="28" y="196" fontSize="13">第3回レポート</text>
      <text x="28" y="216" fontSize="12">要約と引用</text>
      <text x="22" y="257" fontSize="12">{prepared ? '2人で決めた予定' : '11/12から変更'}</text>
    </> : <>
      <text x="23" y="111" fontSize="12">ToDoku たった今</text>
      <rect x="18" y="124" width="144" height="129" rx="8" fill="var(--story-blue-soft)" />
      <text x="28" y="149" fontSize="16" fontWeight="700">今日やること</text>
      <text x="28" y="177" fontSize="13">13:00 文章表現</text>
      <text x="28" y="199" fontSize="13">第3回レポートの</text><text x="28" y="221" fontSize="13">準備をします</text>
    </>}
    <path d="M65 277h50" stroke={storyInk} strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

export function StoryScreen({ kind, x = 0, y = 0, width = 535, height = 370 }: {
  kind: StoryScreenKind; x?: number; y?: number; width?: number; height?: number;
}) {
  const titles = { lms: 'LMS · 課題の締切', change: '面談画面 · 前回からの変化', preparation: '面談画面 · 空きコマに準備を入れる', calendar: 'スマホ · カレンダーの締切', mail: 'スマホ · 今日やることのメール' };
  return <svg x={x} y={y} width={width} height={height} viewBox="-24 0 559 400">
    <StoryBubble width={535} height={368} title={titles[kind]}>
      <AssignmentHeading />
      {kind === 'lms' && <>
        <text y="84" fontSize="16">変更前</text><text x="132" y="84" fontSize="27" className="story-time">11/12 17:00</text>
        <path d="M132 93H316" stroke="var(--line-strong)" strokeWidth="2" />
        <text y="145" fontSize="16">変更後</text><text x="132" y="145" fontSize="29" fontWeight="700" fill="var(--story-student)" className="story-time">11/13 17:00</text>
        <rect y="184" width="481" height="44" rx="5" fill="var(--story-success-soft)" /><text x="16" y="212" fontSize="17">先生が締切を1日延ばしました</text>
      </>}
      {kind === 'change' && <>
        <text y="90" fontSize="25" fontWeight="700" fill="var(--accent-text)">締切が変わった</text>
        <text y="146" fontSize="36" className="story-time">11/12 → 11/13</text>
        <text y="183" fontSize="18">17:00</text><text x="209" y="183" fontSize="18">17:00</text>
        <text y="232" fontSize="16">学生が共有を許可している課題</text>
      </>}
      {kind === 'preparation' && <>
        <StoryTimetable x={0} y={73} prepared={false} /><StoryTimetable x={260} y={73} prepared />
        <text x="235" y="176" textAnchor="middle" fontSize="24">→</text>
        <text y="251" fontSize="17">11/11 13:00–14:00 · 要約と引用の準備</text>
      </>}
      {kind === 'calendar' && <>
        <text y="82" fontSize="18">締切が移ったあとの予定</text>
        <rect y="105" width="481" height="103" rx="5" fill="var(--story-blue-soft)" />
        <text x="18" y="146" fontSize="31" fontWeight="700" fill="var(--story-student)" className="story-time">11/13 17:00</text>
        <text x="18" y="181" fontSize="18">第3回レポートの締切</text>
        <text y="242" fontSize="17">11/12 17:00 から変更</text>
      </>}
      {kind === 'mail' && <>
        <text y="80" fontSize="16">ToDokuから · 7:30</text>
        <text y="125" fontSize="29" fontWeight="700">今日やること</text>
        <rect y="150" width="481" height="80" rx="5" fill="var(--marker-soft)" />
        <text x="16" y="182" fontSize="21">13:00–14:00 レポートの準備</text>
        <text x="16" y="212" fontSize="17">要約する部分と、引用する部分を決める</text>
      </>}
    </StoryBubble>
  </svg>;
}
