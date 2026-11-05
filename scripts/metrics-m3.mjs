import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { createAnnouncementExtractor } from '../packages/server/dist/announcements/extract.js';
import { createGeminiModel, MODEL } from '../packages/server/dist/announcements/gemini.js';
import { withEvaluationBudget, estimatedYen } from '../packages/server/dist/announcements/budget.js';
import { scoreM3, summarizeM3 } from './m3-score.mjs';

async function main() {
  const args = process.argv.slice(2);
  const split = args.length === 0 ? 'all' : args.length === 2 && args[0] === '--split' ? args[1] : null;
  if (!['all', 'development', 'confirmation'].includes(split)) throw new Error('usage: metrics:m3 [--split development|confirmation]');
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('set GOOGLE_CLOUD_PROJECT to the approved existing project');
  const splits = split === 'all' ? ['development', 'confirmation'] : [split];
  const samples = (await Promise.all(splits.map(async (name) => ({ name,
    samples: JSON.parse(await readFile(new URL(`../lms-definitions/announcements/samples/${name}.json`, import.meta.url), 'utf8')),
  }))));
  if (samples.some((g) => g.samples.length !== (g.name === 'development' ? 24 : 6))) throw new Error('corpus-count-invalid');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // Shared across worktrees and restarted commands for this project. Never store announcement text or responses.
  const state = join(homedir(), '.cache/kadai-hisho/m3', project, 'usage.json');
  await withEvaluationBudget(state, split, day, async (budget) => {
    const extractor = createAnnouncementExtractor(createGeminiModel(project, budget));
    const priorBaseline = budget.measuredBaseline;
    try {
      const scores = [];
      const reports = [];
      for (const group of samples) {
        const groupScores = [];
        for (const sample of group.samples) {
          const result = await extractor.extract(sample.announcement, sample.candidates);
          if (!['proposal', 'abstained', 'invalid-output'].includes(result.status)) {
            // All errors are fixed codes; do not print SDK exceptions (they may contain requests).
            throw new Error(`evaluation-stopped:${result.status}`);
          }
          const score = scoreM3(sample.expected, result.status === 'proposal' ? result.proposal : null);
          groupScores.push(score);
          scores.push(score);
          console.log(`${sample.id}: ${result.status}; TP=${score.tp} FP=${score.fp} FN=${score.fn}`);
        }
        reports.push({ split: group.name, count: groupScores.length, ...summarizeM3(groupScores) });
      }
      // Only a complete 30-case live evaluation establishes the immutable first measured baseline.
      if (split === 'all') await budget.calibrate();
      const report = { date: day, model: MODEL, location: 'global', tokenBaseline: priorBaseline,
        confirmation: 'fixed split; author-known, not a blind holdout', splits: reports, overall: summarizeM3(scores),
        usage: { ...budget.totals }, estimatedYen: estimatedYen(budget.totals.inputTokens, budget.totals.outputTokens),
        dailyYen: budget.dailyYen };
      console.log(JSON.stringify(report, null, 2));
      if (report.overall.recall < 0.9 || report.overall.precision === null || report.overall.precision < 0.95) process.exitCode = 1;
    } finally {
      console.log(JSON.stringify({ usage: budget.totals, includesUnsettledReservation: budget.hasUnsettledUsage, dailyEstimatedYen: budget.dailyYen }));
    }
  });
}
try { await main(); } catch (error) {
  // Whitelist only our fixed error codes. Never emit an upstream message or stack.
  const message = error instanceof Error ? error.message : '';
  const safe = /^(budget-[a-z-]+|corpus-count-invalid|confirmation-already-used|evaluation-stopped:[a-z-]+|set GOOGLE_CLOUD_PROJECT to the approved existing project|usage: metrics:m3 \[--split development\|confirmation\])$/;
  console.error(safe.test(message) ? message : 'evaluation-failed (upstream details suppressed)');
  process.exitCode = 1;
}
