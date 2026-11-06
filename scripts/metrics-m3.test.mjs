import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';
import process from 'node:process';

const due = '2026-11-18T17:00:00+09:00';
const proposal = { assignmentKey: 'fictional-key', proposedDueAt: due };
const sample = (id, expected = proposal) => ({
  id: `private-id-${id}`, category: 'fictional',
  announcement: { announcementId: `private-announcement-${id}`, version: '1',
    publishedAt: '2026-11-06T09:00:00+09:00', body: 'private fictional announcement body' },
  candidates: [{ assignmentKey: 'fictional-key', title: 'private fictional title', officialDueAt: null }],
  expected,
});

// Exercise the CLI in a child process, replacing Gemini before import. The real
// extractor, scorer and budget run against fictional input and temporary state.
async function run(t, { samples = [sample(1)], args, outputs = [proposal], failure = false, raw } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kadai-m3-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'fictional samples.json');
  const state = join(dir, 'usage.json');
  await writeFile(file, raw ?? JSON.stringify(samples));
  const budgetUrl = new URL('../packages/server/dist/announcements/budget.js', import.meta.url).href;
  const geminiUrl = new URL('../packages/server/dist/announcements/gemini.js', import.meta.url).href;
  const cliUrl = new URL('./metrics-m3.mjs', import.meta.url).href;
  const source = `
    import { mock } from 'node:test';
    import { withEvaluationBudget, estimatedYen } from ${JSON.stringify(budgetUrl)};
    const outputs = ${JSON.stringify(outputs)};
    let index = 0;
    mock.module(${JSON.stringify(budgetUrl)}, { exports: {
      estimatedYen,
      withEvaluationBudget: (_path, split, day, run) =>
        withEvaluationBudget(${JSON.stringify(state)}, split, day, run),
    }});
    mock.module(${JSON.stringify(geminiUrl)}, { exports: {
      MODEL: 'fictional-model',
      createGeminiModel: (_project, budget) => ({ async generate(a) {
        await budget.reserve(100, 100);
        if (${failure}) throw new Error('private upstream body and prediction');
        const prediction = outputs[index++ % outputs.length];
        const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
        await budget.settle(usage);
        return { usage, output: { announcementId: a.announcementId, ...prediction,
          quote: a.body, reason: 'private prediction reason' } };
      }}),
    }});
    process.argv = ['node', 'metrics-m3.mjs', ...${JSON.stringify(args ?? ['--file', file])}];
    await import(${JSON.stringify(cliUrl)});
  `;
  let stdout, stderr = '', status = 0;
  try {
    stdout = execFileSync(process.execPath, ['--experimental-test-module-mocks', '--disable-warning=ExperimentalWarning',
      '--input-type=module', '--eval', source], {
      encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-kadai-m3' },
    });
  } catch (error) {
    ({ stdout, stderr, status } = error);
  }
  const saved = await readFile(state, 'utf8').then(JSON.parse, () => null);
  return { stdout, stderr, status, saved };
}

test('--file reads an external array of arbitrary size and prints only aggregate metrics', async (t) => {
  const result = await run(t, { samples: [sample(1), sample(2), sample(3)] });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { recall: 1, precision: 1, count: 3, totalTokens: 45 });
  assert.equal(result.saved.baseline, null, 'external input must not calibrate the 30-case baseline');
  assert.equal(Object.values(result.saved.days)[0].confirmation, true, 'external input uses confirmation limits');
});

test('--file preserves scoring and the failing exit code for misses and false alarms', async (t) => {
  const result = await run(t, { samples: [sample(1), sample(2), sample(3, { assignmentKey: null, proposedDueAt: null })],
    outputs: [proposal, { assignmentKey: null, proposedDueAt: null }, proposal] });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { recall: 0.5, precision: 0.5, count: 3, totalTokens: 45 });
});

test('--file accepts an empty array without fabricating accuracy or calling the model', async (t) => {
  const result = await run(t, { samples: [] });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { recall: null, precision: null, count: 0, totalTokens: 0 });
});

test('--file suppresses upstream details on failure and reports only aggregate usage', async (t) => {
  const result = await run(t, { failure: true });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'evaluation-stopped:model-error\n');
  assert.deepEqual(JSON.parse(result.stdout), { count: 0, totalTokens: 200 });
});

test('--file rejects unreadable, invalid JSON and non-array input without printing contents', async (t) => {
  for (const options of [{ args: ['--file', '/nonexistent/private-sample.json'] },
    { raw: 'private broken JSON' }, { raw: '{"private":"not-an-array"}' }]) {
    const result = await run(t, options);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /private/);
    assert.equal(result.saved, null);
  }
});

test('existing default and --split modes retain counts, detailed output and calibration behavior', async (t) => {
  for (const [args, count] of [[[], 30], [['--split', 'development'], 24], [['--split', 'confirmation'], 6]]) {
    const result = await run(t, { args });
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.filter((line) => line.startsWith('fictional-notice-')).length, count);
    assert.match(result.stdout, /"confirmation": "fixed split; author-known, not a blind holdout"/);
    assert.equal(result.saved.baseline?.calls ?? null, args.length ? null : 30);
    assert.equal(Object.values(result.saved.days)[0].confirmation, args[1] !== 'development');
    assert.equal(result.stderr, '');
  }
});

test('CLI rejects missing values, unknown splits and combining --file with --split', async (t) => {
  for (const args of [['--file'], ['--split', 'other'], ['--file', 'x', '--split', 'development']]) {
    const result = await run(t, { args });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^usage: metrics:m3 /);
    assert.equal(result.saved, null);
  }
});
