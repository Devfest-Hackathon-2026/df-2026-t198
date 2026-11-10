import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-f1-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) for (const role of ['student', 'supporter']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5189/student');
    await page.evaluate(async role => {
      const { default: { createElement, act } } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { StudentView } = await import('/src/features/student/page.tsx');
      const { SessionDetails } = await import('/src/features/session/page.tsx');
      const { emptySession } = await import('/src/features/session/model.ts');
      const { studentFixture, assignment, dated } = await import('/src/shared/testing/student-fixture.ts');
      const data = { ...emptySession(), ...studentFixture(), changes: [] };
      data.assignments = Array.from({ length: 5 }, (_, i) => assignment(`架空のレポート${i + 1}：授業で配られた資料を読んで考えをまとめる`, dated('2026-11-12')));
      const changes = data.assignments.map((row, i) => ({ changeId: `change-${i}`, assignmentKey: row.key,
        kind: 'deadline-changed', before: dated('2026-11-14'), after: dated('2026-11-12'),
        observationId: 'fictional', recordedAt: `2026-11-10T02:0${i}:00Z` }));
      const frame = globalThis.document.createElement('div'); frame.className = 'app';
      const host = globalThis.document.createElement('main'); frame.append(host); globalThis.document.body.replaceChildren(frame);
      let root = createRoot(host); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.renderF1 = async (mode = 'history') => {
        if (mode === 'reopen') { await act(async () => root.unmount()); root = createRoot(host); }
        data.changes = mode === 'new' ? changes.map(change => ({ ...change, kind: 'new' })) : changes;
        await act(async () => root.render(role === 'student'
          ? createElement(StudentView, { data: globalThis.structuredClone(data), now: Date.parse('2026-11-10T03:00:00Z') })
          : createElement(SessionDetails, { data: globalThis.structuredClone(data), now: new Date('2026-11-10T03:00:00Z'),
            own: false, uid: 'fictional-student', planning: false, save: async () => {} })));
      };
      await globalThis.renderF1('new');
    }, role);
    const notice = page.getByRole('region', { name: '最近の締切変更' });
    assert.equal(await notice.count(), 0, 'new assignments are not deadline changes');
    await page.evaluate(() => globalThis.renderF1());
    await notice.waitFor();
    assert.equal(await notice.locator('li:visible').count(), 1);
    assert.match(await notice.innerText(), /変更前：2026\/11\/14/);
    assert.match(await notice.innerText(), /変更後：2026\/11\/12/);
    await notice.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await notice.locator('li:visible').count(), 5, 'keyboard expands remaining changes');
    await page.clock.install(); await page.clock.fastForward(9000);
    assert.equal(await notice.count(), 1);
    await page.evaluate(() => globalThis.renderF1('reopen'));
    assert.equal(await notice.locator('li:visible').count(), 1);
    assert.equal(await notice.getByRole('link').first().getAttribute('href'), 'https://example.invalid/task');
    const fits = await notice.evaluate(element => [...element.querySelectorAll('li, a, summary')].every(child => {
      if (!child.getClientRects().length) return true;
      const rect = child.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= globalThis.innerWidth;
    }));
    assert.ok(fits, 'notice text and controls fit the viewport');
    await page.screenshot({ path: `${output}/${role}-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    process.stdout.write(JSON.stringify({ role, width, checks: 10, passed: 10, errors: errors.length }) + '\n');
    await page.close();
  }
} finally { await browser.close(); }
