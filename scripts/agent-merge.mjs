/* global Buffer, console, process */
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const repository = 'shieikan/kadai-hisho';
const headings = [
  '利用者から見て何が変わったか',
  'どう確かめたか（試験と指標の、前と後の数字）',
  '満たした完成条件（PLAN.md のC番号）',
  '人に見てほしいところ',
  'エージェントが自分で決めたことと、その理由',
];
const dependencyKeys = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
  'bundledDependencies', 'bundleDependencies', 'peerDependenciesMeta', 'overrides', 'resolutions', 'pnpm'];
const manifest = (path) => /(^|\/)package\.json$/.test(path);
const protectedPath = (path) => ['docs/data-shapes.md', 'packages/core/src/types.ts', 'firestore.rules',
  'firebase.json', 'pnpm-lock.yaml'].includes(path) || /(^|\/)AGENTS\.md$/.test(path) || path.startsWith('.github/workflows/');
const excludedLines = (path) => path === 'pnpm-lock.yaml' || /^lms-definitions\/[^/]+\/samples\//.test(path);

// Standalone markers only: quoted examples and fenced code are not attestations.
function proseLines(text) {
  let fence;
  return String(text ?? '').split(/\r?\n/).filter((line) => {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
      return false;
    }
    return !fence;
  });
}

export function dependenciesChanged(before, after) {
  return dependencyKeys.some((key) => !isDeepStrictEqual(before?.[key], after?.[key]));
}

export function evaluate({ pr, checks, comments, files }) {
  const problems = [];
  if (pr.state !== 'open' || pr.draft || pr.base?.ref !== 'main') problems.push('main向けの、draftでないopen PRが必要。');
  if (!Array.isArray(checks) || checks.length === 0) problems.push('CIの結果が無い、または取得できない。');
  else for (const check of checks) {
    if (check.state !== 'SUCCESS') problems.push(`CI未成功: ${check.name ?? '名称不明'} (${check.state ?? '不明'})`);
  }

  const lines = proseLines(pr.body);
  const authors = lines.flatMap((line) => /^\s*<!-- author: (claude|codex|human) -->\s*$/.exec(line)?.[1] ?? []);
  if (authors.length !== 1) problems.push('authorの印をclaude・codex・humanのどれか1つだけ書く。');
  const presentHeadings = lines.map((line) => /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1]);
  for (const heading of headings) if (!presentHeadings.includes(heading)) problems.push(`見出しが無い: ${heading}`);

  let approval = -Infinity;
  let request = -Infinity;
  for (const comment of comments) {
    for (const line of proseLines(comment.body)) {
      const mark = /^\s*<!-- review: (claude|codex|human) (approve|request-changes) -->\s*$/.exec(line);
      if (!mark) continue;
      const time = Date.parse(comment.updated_at ?? comment.created_at);
      if (!Number.isFinite(time)) { problems.push('見直しコメントの日時が不明。'); continue; }
      if (mark[2] === 'request-changes') request = Math.max(request, time);
      else if (authors.length === 1 && mark[1] !== authors[0]) approval = Math.max(approval, time);
    }
  }
  if (approval === -Infinity) problems.push('書いた系統と違う系統の承認が無い。');
  else if (request >= approval) problems.push('最後の承認以降にrequest-changesがある。');

  const humanOk = pr.labels.some((label) => label.name === 'human:ok');
  if (files.length !== pr.changed_files) problems.push('変更ファイルを全件取得できていない。');
  let changedLines = 0;
  for (const file of files) {
    const paths = [file.filename, file.previous_filename].filter(Boolean);
    if (!paths.length || !Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions) || file.additions < 0 || file.deletions < 0) {
      problems.push('変更ファイルのパスまたは行数が不明。');
      continue;
    }
    if (!paths.every(excludedLines)) changedLines += file.additions + file.deletions;
    const packageChanged = paths.some(manifest);
    if (packageChanged && typeof file.dependencyChanged !== 'boolean') problems.push(`依存の比較ができない: ${file.filename}`);
    if (!humanOk && (paths.some(protectedPath) || (packageChanged && file.dependencyChanged))) {
      problems.push(`human:okが必要: ${file.filename}`);
    }
  }
  if (!humanOk && changedLines > 600) problems.push(`変更は${changedLines}行（上限600行）。超える場合はhuman:okが必要。`);
  return { problems, changedLines };
}

export function evaluateMergeability({ mergeable, mergeStateStatus } = {}) {
  if (mergeable === 'CONFLICTING' || ['BLOCKED', 'BEHIND', 'DIRTY', 'DRAFT'].includes(mergeStateStatus)) return 'blocked';
  if (mergeable === 'UNKNOWN' || (mergeable === 'MERGEABLE' && mergeStateStatus === 'UNKNOWN')) return 'retry';
  return mergeable === 'MERGEABLE' && ['CLEAN', 'HAS_HOOKS'].includes(mergeStateStatus) ? 'ready' : 'blocked';
}

