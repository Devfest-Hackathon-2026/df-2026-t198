import { readFile, readdir, stat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

// Product vocabulary only. Never add a person, course, assignment, or source identifier.
const UI_TEXT = new Set([
  'CoursePower', 'お知らせ一覧', 'お知らせ詳細', 'メニュー', 'ログイン', 'ログアウト', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日', 'その他',
  '第１限', '第２限', '第３限', '第４限', '第５限', '第６限', '第７限',
  '第1限', '第2限', '第3限', '第4限', '第5限', '第6限', '第7限',
  '秋学期', '前学期', '後学期', '通年', '集中講義', '仮登録', '履修生',
  'レポート', '未提出', '提出済', '提出済み', '未評価', '公開中', '公開終了',
  '提出期限', '提出状況', '提出期間', '状態', '教材名', '教材種別', 'タイトル',
  '件名', '本文', 'お知らせ', '種別', '登録者', '登録日', '掲載期間', '課題', '内容',
  '締切', '講義名', '授業名', '担当教員', '未読', '既読', '状況', '提出後の訂正',
  '発信者', '分類', '公開開始日時', '公開終了日時', '発信日時', '更新日時',
  '関連講義名', '添付ファイル', 'まで', 'なし', '教材', '公開開始', '授業日',
  'すべて開く', '名称', '公開期限', '出欠', '授業実施日', '公開開始 ▼', '添付',
  '訂正可', '訂正不可', '可(再提出不可)', '可(再提出可能)', '否', '-', '－', '―',
]);
const STRUCTURE = {
  class: new Set([
    'accordionContents hide kyozaiHidden', 'accordionFolderIcon', 'accordionHeader jyugyoHidden',
    'accordionMark clickable jyugytitleCell', 'allOpen clickable', 'allOpenIcon', 'allOpenText',
    'breadCrumb', 'center', 'courseCard', 'courseCardArea', 'courseCardContents', 'courseCardInfo',
    'courseCardName', 'courseCardUser', 'courseFolderName jyugytitleEllipsisCell boldStCourseFolderName',
    'courseListTable kyozai_table', 'cpLabel orange', 'cs_table2', 'cs_table3a', 'current',
    'dayBox cpMargin', 'green1', 'hide', 'htmlwordbreak box01', 'iconText', 'jyugyeditCell',
    'jyugyeditCell checkStBoldJyugyoDy', 'jyugytitleCell', 'kyozaititleCell', 'materialLabe blueblock',
    'quantity', 'red3', 'sortlink', 'tableFixedSet', 'term', 'textoverflow', 'weeklyCourseArea cpMargin',
    'cpPopupFooter', 'cs_top10',
  ]),
  id: new Set(['HTMLEditor_subject', 'allOpenTxt', 'cs_centerinVox', 'cs_rightTabinVox',
    'cs_rightVox', 'cs_rightinVox', 'list_table0', 'table0', 'title0',
    ...Array.from({ length: 9 }, (_, i) => `ryogyoCheck0_${i + 1}`),
    'sortlink1', 'sortlink2', 'sortlink3', 'sortlink5', 'sortlink6',
    'gakuninLoginForm', 'addMess4Vox', 'addMess4']),
  name: new Set(['loginButton', 'lginLgirActionForm']), type: new Set(['submit']),
  colspan: new Set(['3', '4', '5']), border: new Set(['0']),
  cellpadding: new Set(['0']), cellspacing: new Set(['0']),
  width: new Set(['10%', '12%', '15%', '16%', '20%', '29%', '30%', '35%']),
  lang: new Set(['ja']), charset: new Set(['utf-8']), href: new Set(['#']),
};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ensp: ' ', emsp: ' ', thinsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©' };
function decode(value) {
  let result = value;
  for (let pass = 0; pass < 3; pass++) {
    const previous = result;
    result = result.replace(/&#(x[\da-f]+|\d+);?/gi, (whole, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
    }).replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
      .replace(/\\u([\da-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/(?:%[\da-f]{2})+/gi, (part) => { try { return decodeURIComponent(part); } catch { return part; } });
    if (previous === result) break;
  }
  return result.normalize('NFKC');
}
const normalize = (value) => decode(value).replace(/\s+/gu, ' ').trim();
// Names used by HTML, the fixture format and this documentation, not source content.
const FORMAT_WORDS = ['html', 'script', 'style', 'class', 'colspan', 'onclick', 'href', 'hidden',
  'formSubmit', 'kyozaiTitleLink', 'clickTitle', 'course', 'assignment', 'notice', 'detail',
  'samples', 'check', 'self', 'test', 'sourceId', 'courseId', 'slots', 'contextOnly',
  'dueText', 'dueAt', 'availabilityText', 'statusText', 'bodyText', 'submitted'];
const ui = new Set([...UI_TEXT, ...FORMAT_WORDS].map(normalize));
function grams(value) {
  const characters = Array.from(value);
  return Array.from({ length: Math.max(0, characters.length - 3) }, (_, i) => characters.slice(i, i + 4).join(''));
}
const uiGrams = new Set([...ui].flatMap(grams));
// Lexical scanning is deliberately conservative. This is not the product HTML parser.
// Quoted '>' is part of an attribute, not a tag boundary.
function parts(html) {
  const result = [];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+/gi;
  let rawTag = null;
  for (const match of html.matchAll(tokens)) {
    const token = match[0];
    if (/^<\//.test(token)) { if (rawTag && token.toLowerCase().startsWith(`</${rawTag}`)) rawTag = null; continue; }
    if (rawTag) continue;
    if (/^<!(?:--)?/.test(token)) continue;
    if (token[0] !== '<') { result.push({ value: token, index: match.index + token.length - token.trimStart().length, attribute: null }); continue; }
    const tag = /^<([\w-]+)/.exec(token)?.[1].toLowerCase();
    if (tag === 'script' || tag === 'style') rawTag = tag;
    const attr = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const a of token.matchAll(attr)) result.push({ value: a[2] ?? a[3] ?? a[4], index: match.index + a.index, attribute: a[1].toLowerCase() });
  }
  return result;
}
function structural(attribute, value) {
  return STRUCTURE[attribute]?.has(value) ?? false;
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('symlink');
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function textGrams(value) {
  // Dates and punctuation are checked as whole values and digit runs separately.
  return (value.match(/[\p{L}\p{M}]{4,}/gu) ?? []).flatMap(grams).filter((gram) => !uiGrams.has(gram));
}
function prominentWords(value) {
  const japanese = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{5,}/gu) ?? [])
    .filter((word) => /[\p{Script=Han}\p{Script=Katakana}]/u.test(word));
  return [...japanese, ...(value.match(/[a-zA-Z]{6,}/g) ?? [])].filter((word) => !ui.has(word));
}
async function privateTerms(directory) {
  const sources = (await files(directory)).filter((path) => /\.html?$/i.test(path));
  if (!sources.length || !await exists(join(directory, 'denylist.local.txt'))) throw new Error('incomplete-local-input');
  const forbidden = new Set();
  const attributes = new Set();
  const textValues = new Set();
  const prominent = new Set();
  for (const path of sources) {
    const html = await readFile(path, 'utf8');
    for (const { value, attribute } of parts(html)) {
      const token = normalize(value);
      if (!token || structural(attribute, token) || ui.has(token)) continue;
      for (const word of prominentWords(token)) prominent.add(word);
      if (attribute) attributes.add(token);
      else {
        if (Array.from(token).length >= 4) textValues.add(token);
        for (const gram of textGrams(token)) forbidden.add(gram);
      }
    }
    for (const digits of decode(html).match(/\d{4,}/g) ?? []) for (const gram of grams(digits)) {
      forbidden.add(gram);
      prominent.add(gram);
    }
  }
  const deny = (await readFile(join(directory, 'denylist.local.txt'), 'utf8')).split(/\r?\n/)
    .map(normalize).filter((line) => line && !line.startsWith('#'));
  if (!deny.length) throw new Error('empty-denylist');
  return { forbidden, attributes, textValues, prominent, deny };
}

const JSON_METADATA = new Set(['home', 'materials', 'assignment-detail', 'notice-list', 'notice-detail',
  'submitted', 'not-submitted', 'unknown', 'sourceId', 'courseId']);
function jsonChunks(content) {
  JSON.parse(content);
  return [...content.matchAll(/"(?:[^"\\]|\\.)*"/g)].filter((match) => !/^\s*:/.test(content.slice(match.index + match[0].length)))
    .map((match) => ({ value: JSON.parse(match[0]), index: match.index, attribute: null }))
    .filter(({ value }) => !JSON_METADATA.has(value));
}
const genericPatterns = [/;sid\s*=/i, /jsessionid/i, /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i, /fixtures-local/i];
function compactWithOffsets(content) {
  let text = '';
  const offsets = [];
  let lineStart = 0;
  for (const line of content.split('\n')) {
    const compact = decode(line).replace(/\s+/gu, '');
    text += compact;
    offsets.push(...Array(compact.length).fill(lineStart));
    lineStart += line.length + 1;
  }
  return { text, offsets };
}
function privateMatch(token, attribute, terms) {
  if (structural(attribute, token) || (!attribute && ui.has(token))) return false;
  if (terms.attributes.has(token)) return true;
  for (const term of terms.attributes) {
    if (term.length >= 8 && !/^[a-zA-Z_][\w]*$/.test(term) && token.includes(term)) return true;
  }
  if ([...terms.textValues].some((term) => token.includes(term))) return true;
  const candidates = [...textGrams(token), ...(token.match(/\d{4,}/g) ?? []).flatMap(grams)];
  return candidates.some((gram) => terms.forbidden.has(gram));
}
async function check(root) {
  const sampleRoot = join(root, 'lms-definitions/coursepower/samples');
  const paths = await files(sampleRoot);
  if (!paths.some((path) => path.endsWith('.html'))) throw new Error('no-samples');
  const local = join(root, 'fixtures-local/ynu');
  const terms = await exists(local) ? await privateTerms(local) : null;
  const findings = new Set();
  const add = (path, content, index) => findings.add(`${relative(root, path)}:${content.slice(0, index).split('\n').length}`);
  for (const path of paths) {
    const content = await readFile(path, 'utf8');
    const compact = compactWithOffsets(content);
    const markdown = /\.md$/i.test(path);
    const words = new Set(markdown ? prominentWords(normalize(content)) : []);
    const proseTerms = markdown ? [...terms?.prominent ?? []]
      .filter((term) => !/^[a-zA-Z]+$/.test(term) || words.has(term)) : [];
    for (const pattern of genericPatterns) {
      for (const match of compact.text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        add(path, content, compact.offsets[match.index]);
      }
    }
    for (const term of [...terms?.deny ?? [], ...proseTerms]) {
      const needle = term.replace(/\s+/gu, '');
      let index = compact.text.indexOf(needle);
      while (index !== -1) {
        add(path, content, compact.offsets[index]);
        index = compact.text.indexOf(needle, index + needle.length);
      }
    }
    if (/\.html$/i.test(path)) {
      for (const match of content.matchAll(/<!--|<(?:script|style|link|iframe|object|embed)\b|\s(?:src|srcset|action|style)\s*=/gi)) add(path, content, match.index);
    }
    if (!terms || markdown) continue;
    const chunks = /\.html$/i.test(path) ? parts(content) : /\.json$/i.test(path) ? jsonChunks(content) : content.split('\n').map((value, i, lines) => ({ value, index: lines.slice(0, i).join('\n').length + (i ? 1 : 0), attribute: null }));
    for (const { value, index, attribute } of chunks) {
      const token = normalize(value);
      if (privateMatch(token, attribute, terms)) add(path, content, index);
    }
  }
  return { findings: [...findings].sort(), local: Boolean(terms), count: paths.length };
}

async function selfTest() {
  const root = await mkdtemp(join(tmpdir(), 'check-samples-'));
  const sample = join(root, 'lms-definitions/coursepower/samples');
  const local = join(root, 'fixtures-local/ynu');
  try {
    await mkdir(sample, { recursive: true });
    const target = join(sample, 'synthetic.html');
    const run = async (text) => { await writeFile(target, text); return check(root); };
    const publicOnly = await run('<p>架空のみ</p>');
    assert.equal(publicOnly.findings.length, 0);
    assert.equal(publicOnly.local, false);
    const splitToken = await run('<p>\n;SI\nD=dummy\n</p>');
    assert.deepEqual(splitToken.findings, ['lms-definitions/coursepower/samples/synthetic.html:2']);
    for (const marker of [';SID=dummy', 'jSeSsIoNiD', 'sample@example.test', 'fixtures-local', '&#59;SID=dummy', '%3BSID%3Ddummy', '<script>void 0</script>']) {
      assert.ok((await run(`<p>\n${marker}\n</p>`)).findings.length > 0);
    }
    await mkdir(local, { recursive: true });
    await writeFile(join(local, 'synthetic.html'), '<p>合成秘密語句</p><p>番号 87654321</p><p>提出期限</p><p>未提出</p><p>無名語彙</p><i title="hidden-synthetic-value"></i><b data-code="xyz"></b>');
    await writeFile(join(local, 'denylist.local.txt'), '禁止試験語\n');
    assert.equal((await run('<p>提出期限</p><p>未提出</p><p>架空のみ</p>')).findings.length, 0);
    for (const marker of ['合成秘密', '8765', 'hidden-synthetic-value', '禁止試験語', '&#x5408;成秘密', '<b data-code="xyz"></b>', '無名語彙']) {
      const result = await run(`<p>\n${marker}\n</p>`);
      assert.ok(result.findings.length > 0);
      assert.deepEqual(result.findings, ['lms-definitions/coursepower/samples/synthetic.html:2']);
    }
    // Synthetic material only: prose has a different lexical threshold from data.
    await writeFile(join(local, 'prose.html'), '<p>なかった</p><p>画面から</p><p>ひらがなだけ</p><p>合成専用秘密</p><p>カタカナヒミツ</p><p>ABCDEF</p><p>ABCDE</p>');
    const documentation = join(sample, 'README.md');
    const runDocumentation = async (value) => {
      await writeFile(target, '<p>架空のみ</p>');
      await writeFile(documentation, value);
      return check(root);
    };
    assert.equal((await runDocumentation('なかった。画面から読む。ひらがなだけ。合成専用。ABCDE。ABCDEFG。')).findings.length, 0);
    for (const marker of ['合成専用秘密', 'カタカナヒミツ', 'an ABCDEF word', '8765', '禁止試験語',
      '&#x5408;成専用秘密', '禁止\n試験語']) {
      const result = await runDocumentation(marker);
      assert.deepEqual(result.findings, ['lms-definitions/coursepower/samples/README.md:1']);
      assert.ok(!result.findings.join('\n').includes(marker));
    }
    await writeFile(documentation, '架空のみ');
    for (const marker of ['なかった', '画面から', '合成専用']) {
      assert.ok((await run(`<p>${marker}</p>`)).findings.length > 0);
      await writeFile(target, '<p>架空のみ</p>');
      const json = join(sample, 'synthetic.expected.json');
      await writeFile(json, JSON.stringify({ value: marker }));
      assert.deepEqual((await check(root)).findings, ['lms-definitions/coursepower/samples/synthetic.expected.json:1']);
      await rm(json);
    }
    await writeFile(join(local, 'denylist.local.txt'), '');
    await assert.rejects(() => check(root));
    console.log('check:samples self-test: passed');
  } finally { await rm(root, { recursive: true, force: true }); }
}
try {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const result = await check(root);
    if (result.findings.length) { console.error(result.findings.join('\n')); process.exitCode = 1; }
    else console.log(`check:samples: ${result.count} files passed; local comparison ${result.local ? 'passed' : 'skipped (local materials absent)'}`);
  }
} catch {
  // Do not print exceptions: file names, parser errors and input values may be private.
  console.error('check:samples: inspection could not complete');
  process.exitCode = 1;
}
