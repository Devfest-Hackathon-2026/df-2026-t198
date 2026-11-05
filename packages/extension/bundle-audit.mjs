import { readFile } from 'node:fs/promises';

export async function auditBundle(metafile) {
  for (const [path, output] of Object.entries(metafile.outputs)) {
    if (output.imports.length > 0) throw new Error('Extension bundle contains unresolved imports');
    if (!path.endsWith('.js')) continue;
    const source = await readFile(path, 'utf8');
    const forbidden = [
      /\beval\s*\(/,
      /\bnew\s+Function\s*\(/,
      /\bimport\s*\(/,
      /\bimportScripts\s*\(/,
      /\bcreateElement\s*\(\s*['"]script['"]/i,
    ];
    if (forbidden.some((pattern) => pattern.test(source))) {
      throw new Error(`Extension bundle contains code generation or script loading: ${path}`);
    }
  }
}
