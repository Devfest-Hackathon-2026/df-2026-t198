import { BlazerBody, DeviceBody, ExplainingBody, HoodieBody, StudentHead, SupporterHead, TeacherHead, WalkingBody } from './peeps-paths';

export type StoryRole = 'teacher' | 'student' | 'supporter';
export type StoryPose = 'desk' | 'phone' | 'walking' | 'seated';
export const roleNames: Record<StoryRole, string> = { teacher: '先生', student: '学生', supporter: '支援担当' };
export const storyPalette = {
  name: '先生は墨、学生は深い青、支援担当は紫',
  colors: { teacher: 'var(--story-teacher)', student: 'var(--story-student)', supporter: 'var(--story-supporter)' },
} as const;
export type StoryPalette = typeof storyPalette;

export function StoryPerson({ role, pose = 'desk', color, x = 0, y = 0, width = 200, height = 250 }: {
  role: StoryRole; pose?: StoryPose; color: string; x?: number; y?: number; width?: number; height?: number;
}) {
  const Head = role === 'teacher' ? TeacherHead : role === 'student' ? StudentHead : SupporterHead;
  const Body = pose === 'walking' ? WalkingBody : pose === 'phone' ? DeviceBody
    : role === 'teacher' ? BlazerBody : role === 'student' ? HoodieBody : ExplainingBody;
  return <svg x={x} y={y} width={width} height={height} viewBox={pose === 'walking' ? '-140 -60 1160 3020' : '-60 -60 1040 1290'}
    role="img" aria-label={`${roleNames[role]}・${{ desk: '机に向かう', phone: 'スマホを持つ', walking: '歩く', seated: '面談で座る' }[pose]}`}
    style={{ color }} data-role={role} data-pose={pose}>
    <Body /><g transform="translate(225 0)"><Head /></g>
    {pose === 'phone' && <g transform="rotate(16 660 805)" aria-label="手に持ったスマホ">
      <rect x="602" y="695" width="116" height="216" rx="15" fill="var(--story-ink)" />
      <rect x="611" y="706" width="98" height="193" rx="8" fill="var(--story-phone)" />
      <path d="M637 715h45" stroke="var(--story-ink)" strokeWidth="6" strokeLinecap="round" />
      <path d="M602 828q68-35 79-11 4 17-63 36Z" fill="currentColor" />
    </g>}
  </svg>;
}
