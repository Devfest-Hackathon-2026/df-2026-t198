/* global Buffer, URL */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, dependenciesChanged, evaluateMergeability, remoteBranchPath, run } from './agent-merge.mjs';

const headings = [
  '利用者から見て何が変わったか',
  'どう確かめたか（試験と指標の、前と後の数字）',
  '満たした完成条件（PLAN.md のC番号）',
  '人に見てほしいところ',
  'エージェントが自分で決めたことと、その理由',
];
const body = headings.map((h) => `## ${h}\n記入済み`).join('\n') + '\n<!-- author: codex -->';
const comment = (family, decision, second) => ({
  body: `<!-- review: ${family} ${decision} -->`,
  created_at: `2026-11-06T00:00:0${second}Z`,
  updated_at: `2026-11-06T00:00:0${second}Z`,
});
const file = (filename, additions = 1, deletions = 0) => ({ filename, additions, deletions, status: 'modified' });
function fixture(overrides = {}) {
  return {
    pr: { body, state: 'open', draft: false, labels: [], changed_files: 1,
      head: { sha: 'a'.repeat(40), ref: 'feature/merge-gate', repo: { full_name: 'shieikan/kadai-hisho' } }, base: { sha: 'b'.repeat(40), ref: 'main' } },
    checks: [{ name: 'check', state: 'SUCCESS' }],
    comments: [comment('claude', 'approve', 1)],
    files: [file('packages/web/src/App.tsx')],
    ...overrides,
  };
}
const reasons = (data) => evaluate(data).problems.join('\n');

