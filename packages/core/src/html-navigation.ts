import { parseHTML } from 'linkedom/worker';

/** Detached parsing only. Successful controls are restricted to the caller's allowlist. */
export function readFormFields(html: string, name: string, allowed: readonly string[]): Record<string, string> {
  const { document } = parseHTML(html);
  const forms = Array.from(document.querySelectorAll('form')).filter(f => f.getAttribute('name') === name || f.getAttribute('id') === name);
  if (forms.length !== 1) throw new Error('parse-error');
  const fields: Record<string, string> = {};
  for (const node of forms[0]!.querySelectorAll('input, select, textarea')) {
    const key = node.getAttribute('name');
    if (!key || !allowed.includes(key) || node.getAttribute('disabled') !== null) continue;
    if (['submit', 'button', 'file', 'reset'].includes(node.getAttribute('type') ?? '')) continue;
    if (['checkbox', 'radio'].includes(node.getAttribute('type') ?? '') && node.getAttribute('checked') === null) continue;
    if (Object.hasOwn(fields, key)) throw new Error('parse-error');
    fields[key] = node.localName === 'select'
      ? (node.querySelector('option[selected]') ?? node.querySelector('option'))?.getAttribute('value') ?? ''
      : node.localName === 'textarea' ? node.textContent ?? '' : node.getAttribute('value') ?? '';
  }
  return fields;
}

export function readHtmlAttribute(html: string, selector: string, attribute: string): string | null {
  const nodes = parseHTML(html).document.querySelectorAll(selector);
  return nodes.length === 1 ? nodes[0]!.getAttribute(attribute) : null;
}
