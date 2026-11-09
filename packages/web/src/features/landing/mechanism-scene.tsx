import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { bindScene, layouts, routeKeys, type NodeKey } from './mechanism-motion';

export interface SceneHandle { draw: (step: number, elapsed: number) => void }
function Card({ node, at, children, app = false }: { node: NodeKey; at: readonly [number, number]; children: ReactNode; app?: boolean }) {
  return <g className={`node${app ? ' app' : ''}`} data-node={node} transform={`translate(${at.join(' ')})`}>
    <rect className="node-ring" data-k={`ring${node}`} x="-5" y="-5" width="138" height="82" rx="14" />
    <rect className="node-body" width="128" height="72" rx="10" />{children}
  </g>;
}
function Value({ prefix }: { prefix: string }) {
  return <><g data-k={`${prefix}Old`}><text className="node-value" x="12" y="59">11/12</text></g>
    <path className="node-strike" data-k={`${prefix}Strike`} d="M84 55H122" />
    <rect className="scene-marker" data-k={`${prefix}Mark`} x="8" y="40" width="74" height="24" rx="3" />
    <text className="node-value is-new" data-k={`${prefix}New`} x="12" y="59">11/13</text></>;
}
export function MechanismScene({ ref, step = 0, compact = false, still = false }: { ref?: Ref<SceneHandle>; step?: number; compact?: boolean; still?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const draw = useRef<SceneHandle['draw']>(() => {});
  const layout = layouts[compact ? 'compact' : 'wide'];
  useLayoutEffect(() => {
    if (!svg.current) return;
    draw.current = bindScene(svg.current, layout);
    draw.current(step, still ? Infinity : 0);
  }, [layout, step, still]);
  useImperativeHandle(ref, () => ({ draw: (stage, elapsed) => draw.current(stage, elapsed) }), []);
  return <div className={`flow-board${compact ? ' is-compact' : ''}`}>
    <svg ref={svg} className="flow-scene" viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true" focusable="false">
      <g className="scene-wires">{routeKeys.map(key => <path key={key} d={layout.routes[key]} />)}</g>
      <g className="scene-lit">{routeKeys.map(key => <path key={key} data-k={key} d={layout.routes[key]} />)}</g>
      <Card node="T" at={layout.at.T}><text className="node-label" x="12" y="21">先生のLMS</text><Value prefix="t" /></Card>
      <Card node="S" at={layout.at.S}>
        <text className="node-label" x="12" y="21">学生のPC</text>
        <g data-k="sOpen"><text className="node-link" x="12" y="55">LMSを開く</text><path className="node-link-line" d="M12 59H75" /></g>
        <rect className="scene-marker" data-k="sMark" x="8" y="40" width="74" height="24" rx="3" />
        <text className="node-value is-new" data-k="sNew" x="12" y="59">11/13</text>
        <g className="node-ext" data-k="sExt"><rect x="68" y="-10" width="56" height="19" rx="9.5" /><text x="96" y="3.5" textAnchor="middle">拡張機能</text></g>
      </Card>
      <Card node="H" at={layout.at.H}>
        <g className="node-logo"><rect x="10" y="8" width="20" height="20" rx="5" /><path d="M13.2 14H20.8V22H17.2V17.6H13.2ZM22.8 14H26.8V22H22.8Z" /></g>
        <text className="node-label is-tight" x="34" y="22">ToDokuの台帳</text><Value prefix="h" />
      </Card>
      <Card node="M" at={layout.at.M} app>
        <text className="node-label" x="12" y="21">学生のスマホ</text>
        <text className="node-time scene-mono" data-k="mTime" x="118" y="21" textAnchor="end">7:30</text>
        <g data-k="mCal"><text className="node-day scene-mono" x="12" y="40">11/12</text><text className="node-day scene-mono" x="70" y="40">11/13</text>
          <path className="node-divider" d="M64 30V66" />
          <g className="node-chip is-ghost" data-k="mGhost"><rect x="10" y="45" width="48" height="20" rx="4" /><text x="34" y="59" textAnchor="middle">17:00</text></g>
          <g className="node-chip" data-k="mChip"><rect x="10" y="45" width="48" height="20" rx="4" /><text x="34" y="59" textAnchor="middle">17:00</text></g>
          <rect className="scene-marker" data-k="mMark" x="68" y="66" width="48" height="3.5" rx="1.5" />
        </g>
        <g data-k="mMail"><path className="node-envelope" d="M12 31H30V44H12ZM12 31L21 38L30 31" />
          <rect className="scene-marker" data-k="mMailMark" x="34" y="29" width="80" height="19" rx="3" />
          <text className="node-mail" x="36" y="43">今日やること</text><text className="node-mail-sub scene-mono" x="12" y="62">締切 11/13 17:00</text>
        </g>
      </Card>
      <Card node="P" at={layout.at.P}><text className="node-label" x="12" y="21">支援担当のPC</text>
        <text className="node-muted" data-k="pBefore" x="12" y="55">変化なし</text><path className="node-strike" data-k="pStrike" d="M10 51H64" />
        <g data-k="pAfter"><rect className="scene-marker" data-k="pMark" x="8" y="30" width="98" height="19" rx="3" />
          <text className="node-alert" x="12" y="44">締切が変わった</text><text className="node-change scene-mono" x="12" y="63">11/12 → 11/13</text></g>
      </Card>
      <circle className="scene-pulse" data-k="pulse" r="4" /><circle className="scene-ripple" data-k="ripple" r="10" />
      <g className="scene-cursor" data-k="cursor"><circle className="scene-ring" data-k="clickRing" r="10" /><path d="M0 0V18L4.3 13.9L7.7 21.2L10.6 20L7.4 12.8H13.1Z" /></g>
    </svg>
  </div>;
}
