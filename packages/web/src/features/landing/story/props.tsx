import type { ReactNode } from 'react';
import { TodokuMark } from '../../../shared/ui/todoku-logo';

export const storyInk = 'var(--story-ink)';
export const storyPaper = 'var(--paper)';

export function StoryDesk({ x = 0, y = 0, width = 450 }: { x?: number; y?: number; width?: number }) {
  return <g transform={`translate(${x} ${y})`} aria-label="机">
    <g transform={`scale(${width / 450})`}>
      <path d="M4 30h442v49H4Z" fill={storyPaper} />
      <path d="M24 18v98M426 18v98" stroke={storyInk} strokeWidth="10" />
      <rect width="450" height="28" rx="4" fill="var(--story-wood)" stroke={storyInk} strokeWidth="3" />
    </g>
  </g>;
}

export function StoryLaptop({ x = 0, y = 0, width = 205 }: { x?: number; y?: number; width?: number }) {
  return <svg x={x} y={y} width={width} height={width * .67} viewBox="0 0 220 148" role="img" aria-label="背面がこちらを向いたノートPC">
    <path d="M24 12Q23 5 32 5H188Q197 5 196 12L187 123H33Z" fill="var(--story-laptop)" stroke={storyInk} strokeWidth="4" />
    <path d="M9 124H211L218 134Q218 142 208 142H12Q2 142 2 134Z" fill="var(--story-laptop-base)" stroke={storyInk} strokeWidth="4" />
    <path d="M88 126H132L128 132H92Z" fill={storyInk} />
  </svg>;
}

export function StoryClock({ kind, hour, minute, x = 0, y = 0, size = 100 }: {
  kind: 'wall' | 'phone' | 'table'; hour: number; minute: number; x?: number; y?: number; size?: number;
}) {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (kind === 'table') return <svg x={x} y={y} width={size} height={size * .45} viewBox="0 0 240 108" role="img" aria-label={`木枠のデジタル置時計 ${time}`} data-clock="table" data-time={time}>
    <rect x="1" y="1" width="238" height="106" rx="9" fill="var(--story-clock-wood)" stroke="var(--story-clock-grain)" strokeWidth="2" />
    <path d="M10 8h220M10 99h220M7 16v75M233 16v75" stroke="var(--story-clock-grain)" opacity=".6" />
    <rect x="13" y="15" width="214" height="78" rx="5" fill="var(--story-lcd)" stroke="var(--story-lcd-ink)" strokeWidth="2" />
    <g transform="translate(26 25)" fill="var(--story-lcd-ink)">
      {[...time].map((digit, index) => digit === ':' ? <g key={index} transform="translate(86 0)"><rect x="0" y="15" width="5" height="5" /><rect x="0" y="37" width="5" height="5" /></g>
        : <SevenSegment key={index} digit={Number(digit)} x={index < 2 ? index * 42 : 98 + (index - 3) * 42} />)}
    </g>
  </svg>;
  if (kind === 'phone') return <svg x={x} y={y} width={size} height={size * 1.5} viewBox="0 0 140 210" role="img" aria-label={`スマホの時計 ${time}`}>
    <rect x="3" y="3" width="134" height="204" rx="19" fill={storyInk} />
    <rect x="9" y="9" width="122" height="192" rx="14" fill="var(--story-phone)" />
    <path d="M50 14h40" stroke={storyInk} strokeWidth="5" strokeLinecap="round" />
    <text x="70" y="83" textAnchor="middle" fontSize="35" className="story-time">{time}</text>
    <text x="70" y="111" textAnchor="middle" fontSize="13">ロック画面</text>
    <path d="M52 188h36" stroke={storyInk} strokeWidth="3" strokeLinecap="round" />
  </svg>;
  return <svg x={x} y={y} width={size} height={size * 1.18} viewBox="0 0 120 142" role="img" aria-label={`${kind === 'wall' ? '壁掛け時計' : '置時計'} ${time}`}>
    <circle cx="60" cy="59" r="51" fill={storyPaper} stroke={storyInk} strokeWidth="4" />
    {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(angle => <path key={angle} d="M60 14v7" stroke={storyInk} strokeWidth="2" transform={`rotate(${angle} 60 59)`} />)}
    <path data-hand="hour" d="M60 59V33" stroke={storyInk} strokeWidth="5" strokeLinecap="round" transform={`rotate(${(hour % 12) * 30 + minute / 2} 60 59)`} />
    <path data-hand="minute" d="M60 59V20" stroke={storyInk} strokeWidth="3" strokeLinecap="round" transform={`rotate(${minute * 6} 60 59)`} />
    <circle cx="60" cy="59" r="4" fill={storyInk} />
    <text x="60" y="140" textAnchor="middle" fontSize="16" className="story-time">{time}</text>
  </svg>;
}

