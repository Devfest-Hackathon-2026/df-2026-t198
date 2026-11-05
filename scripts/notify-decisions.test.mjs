import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

// Execute the shipped workflow shell with real jq, but never real Git or HTTP.
const workflow = readFileSync(new URL('../.github/workflows/notify-decisions.yml', import.meta.url), 'utf8');
const shell = workflow.split('        run: |\n')[1].split('\n')
  .map((line) => line.replace(/^ {10}/, '')).join('\n');
const fileUrl = 'https://github.com/example/project/blob/after/docs/decisions.md';

function run({ diff = '+## D1. Example\n', env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'notify-decisions-'));
  try {
    const patch = /^[+-]/.test(diff)
      ? `--- a/docs/decisions.md\n+++ b/docs/decisions.md\n@@ -1 +1 @@\n${diff}` : diff;
    writeFileSync(join(dir, 'diff'), patch);
    writeFileSync(join(dir, 'git'), `#!/bin/bash
printf '%s\\n' "$*" >> "$CASE_DIR/git-calls"
case "$1" in
  cat-file) exit "\${MOCK_COMMIT_STATUS:-0}" ;;
  diff) cat "$CASE_DIR/diff"; exit "\${MOCK_DIFF_STATUS:-0}" ;;
  *) exit 99 ;;
esac
`, { mode: 0o700 });
    writeFileSync(join(dir, 'curl'), `#!/bin/bash
printf '%s\\n' "$@" > "$CASE_DIR/curl-args"
cat > "$CASE_DIR/payload"
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output|-o) output="$2"; shift ;;
  esac
  shift
done
if [ -n "$output" ]; then
  printf '%s' "$MOCK_RESPONSE" > "$output"
else
  printf '%s' "$MOCK_RESPONSE"
fi
exit "\${MOCK_CURL_STATUS:-0}"
`, { mode: 0o700 });
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', shell], {
      cwd: dir, encoding: 'utf8', timeout: 10000,
      env: { PATH: `${dir}:${process.env.PATH}`, CASE_DIR: dir, TMPDIR: dir,
        WEBHOOK: 'https://discord.invalid/api/webhooks/test/dummy', BEFORE: 'before', AFTER: 'after',
        FILE_URL: fileUrl, MOCK_RESPONSE: '{"id":"123","content":"PRIVATE_RESPONSE"}', ...env },
    });
    assert.ifError(result.error);
    const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '';
    return { ...result, calls: read('git-calls'), curlArgs: read('curl-args'), payload: read('payload') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('workflow explicitly uses bash and strict pipeline failure handling', () => {
  assert.match(workflow, /shell: bash/);
  assert.match(shell, /set -euo pipefail/);
});

test('missing secret and unchanged file never send', () => {
  for (const input of [
    { env: { WEBHOOK: '' } }, { diff: '' },
    { diff: 'diff --git a/docs/decisions.md b/docs/decisions.md\nold mode 100644\nnew mode 100755\n' },
  ]) {
    const result = run(input);
    assert.equal(result.status, 0);
    assert.equal(result.curlArgs, '');
  }
});

test('missing comparison commit and failed diff stop without sending or fallback', () => {
  for (const env of [{ MOCK_COMMIT_STATUS: '128' }, { MOCK_DIFF_STATUS: '128' }]) {
    const result = run({ env });
    assert.notEqual(result.status, 0);
    assert.equal(result.curlArgs, '');
    assert.doesNotMatch(result.calls, /after~1/);
  }
});

test('body-only changes notify and verify delivery without logging response', () => {
  const result = run({ diff: '-old body\n+new body\n' });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.payload);
  assert.match(payload.content, /本文/);
  assert.ok(payload.content.endsWith(fileUrl));
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.match(result.curlArgs, /\?wait=true(?:\n|$)/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_RESPONSE/);
});

test('at most five headings are included and shell syntax stays literal', () => {
  const headings = Array.from({ length: 500 }, (_, i) => `+## D${i + 1}. $(printf INJECTED) @everyone`);
  const result = run({ diff: headings.join('\n') });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.payload);
  assert.equal((payload.content.match(/^- D/gm) ?? []).length, 5);
  assert.match(payload.content, /\$\(printf INJECTED\)/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('long Japanese and emoji headings fit 2000 characters with the complete link', () => {
  for (const title of ['あ'.repeat(2200), '😀'.repeat(2200)]) {
    const result = run({ diff: `+## D1. ${title}\n` });
    assert.equal(result.status, 0);
    const { content } = JSON.parse(result.payload);
    assert.ok(content.length <= 2000, `length: ${content.length}`);
    assert.ok(content.endsWith(`詳しく：${fileUrl}`));
    assert.match(content, /…/);
  }
});

test('failed HTTP or missing message confirmation fails without logging response', () => {
  for (const env of [
    { MOCK_CURL_STATUS: '22' },
    { MOCK_RESPONSE: '' },
    { MOCK_RESPONSE: '{"content":"PRIVATE_RESPONSE"}' },
    { MOCK_RESPONSE: 'PRIVATE_RESPONSE invalid json' },
  ]) {
    const result = run({ env });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_RESPONSE/);
  }
});
