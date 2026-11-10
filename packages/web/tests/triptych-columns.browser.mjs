import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openJudgeLogin } from './helpers/judge-login.mjs';

// Run via run-demo-browser.mjs --triptych inside the local emulator wrapper.
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const phase = process.env.TRIPTYCH_CHECK_PHASE || 'after';
assert.ok(['before', 'after'].includes(phase));
const dir = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-10-triptych-columns';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
const controls = [];
let before;
if (phase === 'after') {
  try { before = JSON.parse(await readFile(`${dir}/before.json`, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const lms = page.locator('[data-demo-pane=lms]');

async function measure() {
  await page.evaluate(async () => { await globalThis.document.fonts.ready; });
  return page.locator('.demo-pane:visible').evaluateAll(panes => panes.map(pane => {
    const visible = node => node.getClientRects().length && globalThis.getComputedStyle(node).visibility !== 'hidden' && globalThis.getComputedStyle(node).clipPath === 'none';
    const label = node => ({ tag: node.tagName, class: node.className, text: node.textContent.trim().slice(0, 100) });
    const body = pane.querySelector('.demo-pane-body');
    const nodes = [body, ...body.querySelectorAll('*')].filter(visible);
    // Inspect descendants too: clipping the pane must not hide overflowing content.
    const overflow = nodes.filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth).map(node => ({ ...label(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    const cells = [...pane.querySelectorAll('.rd-lms-columns > span, .demo-course > *, .rd-lms-task-columns > span, .demo-task > a, .demo-task > .demo-status, [data-demo-page=detail] dt, [data-demo-page=detail] dd')].filter(visible).map(node => {
      const style = globalThis.getComputedStyle(node);
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const text = node.innerText.trim();
      const lineHeight = Math.max(...[node, ...node.querySelectorAll('*')].filter(visible).map(child => parseFloat(globalThis.getComputedStyle(child).lineHeight)).filter(Number.isFinite));
      const minWidth = [...text.replace(/\s/g, '')].length * parseFloat(style.fontSize) * .6;
      return { ...label(node), width, height, minWidth, lineHeight, readable: width >= minWidth || height <= lineHeight * 2 + 1 };
    });
    const narrowText = nodes.filter(node => {
      const textNodes = [...node.childNodes].filter(child => child.nodeType === globalThis.Node.TEXT_NODE && child.textContent.trim().length > 1);
      if (!textNodes.length) return false;
      const style = globalThis.getComputedStyle(node);
      const width = node.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return width < parseFloat(style.fontSize) * 2 && textNodes.some(child => {
        const range = globalThis.document.createRange(); range.selectNodeContents(child);
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size > 1;
      });
    }).map(label);
    const geometry = [...pane.querySelectorAll('.demo-campus, .demo-lms-layout, .demo-course-nav, .demo-lms-content')].map(node => {
      const box = node.getBoundingClientRect(); const origin = body.getBoundingClientRect();
      return { class: node.className, x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
    });
    const nav = pane.querySelector('.demo-course-nav')?.getBoundingClientRect();
    const content = pane.querySelector('.demo-lms-content')?.getBoundingClientRect();
    return { role: pane.dataset.demoPane, top: pane.getBoundingClientRect().top, clientWidth: body.clientWidth, scrollWidth: body.scrollWidth,
      menuAbove: nav && content ? nav.bottom <= content.top : null, geometry, overflow, cells, narrowText };
  }));
}

try {
  await page.goto('http://127.0.0.1:5177/demo-lms'); await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await page.locator('[data-demo-pane=student] .demo-observed-task').first().waitFor({ state: 'attached' });
  await page.locator('[data-demo-pane=supporter] .session-task').first().waitFor({ state: 'attached' });
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: '3つ並べて見る', exact: true }).click();
    await lms.locator('.demo-breadcrumb a').first().click();
    for (const name of ['courses', 'assignments', 'detail']) {
      if (name === 'assignments') await lms.locator('.demo-course a').first().click();
      if (name === 'detail') await lms.locator('.demo-task a').first().click();
      await lms.locator(`[data-demo-page=${{ courses: 'home', assignments: 'materials', detail: 'detail' }[name]}]:visible`).waitFor();
      // Check the supporter's expanded content as well as the collapsed summaries.
      await page.locator('[data-demo-pane=supporter] .session-task').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
      const panes = await measure();
      results.push({ width, page: name, panes });
      if (width === 1440) await page.screenshot({ path: `${dir}/${phase}-${name}-1440.png`, fullPage: true, animations: 'disabled' });
    }
    await page.getByRole('button', { name: '1画面ずつ見る', exact: true }).click();
    await lms.locator('.demo-breadcrumb a').first().click();
    controls.push({ width, mode: 'single', panes: await measure() });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  controls.push({ width: 390, mode: 'mobile', panes: await measure() });
  assert.deepEqual(errors, []);
} finally {
  // One case per line keeps the raw measurements compact and diffable.
  await writeFile(`${dir}/${phase}.json`, `{\n  "phase": ${JSON.stringify(phase)},\n  "results": [\n${results.map(row => '    ' + JSON.stringify(row)).join(',\n')}\n  ],\n  "controls": ${JSON.stringify(controls)},\n  "browserErrors": ${JSON.stringify(errors)}\n}\n`);
  await browser.close();
}
if (before) assert.deepEqual(controls, before.controls, 'default desktop and mobile geometry unchanged');
for (const row of results) {
  assert.equal(row.panes.length, 3);
  assert.equal(new Set(row.panes.map(pane => pane.top)).size, 1, `${row.width} ${row.page}: panes share a row`);
  for (const pane of row.panes) {
    const where = `${row.width} ${row.page} ${pane.role}`;
    assert.ok(pane.scrollWidth <= pane.clientWidth, `${where}: pane overflow`);
    assert.deepEqual(pane.overflow, [], `${where}: descendant overflow`);
    assert.deepEqual(pane.cells.filter(cell => !cell.readable), [], `${where}: crushed cells`);
    assert.deepEqual(pane.narrowText, [], `${where}: narrow text`);
    if (pane.role === 'lms') { assert.ok(pane.cells.length > 0); assert.equal(pane.menuAbove, true, `${where}: menu above content`); }
  }
}
process.stdout.write(`Triptych: ${results.length}/9 width/page cases, ${results.length * 3}/27 pane checks passed\n`);
