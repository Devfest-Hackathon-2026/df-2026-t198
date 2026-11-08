import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { log } from 'node:console';

// Emit the shared artifact checker's observation format without forwarding runner logs.
const evidence = process.env.ARTIFACT_EVIDENCE_DIR;
if (!evidence) throw new Error('evidence-directory-required');
const result = spawnSync('pnpm', ['exec', 'node', 'scripts/run-emulators.mjs', '--config-from-env',
  '--project', 'demo-kadai-hisho', '--only', 'auth,firestore', 'node packages/web/tests/run-course-colors-browser.mjs'],
{ env: { ...process.env, COURSE_COLOR_PHASE: 'after' }, encoding: 'utf8', timeout: 120000 });
const passed = result.status === 0;
const observed = passed ? JSON.parse(readFileSync(`${evidence}/after.json`, 'utf8')) : { runnerExit: result.status };
log(JSON.stringify({ observations: [{ requirement_id: 'course-colors', status: passed ? 'pass' : 'fail', observed,
  evidence_files: passed ? ['after.json', ...[1280, 390].flatMap(width => ['student', 'timetable', 'session', 'demo-student', 'demo-supporter']
    .map(name => `after-${name}-${width}.png`))] : [] }] }));
process.exitCode = passed ? 0 : 1;