function SevenSegment({ digit, x }: { digit: number; x: number }) {
  const paths = ['M5 0h25l-4 5H9Z', 'M31 2v24l-5-4V7Z', 'M31 30v24l-5-5V34Z', 'M5 56l4-5h17l4 5Z', 'M3 30l5 4v15l-5 5Z', 'M3 2l5 5v15l-5 4Z', 'M5 28l4-3h17l4 3-4 3H9Z'];
  const segments = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'][digit] ?? '';
  return <g transform={`translate(${x} 0)`} data-digit={digit}>{paths.map((d, index) => <path key={d} d={d} opacity={segments.includes('abcdefg'[index]!) ? 1 : .055} />)}</g>;
}

export function StoryRoom({ kind, daylight = false, x = 0, y = 0, width = 600, height = 430 }: {
  kind: 'office' | 'bedroom' | 'consultation'; daylight?: boolean; x?: number; y?: number; width?: number; height?: number;
}) {
  return <svg x={x} y={y} width={width} height={height} viewBox="0 0 600 430" role="img" aria-label={{ office: '研究室の背景', bedroom: '学生の部屋の背景', consultation: '相談室の背景' }[kind]}>
    <g fill="none" stroke="var(--story-room-line)" strokeWidth="3" strokeLinejoin="round">
      <path d="M20 372H580" />
      {kind === 'office' && <><path d="M33 50H182V330H33ZM33 141H182M33 235H182" />
        {[51, 78, 112, 143].map((book, index) => <g key={book}><path d={`M${book} 68v70h19V68ZM${book} 163v69h19v-69`} fill={index % 2 ? 'var(--story-book)' : 'var(--surface)'} /></g>)}
        <g aria-label="研究の図があるホワイトボード"><rect x="352" y="42" width="220" height="176" rx="3" fill="var(--story-sheet)" />
          <path d="M367 191h184M376 185V65M390 164l29-42 29 16 35-51 55 22M395 75h40m-20-9v18M488 164l15-16 16 16-16 15ZM450 167h28M530 162h22" stroke="var(--story-border)" />
        </g>
        <g aria-label="資料のファイル"><path d="M48 258h21v66H48ZM76 252h25v72H76ZM108 263h24v61h-24ZM140 255h25v69h-25Z" fill="var(--story-book)" /><path d="M53 271h10m19-5h13m19 11h12m20-8h13" /></g>
        <g aria-label="2台目のモニター"><rect x="433" y="254" width="125" height="81" rx="4" fill="var(--story-laptop)" stroke="var(--story-ink)" /><path d="M495 335v25m-28 0h56" stroke="var(--story-ink)" strokeWidth="5" /></g></>}
      {kind === 'bedroom' && <><rect x="365" y="32" width="192" height="170" fill={daylight ? 'var(--story-day)' : 'var(--story-night)'} /><path d="M461 32V202M365 119H557" />
        {daylight ? <circle cx="516" cy="70" r="17" fill="var(--story-sun)" stroke="none" /> : <path d="M512 58a24 24 0 0 0 21 34 26 26 0 0 1-21-34Z" fill="var(--story-moon)" stroke="none" />}
        <path d="M18 290h175q18 0 18 18v62H18ZM18 322h193M18 370v29m178-29v29M26 282h58v35H26Z" fill="var(--story-bedding)" />
        <path d="M41 281v-57h12v58" /></>}
      {kind === 'consultation' && <><path d="M500 372l-9-81h62l-9 81ZM524 295V173" fill="var(--story-book)" />
        <path d="M524 247q-61-13-51-58 46 2 51 58ZM524 218q6-47 47-50 8 38-47 50ZM523 278q-41-2-44-31 36-8 44 31Z" fill="var(--story-leaf)" />
        <path d="M48 57H218V190H48Z" /><path d="M67 169l42-55 31 30 26-43 36 68Z" fill="var(--surface)" />
        <path d="M84 307h120m-104 0v65m89-65v65" /></>}
    </g>
  </svg>;
}

export function StoryBubble({ x = 0, y = 0, width = 510, height = 340, title, children }: {
  x?: number; y?: number; width?: number; height?: number; title: string; children: ReactNode;
}) {
  return <svg x={x} y={y} width={width} height={height + 30} viewBox={`-24 0 ${width + 24} ${height + 30}`} role="img" aria-label={title}>
    <path d={`M0 42Q0 24 18 24H${width - 18}Q${width} 24 ${width} 42V${height - 18}Q${width} ${height} ${width - 18} ${height}H18Q0 ${height} 0 ${height - 18}V${height - 62}L-22 ${height - 42} 0 ${height - 99}Z`} fill="var(--story-sheet)" stroke="var(--story-border)" strokeWidth="2" />
    <text x="24" y="59" fontSize="17" fontWeight="700">{title}</text>
    <path d={`M20 78H${width - 20}`} stroke="var(--line)" />
    <g transform="translate(24 106)">{children}</g>
  </svg>;
}

export function StoryBrand({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} role="img" aria-label="ToDokuのロゴと名前">
    <svg width="64" height="64"><TodokuMark /></svg>
    <text x="82" y="51" className="story-wordmark" fontSize="56" fontWeight="700">ToDo<tspan fill="var(--accent)">ku</tspan></text>
  </g>;
}
