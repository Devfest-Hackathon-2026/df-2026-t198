/** Limit worker types to the inert tree API; do not add browser DOM globals to core. */
declare module 'linkedom/worker' {
  export interface TreeElement {
    localName: string;
    namespaceURI: string;
    attributes: ArrayLike<{ name: string; value: string }> & Iterable<{ name: string; value: string }>;
    textContent: string | null;
    querySelectorAll(selector: string): ArrayLike<TreeElement> & Iterable<TreeElement>;
    querySelector(selector: string): TreeElement | null;
    closest(selector: string): TreeElement | null;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  }
  export function parseHTML(html: string): { document: TreeElement };
}
