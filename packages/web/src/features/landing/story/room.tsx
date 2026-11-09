import { StoryPerson, storyPalette } from './people';
import { StoryClock, StoryDesk, StoryLaptop, StoryRoom } from './props';
import { StoryPhone } from './screens';
import type { StorySceneId } from './scenes';

export const clockFocus: Record<StorySceneId, { x: number; y: number }> = {
  office: { x: 285, y: 75 }, bedroom: { x: 537, y: 277 }, consultation: { x: 503, y: 320 },
  meeting: { x: 503, y: 320 }, morning: { x: 537, y: 277 },
};

export function StoryRoomStage({ scene, elapsed = 4000, clockMinutes }: { scene: StorySceneId; elapsed?: number; clockMinutes?: number }) {
  const colors = storyPalette.colors;
  const office = scene === 'office';
  const bedroom = scene === 'bedroom' || scene === 'morning';
  const meeting = scene === 'meeting';
  const walking = meeting && elapsed < 1600;
  const moving = elapsed < 2200 ? Math.sin(elapsed / 230) * 2 : 0;
  const hour = office ? 14 : scene === 'bedroom' ? 21 : scene === 'morning' ? 7 : 10;
  const minute = scene === 'meeting' || scene === 'morning' ? 30 : 0;
  const time = clockMinutes ?? hour * 60 + minute;
  return <g data-room={scene}>
    <StoryRoom kind={office ? 'office' : bedroom ? 'bedroom' : 'consultation'} daylight={scene === 'morning'} />
    {office && <StoryClock kind="wall" hour={Math.floor(time / 60) % 24} minute={time % 60} x={240} y={24} size={90} />}
    {meeting ? <>
      {walking ? <g data-action="enter" transform={`translate(${-120 + Math.min(1, elapsed / 1500) * 232} ${Math.sin(elapsed / 80) * 3})`}>
        <StoryPerson role="student" pose="walking" color={colors.student} x={0} y={65} width={112} height={312} />
      </g> : <g data-action="seated" transform={`translate(0 ${elapsed < 1900 ? (1900 - elapsed) / -35 : 0})`}>
        <StoryPerson role="student" pose="seated" color={colors.student} x={49} y={125} width={230} height={260} />
      </g>}
      <g transform={`translate(0 ${elapsed >= 2000 && elapsed < 3300 ? Math.sin(elapsed / 180) * 2 : 0})`}>
        <StoryPerson role="supporter" pose="seated" color={colors.supporter} x={284} y={121} width={242} height={270} />
      </g>
    </> : <g data-action="actor" transform={`translate(0 ${moving})`}>
      <StoryPerson role={office ? 'teacher' : bedroom ? 'student' : 'supporter'} pose={scene === 'morning' ? 'phone' : 'desk'}
        color={office ? colors.teacher : bedroom ? colors.student : colors.supporter} x={143} y={118} width={268} height={295} />
    </g>}
    <StoryDesk x={meeting ? 44 : 111} y={350} width={meeting ? 534 : 474} />
    {scene !== 'morning' && <StoryLaptop x={meeting ? 212 : 220} y={350 - 200 * .67 * 144 / 148} width={200} />}
    {!office && !bedroom && <StoryClock kind="table" hour={Math.floor(time / 60) % 24} minute={time % 60} x={443} y={296} size={120} />}
    {bedroom && <StoryClock kind="phone" hour={Math.floor(time / 60) % 24} minute={time % 60} x={491} y={350 - 92 * 1.5 * 207 / 210} size={92} />}
    {meeting && !walking && <g data-action="phone" data-vibrating={elapsed >= 3300 && elapsed < 3900}
      transform={`translate(${elapsed >= 3300 && elapsed < 3900 ? Math.sin(elapsed / 18) * 4 : 0} 0)`}>
      <StoryPhone screen="calendar" prepared={elapsed >= 3300} x={79} y={350 - 61 * 1.65 * 295 / 297} width={61} />
    </g>}
    <text x="300" y="419" textAnchor="middle" fontSize="19" fontWeight="700" fill={office ? colors.teacher : bedroom ? colors.student : colors.supporter}>
      {office ? '先生' : bedroom ? '学生' : meeting ? '学生　　　　　支援担当' : '支援担当'}
    </text>
  </g>;
}
