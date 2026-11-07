import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from 'firebase/auth';
import type { LedgerAssignment, PreparationPlan } from '../../core/src/types';
import { PlanForm, PlanList } from '../src/preparation-plans';
import { performPlanAction } from '../src/plan-progress';
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
it('prefills known candidate periods but does not guess PandA times', () => {
  for (const system of ['ynu-lms', 'demo-lms', 'panda'] as const) {
    const assignment = { key: { system, sourceId: 'fictional' }, latest: { title: '架空の課題' } } as LedgerAssignment;
    const html = renderToStaticMarkup(<PlanForm assignments={[assignment]} candidate={{ assignment: assignment.key, date: '2099-11-11', period: 1 }} actions={{ add: vi.fn(), remove: vi.fn() }} />);
    const { document } = parseHTML(html);
    expect(document.querySelector('[name="start"]').getAttribute('value')).toBe(system === 'panda' ? '' : '08:50');
    expect(document.querySelector('[name="end"]').getAttribute('value')).toBe(system === 'panda' ? '' : '10:20');
  }
});
it('keeps the future later button after a move and sends the displayed revision', async () => {
  const change = vi.fn(async () => ({ outcome: 'moved' }));
  await act(async () => root.render(<PlanList plans={[plan]} own actions={{ add: vi.fn(), remove: vi.fn(), act: change }} />));
  const later = [...host.querySelectorAll('button')].find(button => button.textContent === '後回し');
  expect(later).toBeDefined();
  await act(async () => later!.click());
  expect(change).toHaveBeenCalledExactlyOnceWith('fictional', 'later', 2);
  await act(async () => root.render(<PlanList plans={[{ ...plan, startsAt: '2000-11-11T13:00:00+09:00' }]} own actions={{ add: vi.fn(), remove: vi.fn(), act: change }} />));
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '後回し')).toBe(false);
});
it('carries the revision in a bodyless authenticated action request', async () => {
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ outcome: 'moved' }) }));
  vi.stubGlobal('fetch', request);
  await performPlanAction({ getIdToken: async () => 'fictional' } as unknown as User, 'fictional', 'later', 2);
  expect(request.mock.calls[0]).toEqual(['/api/v1/plans/fictional/later?rev=2', expect.objectContaining({ method: 'POST' })]);
  expect(request.mock.calls[0]![1]).not.toHaveProperty('body');
});
