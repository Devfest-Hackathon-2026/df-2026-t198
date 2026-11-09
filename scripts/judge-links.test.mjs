import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, stat, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeJudgeLinks } from './judge-links.mjs';

const accounts = () => ({ origin: 'https://demo.example.invalid', pairs: [1, 2, 3].map(n => ({ pair: `trial-${n}`,
  student: { email: `judge-${n}@example.invalid`, password: `synthetic-パス-${n}` },
  supporter: { email: `support-${n}@example.invalid`, password: 'never-include-supporter' } })) });
async function fixture(run) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'judge-links-test-')));
  try {
    await writeFile(join(folder, 'demo-accounts.local.json'), JSON.stringify(accounts()));
    await run(folder);
  } finally { await rm(folder, { recursive: true, force: true }); }
}
test('writes exactly three student-only links to a new private file', () => fixture(async folder => {
  await writeJudgeLinks(folder);
  const output = join(folder, 'judge-links.local.txt');
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const links = (await readFile(output, 'utf8')).trim().split('\n');
  assert.equal(links.length, 3);
  for (const [index, link] of links.entries()) {
    const url = new URL(link);
    assert.equal(url.origin, accounts().origin); assert.equal(url.pathname, '/demo-lms'); assert.equal(url.search, '');
    assert.deepEqual(JSON.parse(Buffer.from(url.hash.slice(7), 'base64url').toString()), accounts().pairs[index].student);
  }
}));
test('refuses existing output including a symlink without modifying its target', () => fixture(async folder => {
  const target = join(folder, 'protected.txt'); await writeFile(target, 'unchanged');
  await symlink(target, join(folder, 'judge-links.local.txt'));
  await assert.rejects(writeJudgeLinks(folder));
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
}));
test('rejects invalid accounts and origins without creating output', async () => {
  for (const value of [null, { ...accounts(), origin: 'http://demo.example.invalid' },
    { ...accounts(), origin: 'https://name:secret@example.invalid' }, { ...accounts(), origin: 'https://example.invalid/path#secret' },
    { ...accounts(), pairs: accounts().pairs.slice(0, 2) }, { ...accounts(), pairs: accounts().pairs.map(p => ({ ...p, pair: 'public-1' })) },
    { ...accounts(), pairs: [accounts().pairs[0], accounts().pairs[0], accounts().pairs[0]] }]) {
    await fixture(async folder => {
      await writeFile(join(folder, 'demo-accounts.local.json'), JSON.stringify(value));
      await assert.rejects(writeJudgeLinks(folder));
      await assert.rejects(stat(join(folder, 'judge-links.local.txt')));
    });
  }
});
test('CLI never emits raw input or exceptions on success or failure', () => fixture(async folder => {
  // Copy the script into an isolated layout so no real fixture path is read.
  const { mkdir, copyFile } = await import('node:fs/promises');
  await mkdir(join(folder, 'scripts')); await mkdir(join(folder, 'fixtures-local'));
  await copyFile(new URL('./judge-links.mjs', import.meta.url), join(folder, 'scripts/judge-links.mjs'));
  await writeFile(join(folder, 'fixtures-local/demo-accounts.local.json'), JSON.stringify(accounts()));
  const run = () => spawnSync(process.execPath, [join(folder, 'scripts/judge-links.mjs')], { encoding: 'utf8' });
  const success = run(); assert.equal(success.status, 0);
  assert.equal(success.stdout, '3本を書いた: fixtures-local/judge-links.local.txt\n'); assert.equal(success.stderr, '');
  const failed = run(); assert.equal(failed.status, 1); assert.equal(failed.stdout, '');
  assert.equal(failed.stderr, '審査用リンクを作れませんでした。入力と保存先を確認してください。\n');
}));
