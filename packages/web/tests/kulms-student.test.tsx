import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentView } from '../src/features/student/page';
import { applyObservation } from '../../core/src/ledger';
import type { Observation } from '../../core/src/types';
import golden from '../../../lms-definitions/kulms/samples/observation.expected.json';
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => vi.unstubAllGlobals());
it('opens KULMS tasks without weekday/period, retaining unknown deadlines and submission', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.matchMedia = () => ({ matches: false });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.getElementById('root')!);
  const applied = applyObservation([], golden as Observation, golden.fetchedAt);
  const data = { courses: golden.catalogCourses.map(c => ({ ...c, system: 'kulms' as const })), assignments: applied.assignments,
    fetchStates: [], plans: [], manualAssignments: [], online: true };
  try {
    await act(async () => root.render(<StudentView data={data} now={Date.parse(golden.fetchedAt)} />));
    expect(document.body.textContent).toContain('曜日・時限のない授業');
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === '架空の授業');
    expect(button).toBeDefined();
    await act(async () => button!.click());
    const panel = document.querySelector('aside[aria-label="架空の授業の課題"]');
    expect(panel?.textContent).toContain('架空の課題C');
    expect(panel?.textContent).toContain('要確認');
    expect(panel?.textContent).not.toContain('未提出');
    expect(panel?.querySelector('a')?.getAttribute('href')).toBe(golden.catalogCourses[0]?.url);
    expect(panel?.querySelectorAll('li').length).toBe(5);
  } finally { await act(async () => root.unmount()); }
});
