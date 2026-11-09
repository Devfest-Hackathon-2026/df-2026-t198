import process from 'node:process';
import { log } from 'node:console';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = process.env.ARTIFACT_EVIDENCE_DIR;
if (!directory) throw new Error('evidence-directory-required');
const result = spawnSync('pnpm', ['exec', 'node', 'scripts/run-emulators.mjs', '--project', 'demo-kadai-hisho', '--only', 'auth,firestore',
  'node packages/web/tests/run-landing-browser.mjs --small-screens'], { env: process.env, encoding: 'utf8', timeout: 120000 });
await writeFile(`${directory}/browser.log`, result.stdout + result.stderr);
if (result.status !== 0) throw new Error('small-screens-failed; see browser.log');
const observations = JSON.parse(await readFile(`${directory}/after.json`, 'utf8'));
const capture = JSON.parse(await readFile('docs/records/2026-11-09-issue-261/capture/capture-results.json', 'utf8'));
for (const shot of capture.shots) {
  const bytes = await readFile(`packages/web/public/landing/${shot.name}.png`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), shot.sha256);
  assert.equal(bytes.readUInt32BE(16), shot.width); assert.equal(bytes.readUInt32BE(20), shot.height);
}
await writeFile(`${directory}/capture.json`, JSON.stringify(capture));
log(JSON.stringify({ observations: [{ requirement_id: 'browser', status: 'pass', observed: observations,
  evidence_files: (await readdir(directory)).filter(name => /\.(png|json|log)$/.test(name)) }] }));