test('all required conditions accept; all three author families work', () => {
  for (const [author, reviewer] of [['codex', 'claude'], ['claude', 'human'], ['human', 'codex']]) {
    const data = fixture({ comments: [comment(reviewer, 'approve', 1)] });
    data.pr.body = body.replace('author: codex', `author: ${author}`);
    assert.deepEqual(evaluate(data).problems, []);
  }
});
for (const state of ['PENDING', 'QUEUED', 'IN_PROGRESS', 'FAILURE', 'ERROR', 'CANCELLED', 'SKIPPED', 'NEUTRAL', 'UNKNOWN', undefined]) {
  test(`CI ${state} blocks`, () => assert.match(reasons(fixture({ checks: [{ name: 'CI', state }] })), /CI/));
}
test('missing and empty checks block', () => {
  for (const checks of [[], undefined]) assert.match(reasons(fixture({ checks })), /CI/);
  assert.deepEqual(evaluate(fixture({ checks: [{ name: 'legacy', state: 'SUCCESS' }] })).problems, []);
});
test('missing or ambiguous author and same-family approval block', () => {
  for (const marker of ['', '<!-- author: ... -->', '<!-- author: codex -->\n<!-- author: claude -->']) {
    const data = fixture();
    data.pr.body = headings.map((h) => `## ${h}`).join('\n') + '\n' + marker;
    assert.match(reasons(data), /author/);
  }
  assert.match(reasons(fixture({ comments: [comment('codex', 'approve', 1)] })), /承認/);
});
test('latest cross-family approval must follow every request-changes', () => {
  const reject = comment('human', 'request-changes', 2);
  assert.match(reasons(fixture({ comments: [reject, comment('claude', 'approve', 1)] })), /request-changes/);
  assert.deepEqual(evaluate(fixture({ comments: [comment('claude', 'approve', 3), reject] })).problems, []);
  assert.match(reasons(fixture({ comments: [reject, comment('claude', 'approve', 2)] })), /request-changes/);
  assert.match(reasons(fixture({ comments: [comment('claude', 'approve', 1), reject, comment('codex', 'approve', 3)] })), /request-changes/);
});
test('edited comment uses updated time; invalid time cannot authorize', () => {
  const edited = { ...comment('human', 'request-changes', 1), updated_at: '2026-11-06T00:00:04Z' };
  assert.match(reasons(fixture({ comments: [edited, comment('claude', 'approve', 3)] })), /request-changes/);
  assert.match(reasons(fixture({ comments: [{ ...comment('claude', 'approve', 1), updated_at: 'invalid' }] })), /日時/);
});
test('headings and markers in code fences or quoted lines do not count', () => {
  const data = fixture();
  data.pr.body = '```md\n' + body + '\n```';
  assert.match(reasons(data), /見出し/);
  data.pr.body = body;
  data.comments = [{ ...comment('claude', 'approve', 1), body: '> <!-- review: claude approve -->' }];
  assert.match(reasons(data), /承認/);
});
test('every template heading is required as a heading', () => {
  for (const heading of headings) {
    const data = fixture();
    data.pr.body = body.replace(`## ${heading}`, heading);
    assert.match(reasons(data), /見出し/);
  }
});
for (const path of ['docs/data-shapes.md', 'packages/core/src/types.ts', 'firestore.rules', 'firebase.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'AGENTS.md', 'packages/web/AGENTS.md']) {
  test(`human agreement required: ${path}`, () => {
    const data = fixture({ files: [file(path)] });
    assert.match(reasons(data), /human:ok/);
    data.pr.labels = [{ name: 'human:ok' }];
    assert.deepEqual(evaluate(data).problems, []);
  });
}
test('renaming away a protected file still needs agreement', () => {
  assert.match(reasons(fixture({ files: [{ ...file('old.md'), previous_filename: 'AGENTS.md' }] })), /human:ok/);
});
test('600 lines accepts, 601 requires human:ok; deletions count', () => {
  const data = fixture({ files: [file('src/a.ts', 300, 300)] });
  assert.deepEqual(evaluate(data).problems, []);
  data.files[0].deletions++;
  assert.match(reasons(data), /601/);
  data.pr.labels = [{ name: 'human:ok' }];
  assert.deepEqual(evaluate(data).problems, []);
});
test('only lockfile and sample directories are excluded from line count', () => {
  const data = fixture({ files: [file('pnpm-lock.yaml', 5000), file('lms-definitions/demo/samples/nested/test.html', 9000)] });
  data.pr.changed_files = 2;
  data.pr.labels = [{ name: 'human:ok' }];
  assert.equal(evaluate(data).changedLines, 0);
  assert.equal(evaluate(fixture({ files: [file('lms-definitions/demo/definition.json', 601)] })).changedLines, 601);
  assert.equal(evaluate(fixture({ files: [{ ...file('lms-definitions/demo/samples/a.ts', 601), previous_filename: 'src/a.ts' }] })).changedLines, 601);
});
test('package scripts/order changes do not require agreement, dependency changes do', () => {
  const old = { dependencies: { a: '1', b: '2' }, scripts: { test: 'old' } };
  assert.equal(dependenciesChanged(old, { dependencies: { b: '2', a: '1' }, scripts: { test: 'new' } }), false);
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'peerDependenciesMeta', 'overrides', 'resolutions', 'pnpm']) {
    assert.equal(dependenciesChanged({}, { [key]: { a: '2' } }), true);
    assert.equal(dependenciesChanged({ [key]: { a: '2' } }, {}), true);
  }
  const data = fixture({ files: [{ ...file('packages/web/package.json'), dependencyChanged: true }] });
  assert.match(reasons(data), /human:ok/);
  data.files[0].dependencyChanged = false;
  assert.deepEqual(evaluate(data).problems, []);
  delete data.files[0].dependencyChanged;
  assert.match(reasons(data), /依存/);
});
test('incomplete files or invalid counts reject even with human:ok', () => {
  const data = fixture();
  data.pr.labels = [{ name: 'human:ok' }];
  data.pr.changed_files = 2;
  assert.match(reasons(data), /全件/);
  data.pr.changed_files = 1;
  data.files[0].additions = -1;
  assert.match(reasons(data), /行数/);
});
test('multiple failures are reported together; closed/draft/wrong target reject', () => {
  const data = fixture({ checks: [], comments: [] });
  data.pr.body = '';
  assert.ok(evaluate(data).problems.length >= 4);
  for (const extra of [{ state: 'closed' }, { draft: true }, { base: { ref: 'other' } }]) {
    const candidate = fixture();
    Object.assign(candidate.pr, extra);
    assert.ok(evaluate(candidate).problems.length > 0);
  }
});

