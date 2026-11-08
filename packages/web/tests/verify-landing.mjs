import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const directory = process.env.ARTIFACT_EVIDENCE_DIR;
if (!directory) throw new Error('artifact-evidence-directory-required');
const checks = {
  layout: { mode: '--layout', file: 'chapter-measurements.json' },
  flow: { mode: '--flow', file: 'flow-verification.json' },
  entry: { mode: '--shared', file: 'shared-entry.json' },
  dialogs: { mode: '--dialogs', file: 'verification.json' },
};
const id = process.argv[2];
const check = checks[id];
if (!check) throw new Error('unknown-landing-check');
const result = spawnSync('node', ['packages/web/tests/run-landing-browser.mjs', check.mode],
  { env: process.env, encoding: 'utf8', timeout: 58000 });
const logfile = `${id}.log`;
await writeFile(`${directory}/${logfile}`, result.stdout + result.stderr);
if (result.status !== 0) throw new Error(`landing-${id}-failed; see ${logfile}`);
log(JSON.stringify({ observations: [{ requirement_id: id, status: 'pass',
  observed: JSON.parse(await readFile(`${directory}/${check.file}`, 'utf8')), evidence_files: [check.file, logfile] }] }));
