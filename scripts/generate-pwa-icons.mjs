import { readFile, mkdir } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

// One-time regeneration: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/generate-pwa-icons.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = new URL('../packages/web/public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', directory), 'utf8');
await mkdir(new URL('icons/', directory), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [size, path, maskable] of [
    [192, 'icons/icon-192.png', false], [512, 'icons/icon-512.png', false],
    [512, 'icons/icon-maskable-512.png', true], [180, 'apple-touch-icon.png', false],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    // The padded mark fits inside the maskable icon's central 80% safe circle.
    const drawing = maskable ? svg.replace('viewBox="0 0 64 64"', 'viewBox="-16 -16 96 96"') : svg;
    await page.setContent(`<style>body{margin:0;background:#F3F0E8}svg{width:100vw;height:100vh;display:block}</style>${drawing}`);
    await page.screenshot({ path: new URL(path, directory).pathname });
    await page.close();
  }
} finally { await browser.close(); }
