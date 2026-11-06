import { isSafeMailText } from '../../core/src/mail-safety.js';

export interface DigestMail { to: string; subject: string; text: string; html: string }
// Consumer view of #112. Additional course/deadline fields are not persisted here.
export interface DigestPlan extends Omit<DigestMail, 'to'> { planId: string; date: string; startsAt: string; status: 'active' }
export interface Digest extends DigestMail { date: string; empty: boolean; plans: DigestPlan[] }

export function parseDigest(value: unknown, date: string): Digest {
  const digest = value as Digest | null;
  const mail = (row: DigestMail) => ['to', 'subject', 'text', 'html'].every(key => typeof row[key as keyof DigestMail] === 'string');
  if (!digest || typeof digest !== 'object' || !mail(digest) || digest.date !== date || typeof digest.empty !== 'boolean' ||
    !Array.isArray(digest.plans) || digest.plans.length > 200 || digest.plans.some(plan => !plan ||
      !mail({ ...plan, to: digest.to }) || typeof plan.planId !== 'string' || !/^[a-z0-9-]{1,100}$/.test(plan.planId) || plan.date !== date ||
      plan.status !== 'active' || typeof plan.startsAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(plan.startsAt) ||
      !Number.isFinite(Date.parse(plan.startsAt)) || japanDate(new Date(plan.startsAt)) !== date)) throw new Error('invalid-digest');
  return digest;
}

export function japanDate(now: Date): string { return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10); }
export function morningAt(date: string): number { return Date.parse(`${date}T07:30:00+09:00`); }
export function mailIsSafe(mail: DigestMail, secrets: string[]): boolean {
  if (!/^[A-Za-z0-9.!#$%&'*+/?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(mail.to) ||
    /[\r\n]/.test(mail.subject) || !mail.subject.trim()) return false;
  const body = [mail.to, mail.subject, mail.text, mail.html].join('\n');
  if (body.length > 512_000) return false;
  return isSafeMailText(body, secrets);
}
function base64(value: string): string {
  return btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''));
}
function subjectHeader(value: string): string {
  const words: string[] = [];
  let word = '';
  for (const char of value) {
    if (base64(word + char).length > 60) { words.push(word); word = ''; }
    word += char;
  }
  if (word) words.push(word);
  return words.map(part => `=?UTF-8?B?${base64(part)}?=`).join('\r\n ');
}
export function encodeMail(mail: DigestMail, owner: string, secrets: string[]): string {
  if (mail.to.toLowerCase() !== owner.toLowerCase() || !mailIsSafe(mail, secrets)) throw new Error('unsafe-digest');
  const boundary = `kadai-${crypto.randomUUID()}`;
  const encodedSubject = subjectHeader(mail.subject);
  const part = (type: string, body: string) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(body).match(/.{1,76}/g)?.join('\r\n') ?? ''}\r\n`;
  return base64(`From: ${mail.to}\r\nTo: ${mail.to}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${part('text/plain', mail.text)}${part('text/html', mail.html)}--${boundary}--\r\n`)
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
