import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEvaluationBudget, estimatedYen } from '../announcements/budget.js';
import { createDraftGenerator, generateDraft } from './draft.js';
import { readDraftInputs } from './input.js';

async function main() {
  const [manifest, id, ...extra] = process.argv.slice(2);
  if (!manifest || !id || extra.length) throw new Error('draft-usage');
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('draft-project-required');
  const root = await realpath(fileURLToPath(new URL('../../../..', import.meta.url)));
  const pages = await readDraftInputs(root, manifest);
  // Supply the existing type contract, never the current definition or test oracle.
  const source = await readFile(join(root, 'packages/core/src/definition.ts'), 'utf8');
  const contract = "type Submission = 'submitted' | 'not-submitted' | 'unknown';\n" + source.slice(source.indexOf('export const'), source.indexOf('type Check'));
  let out = root;
  for (const part of ['out', 'definition-drafts']) {
    out = join(out, part);
    await mkdir(out, { recursive: true });
    if ((await lstat(out)).isSymbolicLink()) throw new Error('draft-output-unavailable');
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shared = join(homedir(), '.cache/kadai-hisho/m3', project, 'usage.json');
  const local = join(homedir(), '.cache/kadai-hisho/definition-drafts', project, 'usage.json');
  // Same daily account as M3, plus a separate immutable C30 baseline. Locks span counting and generation.
  await withEvaluationBudget(shared, 'development', day, async (daily) =>
    withEvaluationBudget(local, 'development', day, async (run) => {
      try {
        const result = await generateDraft({ out, id, pages, contract, ...createDraftGenerator(project), budget: {
          reserve: async (input, output) => { await run.reserve(input, output); await daily.reserve(input, output); },
          settle: async (usage) => { await daily.settle(usage); await run.settle(usage); },
        } });
        await run.calibrate();
        console.log(JSON.stringify({ ...result, estimatedYen: estimatedYen(result.usage.inputTokens, result.usage.outputTokens),
          draft: `out/definition-drafts/${id}/definition.draft.json`, review: `out/definition-drafts/${id}/review.json` }));
      } finally {
        console.log(JSON.stringify({ usage: daily.totals, includesUnsettledReservation: daily.hasUnsettledUsage, dailyEstimatedYen: daily.dailyYen }));
      }
    }));
}
try { await main(); } catch (error) {
  const code = error instanceof Error ? error.message : '';
  const safe = /^(draft-(usage|project-required|input-path|input-limit|input-manifest|input-sensitive|invalid-id|output-unavailable|destination-exists|usage-missing|incomplete-response|invalid-json|id-mismatch|count-invalid)|invalid-definition|budget-[a-z-]+)$/;
  console.error(safe.test(code) ? code : 'draft-failed (details suppressed)');
  process.exitCode = 1;
}
