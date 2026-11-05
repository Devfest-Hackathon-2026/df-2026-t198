import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withEvaluationBudget } from '../src/announcements/budget.js';
const dirs: string[] = [];
async function state() { const dir = await mkdtemp(join(tmpdir(), 'm3-budget-')); dirs.push(dir); return join(dir, 'usage.json'); }
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
const day = '2026-11-06';
it('persists reservations before a call, including failed/unknown usage', async () => {
  const path = await state();
  await withEvaluationBudget(path, 'development', day, async (budget) => {
    await budget.reserve(2000, 4096);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    expect(saved.days[day].yen).toBeGreaterThan(0);
  });
  await withEvaluationBudget(path, 'development', day, async (budget) => {
    expect(budget.dailyYen).toBeGreaterThan(0);
  });
});
it('stops before daily spend exceeds 3000 yen', async () => {
  const path = await state();
  await withEvaluationBudget(path, 'development', day, async (budget) => {
    await expect(budget.reserve(20_000_000, 0)).rejects.toThrow('budget-limit');
    expect(budget.totals.calls).toBe(0);
  });
});
it('caps a later run at three times the measured tokens and calls', async () => {
  const path = await state();
  await withEvaluationBudget(path, 'development', day, async (budget) => {
    await budget.reserve(100, 100);
    await budget.settle({ inputTokens: 100, outputTokens: 100, totalTokens: 200 });
    await budget.calibrate();
  });
  await withEvaluationBudget(path, 'development', day, async (budget) => {
    await expect(budget.reserve(601, 0)).rejects.toThrow('budget-limit');
    for (let i = 0; i < 3; i++) { await budget.reserve(50, 50); await budget.settle({ inputTokens: 50, outputTokens: 50, totalTokens: 100 }); }
    await expect(budget.reserve(1, 1)).rejects.toThrow('budget-limit');
  });
});
it('allows confirmation once per Japan day, independently from development and across restarts', async () => {
  const path = await state();
  await withEvaluationBudget(path, 'all', day, async () => {});
  await expect(withEvaluationBudget(path, 'confirmation', day, async () => {})).rejects.toThrow('confirmation-already-used');
  await withEvaluationBudget(path, 'development', day, async () => {});
  await withEvaluationBudget(path, 'confirmation', '2026-11-07', async () => {});
});
it('fails closed on concurrent processes and corrupt state', async () => {
  const path = await state();
  await withEvaluationBudget(path, 'development', day, async () => {
    await expect(withEvaluationBudget(path, 'development', day, async () => {})).rejects.toThrow('budget-locked');
  });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, '{bad');
  await expect(withEvaluationBudget(path, 'development', day, async () => {})).rejects.toThrow('budget-state-invalid');
});
