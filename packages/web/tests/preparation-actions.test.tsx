import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from 'firebase/auth';
import type { LedgerAssignment, PreparationPlan } from '../../core/src/types';
import { PlanForm, PlanList } from '../src/features/plans/components';
import { performPlanAction, planActions } from '../src/features/plans/api';
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
let root: Root; let host: HTMLElement;
beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.getElementById('root')!; root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const plan = { planId: 'fictional', title: '架空の準備', date: '2099-11-11', period: 3,
  startsAt: '2099-11-11T13:00:00+09:00', endsAt: '2099-11-11T14:30:00+09:00',
  status: 'active', createdByRole: 'student', laterResult: 'moved', revision: 2 } as PreparationPlan;
it('prefills known candidate periods but does not guess KULMS times', () => {
  for (const system of ['ynu-lms', 'demo-lms', 'kulms'] as const) {
    const assignment = { key: { system, sourceId: 'fictional' }, latest: { title: '架空の課題' } } as LedgerAssignment;
    const html = renderToStaticMarkup(<PlanForm assignments={[assignment]} candidate={{ assignment: assignment.key, date: '2099-11-11', period: 1 }} actions={{ add: vi.fn(), remove: vi.fn() }} />);
    const { document } = parseHTML(html);
    expect(document.querySelector('[name="start"]').getAttribute('value')).toBe(system === 'kulms' ? '' : '08:50');
    expect(document.querySelector('[name="end"]').getAttribute('value')).toBe(system === 'kulms' ? '' : '10:20');
  }
});
it('keeps the future later button after a move and sends the displayed revision', async () => {
  const change = vi.fn(async () => ({ outcome: 'moved' as const, plan, demo: true }));
  await act(async () => root.render(<PlanList plans={[plan]} own actions={{ add: vi.fn(), remove: vi.fn(), act: change }} />));
  const later = [...host.querySelectorAll('button')].find(button => button.textContent === '後回し');
  expect(later).toBeDefined();
  await act(async () => later!.click());
  expect(change).toHaveBeenCalledExactlyOnceWith('fictional', 'later', 2);
  await act(async () => root.render(<PlanList plans={[{ ...plan, startsAt: '2000-11-11T13:00:00+09:00' }]} own actions={{ add: vi.fn(), remove: vi.fn(), act: change }} />));
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '後回し')).toBe(false);
});
it('carries the revision in a bodyless authenticated action request', async () => {
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ outcome: 'moved', plan, demo: true }) }));
  vi.stubGlobal('fetch', request);
  await performPlanAction({ getIdToken: async () => 'fictional' } as unknown as User, 'fictional', 'later', 2);
  expect(request.mock.calls[0]).toEqual(['/api/v1/plans/fictional/later?rev=2', expect.objectContaining({ method: 'POST' })]);
  expect(request.mock.calls[0]![1]).not.toHaveProperty('body');
});

it.each([
  ['plan-class-conflict', 'その時間にはすでに授業が入っています。別のコマを選んでください。'],
  ['plan-overlap', 'その時間にはすでに別の準備の予定が入っています。別の時間を選んでください。'],
  ['plan-in-past', 'その時間はもう過ぎています。これからの時間を選んでください。'],
  ['plan-assignment-unavailable', 'この課題は提出済み、取り消し済み、または課題の一覧にないため、予定を入れられません。'],
  ['plan-after-deadline', '締切より後の予定は入れられません。締切までの日時を選んでください。'],
])('shows the server reason %s in candidate and manual forms', async (code, message) => {
  const assignment = { key: { system: 'demo-lms', sourceId: 'fictional' }, latest: { title: '架空の課題' } } as LedgerAssignment;
  const input = { assignment: assignment.key, date: '2030-11-11', period: 1,
    startsAt: '2030-11-11T08:50:00+09:00', endsAt: '2030-11-11T10:20:00+09:00' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: code }), { status: 409 })));
  const actions = planActions({ getIdToken: async () => 'synthetic' } as User, 'fictional');
  // LinkeDOM has no native form controls; supply only FormData's browser boundary.
  vi.stubGlobal('FormData', class { get(name: string) {
    return ({ assignment: JSON.stringify(assignment.key), date: input.date, period: '1', start: '08:50', end: '10:20' } as Record<string, string>)[name];
  } });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  for (const candidate of [undefined, { assignment: assignment.key, date: input.date, period: 1 }]) {
    await act(async () => root.render(<PlanForm key={String(!!candidate)} assignments={[assignment]}
      {...(candidate ? { candidate } : {})} actions={actions} />));
    await act(async () => host.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
    expect(host.textContent).not.toContain('準備の予定を入れました');
    if (code === 'plan-assignment-unavailable') {
      await act(async () => root.render(<PlanForm key={String(!!candidate)} assignments={[]}
        {...(candidate ? { candidate } : {})} actions={actions} />));
      expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
    }
  }
});