// gh is replaced at the process boundary: these tests never spawn it or use the network.
function fakeGh(data = fixture(), options = {}) {
  const calls = [];
  let pullReads = 0;
  let merged = false;
  let mergeabilityReads = 0;
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (args.at(-1) === 'state') return JSON.stringify({ state: merged ? 'MERGED' : 'OPEN' });
      const states = options.mergeability ?? [{ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }];
      return JSON.stringify(states[Math.min(mergeabilityReads++, states.length - 1)]);
    }
    if (args[0] === 'api' && args[1] === '-X' && args[2] === 'DELETE') {
      if (options.deleteFails) throw Error('delete failed');
      return '';
    }
    if (args[0] === 'pr' && args[1] === 'checks') return JSON.stringify(data.checks);
    if (args[0] === 'pr' && args[1] === 'merge') { if (options.mergeFails) throw Error('merge failed'); merged = !options.notMerged; return ''; }
    if (args[0] === 'pr' && args[1] === 'edit') { if (options.labelFails) throw Error('label failed'); return ''; }
    if (args[0] === 'api') {
      const endpoint = args[1];
      if (endpoint.includes('/compare/')) return JSON.stringify({ merge_base_commit: { sha: 'd'.repeat(40) } });
      if (endpoint.includes('/contents/')) {
        const content = endpoint.endsWith('d'.repeat(40)) ? options.before : options.after;
        if (!content) throw Error('missing package');
        return JSON.stringify({ encoding: 'base64', type: 'file', content: Buffer.from(JSON.stringify(content)).toString('base64') });
      }
      if (endpoint.includes('/comments?')) return JSON.stringify([data.comments.slice(0, 1), data.comments.slice(1)]);
      if (endpoint.includes('/files?')) return JSON.stringify([data.files]);
      if (endpoint.endsWith('/pulls/12')) {
        if (merged) return JSON.stringify({ ...data.pr, merged: true });
        pullReads++;
        return JSON.stringify(options.moved && pullReads > 1 ? { ...data.pr, head: { sha: 'c'.repeat(40) } } : data.pr);
      }
    }
    throw Error(`unexpected mock call: ${args.join(' ')}`);
  };
  return { gh, calls };
}
test('dry-run makes no writes; real run pins SHA then labels only after merge', async () => {
  for (const dry of [true, false]) {
    const { gh, calls } = fakeGh();
    assert.equal(await run(['12', ...(dry ? ['--dry-run'] : [])], gh, () => {}), 0);
    const writes = calls.filter((a) => (a[0] === 'pr' && ['merge', 'edit'].includes(a[1])) || a.includes('DELETE'));
    assert.equal(writes.length, dry ? 0 : 3);
    if (!dry) {
      assert.ok(writes[0].includes('--merge'));
      assert.ok(!writes[0].includes('--delete-branch'));
      assert.equal(writes[0][writes[0].indexOf('--match-head-commit') + 1], 'a'.repeat(40));
      assert.equal(writes[1][2], 'DELETE');
      assert.ok(writes[2].includes('auto:merged'));
    }
    assert.ok(calls.every((a) => a[0] === 'api' ? (a[1] === '-X' ? a[3] : a[1]).startsWith('repos/shieikan/kadai-hisho/') : a.includes('shieikan/kadai-hisho')));
  }
});
test('bad arguments, changed head, failed conditions, and acquisition failure never write', async () => {
  for (const args of [[], ['0'], ['12;echo'], ['12', '--admin'], ['12', '13']]) {
    const { gh, calls } = fakeGh();
    assert.equal(await run(args, gh, () => {}), 1);
    assert.equal(calls.length, 0);
  }
  for (const mock of [fakeGh(fixture(), { moved: true }), fakeGh(fixture({ checks: [] }))]) {
    assert.equal(await run(['12'], mock.gh, () => {}), 1);
    assert.equal(mock.calls.some((a) => ['merge', 'edit'].includes(a[1])), false);
  }
  assert.equal(await run(['12'], () => { throw Error('network'); }, () => {}), 1);
});
test('merge failure never labels; label failure explicitly reports partial success', async () => {
  const failed = fakeGh(fixture(), { mergeFails: true });
  assert.equal(await run(['12'], failed.gh, () => {}), 1);
  assert.equal(failed.calls.some((a) => a[1] === 'edit'), false);
  const partial = fakeGh(fixture(), { labelFails: true });
  const output = [];
  assert.equal(await run(['12'], partial.gh, (s) => output.push(s)), 1);
  assert.match(output.join('\n'), /merge済み/);
});

