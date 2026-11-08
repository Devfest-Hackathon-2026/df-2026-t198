import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export default defineConfig({
  server: { proxy: { '/api': `http://127.0.0.1:${process.env['KADAI_API_PORT'] || '8080'}` } },
  plugins: [{
    name: 'pwa-cache-version',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const source = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
        const hash = createHash('sha256').update(source);
        for (const [name, file] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
          hash.update(name).update(file.type === 'chunk' ? file.code : file.source);
        }
        this.emitFile({ type: 'asset', fileName: 'sw.js',
          source: source.replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16)) });
      },
    },
  }],
});
