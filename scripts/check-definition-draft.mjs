import { readFile, writeFile, unlink } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

// Replay the exact existing oracle. Substitute only the definition's input, never its expectations.
const root = fileURLToPath(new URL('../', import.meta.url));
const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) {
  console.error('usage: pnpm definition:check <definition.draft.json>');
  process.exitCode = 1;
} else {
  const target = resolve(path);
  const source = await readFile(new URL('../packages/core/tests/demo-lms.test.mjs', import.meta.url), 'utf8');
  const needle = "new URL('definition.json', root)";
  if (source.split(needle).length !== 2) throw new Error('draft-oracle-input-changed');
  const temporary = `tests/draft-check-${randomUUID()}.test.mjs`;
  const fullPath = resolve(root, 'packages/core', temporary);
  try {
    await writeFile(fullPath, source.replace(needle, () => JSON.stringify(target)), { flag: 'wx' });
    const run = spawnSync('pnpm', ['--filter', '@kadai-hisho/core', 'exec', 'vitest', 'run', temporary], { cwd: root, stdio: 'inherit' });
    process.exitCode = run.status ?? 1;
  } finally { await unlink(fullPath); }
}
