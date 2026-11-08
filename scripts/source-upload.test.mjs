import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function excluded(paths) {
  const directory = mkdtempSync(join(tmpdir(), 'kadai-source-upload-'));
  try {
    assert.equal(spawnSync('git', ['init', '--quiet', directory]).status, 0);
    copyFileSync(join(root, '.gcloudignore'), join(directory, '.gitignore'));
    const result = spawnSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--stdin'], {
      cwd: directory, input: `${paths.join('\n')}\n`, encoding: 'utf8',
    });
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return result.stdout.trim().split('\n').filter(Boolean);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('source deployment includes every core and server runtime source after directory moves', () => {
  const sources = ['core', 'server'].flatMap(name => {
    const directory = `packages/${name}/src`;
    return readdirSync(join(root, directory), { recursive: true })
      .filter(path => path.endsWith('.ts') && !path.startsWith('definition-drafts/'))
      .map(path => `${directory}/${path}`);
  });
  const required = ['Procfile', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
    ...['core', 'server'].flatMap(name => ['package.json', 'tsconfig.json', 'tsconfig.build.json'].map(path => `packages/${name}/${path}`)),
    'lms-definitions/coursepower/navigation.json', ...sources];
  assert.deepEqual(excluded(required), []);
});

test('source deployment excludes credentials, local fixtures, tests and browser packages', () => {
  const privatePaths = ['.env', '.env.production', '.git/config', 'credentials.json', 'service-account.json',
    'fixtures-local/lms.html', 'docs/records/receipt.json', 'spikes/probe.ts', 'node_modules/module/index.js',
    'packages/extension/config.local.json', 'packages/extension/src/service-worker.ts', 'packages/web/src/main.tsx',
    'packages/server/tests/http.test.ts', 'packages/server/scripts/seed-demo-live.mjs', 'packages/server/dist/index.js',
    'packages/server/src/definition-drafts/cli.ts', 'packages/server/src/notifications/credentials.json',
    'packages/core/tests/ledger.test.ts', 'lms-definitions/coursepower/samples/assignment.html'];
  assert.deepEqual(excluded(privatePaths), privatePaths);
});
