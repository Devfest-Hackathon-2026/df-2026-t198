import type { CSSProperties } from 'react';
import { StoryBrand } from './props';
import { StoryActionScreen } from './film-screen';
import { StoryRoomStage, clockFocus } from './room';
import { mechanismSteps, transitionDuration } from './timeline';
import type { StorySceneId } from './scenes';

function Summary() {
  return <div className="story-summary" aria-label="先生から学生、ToDokuを通じてスマホと支援担当へ">
    <div className="story-summary-places">
      {(['office', 'bedroom', 'meeting'] as const).map((scene, index) => <div key={scene}>
        <svg viewBox="0 0 600 430" role="img" aria-label={['先生の研究室', '学生の部屋', '2人の相談室'][index]}><StoryRoomStage scene={scene} /></svg>
        <span>{['先生が締切を変更', '学生がLMSを開く', '同じ締切で準備を相談'][index]}</span>
      </div>)}
    </div>
    <svg className="story-summary-lines" viewBox="0 0 1100 95" aria-hidden="true">
      <path d="M175 0v33H530M550 0v33M570 33h355V0M550 64v29" fill="none" stroke="var(--story-student)" strokeWidth="3" strokeDasharray="6 5" />
      <path d="m916 11 9-10 9 10M541 81l9 10 9-10" fill="none" stroke="var(--story-student)" strokeWidth="3" />
      <rect x="474" y="9" width="154" height="51" rx="10" fill="var(--paper)" stroke="var(--story-student)" strokeWidth="2" />
      <text x="551" y="43" textAnchor="middle" fontSize="27" fontWeight="700">ToDoku</text>
    </svg>
    <p className="story-summary-result">スマホの締切 11/13 17:00 · 準備 11/11 13:00</p>
  </div>;
}

export function MechanismFilm({ step, elapsed, still = false }: { step: number; elapsed: number; still?: boolean }) {
  const item = mechanismSteps[step] ?? mechanismSteps[0];
  if (item.id === 'eyecatch') return <div className="story-film story-eyecatch" data-scene="eyecatch">
    <svg viewBox="0 0 600 250" role="img" aria-label="ToDokuのロゴと名前"><StoryBrand x={98} y={82} scale={1.3} /></svg>
  </div>;
  if (item.id === 'summary') return <div className="story-film" data-scene="summary"><Summary /></div>;
  // Clock transitions occupy the end of a scene. Manual navigation starts at a stable frame.
  const next = mechanismSteps[step + 1];
  const progress = !still && next && 'hour' in next ? Math.max(0, (elapsed - (item.duration - transitionDuration)) / transitionDuration) : 0;
  const swapped = progress >= .5;
  const shown = swapped && next && 'hour' in next ? next : item;
  const fromMinutes = item.hour * 60 + item.minute;
  const toMinutes = next && 'hour' in next ? next.hour * 60 + next.minute + (next.day === item.day ? 0 : 1440) : fromMinutes;
  const clockMinutes = Math.round(fromMinutes + (toMinutes - fromMinutes) * progress);
  const zoom = Math.sin(Math.min(1, progress) * Math.PI);
  const scale = 1 + zoom * 5;
  const focus = clockFocus[shown.id];
  const x = (300 - focus.x * scale) * zoom;
  const y = (215 - focus.y * scale) * zoom;
  return <div className="story-film story-two-shot" data-scene={item.id} data-transition={progress > 0} style={{ '--story-zoom': zoom } as CSSProperties}>
    <svg className="story-room-shot" viewBox="0 0 600 430" role="img" aria-label={shown.place}>
      <g transform={`translate(${x} ${y}) scale(${scale})`} data-camera-scale={scale}>
        <StoryRoomStage scene={shown.id as StorySceneId} elapsed={swapped ? 0 : elapsed} clockMinutes={clockMinutes} />
      </g>
    </svg>
    <div className="story-screen-shot" style={{ opacity: 1 - zoom }}>
      <StoryActionScreen scene={item.id} elapsed={elapsed} />
    </div>
  </div>;
}
