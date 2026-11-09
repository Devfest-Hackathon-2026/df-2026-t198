import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryAssetsPage from '../src/features/landing/story/page';
import { StoryCatalog } from '../src/features/landing/story/catalog';
import { storyPalette } from '../src/features/landing/story/people';
import { StoryClock } from '../src/features/landing/story/props';
import { StoryScene } from '../src/features/landing/story/scenes';
import { StoryScreen } from '../src/features/landing/story/screens';

it('provides the seven requested role/pose combinations as inline SVG', () => {
  const html = renderToStaticMarkup(<StoryCatalog palette={storyPalette} />);
  for (const [role, poses] of [['teacher', ['desk']], ['student', ['desk', 'phone', 'walking', 'seated']], ['supporter', ['desk', 'seated']]] as const) {
    for (const pose of poses) expect(html).toContain(`data-role="${role}" data-pose="${pose}"`);
  }
  expect(html).not.toMatch(/<img|<image|<foreignObject/);
  expect(html).toContain('背面がこちらを向いたノートPC');
  for (const room of ['研究室の背景', '学生の部屋の背景', '相談室の背景']) expect(html).toContain(room);
});

it('uses only the chosen ink, deep blue and purple palette', () => {
  const tokens = readFileSync(new URL('../src/shared/styles/tokens.css', import.meta.url), 'utf8');
  for (const token of ['--story-teacher: #292C31', '--story-student: #16386C', '--story-supporter: #64446E']) expect(tokens).toContain(token);
  expect(tokens).not.toMatch(/--story-(?:teacher|student|supporter)-[abc]/);
  const html = renderToStaticMarkup(<StoryAssetsPage search="?view=assets" />);
  expect(html).not.toContain('3配色');
  expect(html).not.toContain('aria-label="配色"');
});

it('draws the consultation clock with a wooden case, blue LCD and four seven-segment digits', () => {
  const html = renderToStaticMarkup(<StoryClock kind="table" hour={10} minute={30} size={120} />);
  expect(html).toContain('木枠のデジタル置時計 10:30');
  expect(html).toContain('var(--story-clock-wood)');
  expect(html).toContain('var(--story-lcd)');
  expect([...html.matchAll(/data-digit="(\d)"/g)].map(match => match[1])).toEqual(['1', '0', '3', '0']);
});

it.each([
  ['office', '月 14:00', '研究室', 'LMS · 課題の締切'],
  ['bedroom', '月 21:00', '学生の部屋', 'カレンダーの締切'],
  ['consultation', '火 10:00', '相談室', '締切が変わった'],
  ['meeting', '火 10:30', '面談', '準備を入れる前の時間割'],
  ['morning', '水 07:30', '翌朝の学生の部屋', '今日やること'],
] as const)('renders the correct static scene: %s', (scene, time, room, content) => {
  const html = renderToStaticMarkup(<StoryScene scene={scene} />);
  for (const text of [time, room, content]) expect(html).toContain(text);
  expect(html).not.toMatch(/<animate|<audio|<video|<foreignObject/);
});

it('keeps the fictional task, old/new deadlines, and preparation before/after visible', () => {
  for (const kind of ['lms', 'change', 'preparation', 'calendar', 'mail'] as const) {
    const html = renderToStaticMarkup(<StoryScreen kind={kind} />);
    expect(html).toContain('文章表現');
    expect(html).toContain('第3回レポート（要約と引用）');
    if (kind === 'lms') for (const deadline of ['11/12 17:00', '11/13 17:00']) expect(html).toContain(deadline);
    if (kind === 'preparation') for (const label of ['準備を入れる前の時間割', '準備を入れた後の時間割', '11/11 13:00–14:00']) expect(html).toContain(label);
  }
});

it.each([
  [14, 0, 60, 0], [21, 0, 270, 0], [10, 0, 300, 0], [10, 30, 315, 180], [7, 30, 225, 180],
])('sets the clock to %i:%i including the hour hand offset', (hour, minute, hourAngle, minuteAngle) => {
  const html = renderToStaticMarkup(<StoryClock kind="wall" hour={hour} minute={minute} />);
  expect(html).toContain(`transform="rotate(${hourAngle} 60 59)"`);
  expect(html).toContain(`transform="rotate(${minuteAngle} 60 59)"`);
  const phone = renderToStaticMarkup(<StoryClock kind="phone" hour={hour} minute={minute} />);
  expect(phone).toContain(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
});

it('opens the requested scene/palette directly and falls back for unknown query values', () => {
  const html = renderToStaticMarkup(<StoryAssetsPage search="?view=scene&scene=meeting&palette=b&capture=1" />);
  expect(html).toContain('data-palette="b"');
  expect(html).toContain('火 10:30');
  expect(html).not.toContain('story-toolbar');
  const fallback = renderToStaticMarkup(<StoryAssetsPage search="?view=unknown&scene=unknown&palette=unknown" />);
  expect(fallback).toContain('data-view="assets"');
  expect(fallback).toContain('data-palette="b"');
});
