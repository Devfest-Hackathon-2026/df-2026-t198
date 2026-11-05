import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Usage } from './extract.js';

type Totals = Usage & { calls: number };
type State = { version: 1; baseline: Totals | null; days: Record<string, { yen: number; confirmation: boolean }> };
const zero = (): Totals => ({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
const validCount = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const validUsage = (v: Usage) => validCount(v.inputTokens) && validCount(v.outputTokens) &&
  validCount(v.totalTokens) && v.totalTokens === v.inputTokens + v.outputTokens;
// Conservative text-only standard rates (not the temporary discount), at a 200 JPY/USD ceiling.
// https://cloud.google.com/model-garden/pricing — recheck before 2027-01-01 or changing the model.
export const estimatedYen = (input: number, output: number) => (input * 1.5 + output * 7.5) / 1_000_000 * 200;

export class EvaluationBudget {
  readonly totals = zero();
  private reserved: { input: number; output: number; yen: number } | null = null;
  constructor(private state: State, private day: string, private save: () => Promise<void>) {}
  get measuredBaseline() { return this.state.baseline ? { ...this.state.baseline } : null; }
  get hasUnsettledUsage() { return this.reserved !== null; }
  get dailyYen() { return this.state.days[this.day]!.yen; }
  async reserve(input: number, output: number) {
    if (this.reserved || !validCount(input) || !validCount(output)) throw new Error('budget-invalid-reservation');
    const baseline = this.state.baseline;
    const limit = baseline ? baseline.totalTokens * 3 : 600_000;
    const maxCalls = baseline ? baseline.calls * 3 : 30;
    const yen = estimatedYen(input, output);
    if (this.totals.calls + 1 > maxCalls || this.totals.totalTokens + input + output > limit ||
        this.dailyYen + yen > 3000) throw new Error('budget-limit');
    this.state.days[this.day]!.yen += yen;
    this.totals.calls++;
    this.totals.inputTokens += input;
    this.totals.outputTokens += output;
    this.totals.totalTokens += input + output;
    this.reserved = { input, output, yen };
    await this.save(); // Persist before sending: a crash retains the full reservation.
  }
  async settle(usage: Usage) {
    const r = this.reserved;
    if (!r || !validUsage(usage) || usage.inputTokens > r.input || usage.outputTokens > r.output) {
      throw new Error('budget-usage-invalid'); // Keep reservation on missing or inconsistent metadata.
    }
    this.state.days[this.day]!.yen += estimatedYen(usage.inputTokens, usage.outputTokens) - r.yen;
    this.totals.inputTokens += usage.inputTokens - r.input;
    this.totals.outputTokens += usage.outputTokens - r.output;
    this.totals.totalTokens += usage.totalTokens - r.input - r.output;
    this.reserved = null;
    await this.save();
  }
  async calibrate() {
    if (this.reserved || this.totals.calls === 0) throw new Error('budget-incomplete-calibration');
    if (this.state.baseline === null) { this.state.baseline = { ...this.totals }; await this.save(); }
  }
}

export async function withEvaluationBudget<T>(path: string, split: string, day: string,
  run: (budget: EvaluationBudget) => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await open(`${path}.lock`, 'wx', 0o600).catch(() => { throw new Error('budget-locked'); });
  try {
    let state: State;
    try {
      state = JSON.parse(await readFile(path, 'utf8')) as State;
      if (state.version !== 1 || !state.days || typeof state.days !== 'object' || Array.isArray(state.days) ||
          !(state.baseline === null || (validUsage(state.baseline) && validCount(state.baseline.calls) && state.baseline.calls > 0)) ||
          Object.values(state.days).some((d) => !d || !Number.isFinite(d.yen) || d.yen < 0 || typeof d.confirmation !== 'boolean')) {
        throw new Error('invalid');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line preserve-caught-error -- Do not attach raw state errors to caller-visible errors.
        throw new Error('budget-state-invalid');
      }
      state = { version: 1, baseline: null, days: {} };
    }
    const save = async () => {
      await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    };
    state.days[day] ??= { yen: 0, confirmation: false };
    if (split !== 'development') {
      if (state.days[day].confirmation) throw new Error('confirmation-already-used');
      state.days[day].confirmation = true;
      await save();
    }
    return await run(new EvaluationBudget(state, day, save));
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
