import { storyScenes } from './scenes';

export const mechanismSteps = [
  { ...storyScenes[0], duration: 4800, lines: ['先生がLMSで締切を', '11/12から11/13に延ばします。'] },
  { ...storyScenes[1], duration: 6000, lines: ['LMSを開くと、拡張が変更を読み取り、', 'ToDokuとスマホのカレンダーに届きます。'] },
  { ...storyScenes[2], duration: 4000, lines: ['共有を許可した課題の変更を、', '支援担当も同じ締切で確かめます。'] },
  { ...storyScenes[3], duration: 6400, lines: ['空きコマを見ながら、一緒に準備を決めると、', '学生のスマホにも予定が入ります。'] },
  { ...storyScenes[4], duration: 4300, lines: ['面談で決めた準備の予定を、', '朝の「今日やること」で確かめます。'] },
  { id: 'summary', title: '変更と準備の予定がつながる', duration: 4300, lines: ['いつものLMS閲覧から、手で書き写さずに共有。', '同じ締切を見ながら、準備を一緒に決めます。'] },
  { id: 'eyecatch', title: 'ToDoku', duration: 2600, lines: ['', ''] },
] as const;
export const transitionDuration = 1100;
export const sceneEnd = [3700, 4900, 2900, 5300, 3200, 4300, 2600] as const;
export type StoryCue = 'send' | 'clock' | 'schedule' | 'notify';
export const storyCues: readonly (readonly { at: number; sound: StoryCue }[])[] = [
  [{ at: 1300, sound: 'send' }, { at: 3750, sound: 'clock' }],
  [{ at: 2800, sound: 'schedule' }, { at: 4950, sound: 'clock' }],
  [{ at: 2950, sound: 'clock' }],
  [{ at: 3000, sound: 'schedule' }, { at: 3300, sound: 'notify' }, { at: 5350, sound: 'clock' }],
  [{ at: 1000, sound: 'notify' }], [], [],
];
