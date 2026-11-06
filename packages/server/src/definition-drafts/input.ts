import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SavedPage } from './draft.js';

export async function readDraftInputs(root: string, manifestPath: string): Promise<SavedPage[]> {
  root = await realpath(root);
  const allowed = resolve(root, 'lms-definitions');
  if ((await lstat(allowed)).isSymbolicLink()) throw new Error('draft-input-path');
  async function read(relativePath: string) {
    const path = resolve(root, relativePath);
    // Check lexical components before following a symlink or reading any file.
    if (path.split(sep).includes('fixtures-local')) throw new Error('draft-input-path');
    const lexical = relative(allowed, path);
    if (lexical.startsWith('..') || isAbsolute(lexical)) throw new Error('draft-input-path');
    let cursor = allowed;
    for (const part of lexical.split(sep)) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('draft-input-path');
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size > 20000) throw new Error('draft-input-limit');
    return readFile(path, 'utf8');
  }
  const manifest: unknown = JSON.parse(await read(manifestPath));
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 12) throw new Error('draft-input-manifest');
  const pages: SavedPage[] = [];
  for (const page of manifest) {
    if (!page || Object.keys(page).some((key) => !['file', 'context'].includes(key)) ||
        typeof page.file !== 'string' || !/\.html$/.test(page.file) || !page.context ||
        Object.keys(page.context).some((key) => !['utcOffset', 'courseId', 'sourceId'].includes(key)) ||
        typeof page.context.utcOffset !== 'string' || !/^[+-](?:0[0-9]|1[0-3]):[0-5][0-9]$|^[+-]14:00$/.test(page.context.utcOffset) ||
        ['courseId', 'sourceId'].some((key) => page.context[key] !== undefined &&
          (typeof page.context[key] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(page.context[key])))) {
      throw new Error('draft-input-manifest');
    }
    const html = await read(page.file);
    // This rejects common credential markers, not all personal information: fictional samples remain mandatory.
    if (/\b(?:sid|jsessionid|cookie|authorization|token|password)\b\s*[=:]|Bearer\s|-----BEGIN|fixtures-local/i.test(html)) {
      throw new Error('draft-input-sensitive');
    }
    pages.push({ name: page.file, html, context: page.context });
  }
  return pages;
}
