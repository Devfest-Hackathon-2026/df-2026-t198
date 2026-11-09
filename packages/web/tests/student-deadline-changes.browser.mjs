import assert from 'node:assert/strict';
import process from 'node:process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:5178/student');
    // Render the production student screen with only fictional fixtures, without signing in.
    await page.evaluate(async () => {
      const { default: { createElement, act } } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { StudentView } = await import('/src/features/student/page.tsx');
      const { studentFixture, assignment } = await import('/src/shared/testing/student-fixture.ts');
      const data = studentFixture();
      const due = { kind: 'datetime', dueAt: '2026-11-12T08:30:00Z', dueText: '', timeZone: 'Asia/Tokyo' };
      data.assignments = [assignment('架空の課題', due)];
      const frame = globalThis.document.createElement('div'); frame.className = 'app';
      const host = globalThis.document.createElement('main'); frame.append(host); globalThis.document.body.replaceChildren(frame);
      const root = createRoot(host);
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.renderFixture = async (change = false) => {
        if (change) {
          const next = { ...due, dueAt: '2026-11-13T08:30:00Z' };
          data.assignments[0].latest.deadline = next; data.assignments[0].officialDeadline.deadline = next;
        }
        await act(async () => root.render(createElement(StudentView, { data: globalThis.structuredClone(data), now: Date.parse('2026-11-10T03:00:00Z') })));
      };
      await globalThis.renderFixture();
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.td-taskrow').first().click();
    await page.locator('.course-panel').waitFor();
    await page.clock.install();
    await page.evaluate(() => globalThis.renderFixture(true));
    await page.locator('.student-deadlines .td-chip-changed').waitFor();
    assert.equal(await page.locator('.course-panel .td-chip-changed').count(), 1);
    const colour = await page.locator('.student-deadlines .td-chip-changed').evaluate(chip => {
      const canvas = globalThis.document.createElement('canvas'); const ctx = canvas.getContext('2d');
      ctx.fillStyle = globalThis.getComputedStyle(chip).color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
    assert.deepEqual(colour, [195, 57, 37]);
    const metrics = await page.locator('.student-deadlines .td-taskrow-side').evaluate(side => {
      const box = side.getBoundingClientRect();
      return [...side.children].map(child => {
        const rect = child.getBoundingClientRect();
        return { text: child.textContent, width: rect.width, columnWidth: box.width, fits: rect.left >= box.left - 1 && rect.right <= box.right + 1 };
      });
    });
    process.stdout.write(JSON.stringify({ width, metrics }) + '\n');
    assert.ok(metrics.every(item => item.fits), 'badge and date stay within the deadline column');
    await page.screenshot({ path: `docs/records/2026-11-10-ui-polish/changed-student-${width}.png`, fullPage: true });
    if (width === 390) {
      await page.locator('.course-panel').getByRole('button', { name: '閉じる' }).click();
      await page.getByRole('tab', { name: '時間割', exact: true }).click();
      // Inspect actual character rectangles, including the timetable's clipped two-line names.
      const lines = await page.locator('.course-cell strong, .td-taskrow-course').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => {
        const node = el.firstChild; const rows = new Map(); const box = el.getBoundingClientRect();
        for (let i = 0; i < node.textContent.length; i++) {
          const range = globalThis.document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          if (rect.top >= box.bottom) continue;
          rows.set(rect.top, (rows.get(rect.top) || '') + node.textContent[i]);
        }
        return [...rows.values()];
      }));
      process.stdout.write(JSON.stringify({ width, courseLines: lines }) + '\n');
      assert.ok(lines.every(rows => rows.every(line => line.trim().length !== 1)), 'course names have no single-character line');
      await page.screenshot({ path: 'docs/records/2026-11-10-ui-polish/changed-timetable-390.png', fullPage: true });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
