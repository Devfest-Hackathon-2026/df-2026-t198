import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoryFilm } from '../src/features/landing/story/film';
import { StoryActionScreen } from '../src/features/landing/story/film-screen';
import { StoryRoomStage } from '../src/features/landing/story/room';
import { storySteps, shortStorySteps } from '../src/features/landing/story/timeline';

it('ends the five agreed scenes with a summary and a logo-only eyecatch in about thirty seconds', () => {
  expect(storySteps.map(item => item.id)).toEqual(['office', 'bedroom', 'consultation', 'meeting', 'morning', 'summary', 'eyecatch']);
  expect(storySteps.reduce((sum, item) => sum + item.duration, 0)).toBeGreaterThanOrEqual(30000);
  expect(storySteps.reduce((sum, item) => sum + item.duration, 0)).toBeLessThanOrEqual(35000);
  const html = renderToStaticMarkup(<StoryFilm step={6} elapsed={0} />);
  expect(html).toContain('ToDokuのロゴと名前');
  expect(html).not.toContain('data-role=');
  expect(html).not.toContain('コピー');
});

it('changes the teacher screen at sending, rather than showing the new date from the start', () => {
  const before = renderToStaticMarkup(<StoryActionScreen scene="office" elapsed={0} />);
  const after = renderToStaticMarkup(<StoryActionScreen scene="office" elapsed={1400} />);
  expect(before).toContain('11/12 17:00');
  expect(before).not.toContain('11/13 17:00');
  expect(after).toContain('11/13 17:00');
  expect(after).toContain('送信しました');
});

it('only moves the student calendar after opening, reading and recording', () => {
  const render = (elapsed: number) => renderToStaticMarkup(<StoryActionScreen scene="bedroom" elapsed={elapsed} />);
  expect(render(0)).toContain('いつもどおりLMSを開く');
  expect(render(1000)).toContain('拡張機能が締切を読む');
  expect(render(1900)).toContain('変更をToDokuへ送る');
  expect(render(2500)).toContain('ToDokuに記録しました');
  expect(render(2500)).toContain('11/12 17:00');
  expect(render(2900)).toContain('11/13 17:00');
});

it('has the student enter, sit, decide preparation, then receive the phone schedule', () => {
  const room = (elapsed: number) => renderToStaticMarkup(<svg><StoryRoomStage scene="meeting" elapsed={elapsed} /></svg>);
  expect(room(700)).toContain('data-action="enter"');
  expect(room(700)).not.toContain('data-action="phone"');
  expect(room(1800)).not.toContain('data-action="enter"');
  expect(room(1800)).toContain('data-action="seated"');
  expect(room(3400)).toContain('data-vibrating="true"');
  const screen = (elapsed: number) => renderToStaticMarkup(<StoryActionScreen scene="meeting" elapsed={elapsed} />);
  expect(screen(1800)).toContain('準備を入れる前の時間割');
  expect(screen(3100)).toContain('準備を入れた後の時間割');
  expect(screen(3100)).not.toContain('スマホにも予定');
  expect(screen(3400)).toContain('スマホにも予定');
});

it('can render each completed scene independently with no previous-room state', () => {
  const cases = [
    ['office', ['teacher']], ['bedroom', ['student']], ['consultation', ['supporter']],
    ['meeting', ['student', 'supporter']], ['morning', ['student']],
  ] as const;
  for (const [index, [scene, roles]] of cases.entries()) {
    const html = renderToStaticMarkup(<StoryFilm step={index} elapsed={3500} still />);
    expect([...html.matchAll(/data-room="([^"]+)"/g)].map(match => match[1])).toEqual([scene]);
    expect([...html.matchAll(/data-role="([^"]+)"/g)].map(match => match[1])).toEqual(roles);
    expect(html).not.toMatch(/<img|<image|<foreignObject/);
  }
});

it('zooms into a clock and replaces the room before pulling out', () => {
  const before = renderToStaticMarkup(<StoryFilm step={0} elapsed={4000} />);
  const after = renderToStaticMarkup(<StoryFilm step={0} elapsed={4500} />);
  expect(before).toContain('data-room="office"');
  expect(after).toContain('data-room="bedroom"');
  expect(after).toContain('data-transition="true"');
});

it('advances the consultation clock from 10:00 to 10:30 without inserting another day', () => {
  const halfway = renderToStaticMarkup(<StoryFilm step={2} elapsed={3450} />);
  expect(/data-time="([^"]+)"/.exec(halfway)?.[1]).toBe('10:15');
});

it('keeps all five story scenes and their clock transitions within a 25-second short edition', () => {
  expect(shortStorySteps.map(item => item.id)).toEqual(['office', 'bedroom', 'consultation', 'meeting', 'morning']);
  expect(shortStorySteps.reduce((sum, item) => sum + item.duration, 0)).toBe(25000);
  expect(storySteps.reduce((sum, item) => sum + item.duration, 0)).toBe(32400);
  const html = renderToStaticMarkup(<StoryFilm steps={shortStorySteps} step={4} elapsed={3750} />);
  expect(html).toContain('今日やること');
  expect(html).toContain('data-transition="false"');
  expect(html).not.toContain('data-scene="summary"');
});