test('shipped template has every heading and requires author substitution', () => {
  const data = fixture();
  data.pr.body = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.match(reasons(data), /author/);
  data.pr.body = data.pr.body.replace('<!-- author: ... -->', '<!-- author: codex -->');
  assert.deepEqual(evaluate(data).problems, []);
});
test('pagination includes late objections; no merge or label after rejection', async () => {
  const mock = fakeGh(fixture({ comments: [comment('claude', 'approve', 1), comment('human', 'request-changes', 3)] }));
  assert.equal(await run(['12'], mock.gh, () => {}), 1);
  assert.ok(mock.calls.filter((a) => /\/(comments|files)\?/.test(a[1])).every((a) => a.includes('--paginate') && a.includes('--slurp')));
  assert.equal(mock.calls.some((a) => ['merge', 'edit'].includes(a[1])), false);
});
test('package fetching compares merge-base to head, including additions/removals/renames', async () => {
  for (const status of ['modified', 'added', 'removed', 'renamed']) {
    const changed = { ...file('packages/demo/package.json'), status };
    if (status === 'renamed') changed.previous_filename = 'packages/old/package.json';
    const data = fixture({ files: [changed] });
    const mock = fakeGh(data, { before: { dependencies: { a: '1' } }, after: { dependencies: { a: '2' } } });
    assert.equal(await run(['12', '--dry-run'], mock.gh, () => {}), 1);
    const contents = mock.calls.filter((a) => a[1].includes('/contents/'));
    assert.equal(contents.length, ['added', 'removed'].includes(status) ? 1 : 2);
    if (status !== 'added') assert.ok(contents[0][1].endsWith('ref=' + 'd'.repeat(40)));
    if (status !== 'removed') assert.ok(contents.at(-1)[1].endsWith('ref=' + 'a'.repeat(40)));
    if (status === 'renamed') assert.ok(contents[0][1].includes('/packages/old/package.json?'));
  }
  const data = fixture({ files: [file('package.json')] });
  const mock = fakeGh(data, { before: { scripts: { test: 'old' } }, after: { scripts: { test: 'new' } } });
  assert.equal(await run(['12', '--dry-run'], mock.gh, () => {}), 0);
  assert.equal(await run(['12'], fakeGh(data).gh, () => {}), 1);
});
test('merge command success without confirmed merge never labels', async () => {
  const mock = fakeGh(fixture(), { notMerged: true });
  assert.equal(await run(['12'], mock.gh, () => {}), 1);
  assert.equal(mock.calls.some((a) => a[1] === 'edit'), false);
});
test('acquisition errors never print raw PR content', async () => {
  const output = [];
  assert.equal(await run(['12'], () => '{private-response-text', (s) => output.push(s)), 1);
  assert.doesNotMatch(output.join('\n'), /private-response-text/);
});

