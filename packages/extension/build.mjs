import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { configureManifest, loadConfig } from './build-config.mjs';
import { auditBundle } from './bundle-audit.mjs';

const config = await loadConfig();
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/service-worker.ts', 'src/content.ts', 'src/options.ts'],
  bundle: true,
  outdir: 'dist',
  platform: 'browser',
  format: 'iife',
  target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) },
  metafile: true,
}).then((result) => auditBundle(result.metafile));
const manifest = configureManifest(JSON.parse(await readFile('manifest.json', 'utf8')), config);
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
for (const asset of ['options.html', 'options.css']) await copyFile(asset, `dist/${asset}`);
