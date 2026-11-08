import { createRequire } from 'node:module';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { PreparationPlan } from '../../core/src/types';
import { PlanLinkAction } from '../src/features/plans/progress';
import { assignment, dated } from '../src/shared/testing/student-fixture';
afterEach(() => vi.unstubAllGlobals());
const plan: PreparationPlan = { planId: 'fictional', assignment: { system: 'demo-lms', sourceId: 'task' }, title: '架空のレポート',
  date: '2030-11-11', period: 3, startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00',
  timeZone: 'Asia/Tokyo', decidedOn: '2030-11-11', confirmedBy: 'supporter', createdByRole: 'supporter',
  confirmedAt: '2030-11-10T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'key' };

const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
const linkPlan = { ...plan, planId: '12345678-1234-4234-8234-123456789abc' };
async function mountLink(action = 'done', current = linkPlan) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.location = { search: `?id=${linkPlan.planId}&do=${action}&rev=1` };
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.getElementById('root')!; const root = createRoot(host);
  const user = { uid: 'fictional', getIdToken: async () => 'synthetic' } as User;
  const task = assignment('架空のレポート', dated('2030-11-12')); task.key = plan.assignment;
  const render = async (value = current, account = user) => act(async () => root.render(<StrictMode><PlanLinkAction user={account}
    data={{ plans: [value], assignments: [task], courses: [{ system: 'demo-lms', courseId: task.latest.courseId, name: '架空の授業', slots: [] }] }} /></StrictMode>));
  await render();
  return { host, render, close: async () => act(async () => root.unmount()), click: async (name: string) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === name)!;
    expect(button).toBeTruthy(); await act(async () => { button.click(); button.click(); });
  } };
}
it('opening, remounting and returning from login show the target without posting; an explicit double click posts once', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ outcome: 'done', plan: { ...linkPlan, status: 'done' }, demo: true })));
  vi.stubGlobal('fetch', request);
  const view = await mountLink();
  try {
    await view.render(linkPlan, { uid: 'fictional', getIdToken: async () => 'synthetic' } as User);
    expect(request).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain('架空の授業'); expect(view.host.textContent).toContain('架空のレポート');
    expect(view.host.textContent).toContain('2030/11/11 13:00〜14:30');
    await view.click('終わった'); expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]).toEqual([`/api/v1/plans/${linkPlan.planId}/done?rev=1`, expect.objectContaining({ method: 'POST' })]);
    expect(view.host.textContent).toContain('次は提出');
  } finally { await view.close(); }
  const reopened = await mountLink();
  try { expect(request).toHaveBeenCalledOnce(); } finally { await reopened.close(); }
});
it.each([
  { ...linkPlan, status: 'done' as const }, { ...linkPlan, status: 'cancelled' as const },
  { ...linkPlan, revision: 2, laterResult: 'moved' as const, date: '2030-11-12' },
  { ...linkPlan, revision: 2 },
])('shows the current state of an old or unavailable link without replacing its revision: %j', async current => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const view = await mountLink('later', current);
  try {
    expect(request).not.toHaveBeenCalled(); expect(view.host.querySelectorAll('button')).toHaveLength(0);
    expect(view.host.textContent).toContain('変更していません');
    if (current.revision !== 1) expect(view.host.textContent).toContain('リンクが作られた後に予定が変わっています');
  } finally { await view.close(); }
});
it('retries a lost response with the same target and revision, even after the live plan moves', async () => {
  const moved = { ...linkPlan, revision: 2, date: '2030-11-12', laterResult: 'moved' as const };
  const request = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(new Response(JSON.stringify({ outcome: 'unchanged', plan: moved, demo: true })));
  vi.stubGlobal('fetch', request);
  const view = await mountLink('later');
  try {
    await view.click('後回し'); expect(view.host.textContent).toContain('確認できませんでした');
    await view.render(moved);
    expect(view.host.textContent).not.toContain('変更していません');
    await view.click('もう一度試す');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(call => call[0])).toEqual(Array(2).fill(`/api/v1/plans/${linkPlan.planId}/later?rev=1`));
    expect(view.host.textContent).toContain('後回しにした'); expect(view.host.querySelectorAll('button')).toHaveLength(0);
  } finally { await view.close(); }
});
it('keeps the target and reports a conflict if it changes after confirmation is displayed', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ plan: { ...linkPlan, status: 'cancelled', revision: 2 } }), { status: 409 }));
  vi.stubGlobal('fetch', request);
  const view = await mountLink();
  try {
    await view.click('終わった'); expect(view.host.textContent).toContain('外されています。変更していません');
    expect(view.host.textContent).toContain('架空のレポート'); expect(view.host.querySelectorAll('button')).toHaveLength(0);
  } finally { await view.close(); }
});

it.each(['?id=invalid&do=done&rev=1', `?id=${linkPlan.planId}&do=remove&rev=1`,
  `?id=${linkPlan.planId}&do=done`, `?id=${linkPlan.planId}&do=done&rev=0`,
  `?id=${linkPlan.planId}&do=done&rev=9007199254740992`])('does not offer or send an invalid link: %s', async search => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const view = await mountLink();
  try {
    window.location.search = search; await view.render();
    expect(request).not.toHaveBeenCalled(); expect(view.host.querySelectorAll('button')).toHaveLength(0);
    expect(view.host.textContent).toContain('リンクを確かめてください');
  } finally { await view.close(); }
});