test('UNKNOWN is retried briefly before merge, then merge confirmation precedes cleanup and labeling', async () => {
  const mock = fakeGh(fixture(), { mergeability: [
    { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' },
    { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' },
    { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' },
  ] });
  const waits = [];
  assert.equal(await run(['12'], mock.gh, () => {}, async (ms) => { waits.push(ms); }), 0);
  assert.deepEqual(waits, [2000, 2000]);
  const actions = mock.calls.filter((a) => a[0] !== 'api' || a.includes('DELETE'));
  assert.deepEqual(actions.slice(-4).map((a) => a.slice(0, 2)), [
    ['pr', 'merge'], ['pr', 'view'], ['api', '-X'], ['pr', 'edit'],
  ]);
  assert.equal(actions.at(-3).at(-1), 'state');
  assert.deepEqual(actions.at(-2), ['api', '-X', 'DELETE', 'repos/shieikan/kadai-hisho/git/refs/heads/feature/merge-gate']);
});

test('UNKNOWN stops after five reads and four waits without writes', async () => {
  const mock = fakeGh(fixture(), { mergeability: [{ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }] });
  const waits = [];
  const output = [];
  assert.equal(await run(['12'], mock.gh, (s) => output.push(s), async (ms) => { waits.push(ms); }), 1);
  assert.deepEqual(waits, [2000, 2000, 2000, 2000]);
  assert.equal(mock.calls.filter((a) => a[1] === 'view').length, 5);
  assert.equal(mock.calls.some((a) => ['merge', 'edit', '-X'].includes(a[1])), false);
  assert.match(output.join('\n'), /UNKNOWN.*5回/);
});

test('conflicts and blocked merge states stop immediately with their reason', async () => {
  for (const state of [
    { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' },
    { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' },
    {},
  ]) {
    const mock = fakeGh(fixture(), { mergeability: [state] });
    const output = [];
    assert.equal(await run(['12'], mock.gh, (s) => output.push(s), async () => { assert.fail('must not wait'); }), 1);
    assert.equal(mock.calls.filter((a) => a[1] === 'view').length, 1);
    assert.equal(mock.calls.some((a) => ['merge', 'edit', '-X'].includes(a[1])), false);
    assert.match(output.join('\n'), new RegExp(state.mergeable ?? '取得できない'));
    if (state.mergeStateStatus) assert.ok(output.join('\n').includes(state.mergeStateStatus));
  }
});

test('remote cleanup failure preserves merge success and still labels afterward', async () => {
  const mock = fakeGh(fixture(), { deleteFails: true });
  const output = [];
  assert.equal(await run(['12'], mock.gh, (s) => output.push(s)), 0);
  assert.match(output.join('\n'), /merge済み.*リモート.*削除.*失敗/);
  assert.equal(mock.calls.at(-2)[2], 'DELETE');
  assert.ok(mock.calls.at(-1).includes('auto:merged'));
});

test('unconfirmed merge cannot delete the branch or label', async () => {
  const mock = fakeGh(fixture(), { notMerged: true });
  assert.equal(await run(['12'], mock.gh, () => {}), 1);
  assert.equal(mock.calls.some((a) => ['edit', '-X'].includes(a[1])), false);
});

test('mergeability decision is pure and rejects missing or unsupported states', () => {
  for (const mergeStateStatus of ['CLEAN', 'HAS_HOOKS']) {
    assert.equal(evaluateMergeability({ mergeable: 'MERGEABLE', mergeStateStatus }), 'ready');
  }
  for (const mergeable of ['UNKNOWN', 'MERGEABLE']) {
    assert.equal(evaluateMergeability({ mergeable, mergeStateStatus: 'UNKNOWN' }), 'retry');
  }
  for (const mergeStateStatus of ['BLOCKED', 'BEHIND', 'DIRTY', 'DRAFT', 'UNSTABLE', 'new-state', undefined]) {
    assert.equal(evaluateMergeability({ mergeable: 'MERGEABLE', mergeStateStatus }), 'blocked');
  }
  assert.equal(evaluateMergeability(), 'blocked');
  assert.equal(evaluateMergeability({ mergeable: 'CONFLICTING', mergeStateStatus: 'UNKNOWN' }), 'blocked');
});

test('remote branch path preserves branch names and never targets another repo or the base branch', async () => {
  const data = fixture();
  data.pr.head.ref = 'feature/日本語#100%';
  assert.equal(remoteBranchPath(data.pr), 'repos/shieikan/kadai-hisho/git/refs/heads/feature/%E6%97%A5%E6%9C%AC%E8%AA%9E%23100%25');
  for (const head of [
    { ...data.pr.head, repo: { full_name: 'another/fork' } },
    { ...data.pr.head, repo: null },
    { ...data.pr.head, ref: 'main' },
    { ...data.pr.head, ref: '' },
  ]) {
    const pr = { ...data.pr, head };
    assert.equal(remoteBranchPath(pr), null);
    const mock = fakeGh(fixture({ pr }));
    assert.equal(await run(['12'], mock.gh, () => {}), 0);
    assert.equal(mock.calls.some((a) => a.includes('DELETE')), false);
    assert.ok(mock.calls.at(-1).includes('auto:merged'));
  }
});

test('PR evidence is rechecked after the mergeability wait', async () => {
  const mock = fakeGh(fixture(), { moved: true, mergeability: [
    { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' },
    { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' },
  ] });
  let waited = false;
  assert.equal(await run(['12'], mock.gh, () => {}, async () => { waited = true; }), 1);
  assert.ok(waited);
  assert.equal(mock.calls.some((a) => ['merge', 'edit', '-X'].includes(a[1])), false);
});

test('cleanup and label failure still reports merged, without retrying merge', async () => {
  const mock = fakeGh(fixture(), { deleteFails: true, labelFails: true });
  const output = [];
  assert.equal(await run(['12'], mock.gh, (s) => output.push(s)), 1);
  assert.match(output.join('\n'), /merge済み.*リモートブランチの削除に失敗/);
  assert.match(output.join('\n'), /merge済みだがauto:merged/);
  assert.equal(mock.calls.filter((a) => a[1] === 'merge').length, 1);
});
