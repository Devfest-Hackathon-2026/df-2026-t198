// PLAN.md の完成条件を数え、冒頭の進捗の行を出す。
//   node scripts/plan-progress.mjs          数字を表示する
//   node scripts/plan-progress.mjs --write  PLAN.md の進捗の行を書き換える
//   node scripts/plan-progress.mjs --check  進捗の行が一覧と食い違えば失敗する（CI用）
import { readFileSync, writeFileSync } from 'node:fs';

const planPath = new URL('../PLAN.md', import.meta.url);
const startMarker = '<!-- progress:start -->';
const endMarker = '<!-- progress:end -->';
const conditionLine = /^- \[( |x)\] (C\d+) /;
const removableMark = '〔削れる〕';
const evidenceMark = '→';

const plan = readFileSync(planPath, 'utf8');
const problems = [];
const seen = new Set();
const counts = { all: 0, allDone: 0, required: 0, requiredDone: 0 };

for (const line of plan.split('\n')) {
  const match = conditionLine.exec(line);
  if (!match) continue;
  const [, mark, id] = match;
  const done = mark === 'x';
  if (seen.has(id)) problems.push(`${id} が2回出てくる`);
  seen.add(id);
  if (done && !line.includes(evidenceMark)) problems.push(`${id} は満たしたことになっているが、証拠（${evidenceMark} のあと）が無い`);

  counts.all += 1;
  if (done) counts.allDone += 1;
  if (!line.includes(removableMark)) {
    counts.required += 1;
    if (done) counts.requiredDone += 1;
  }
}

const percent = (done, total) => (total === 0 ? 0 : Math.floor((done * 100) / total));
const summary =
  `完成条件：全体 ${counts.allDone}/${counts.all}（${percent(counts.allDone, counts.all)}%）、` +
  `必須 ${counts.requiredDone}/${counts.required}（${percent(counts.requiredDone, counts.required)}%）`;

const start = plan.indexOf(startMarker);
const end = plan.indexOf(endMarker);
if (start === -1 || end === -1 || end < start) problems.push('PLAN.md に進捗の行の目印が無い');

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const written = plan.slice(start + startMarker.length, end).trim();
const mode = process.argv[2];

if (mode === '--write') {
  const updated = plan.slice(0, start + startMarker.length) + `\n${summary}\n` + plan.slice(end);
  if (updated !== plan) writeFileSync(planPath, updated);
} else if (mode === '--check' && written !== summary) {
  console.error(`PLAN.md の進捗の行が古い。pnpm progress --write で直す。\n今：${written}\n正：${summary}`);
  process.exit(1);
}

console.log(summary);
