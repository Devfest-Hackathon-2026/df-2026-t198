import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': `http://127.0.0.1:${process.env['KADAI_API_PORT'] || '8080'}` } },
});
