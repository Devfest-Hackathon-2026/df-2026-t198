import { parseHTML, type TreeElement } from 'linkedom/worker';

const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const asciiLower = (name: string): string => name.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** LinkeDOM preserves source attribute names; HTML selectors require ASCII-insensitive names. */
export function parseHtmlTree(html: string): { document: TreeElement } {
  const tree = parseHTML(html);
  for (const element of tree.document.querySelectorAll('*')) {
    if (element.namespaceURI !== htmlNamespace) continue;
    const attributes = Array.from(element.attributes, ({ name, value }) => ({ name, value }));
    if (!attributes.some(({ name }) => asciiLower(name) !== name)) continue;
    const names = new Map<string, string>();
    for (const { name, value } of attributes) {
      const normalized = asciiLower(name);
      // HTML keeps the first occurrence when names differ only by ASCII case.
      if (!names.has(normalized)) names.set(normalized, value);
      element.removeAttribute(name);
    }
    for (const [name, value] of names) element.setAttribute(name, value);
  }
  return tree;
}

export function htmlAttribute(element: TreeElement, name: string): string | null {
  return element.getAttribute(element.namespaceURI === htmlNamespace ? asciiLower(name) : name);
}
