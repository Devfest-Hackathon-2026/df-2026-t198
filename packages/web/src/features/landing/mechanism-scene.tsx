import type { ReactNode } from 'react';

const focuses = ['teacher', 'student', 'todoku', 'phone', 'supporter', 'phone'];
const crops = ['0 0 320 240', '0 265 330 235', '235 135 300 245', '440 240 280 275', '430 0 290 240', '440 240 280 275'];

function Device({ x, y, name, active, children }: { x: number; y: number; name: string; active: boolean; children: ReactNode }) {
  return <g transform={`translate(${x} ${y})`} className={`scene-device${active ? ' is-focus' : ''}`}>
    <rect className="scene-halo" x="-12" y="-30" width="266" height="202" rx="20" />
    <text className="scene-label" x="0" y="-8">{name}</text>
    <rect className="scene-shell" width="240" height="140" rx="10" />
    <rect className="scene-screen" x="10" y="10" width="220" height="116" rx="3" />
    <path className="scene-base" d="M-10 140H250L236 152H4Z" />{children}
  </g>;
}

export function MechanismScene({ step, compact = false }: { step: number; compact?: boolean }) {
  const focus = focuses[step];
  return <div className={`flow-board flow-scene-${step + 1}${compact ? ' is-compact' : ''}`} data-focus={focus}>
    <svg className="flow-scene" viewBox={compact ? crops[step] : '0 0 720 520'} aria-hidden="true">
      <path className="scene-wire" d="M155 155V360H350V255H575M470 255H590V350" />
      <Device x={30} y={55} name="先生 · LMS" active={focus === 'teacher'}>
        <text className="scene-small" x="25" y="36">課題の締切</text>
        <text className="scene-old" x="25" y="65">11/12 17:00</text><path className="scene-strike" d="M23 59H142" />
        <text className="scene-date" x="25" y="100">11/13 17:00</text>
      </Device>
      <Device x={30} y={345} name="学生 · ノートPC" active={focus === 'student'}>
        <text className="scene-small" x="25" y="36">LMS</text><path className="scene-rule" d="M25 50H210M25 76H145M25 102H180" />
        {step >= 1 && <g className="scene-extension"><rect x="140" y="18" width="78" height="28" rx="5" /><text x="144" y="37">拡張機能</text></g>}
      </Device>
      <g className={`scene-todoku${focus === 'todoku' ? ' is-focus' : ''}`} transform="translate(316 191)">
        <rect className="scene-halo" x="-14" y="-20" width="152" height="150" rx="28" />
        <rect className="scene-hub" width="124" height="110" rx="24" />
        <path className="scene-logo" d="M28 30H66V70H48V48H28M76 30H96V70H76" />
        <text className="scene-hub-label" x="62" y="94" textAnchor="middle">ToDoku</text>
        <text className="scene-label" x="62" y="144" textAnchor="middle">台帳</text>
      </g>
      <Device x={455} y={55} name="支援担当 · PC" active={focus === 'supporter'}>
        <text className="scene-small" x="25" y="36">面談</text>
        <text className={step >= 4 ? 'scene-date' : 'scene-small'} x="25" y="72">{step >= 4 ? '締切が変わった' : '変化なし'}</text>
        {step >= 4 && <text className="scene-small" x="25" y="106">11/12 → 11/13</text>}
      </Device>
      <g className={`scene-phone app${focus === 'phone' ? ' is-focus' : ''}`} transform="translate(500 307)">
        <rect className="scene-halo" x="-15" y="-28" width="200" height="237" rx="26" />
        <text className="scene-label" x="0" y="-8">学生 · スマホ</text>
        <rect className="scene-shell" width="170" height="196" rx="20" />
        <rect className="scene-screen" x="9" y="12" width="152" height="171" rx="12" />
        {step < 5 ? <>
          <text className="scene-small" x="21" y="38">カレンダー・時間割</text>
          <text className="scene-small" x="22" y="68">11/12</text><text className="scene-small" x="94" y="68">11/13</text>
          <path className="scene-rule" d="M85 77V165" />
          {[0, 1].map(row => <g className={`scene-event${step >= 3 ? ' is-moved' : ''}`} key={row} transform={`translate(18 ${84 + row * 43})`}>
            <rect width="62" height="34" rx="4" /><text x="7" y="22">17:00</text>
          </g>)}
        </> : <g className="scene-mail">
          <text className="scene-date" x="24" y="42">翌朝 7:30</text>
          <rect x="22" y="58" width="126" height="106" rx="8" />
          <path className="scene-envelope" d="M39 76H131V119H39ZM39 76L85 103L131 76" />
          <text className="scene-small" x="30" y="146">今日やること</text>
        </g>}
      </g>
    </svg>
    {!compact && <div className="flow-task" data-task="report">
      <span>文章表現</span><strong>第3回レポート<span>（要約と引用）</span></strong>
      <div className="flow-task-date"><s>11/12</s><b>11/13 17:00</b></div>
    </div>}
  </div>;
}
