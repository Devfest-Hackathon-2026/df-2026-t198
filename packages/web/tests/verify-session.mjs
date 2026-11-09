import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { log } from 'node:console';
// Collect only bounded observations; emulator output and account setup stay out of the receipt.
const result = spawnSync('pnpm', ['exec', 'node', 'scripts/run-emulators.mjs', '--config-from-env', '--project',
  'demo-kadai-hisho', '--only', 'auth,firestore', 'node packages/web/tests/run-session-browser.mjs'],
{ env: process.env, encoding: 'utf8', timeout: 180000 });
if (result.status !== 0) throw new Error('session-verification-failed: inspect local emulator/browser run');
const observations = result.stdout.split('\n').filter(line => line.startsWith('{"observations":'))
  .flatMap(line => JSON.parse(line).observations);
if (observations.length !== 2) throw new Error('missing-session-observations');
log(JSON.stringify({ observations }));
