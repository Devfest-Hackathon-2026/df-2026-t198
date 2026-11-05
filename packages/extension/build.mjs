import { copyFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/service-worker.ts', 'src/content.ts'],
  bundle: true,
  outdir: 'dist',
  platform: 'browser',
  format: 'iife',
  target: 'chrome102',
});
await copyFile('manifest.json', 'dist/manifest.json');
