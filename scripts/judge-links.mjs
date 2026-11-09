import { readFile, open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';

export async function writeJudgeLinks(folder) {
  const data = JSON.parse(await readFile(join(folder, 'demo-accounts.local.json'), 'utf8'));
  const origin = new URL(data.origin);
  if (origin.protocol !== 'https:' || origin.origin !== data.origin || !Array.isArray(data.pairs) || data.pairs.length !== 3) {
    throw new Error('invalid-judge-accounts');
  }
  const pairs = [...data.pairs].sort((a, b) => String(a.pair).localeCompare(String(b.pair)));
  const emails = new Set();
  const links = pairs.map((pair, index) => {
    const student = pair.student;
    if (pair.pair !== `trial-${index + 1}` || !student ||
      typeof student.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email) ||
      typeof student.password !== 'string' || !student.password || emails.has(student.email)) {
      throw new Error('invalid-judge-accounts');
    }
    emails.add(student.email);
    const encoded = Buffer.from(JSON.stringify({ email: student.email, password: student.password }), 'utf8').toString('base64url');
    if (encoded.length > 8192) throw new Error('invalid-judge-accounts');
    return `${origin.origin}/demo-lms#judge=${encoded}`;
  });
  // Exclusive creation also rejects existing symlinks; never replace another file.
  const file = await open(join(folder, 'judge-links.local.txt'), 'wx', 0o600);
  try { await file.writeFile(links.join('\n') + '\n'); }
  finally { await file.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await writeJudgeLinks(fileURLToPath(new URL('../fixtures-local/', import.meta.url)));
    process.stdout.write('3本を書いた: fixtures-local/judge-links.local.txt\n');
  } catch {
    process.stderr.write('審査用リンクを作れませんでした。入力と保存先を確認してください。\n');
    process.exitCode = 1;
  }
}
