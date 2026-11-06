import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDraft } from '../src/definition-drafts/draft.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function setup() {
  const out = await mkdtemp(join(tmpdir(), 'definition-draft-')); dirs.push(out);
  const definition = JSON.parse(await readFile(new URL('../../../lms-definitions/demo-lms/definition.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../../../lms-definitions/demo-lms/samples/home.html', import.meta.url), 'utf8');
  const budget = { reserve: vi.fn(), settle: vi.fn() };
  return { out, definition, budget, pages: [{ name: 'home.html', html, context: { utcOffset: '+09:00' } }] };
}
const response = (value: unknown) => ({ text: JSON.stringify(value), candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 100, totalTokenCount: 200 } });

it('rejects invalid definitions without writing a draft or raw response', async () => {
  const { out, pages, budget } = await setup();
  const generate = vi.fn().mockResolvedValue(response({ malicious: 'not a definition' }));
  await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate })).rejects.toThrow('invalid-definition');
  expect(await readdir(out)).toEqual([]);
});
it('never replaces an occupied destination and does not call Gemini for it', async () => {
  const { out, pages, budget } = await setup();
  await mkdir(join(out, 'demo-lms'));
  await writeFile(join(out, 'demo-lms', 'definition.draft.json'), 'preserve');
  const generate = vi.fn();
  await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate })).rejects.toThrow('draft-destination-exists');
  expect(generate).not.toHaveBeenCalled();
  expect(await readFile(join(out, 'demo-lms', 'definition.draft.json'), 'utf8')).toBe('preserve');
});

it('saves a validated draft with source hashes and readings, with no activation', async () => {
  const { out, pages, budget, definition } = await setup();
  const generate = vi.fn().mockResolvedValue(response(definition));
  const result = await generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: 'type contract only', budget, generate });
  expect(result).toMatchObject({ calls: 2, readingFailures: 0, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } });
  expect(budget.reserve).toHaveBeenCalledOnce();
  expect(budget.settle).toHaveBeenCalledWith(result.usage);
  const request = generate.mock.calls[0]![0];
  expect(request.config).toMatchObject({ responseMimeType: 'application/json', httpOptions: { retryOptions: { attempts: 1 } } });
  expect(request.config.tools).toBeUndefined();
  expect(request.contents).not.toContain('expected');
  expect(await readdir(join(out, 'demo-lms'))).toEqual(['definition.draft.json', 'review.json']);
  const review = JSON.parse(await readFile(join(out, 'demo-lms', 'review.json'), 'utf8'));
  expect(review).toMatchObject({ status: 'needs-human-review', definition, readings: [{ name: 'home.html',
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/), result: { pageType: 'home', courses: expect.any(Array) } }] });
});
it.each(['MAX_TOKENS', 'SAFETY'])('rejects a %s response even if the JSON is valid', async (finishReason) => {
  const { out, pages, budget, definition } = await setup();
  const generate = vi.fn().mockResolvedValue({ ...response(definition), candidates: [{ finishReason }] });
  await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate })).rejects.toThrow('draft-incomplete-response');
  expect(await readdir(out)).toEqual([]);
});
it('retains no response on missing usage or upstream failure and never retries', async () => {
  const { out, pages, budget } = await setup();
  for (const generate of [vi.fn().mockResolvedValue({ text: '{}' }), vi.fn().mockRejectedValue(new Error('upstream-private-body'))]) {
    await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate })).rejects.toThrow();
    expect(generate).toHaveBeenCalledOnce();
    expect(await readdir(out)).toEqual([]);
  }
  expect(budget.settle).not.toHaveBeenCalled();
});
it('stops before calling Gemini when the budget refuses or input is too large', async () => {
  const { out, pages, budget } = await setup();
  const generate = vi.fn();
  budget.reserve.mockRejectedValue(new Error('budget-limit'));
  await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate })).rejects.toThrow('budget-limit');
  await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: 'x'.repeat(24001), budget, generate })).rejects.toThrow('draft-input-limit');
  expect(generate).not.toHaveBeenCalled();
});
it('rejects unexpected fields, mismatched identity and executable rules', async () => {
  const { out, pages, budget, definition } = await setup();
  for (const value of [{ ...definition, definitionId: 'different' }, { ...definition, script: 'doSomething()' },
    { ...definition, courses: { ...definition.courses, name: { selector: 'h2', pattern: { type: 'regex', value: '.*' } } } }]) {
    await expect(generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate: vi.fn().mockResolvedValue(response(value)) })).rejects.toThrow();
    expect(await readdir(out)).toEqual([]);
  }
});
it('records a failed reading as needing review instead of claiming semantic correctness', async () => {
  const { out, pages, budget, definition } = await setup();
  pages[0]!.html = '<main>missing page</main>';
  const result = await generateDraft({ out, id: 'demo-lms', pages, count: vi.fn().mockResolvedValue(1600), contract: '', budget, generate: vi.fn().mockResolvedValue(response(definition)) });
  expect(result.readingFailures).toBe(1);
  const review = JSON.parse(await readFile(join(out, 'demo-lms', 'review.json'), 'utf8'));
  expect(review.readings[0].error).toBe('reading-failed');
});
it('counts system and HTML before generation, rejecting invalid token counts', async () => {
  const { out, pages, budget } = await setup();
  const generate = vi.fn();
  const count = vi.fn().mockResolvedValue(undefined);
  await expect(generateDraft({ out, id: 'demo-lms', pages, contract: '', budget, generate, count })).rejects.toThrow('draft-count-invalid');
  expect(count).toHaveBeenCalledWith(expect.stringContaining('home.html'), expect.stringContaining('untrusted DATA'));
  expect(budget.reserve).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});