// Only delete a source branch belonging to the fixed development repository.
export function remoteBranchPath(pr) {
  const branch = pr.head?.ref;
  if (pr.head?.repo?.full_name !== repository || typeof branch !== 'string' || !branch || branch === pr.base?.ref) return null;
  return `repos/${repository}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
}

async function waitForMergeable(number, gh, output, wait) {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const state = JSON.parse(gh(['pr', 'view', number, '--repo', repository, '--json', 'mergeable,mergeStateStatus']));
    const decision = evaluateMergeability(state);
    if (decision === 'ready') return true;
    if (decision === 'blocked') {
      output(`mergeできない: mergeable=${state.mergeable ?? '取得できない'}, mergeStateStatus=${state.mergeStateStatus ?? '取得できない'}。PRの状態を確認する。`);
      return false;
    }
    if (attempt === attempts) {
      output(`merge可否がUNKNOWNのまま${attempts}回の確認を終えた。時間を置いて再実行する。`);
      return false;
    }
    output(`merge可否を計算中（${attempt}/${attempts}回）。2秒後に再確認する。`);
    await wait(2000);
  }
}

function executeGh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
  } catch (error) {
    // gh checks returns 1/8 for failed/pending checks; retain the structured evidence.
    if (args[0] === 'pr' && args[1] === 'checks' && [1, 8].includes(error.status)) {
      try { if (Array.isArray(JSON.parse(error.stdout))) return error.stdout; } catch { /* acquisition failure below */ }
    }
    // Do not echo command output: PR content and API responses can contain secrets.
    throw new Error(`gh ${args[0]} ${args[1]} が失敗（終了コード ${error.status ?? '不明'}）。接続と権限を確認する。`, { cause: error });
  }
}

function collect(number, gh) {
  const root = `repos/${repository}`;
  const api = (endpoint) => JSON.parse(gh(['api', endpoint]));
  const pages = (endpoint) => JSON.parse(gh(['api', `${endpoint}?per_page=100`, '--paginate', '--slurp'])).flat();
  const pr = api(`${root}/pulls/${number}`);
  const files = pages(`${root}/pulls/${number}/files`);
  const comments = pages(`${root}/issues/${number}/comments`);
  const checks = JSON.parse(gh(['pr', 'checks', number, '--repo', repository, '--json', 'name,state']));
  if (![pr.head?.sha, pr.base?.sha].every((sha) => /^[a-f0-9]{40}$/.test(sha))) throw new Error('PRのコミットを取得できない。');
  const packages = files.filter((file) => [file.filename, file.previous_filename].some((path) => path && manifest(path)));
  if (packages.length) {
    const base = api(`${root}/compare/${pr.base.sha}...${pr.head.sha}`).merge_base_commit.sha;
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('比較元のコミットを取得できない。');
    const readPackage = (path, ref) => {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const blob = api(`${root}/contents/${encoded}?ref=${ref}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.type !== 'file') throw new Error('package.jsonの内容を取得できない。');
      const parsed = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('package.jsonの形式が不正。');
      return parsed;
    };
    for (const file of packages) {
      const before = file.status === 'added' ? null : readPackage(file.previous_filename ?? file.filename, base);
      const after = file.status === 'removed' ? null : readPackage(file.filename, pr.head.sha);
      file.dependencyChanged = dependenciesChanged(before, after);
    }
  }
  return { pr, files, comments, checks };
}

export async function run(args, gh = executeGh, output = console.log, wait = sleep) {
  let merged = false;
  try {
    const numbers = args.filter((arg) => arg !== '--dry-run');
    if (numbers.length !== 1 || !/^[1-9]\d*$/.test(numbers[0]) || args.filter((arg) => arg === '--dry-run').length > 1) {
      output('使い方: pnpm agent-merge <PR番号> [--dry-run]');
      return 1;
    }
    const number = numbers[0];
    const data = collect(number, gh);
    const result = evaluate(data);
    if (!result.problems.length && !await waitForMergeable(number, gh, output, wait)) return 1;
    // Ensure the fetched evidence belongs to the PR version still presented by GitHub.
    const current = JSON.parse(gh(['api', `repos/${repository}/pulls/${number}`]));
    if (['head', 'base', 'body', 'labels', 'state', 'draft', 'updated_at', 'changed_files'].some((key) => !isDeepStrictEqual(data.pr[key], current[key]))) {
      result.problems.push('判定中にPRが更新された。再実行が必要。');
    }
    output(`PR #${number}: 対象の変更 ${result.changedLines}行（lockfileと見本を除く）`);
    if (result.problems.length) {
      for (const problem of result.problems) output(`- ${problem}`);
      return 1;
    }
    output('すべての条件を満たした。');
    if (args.includes('--dry-run')) { output('dry-run: merge・ブランチ削除・ラベル付けは行わない。'); return 0; }
    gh(['pr', 'merge', number, '--repo', repository, '--merge', '--match-head-commit', data.pr.head.sha]);
    const mergedPr = JSON.parse(gh(['pr', 'view', number, '--repo', repository, '--json', 'state']));
    if (mergedPr.state !== 'MERGED') throw new Error('GitHubでmerge完了を確認できない。');
    merged = true;
    const branchPath = remoteBranchPath(data.pr);
    if (branchPath) {
      try {
        gh(['api', '-X', 'DELETE', branchPath]);
      } catch {
        output('merge済み。リモートブランチの削除に失敗した。PRのブランチを確認して削除だけ再試行する。');
      }
    } else {
      output('merge済み。開発repo内の削除対象ブランチを確認できないため、リモートブランチを残した。');
    }
    gh(['pr', 'edit', number, '--repo', repository, '--add-label', 'auto:merged']);
    output('mergeし、auto:mergedを付けた。');
    return 0;
  } catch {
    output(merged ? 'merge済みだがauto:mergedの付与に失敗。PRを確認してラベルだけ再試行する。' : '判定またはmergeが完了しなかった。PRの状態を確認する。');
    output('取得データの形式、ghの接続・権限、PRの状態を確認する。');
    return 1;
  }
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2));
