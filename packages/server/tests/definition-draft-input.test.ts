import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDraftInputs } from '../src/definition-drafts/input.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
it('loads only the fictional HTML bundle, without definition or oracle', async () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const pages = await readDraftInputs(root, 'lms-definitions/demo-lms/draft-input.json');
  expect(pages.map((p) => p.name)).toHaveLength(4);
  expect(pages[3]!.context.courseId).toBe('DEMO202');
});
it('rejects fixture paths, traversal, symlink inputs, credential markers and invalid context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-input-')); dirs.push(root);
  await mkdir(join(root, 'lms-definitions'));
  const html = join(root, 'lms-definitions/page.html');
  await writeFile(html, '<p>fictional</p>');
  await symlink(html, join(root, 'lms-definitions/link.html'));
  for (const path of ['fixtures-local/private.json', '../private.json', 'lms-definitions/link.html']) {
    await expect(readDraftInputs(root, path)).rejects.toThrow('draft-input-path');
  }
  const manifest = 'lms-definitions/input.json';
  await writeFile(join(root, manifest), JSON.stringify([{ file: 'lms-definitions/link.html', context: { utcOffset: '+09:00' } }]));
  await expect(readDraftInputs(root, manifest)).rejects.toThrow('draft-input-path');
  await writeFile(join(root, manifest), (await readFile(join(root, manifest), 'utf8')).replace('link.html', 'page.html'));
  await writeFile(html, '<a href="/sample;SID=fictional-marker">fictional</a>');
  await expect(readDraftInputs(root, manifest)).rejects.toThrow('draft-input-sensitive');
  await writeFile(join(root, manifest), '[{"file":"lms-definitions/page.html","context":{"utcOffset":"invalid"}}]');
  await expect(readDraftInputs(root, manifest)).rejects.toThrow('draft-input-manifest');
});
